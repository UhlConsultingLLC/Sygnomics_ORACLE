/* eslint-disable @typescript-eslint/no-explicit-any --
 * Plotly layout objects + validation-run API response use dynamic
 * keys not fully typed yet. Tracked for v1.1.
 */
/* eslint-disable react-hooks/exhaustive-deps --
 * Polling effect intentionally closes over the runId rather than
 * re-subscribing on dep changes.
 */
import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import axios from 'axios';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { InterpretBox, InlineHelp } from '../components/Interpretation';
import { withProvenance, provenanceImageFilename } from '../utils/provenance';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface MOACategory {
  category: string;
  value: string;
  drug_count: number;
  is_group: boolean;
}

interface TestingTrial {
  nct_id: string;
  title?: string;
  enrollment?: number;
  actual_response_rate: number;
  mean_predicted_rate: number;
  std_predicted_rate: number;
  mean_fraction_above_threshold?: number;
  fractions_above_threshold?: number[];
}

interface SimResult {
  moa_category: string;
  moa_value: string;
  testing_trials: TestingTrial[];
}

interface RunStatus {
  status: 'idle' | 'queued' | 'running' | 'complete' | 'error';
  stage?: string;
  detail?: string;
  pct?: number;
  error?: string;
  moa_label?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Module-level persistent store (survives navigation + page refresh)
// ─────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'threshold_validation_state_v1';

interface StoreState {
  selectedMOA: string;
  nIterations: number;
  status: RunStatus;
  result: SimResult | null;
}

const defaultState: StoreState = {
  selectedMOA: '',
  nIterations: 500,
  status: { status: 'idle' },
  result: null,
};

const loadInitial = (): StoreState => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    // If a run was in flight, the in-memory loop is gone after a hard
    // refresh — treat as idle but keep the result if any.
    const status: RunStatus =
      parsed.status?.status === 'running' || parsed.status?.status === 'queued'
        ? { status: 'idle' }
        : parsed.status || { status: 'idle' };
    return { ...defaultState, ...parsed, status };
  } catch {
    return defaultState;
  }
};

const store = {
  state: loadInitial(),
  listeners: new Set<() => void>(),
  cancel: false,

  subscribe(fn: () => void) {
    store.listeners.add(fn);
    return () => store.listeners.delete(fn);
  },
  getSnapshot() {
    return store.state;
  },
  setState(patch: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>)) {
    const next = typeof patch === 'function' ? patch(store.state) : patch;
    store.state = { ...store.state, ...next };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
    } catch {
      /* quota or disabled */
    }
    store.listeners.forEach((l) => l());
  },
};

const useStore = (): StoreState => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

// ─────────────────────────────────────────────────────────────────────────
// Module-level run loop (lives outside React lifecycle)
// ─────────────────────────────────────────────────────────────────────────

async function runValidation(moaValue: string, moaLabel: string, nIterations: number) {
  if (store.state.status.status === 'running' || !moaValue) return;
  store.cancel = false;
  store.setState({
    status: { status: 'running', stage: 'starting…', pct: 0, moa_label: moaLabel },
    result: null,
  });

  try {
    const startResp = await api.post('/simulation/moa-run', {
      moa_category: moaValue,
      n_iterations: nIterations,
      save_plots: false,
    });
    const simId: string = startResp.data.sim_id;

    while (true) {
      if (store.cancel) {
        store.setState({ status: { status: 'idle' } });
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const { data } = await api.get(`/simulation/moa-status/${simId}`);
      store.setState({
        status: {
          status: data.status,
          stage: data.stage,
          detail: data.detail,
          pct: data.progress_pct,
          error: data.error,
          moa_label: moaLabel,
        },
      });
      if (data.status === 'complete' && data.result) {
        const tt: TestingTrial[] = (data.result.testing_trials || [])
          .filter((t: any) => typeof t.actual_response_rate === 'number' && typeof t.mean_predicted_rate === 'number')
          .map((t: any) => ({
            nct_id: t.nct_id,
            title: t.title,
            enrollment: t.enrollment,
            actual_response_rate: t.actual_response_rate,
            mean_predicted_rate: t.mean_predicted_rate,
            std_predicted_rate: t.std_predicted_rate,
            mean_fraction_above_threshold: t.mean_fraction_above_threshold,
            fractions_above_threshold: Array.isArray(t.fractions_above_threshold)
              ? t.fractions_above_threshold
              : undefined,
          }));
        store.setState({
          result: {
            moa_category: data.result.moa_category || moaLabel,
            moa_value: moaValue,
            testing_trials: tt,
          },
        });
        return;
      } else if (data.status === 'error') {
        return;
      }
    }
  } catch (e: any) {
    store.setState({
      status: { status: 'error', error: String(e?.message || e), moa_label: moaLabel },
    });
  }
}

function cancelValidation() {
  store.cancel = true;
  store.setState({ status: { status: 'idle' } });
}

// ─────────────────────────────────────────────────────────────────────────
// Statistics helpers — all computed client-side, no new libraries.
// ─────────────────────────────────────────────────────────────────────────

/** Percentile of a numeric array (linear interpolation). p in [0, 1]. */
function percentile(values: number[], p: number): number {
  if (!values || values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Percentile bootstrap CI on the mean of an array of values. */
function bootstrapMeanCI(
  values: number[],
  nResamples = 1000,
  alpha = 0.05,
  seed = 1,
): { low: number; high: number; mean: number } {
  if (!values || values.length === 0) return { low: NaN, high: NaN, mean: NaN };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { low: mean, high: mean, mean };
  // Simple LCG so the CI is deterministic across renders.
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const means: number[] = new Array(nResamples);
  for (let b = 0; b < nResamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)];
    means[b] = sum / n;
  }
  return {
    low: percentile(means, alpha / 2),
    high: percentile(means, 1 - alpha / 2),
    mean,
  };
}

/** Wilson score interval for a binomial proportion. */
function wilsonCI(successes: number, total: number, alpha = 0.05): { low: number; high: number; p: number } {
  if (total === 0) return { low: NaN, high: NaN, p: NaN };
  const p = successes / total;
  // Normal critical value for common alphas (avoid pulling in a whole stats lib).
  const z = alpha === 0.05 ? 1.959963984540054 : alpha === 0.1 ? 1.6448536269514722 : 1.959963984540054;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin), p };
}

// ─────────────────────────────────────────────────────────────────────────
// Marketing math
// ─────────────────────────────────────────────────────────────────────────

interface TrialEconomy {
  nct_id: string;
  enrollment: number;
  actual_rr: number;
  fraction_above: number;
  screened_rr: number; // R_actual / fraction_above, capped at 1
  lift_pp: number; // percentage-point lift
  nnt_actual: number;
  nnt_screened: number;
  screen_burden_reduction: number; // 1 - (fraction_above)
  is_winner: boolean;
  // 95% CIs derived from the per-iteration fraction distribution.
  // Undefined when the backend did not send the iteration array.
  screened_ci_low?: number;
  screened_ci_high?: number;
  lift_pp_ci_low?: number;
  lift_pp_ci_high?: number;
  n_iterations?: number;
}

function deriveEconomy(t: TestingTrial): TrialEconomy | null {
  const f = t.mean_fraction_above_threshold ?? 0;
  if (!f || f <= 0 || !t.actual_response_rate) return null;
  const actual = t.actual_response_rate;
  // Marketing assumption: responders concentrate in the above-threshold pool.
  // Screened response rate scales as R_actual / fraction_screened_in.
  const screened = Math.min(1, actual / f);
  const lift_pp = (screened - actual) * 100;
  const nnt_actual = actual > 0 ? 1 / actual : Infinity;
  const nnt_screened = screened > 0 ? 1 / screened : Infinity;
  const screen_burden_reduction = 1 - f;

  // Per-iteration 95% CIs. If the backend sent fractions_above_threshold,
  // map each iteration's fraction through the same R/f formula to build an
  // honest distribution of screened RR and lift, then take 2.5/97.5 percentiles.
  let screened_ci_low: number | undefined;
  let screened_ci_high: number | undefined;
  let lift_pp_ci_low: number | undefined;
  let lift_pp_ci_high: number | undefined;
  let n_iterations: number | undefined;
  const iters = t.fractions_above_threshold;
  if (Array.isArray(iters) && iters.length >= 2) {
    const validIters = iters.filter((x) => typeof x === 'number' && x > 0);
    if (validIters.length >= 2) {
      const itScreened = validIters.map((fi) => Math.min(1, actual / fi));
      const itLift = itScreened.map((s) => (s - actual) * 100);
      screened_ci_low = percentile(itScreened, 0.025);
      screened_ci_high = percentile(itScreened, 0.975);
      lift_pp_ci_low = percentile(itLift, 0.025);
      lift_pp_ci_high = percentile(itLift, 0.975);
      n_iterations = validIters.length;
    }
  }

  return {
    nct_id: t.nct_id,
    enrollment: t.enrollment ?? 0,
    actual_rr: actual,
    fraction_above: f,
    screened_rr: screened,
    lift_pp,
    nnt_actual,
    nnt_screened,
    screen_burden_reduction,
    is_winner: lift_pp > 0,
    screened_ci_low,
    screened_ci_high,
    lift_pp_ci_low,
    lift_pp_ci_high,
    n_iterations,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

export default function ThresholdValidation() {
  const { selectedMOA, nIterations, status, result } = useStore();
  const [categories, setCategories] = useState<MOACategory[]>([]);
  const forestRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/simulation/moa-categories').then(({ data }) => setCategories(data));
  }, []);

  const setSelectedMOA = (v: string) => store.setState({ selectedMOA: v });
  const setNIterations = (n: number) => store.setState({ nIterations: n });

  const handleRun = () => {
    if (!selectedMOA) return;
    const cat = categories.find((c) => c.value === selectedMOA);
    runValidation(selectedMOA, cat?.category || selectedMOA, nIterations);
  };

  // Compute economies for marketing summary
  const economies: TrialEconomy[] =
    result?.testing_trials.map(deriveEconomy).filter((e): e is TrialEconomy => e !== null) || [];
  const winners = economies.filter((e) => e.is_winner);
  const winRate = economies.length > 0 ? winners.length / economies.length : 0;
  const meanLift = economies.length > 0 ? economies.reduce((s, e) => s + e.lift_pp, 0) / economies.length : 0;
  const medianLift = (() => {
    if (economies.length === 0) return 0;
    const sorted = [...economies.map((e) => e.lift_pp)].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  })();
  const bestTrial =
    economies.length > 0 ? economies.reduce((best, e) => (e.lift_pp > best.lift_pp ? e : best), economies[0]) : null;
  const meanScreenReduction =
    economies.length > 0 ? economies.reduce((s, e) => s + e.screen_burden_reduction, 0) / economies.length : 0;
  const meanNNTReduction = (() => {
    if (economies.length === 0) return 0;
    const ratios = economies
      .filter((e) => isFinite(e.nnt_actual) && isFinite(e.nnt_screened) && e.nnt_actual > 0)
      .map((e) => 1 - e.nnt_screened / e.nnt_actual);
    if (ratios.length === 0) return 0;
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
  })();

  // Cohort-level 95% confidence intervals.
  // Bootstrap the mean lift across testing trials (resample trials with
  // replacement — captures between-trial variability, which is the honest
  // interval on the headline number).
  const meanLiftCI =
    economies.length > 1
      ? bootstrapMeanCI(
          economies.map((e) => e.lift_pp),
          2000,
          0.05,
        )
      : { low: NaN, high: NaN, mean: meanLift };
  // Wilson score interval on the win rate (binomial proportion, small-n safe).
  const winRateCI = wilsonCI(winners.length, economies.length, 0.05);
  // Bootstrap the mean NNT reduction as well, using the same resampling.
  const nntReductionCI = (() => {
    const ratios = economies
      .filter((e) => isFinite(e.nnt_actual) && isFinite(e.nnt_screened) && e.nnt_actual > 0)
      .map((e) => 1 - e.nnt_screened / e.nnt_actual);
    return ratios.length > 1 ? bootstrapMeanCI(ratios, 2000, 0.05) : { low: NaN, high: NaN, mean: 0 };
  })();

  // Render forest plot whenever result changes
  useEffect(() => {
    if (!forestRef.current) return;
    if (economies.length === 0) {
      Plotly.purge(forestRef.current);
      return;
    }
    // Sort by lift descending so biggest wins are at the top
    const sorted = [...economies].sort((a, b) => b.lift_pp - a.lift_pp);
    const labels = sorted.map((e) => e.nct_id);
    const actualXs = sorted.map((e) => e.actual_rr * 100);
    const screenedXs = sorted.map((e) => e.screened_rr * 100);
    // Asymmetric error bars on the screened-RR diamond: built from each
    // trial's iteration-level 2.5 / 97.5 percentile of the screened RR
    // distribution. Undefined when the backend did not send iterations.
    const screenedErrPlus = sorted.map((e) =>
      e.screened_ci_high != null ? (e.screened_ci_high - e.screened_rr) * 100 : 0,
    );
    const screenedErrMinus = sorted.map((e) =>
      e.screened_ci_low != null ? (e.screened_rr - e.screened_ci_low) * 100 : 0,
    );
    const liftLabels = sorted.map((e) => {
      const liftCI =
        e.lift_pp_ci_low != null && e.lift_pp_ci_high != null
          ? `<br>Lift 95% CI: [${e.lift_pp_ci_low >= 0 ? '+' : ''}${e.lift_pp_ci_low.toFixed(1)}, ${e.lift_pp_ci_high >= 0 ? '+' : ''}${e.lift_pp_ci_high.toFixed(1)}] pp`
          : '';
      return (
        `${e.nct_id}<br>Trial: ${(e.actual_rr * 100).toFixed(1)}%<br>` +
        `ORACLE-screened: ${(e.screened_rr * 100).toFixed(1)}%<br>` +
        `Lift: ${e.lift_pp >= 0 ? '+' : ''}${e.lift_pp.toFixed(1)} pp` +
        liftCI
      );
    });

    // Connector lines (one shape per row from actual → screened)
    const shapes: Partial<Plotly.Shape>[] = sorted.map((e, i) => ({
      type: 'line' as const,
      x0: e.actual_rr * 100,
      x1: e.screened_rr * 100,
      y0: i,
      y1: i,
      line: { color: e.is_winner ? '#634697' : '#aaaaaa', width: 2 },
      layer: 'below' as const,
    }));

    const traces: Partial<Plotly.PlotData>[] = [
      {
        x: actualXs,
        y: labels,
        type: 'scatter',
        mode: 'markers',
        name: 'Actual trial RR',
        marker: { size: 11, color: '#888', symbol: 'circle' },
        hoverinfo: 'text',
        text: liftLabels,
      },
      {
        x: screenedXs,
        y: labels,
        type: 'scatter',
        mode: 'markers',
        name: 'ORACLE-screened RR (95% CI)',
        marker: { size: 12, color: '#634697', symbol: 'diamond', line: { color: '#fff', width: 1 } },
        error_x: {
          type: 'data',
          symmetric: false,
          array: screenedErrPlus,
          arrayminus: screenedErrMinus,
          color: '#634697',
          thickness: 1.2,
          width: 4,
          visible: true,
        },
        hoverinfo: 'text',
        text: liftLabels,
      },
    ];

    const ciUpper = sorted.map((_e, i) => screenedXs[i] + (screenedErrPlus[i] || 0));
    const maxX = Math.max(...screenedXs, ...actualXs, ...ciUpper) * 1.1;
    const layout: Partial<Plotly.Layout> = {
      title: { text: '' },
      xaxis: {
        title: { text: 'Response Rate (%)' },
        range: [0, Math.max(maxX, 20)],
        zeroline: true,
        zerolinecolor: '#ddd',
        automargin: true,
      },
      yaxis: {
        automargin: true,
        tickfont: { size: 10 },
        autorange: 'reversed',
      },
      shapes,
      height: Math.max(300, 28 * sorted.length + 80),
      margin: { l: 110, r: 30, t: 20, b: 50 },
      legend: { orientation: 'h', y: 1.08, x: 0 },
      hovermode: 'closest',
      plot_bgcolor: '#fff',
    };

    Plotly.newPlot(forestRef.current, traces as any, withProvenance(layout, '/threshold-validation'), {
      displayModeBar: true,
      responsive: true,
      toImageButtonOptions: { format: 'svg', filename: provenanceImageFilename('threshold_validation'), scale: 4 },
    });
  }, [result]);

  const isRunning = status.status === 'running' || status.status === 'queued';

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Threshold Validation</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem', maxWidth: 900 }}>
        How much better would clinical trial response rates have been if patients had been pre-screened with ORACLE's
        learned DCNA threshold? This page runs a held-out trial validation: ORACLE learns the threshold on the training
        trials, then for every testing trial it has never seen, computes the response rate the trial would have achieved
        if only patients meeting <strong>both</strong> criteria had been enrolled — DCNA above the learned threshold{' '}
        <strong>and</strong> gene expression above 0. Patients are only counted as predicted responders when they
        satisfy both conditions.
      </p>

      <InterpretBox id="threshold-validation-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          Think of it as a <strong>back-test for a biomarker</strong>. ORACLE only ever "sees" the training trials; the
          testing trials are held-out. For each one, we ask:{' '}
          <em>
            if the trial had enrolled only the patients who pass ORACLE's filter, what would the response rate have
            been?
          </em>
          If the screened rate beats the actual rate, that's a "win" — the biomarker would have helped.
        </p>
        <ul style={{ margin: '0 0 0.4rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Win rate</strong> — fraction of held-out trials where screening helped. Higher is better. Reported
            with a Wilson 95% CI (small-sample safe for proportions).
          </li>
          <li>
            <strong>Mean / Median Lift</strong> — average / typical improvement in percentage points. A lift of +10 pp
            means a trial that reported 20% responders would have seen 30%. The mean has a bootstrap 95% CI; the median
            is robust to outlier trials.
          </li>
          <li>
            <strong>NNT (Number Needed to Treat)</strong> — patients enrolled per responder found. Lower is better. A
            30% NNT reduction means the same clinical signal with 30% fewer enrollees.
          </li>
          <li>
            <strong>Screen-failure reduction</strong> — fraction of patients the biomarker filters out before
            enrollment. Higher = less waste, but also fewer patients to recruit from.
          </li>
          <li>
            <strong>Forest plot</strong> — each row is one held-out trial. Grey = actual rate, purple diamond = screened
            rate (with 95% CI bars). Lines trending right are wins.
          </li>
        </ul>
        <p style={{ margin: '0 0 0.3rem' }}>
          <strong>What counts as a good result?</strong> Win rate ≥ 70% with mean lift CI strictly above 0 suggests the
          biomarker generalizes. Wide CIs that cross zero mean "not enough held-out trials to be sure yet" — increase
          the training corpus or pick a different MOA.
        </p>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          Methodology assumption: responders concentrate in the above-threshold pool, so
          <code style={{ margin: '0 4px' }}>R_screened = R_actual / fraction_passing_filter</code>. This is an upper
          bound — real-world prospective screening performance is bounded by this number, not exactly equal to it.
        </p>
      </InterpretBox>

      {/* Configuration */}
      <div
        style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Pick a Mechanism of Action</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#555', marginBottom: 4 }}>
              MOA Category
            </label>
            <select
              value={selectedMOA}
              onChange={(e) => setSelectedMOA(e.target.value)}
              disabled={isRunning}
              style={{
                width: '100%',
                padding: '0.45rem',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: '0.85rem',
              }}
            >
              <option value="">— Select an MOA —</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.category}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', color: '#555', marginBottom: 4 }}>Iterations</label>
            <input
              type="number"
              min={50}
              max={2000}
              step={50}
              value={nIterations}
              disabled={isRunning}
              onChange={(e) => setNIterations(Math.max(50, Math.min(2000, parseInt(e.target.value) || 500)))}
              style={{ width: '100%', padding: '0.45rem', border: '1px solid #ccc', borderRadius: 4 }}
            />
          </div>
          {isRunning ? (
            <button
              onClick={cancelValidation}
              style={{
                padding: '0.55rem 1.2rem',
                background: '#a12a8b',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!selectedMOA}
              style={{
                padding: '0.55rem 1.2rem',
                background: !selectedMOA ? '#bbb' : '#634697',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: !selectedMOA ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Run Validation
            </button>
          )}
        </div>

        {/* Progress */}
        {(isRunning || status.status === 'error') && (
          <div style={{ marginTop: '0.85rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>
                <strong>{status.moa_label}</strong> —{' '}
                <span style={{ color: status.status === 'error' ? '#c62828' : '#555' }}>{status.status}</span>{' '}
                {status.stage && `(${status.stage})`}
              </span>
              <span style={{ color: '#888' }}>{status.pct ? `${Math.round(status.pct)}%` : ''}</span>
            </div>
            <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${status.pct || 0}%`,
                  height: '100%',
                  background: '#634697',
                  transition: 'width 0.3s',
                }}
              />
            </div>
            {status.error && <div style={{ color: '#c62828', marginTop: 4 }}>{status.error}</div>}
          </div>
        )}
      </div>

      {/* Results — marketing-style */}
      {result && economies.length > 0 && (
        <>
          {/* Hero headline */}
          <div
            style={{
              background: 'linear-gradient(135deg, #1c3e72 0%, #634697 100%)',
              color: '#fff',
              borderRadius: 10,
              padding: '1.5rem 1.75rem',
              marginBottom: '1rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                opacity: 0.85,
                marginBottom: 6,
              }}
            >
              Held-out Validation — {result.moa_category}
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: 700, lineHeight: 1.25, marginBottom: 8 }}>
              ORACLE pre-screening would have improved response rates in{' '}
              <span style={{ color: '#ffd54f' }}>
                {winners.length} of {economies.length}
              </span>{' '}
              held-out clinical trials.
            </div>
            <div style={{ fontSize: '1.05rem', opacity: 0.95 }}>
              Average response-rate lift: <strong style={{ color: '#ffd54f' }}>+{meanLift.toFixed(1)} pp</strong>
              {!isNaN(meanLiftCI.low) && (
                <span style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                  {' '}
                  (95% CI {meanLiftCI.low >= 0 ? '+' : ''}
                  {meanLiftCI.low.toFixed(1)} to {meanLiftCI.high >= 0 ? '+' : ''}
                  {meanLiftCI.high.toFixed(1)})
                </span>
              )}
              {' · '}
              Win rate: <strong style={{ color: '#ffd54f' }}>{(winRate * 100).toFixed(0)}%</strong>
              {!isNaN(winRateCI.low) && (
                <span style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                  {' '}
                  (95% CI {(winRateCI.low * 100).toFixed(0)}–{(winRateCI.high * 100).toFixed(0)}%)
                </span>
              )}
              {' · '}
              Median NNT reduction: <strong style={{ color: '#ffd54f' }}>{(meanNNTReduction * 100).toFixed(0)}%</strong>
            </div>
          </div>

          {/* Stat tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <StatTile
              label="Held-out Trials"
              value={String(economies.length)}
              accent="#1c3e72"
              tooltip="Number of testing trials the threshold was evaluated on — trials ORACLE never saw during training."
            />
            <StatTile
              label="Win Rate"
              value={`${(winRate * 100).toFixed(0)}%`}
              sub={
                !isNaN(winRateCI.low)
                  ? `${winners.length}/${economies.length} · 95% CI ${(winRateCI.low * 100).toFixed(0)}–${(winRateCI.high * 100).toFixed(0)}%`
                  : `${winners.length} of ${economies.length}`
              }
              accent="#634697"
              tooltip="Share of held-out trials where the screened response rate beat the actual rate. 95% CI is a Wilson score interval — reliable even with small samples."
            />
            <StatTile
              label="Mean Lift"
              value={`+${meanLift.toFixed(1)} pp`}
              sub={
                !isNaN(meanLiftCI.low)
                  ? `95% CI [${meanLiftCI.low >= 0 ? '+' : ''}${meanLiftCI.low.toFixed(1)}, ${meanLiftCI.high >= 0 ? '+' : ''}${meanLiftCI.high.toFixed(1)}]`
                  : 'vs actual trial RR'
              }
              accent="#634697"
              tooltip="Average improvement in response rate (percentage points). 95% CI is a 2,000-sample bootstrap over trials. If the lower bound is above 0, the lift is significant at α=0.05."
            />
            <StatTile
              label="Median Lift"
              value={`+${medianLift.toFixed(1)} pp`}
              sub="50th percentile"
              accent="#634697"
              tooltip="Middle trial's lift. Less sensitive than the mean to a single huge-win outlier — a better 'typical' result."
            />
            {bestTrial && (
              <StatTile
                label="Best Improvement"
                value={`+${bestTrial.lift_pp.toFixed(1)} pp`}
                sub={bestTrial.nct_id}
                accent="#a12a8b"
                tooltip="Largest single-trial lift. Anecdotal — use Median Lift for the typical result, not this."
              />
            )}
            <StatTile
              label="Avg NNT Reduction"
              value={`${(meanNNTReduction * 100).toFixed(0)}%`}
              sub={
                !isNaN(nntReductionCI.low)
                  ? `95% CI ${(nntReductionCI.low * 100).toFixed(0)}–${(nntReductionCI.high * 100).toFixed(0)}%`
                  : 'bootstrap across trials'
              }
              accent="#057fa5"
              tooltip="Reduction in Number Needed to Treat (patients per responder). 30% reduction = same clinical signal using 30% fewer enrollees. Bootstrap 95% CI across trials."
            />
            <StatTile
              label="Avg Screen-Failure Reduction"
              value={`${(meanScreenReduction * 100).toFixed(0)}%`}
              sub="patients filtered out"
              accent="#057fa5"
              tooltip="Fraction of candidate patients the biomarker would filter out before enrollment. Higher = less recruitment waste, but also a smaller eligible pool to recruit from."
            />
          </div>

          {/* Forest plot */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
              Per-trial response rate: actual vs ORACLE-screened
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#666', margin: '0 0 0.75rem' }}>
              Each row is a held-out testing trial. Grey circle = the response rate the trial actually reported. Purple
              diamond = the response rate the trial would have achieved if patients had been pre-screened to enroll only
              those above ORACLE's learned DCNA threshold
              <em> and</em> with gene expression &gt; 0. Horizontal bars through the diamond are the trial's 95%
              confidence interval on the screened response rate, derived from the iteration-level distribution of
              patients passing both filters. Bars trending right are wins.
            </p>
            <div ref={forestRef} style={{ width: '100%' }} />
          </div>

          {/* Patient-economy table */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Patient-Economy Breakdown</h3>
            <p style={{ fontSize: '0.78rem', color: '#666', margin: '0 0 0.75rem' }}>
              Number Needed to Treat (NNT) is the number of patients you must enroll to find one responder. ORACLE
              pre-screening lowers NNT and reduces the screen-fail burden — both translate directly to lower trial cost
              and faster enrollment.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#f0f0f0' }}>
                    <th style={th}>Trial</th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        N enrolled{' '}
                        <InlineHelp size={11} text="Self-reported enrollment size from ClinicalTrials.gov." />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Actual RR{' '}
                        <InlineHelp
                          size={11}
                          text="Response rate the trial actually reported — the unfiltered ground truth."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        ORACLE RR{' '}
                        <InlineHelp
                          size={11}
                          text="Projected response rate if only biomarker-passing patients had been enrolled."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Lift{' '}
                        <InlineHelp
                          size={11}
                          text="ORACLE RR minus Actual RR, in percentage points. Positive = the biomarker helped."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Lift 95% CI{' '}
                        <InlineHelp
                          size={11}
                          text="Per-trial 95% CI on the lift, derived from the iteration-level distribution of patients passing both filters. Intervals not crossing 0 are statistically convincing."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        NNT (actual){' '}
                        <InlineHelp
                          size={11}
                          text="Number Needed to Treat without screening = 1 / actual response rate."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        NNT (ORACLE){' '}
                        <InlineHelp
                          size={11}
                          text="Number Needed to Treat after biomarker screening. Lower is better."
                        />
                      </span>
                    </th>
                    <th style={thNum}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Screen-fail ↓{' '}
                        <InlineHelp
                          size={11}
                          text="Percentage of candidate patients filtered out by the biomarker. 40% means 40% fewer biopsies / washouts."
                        />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...economies]
                    .sort((a, b) => b.lift_pp - a.lift_pp)
                    .map((e) => (
                      <tr
                        key={e.nct_id}
                        style={{ borderTop: '1px solid #eee', background: e.is_winner ? '#fafaff' : '#fff' }}
                      >
                        <td style={td}>{e.nct_id}</td>
                        <td style={tdNum}>{e.enrollment || '—'}</td>
                        <td style={tdNum}>{(e.actual_rr * 100).toFixed(1)}%</td>
                        <td style={{ ...tdNum, color: e.is_winner ? '#634697' : '#888', fontWeight: 600 }}>
                          {(e.screened_rr * 100).toFixed(1)}%
                        </td>
                        <td style={{ ...tdNum, color: e.is_winner ? '#2e7d32' : '#c62828', fontWeight: 600 }}>
                          {e.lift_pp >= 0 ? '+' : ''}
                          {e.lift_pp.toFixed(1)} pp
                        </td>
                        <td style={{ ...tdNum, color: '#555', fontSize: '0.75rem' }}>
                          {e.lift_pp_ci_low != null && e.lift_pp_ci_high != null
                            ? `[${e.lift_pp_ci_low >= 0 ? '+' : ''}${e.lift_pp_ci_low.toFixed(1)}, ${e.lift_pp_ci_high >= 0 ? '+' : ''}${e.lift_pp_ci_high.toFixed(1)}]`
                            : '—'}
                        </td>
                        <td style={tdNum}>{isFinite(e.nnt_actual) ? e.nnt_actual.toFixed(1) : '—'}</td>
                        <td style={tdNum}>{isFinite(e.nnt_screened) ? e.nnt_screened.toFixed(1) : '—'}</td>
                        <td style={tdNum}>−{(e.screen_burden_reduction * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Marketing closer */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 8,
              padding: '1.25rem 1.5rem',
              marginBottom: '1rem',
              borderLeft: '4px solid #634697',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#1c3e72' }}>
              What this means for trial sponsors
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', lineHeight: 1.7, color: '#333' }}>
              <li>
                Across the {economies.length} held-out <strong>{result.moa_category}</strong> trials, ORACLE
                pre-screening produced an average response-rate lift of{' '}
                <strong>+{meanLift.toFixed(1)} percentage points</strong>.
              </li>
              <li>
                In <strong>{(winRate * 100).toFixed(0)}%</strong> of held-out trials, ORACLE-screened cohorts beat the
                actual reported rate — a result that did not depend on having seen those trials during training.
              </li>
              <li>
                Average screen-failure burden was reduced by <strong>{(meanScreenReduction * 100).toFixed(0)}%</strong>,
                meaning fewer patients were enrolled, biopsied, and washed out before efficacy could be assessed.
              </li>
              <li>
                Median NNT was reduced by <strong>{(meanNNTReduction * 100).toFixed(0)}%</strong> — a proportional
                reduction in the number of patients needed to find one responder.
              </li>
              {bestTrial && (
                <li>
                  Largest single-trial improvement: <strong>{bestTrial.nct_id}</strong>, going from{' '}
                  <strong>{(bestTrial.actual_rr * 100).toFixed(1)}%</strong> to{' '}
                  <strong>{(bestTrial.screened_rr * 100).toFixed(1)}%</strong> (+{bestTrial.lift_pp.toFixed(1)} pp).
                </li>
              )}
            </ul>
            <p style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.85rem', marginBottom: 0 }}>
              Methodology note: ORACLE-screened response rate is derived as
              <code style={{ margin: '0 4px' }}>R_screened = R_actual / fraction_passing_both_filters</code>, under the
              assumption that responders concentrate in the cohort of patients that are both above the learned DCNA
              threshold <strong>and</strong> above the gene-expression threshold of 0. Patients are only considered
              responders if they meet both criteria. The DCNA threshold itself is learned from training trials only and
              applied unchanged to each held-out testing trial; the gene-expression threshold is fixed at 0. Per-trial
              95% confidence intervals are computed from the iteration-level distribution of the fraction of patients
              passing both filters (2.5th / 97.5th percentiles). Cohort-level 95% intervals on mean lift and NNT
              reduction use a percentile bootstrap over testing trials (2,000 resamples); the win rate uses a Wilson
              score interval.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Small UI helpers
// ─────────────────────────────────────────────────────────────────────────

const th: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 0.6rem', fontWeight: 600, fontSize: '0.78rem' };
const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '0.45rem 0.6rem' };
const tdNum: React.CSSProperties = { ...td, textAlign: 'right' };

function StatTile({
  label,
  value,
  sub,
  accent,
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  tooltip?: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e0e0e0',
        borderRadius: 8,
        padding: '0.85rem 1rem',
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span>{label}</span>
        {tooltip && <InlineHelp text={tooltip} size={12} />}
      </div>
      <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#1c3e72', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
