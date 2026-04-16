/* eslint-disable @typescript-eslint/no-explicit-any --
 * This page interacts heavily with (a) Plotly.js layout objects whose
 * public TS types have incomplete unions for the nested `annotations`,
 * `shapes`, `xaxis.title`, and `marker` shapes we use, and (b) dynamic
 * simulation/responder-similarity API JSON whose structure varies by
 * endpoint. Both are legitimate escape hatches — proper types for each
 * would be a ~200-line effort and is tracked for v1.1. Reviewers still
 * see each `any` on the source line; the rule just doesn't fail CI.
 */
/* eslint-disable react-hooks/exhaustive-deps --
 * Multiple effects intentionally omit state setters (stable by React
 * contract but not seen as such by the plugin) and computed locals
 * (e.g. `spearman`, `testingPts`) that the authors deliberately
 * capture by closure rather than re-run on every change. Individual
 * refactors are tracked for v1.1.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { usePersistentState } from '../hooks/usePersistentState';
import { Metric, InterpretBox } from '../components/Interpretation';
import { withProvenance, provenanceImageFilename } from '../utils/provenance';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

interface MOACategory {
  category: string;
  value: string;
  drug_count: number;
  is_group: boolean;
  drugs: string[];
  members: string[];
  part_of_group?: boolean;
}

interface SimProgress {
  sim_id: string;
  status: 'running' | 'complete' | 'error';
  stage: string;
  detail: string;
  progress_pct: number;
  result?: any;
  error?: string;
}

const SIM_STORAGE_KEY = 'moa_simulation_state';

interface PersistedSimState {
  simId: string;
  selectedMOA: string;
  nIterations: number;
}

function saveSimState(state: PersistedSimState) {
  localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(state));
}

function loadSimState(): PersistedSimState | null {
  try {
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSimState() {
  localStorage.removeItem(SIM_STORAGE_KEY);
}

export default function Simulation() {
  const [categories, setCategories] = useState<MOACategory[]>([]);
  const [selectedMOA, setSelectedMOA, resetSelectedMOA] = usePersistentState<string>('sim_selected_moa', '');
  const [nIterations, setNIterations, resetNIterations] = usePersistentState<number>('sim_n_iterations', 1000);
  const [confidenceLevel, setConfidenceLevel, resetConfidenceLevel] = usePersistentState<number>(
    'sim_confidence_level',
    95,
  );
  const [simId, setSimId] = useState('');
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [result, setResult] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const handleReset = () => {
    clearSimState();
    resetSelectedMOA();
    resetNIterations();
    resetConfidenceLevel();
    setSimId('');
    setProgress(null);
    setResult(null);
    try {
      sessionStorage.removeItem('sim_rsim_rule');
      sessionStorage.removeItem('sim_rsim_q_cutoff');
      sessionStorage.removeItem('sim_rsim_type_filter');
    } catch {
      /* noop */
    }
  };

  // Load MOA categories on mount
  useEffect(() => {
    api.get('/simulation/moa-categories').then(({ data }) => setCategories(data));
  }, []);

  // Restore persisted simulation state on mount
  useEffect(() => {
    const saved = loadSimState();
    if (saved?.simId) {
      setSimId(saved.simId);
      setSelectedMOA(saved.selectedMOA);
      setNIterations(saved.nIterations);
    }
  }, []);

  // Poll for simulation progress
  useEffect(() => {
    if (!simId) return;
    const poll = () => {
      api
        .get(`/simulation/moa-status/${simId}`)
        .then(({ data }) => {
          setProgress(data);
          if (data.status === 'complete' && data.result) {
            setResult(data.result);
            clearInterval(pollRef.current);
          } else if (data.status === 'error') {
            clearInterval(pollRef.current);
          }
        })
        .catch(() => {
          // Server may have restarted — simulation lost
          clearInterval(pollRef.current);
          clearSimState();
          setProgress(null);
          setSimId('');
        });
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, [simId]);

  const handleStart = async () => {
    if (!selectedMOA) return;
    setStarting(true);
    setResult(null);
    setProgress(null);
    try {
      const { data } = await api.post('/simulation/moa-run', {
        moa_category: selectedMOA,
        n_iterations: nIterations,
        save_plots: true,
      });
      setSimId(data.sim_id);
      saveSimState({ simId: data.sim_id, selectedMOA, nIterations });
    } catch {
      alert('Failed to start simulation');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>MOA-Based In-Silico Simulation</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Select a Mechanism of Action to run a DCNA threshold learning simulation using TCGA-GBM cohort data.
      </p>

      <InterpretBox id="simulation-intro" title="How this simulation works">
        <p style={{ margin: '0 0 0.5rem' }}>
          For a chosen MOA, ORACLE takes all historical trials of drugs in that category, splits them into{' '}
          <strong>training</strong> and <strong>testing</strong> sets, and for each trial asks: "which DCNA threshold on
          TCGA patients best recovers the trial's reported response rate?" The training-trial thresholds are aggregated
          into a single <em>learned threshold</em>, which is then applied unchanged to each testing trial to predict a
          response rate. Comparing predicted vs. observed is how we measure whether the biomarker holds up.
        </p>
        <ul style={{ margin: '0 0 0.4rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Iterations per trial</strong> — how many times to bootstrap-resample the TCGA cohort when learning
            each trial's per-run threshold. More iterations tighten the CIs (diminishing returns past ~1,000).
          </li>
          <li>
            <strong>Confidence level</strong> — used everywhere downstream: per-trial CI bars, Bland-Altman limits of
            agreement, CI coverage bars. You can edit it after the run; figures update without rerunning.
          </li>
          <li>
            <strong>Learned threshold</strong> — the single DCNA cutoff this simulation produced. Patients with DCNA
            above it are predicted responders.
          </li>
          <li>
            <strong>Threshold Std</strong> — spread of thresholds across training trials. Small = consistent /
            generalizable. Large = different training trials disagree, so the biomarker may not be stable.
          </li>
          <li>
            <strong>Median RR</strong> — the middle reported response rate among the trials in this MOA. A useful
            baseline for interpreting predicted lifts.
          </li>
        </ul>
        <p style={{ margin: 0, color: '#555', fontSize: '0.8rem' }}>
          After the run, scroll through the violin / box / calibration / Bland-Altman plots — each section has its own
          interpretation note explaining what "good" looks like for that figure.
        </p>
      </InterpretBox>

      {/* Configuration Panel */}
      <div
        style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Simulation Configuration</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: 4 }}>MOA Category</label>
            <MOAAutocomplete categories={categories} value={selectedMOA} onChange={setSelectedMOA} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: 4 }}>
              Iterations per Trial
            </label>
            <input
              type="number"
              min={10}
              max={5000}
              step={100}
              value={nIterations}
              onChange={(e) => setNIterations(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#555', marginBottom: 4 }}>
              Confidence Level (%)
            </label>
            <input
              type="number"
              min={1}
              max={99.99}
              step={0.1}
              value={confidenceLevel}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0 && v < 100) setConfidenceLevel(v);
              }}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
              title="Used by all downstream statistics: Per-Therapy box plot footer, Bland-Altman LoA, and CI Coverage analysis. Editable any time — figures update automatically."
            />
          </div>
        </div>
        <button
          onClick={handleStart}
          disabled={!selectedMOA || starting || progress?.status === 'running'}
          style={{
            marginTop: '1rem',
            padding: '0.5rem 2rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            background: !selectedMOA ? '#ccc' : '#1a1a2e',
            color: !selectedMOA ? '#888' : '#00d4ff',
            border: 'none',
            borderRadius: 6,
            cursor: !selectedMOA ? 'not-allowed' : 'pointer',
          }}
        >
          {starting ? 'Starting...' : progress?.status === 'running' ? 'Simulation Running...' : 'Run Simulation'}
        </button>
        <button
          onClick={handleReset}
          style={{
            marginTop: '1rem',
            marginLeft: '0.5rem',
            padding: '0.5rem 1.5rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            background: '#6c757d',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      {/* Progress Panel */}
      {progress && progress.status === 'running' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Simulation Progress</h3>
          <div style={{ background: '#e9ecef', borderRadius: 8, height: 24, overflow: 'hidden', marginBottom: 8 }}>
            <div
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #1a1a2e, #00d4ff)',
                width: `${progress.progress_pct}%`,
                borderRadius: 8,
                transition: 'width 0.5s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.72rem',
                color: '#fff',
                fontWeight: 600,
              }}
            >
              {progress.progress_pct > 10 ? `${Math.round(progress.progress_pct)}%` : ''}
            </div>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#555' }}>
            <strong>{progress.stage}</strong>: {progress.detail}
          </div>
        </div>
      )}

      {/* Error */}
      {progress?.status === 'error' && (
        <div
          style={{
            padding: '0.75rem',
            background: '#f8d7da',
            borderRadius: 8,
            color: '#721c24',
            marginBottom: '1rem',
            fontSize: '0.85rem',
          }}
        >
          <strong>Simulation Error:</strong> {progress.error}
        </div>
      )}

      {/* Results */}
      {result && !result.error && <SimulationResults data={result} confidenceLevel={confidenceLevel} />}
    </div>
  );
}

// ── Results Display ──────────────────────────────────────────────────────

function formatAgeRange(minAge?: string, maxAge?: string): string {
  const lo = (minAge || '').trim();
  const hi = (maxAge || '').trim();
  if (!lo && !hi) return '—';
  if (lo && hi) return `${lo} – ${hi}`;
  if (lo) return `≥ ${lo}`;
  return `≤ ${hi}`;
}

// Inverse standard-normal CDF (Acklam's approximation), used to convert a
// user-chosen confidence level into the corresponding z-multiplier for the
// Bland-Altman limits-of-agreement.
function zForConfidence(cl: number): number {
  const p = (1 + cl / 100) / 2;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
}

function SimulationResults({ data, confidenceLevel = 95 }: { data: any; confidenceLevel?: number }) {
  const [showStatAnalysis, setShowStatAnalysis] = useState(true);
  return (
    <div>
      {/* Summary Cards */}
      <div
        style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Simulation Summary — {data.moa_category}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.75rem' }}>
          <Metric
            label="Total Trials"
            value={data.total_trials}
            tooltip="All trials of drugs in this MOA category found in the database. The sum of training + testing + excluded."
          />
          <Metric
            label="Training Trials"
            value={data.training_trials?.length}
            hint="Used to learn the threshold"
            tooltip="Trials used to learn the DCNA threshold. The threshold is the aggregate (mean) of per-training-trial optimal cutoffs."
          />
          <Metric
            label="Testing Trials"
            value={data.testing_trials?.length}
            hint="Held-out for evaluation"
            tooltip="Trials the threshold is evaluated on. Never seen during learning — any predicted-vs-observed agreement here is genuine generalization."
          />
          <Metric
            label="Excluded Trials"
            value={data.excluded_trials?.length || 0}
            hint="Outliers filtered out"
            tooltip="Trials flagged as outliers and removed before splitting (e.g. unreasonably high/low response rates or insufficient data)."
          />
          <Metric
            label="Total Drugs"
            value={data.total_drugs}
            tooltip="Unique drug molecules represented across all trials in this MOA."
          />
          <Metric
            label="Median RR"
            value={`${(data.median_response_rate * 100).toFixed(1)}%`}
            hint="Typical reported trial RR"
            tooltip="Middle reported response rate across all trials in this MOA — a good baseline for judging predicted lifts."
          />
          <Metric
            label="Learned Threshold"
            value={data.overall_learned_threshold?.toFixed(4)}
            hint="Patients above this are predicted responders"
            tooltip="The DCNA cutoff learned from training trials. In downstream pages, patients with DCNA above this value are classified as predicted responders."
          />
          <Metric
            label="Threshold Std"
            value={data.threshold_std?.toFixed(4)}
            hint="Spread across training trials"
            tooltip="Standard deviation of per-training-trial optimal thresholds. Small values (<0.05) mean training trials agree on a cutoff — a stable biomarker. Large values suggest the biomarker is trial-specific."
          />
        </div>
      </div>

      {/* Training Trials Table */}
      <TrainingTrialsTable data={data} />

      {/* Testing Trials Table */}
      <TestingTrialsTable data={data} />

      {/* Excluded Trials (Outlier Detection) */}
      {data.excluded_trials && data.excluded_trials.length > 0 && <ExcludedTrialsTable data={data} />}

      {/* Build a per-trial drug lookup so every plot can render the MOA-drug
          name as the bold first row of its x-axis label. */}
      {(() => null)()}

      {/* Violin Plot */}
      {data.testing_violin_data && data.testing_violin_data.length > 0 && (
        <ViolinPlot
          data={data.testing_violin_data}
          learnedThreshold={data.overall_learned_threshold}
          drugLookup={buildDrugLookup(data)}
          moaDrugNames={data.moa_drug_names}
        />
      )}

      {/* Per-Therapy Aggregated Box Plot */}
      {data.testing_violin_data && data.testing_violin_data.length > 0 && (
        <div>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '0.8rem',
              color: '#444',
              margin: '0.25rem 0 0.5rem',
            }}
          >
            <input type="checkbox" checked={showStatAnalysis} onChange={(e) => setShowStatAnalysis(e.target.checked)} />
            Include "Statistical Analysis" section in Per-Therapy annotation box
          </label>
          <PerTherapyBoxPlot
            data={data.testing_violin_data}
            trainingTrials={data.training_trials || []}
            drugLookup={buildDrugLookup(data)}
            moaDrugNames={data.moa_drug_names}
            moaCategory={data.moa_category}
            confidenceLevel={confidenceLevel}
            showStatAnalysis={showStatAnalysis}
          />
        </div>
      )}

      {/* Per-Therapy Correlation Plot (predicted vs observed) */}
      {data.testing_violin_data && data.testing_violin_data.length > 0 && (
        <PerTherapyCorrelationPlot
          testingTrials={data.testing_violin_data}
          trainingTrials={data.training_trials || []}
          drugLookup={buildDrugLookup(data)}
          moaDrugNames={data.moa_drug_names}
          moaCategory={data.moa_category}
        />
      )}

      {/* Comparison Analyses */}
      {data.analyses && (
        <>
          {data.analyses.mae && (
            <MAEPlot mae={data.analyses.mae} drugLookup={buildDrugLookup(data)} moaDrugNames={data.moa_drug_names} />
          )}
          {data.analyses.bland_altman && (
            <BlandAltmanPlot
              ba={data.analyses.bland_altman}
              drugLookup={buildDrugLookup(data)}
              moaDrugNames={data.moa_drug_names}
              confidenceLevel={confidenceLevel}
            />
          )}
          {data.analyses.ci_coverage && (
            <CICoveragePlot
              ci={data.analyses.ci_coverage}
              drugLookup={buildDrugLookup(data)}
              moaDrugNames={data.moa_drug_names}
              confidenceLevel={confidenceLevel}
              testingViolinData={data.testing_violin_data || []}
            />
          )}
        </>
      )}

      {/* Proposed-Drug Simulation */}
      {data.sim_id && (
        <ProposedDrugSimulation
          simId={data.sim_id}
          moaCategory={data.moa_category}
          moaDrugNames={data.moa_drug_names}
          allResponseRates={(() => {
            const rates: number[] = [];
            for (const t of data.training_trials || []) {
              if (typeof t.actual_response_rate === 'number') rates.push(t.actual_response_rate);
            }
            for (const t of data.testing_violin_data || []) {
              if (typeof t.actual_response_rate === 'number') rates.push(t.actual_response_rate);
              if (t.drug_rr_range?.min != null) rates.push(t.drug_rr_range.min);
              if (t.drug_rr_range?.max != null) rates.push(t.drug_rr_range.max);
            }
            return rates;
          })()}
          learnedThreshold={data.overall_learned_threshold}
        />
      )}

      {/* Responder Similarity */}
      {data.sim_id && <ResponderSimilarity simId={data.sim_id} />}
    </div>
  );
}

// ── Responder Similarity ────────────────────────────────────────────────

function ResponderSimilarity({ simId }: { simId: string }) {
  const [rule, setRule] = usePersistentState<'majority' | 'any'>('sim_rsim_rule', 'majority');
  const [qCutoff, setQCutoff] = usePersistentState<number>('sim_rsim_q_cutoff', 0.1);
  const [typeFilter, setTypeFilter] = usePersistentState<string>('sim_rsim_type_filter', 'all');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/simulation/moa-responder-similarity/${simId}`, { params: { rule, q_cutoff: qCutoff } })
      .then(({ data }) => {
        if (!cancelled) setResult(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail || e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [simId, rule, qCutoff]);

  const features = (() => {
    if (!result?.features) return [] as any[];
    const sig = result.features.filter((f: any) => f.q_value != null && f.q_value <= qCutoff);
    if (typeFilter === 'all') return sig;
    return sig.filter((f: any) => f.category === typeFilter);
  })();

  return (
    <div
      style={{
        marginTop: '2rem',
        padding: '1rem',
        border: '1px solid #cfd8dc',
        borderRadius: 6,
        background: '#fafafa',
      }}
    >
      <h3 style={{ marginTop: 0 }}>Responder Similarity Analysis</h3>
      <InterpretationNote>
        <div>
          <b>What this does:</b> Every TCGA patient in this MOA cohort is sorted into two groups —{' '}
          <i>predicted responders</i> (likely to benefit from drugs in this MOA) and <i>predicted non-responders</i>. We
          then look at each patient feature (age, gender, mutations, copy-number changes, gene expression levels, etc.)
          and ask: "Is this feature noticeably different between the two groups?"
        </div>
        <div style={{ marginTop: 4 }}>
          <b>How to read the table:</b>
        </div>
        <ul style={{ margin: '2px 0 4px 16px', padding: 0 }}>
          <li>
            <b>Responder / Non-Responder columns:</b> a quick summary of that feature in each group (e.g. "62% present"
            for a mutation, or "mean 54.3" for age). Compare the two to see which group is higher or more common.
          </li>
          <li>
            <b>Effect:</b> how big the difference is. For mutations/CNV it's an
            <i> odds ratio</i> (&gt;1 means more common in responders, &lt;1 means more common in non-responders). For
            numeric features it's a <i>rank-biserial</i> score from −1 to +1 (positive = higher in responders, negative
            = higher in non-responders). Bigger absolute numbers = stronger differences.
          </li>
          <li>
            <b>p-value:</b> the chance the difference happened by luck alone. Smaller = more convincing.
          </li>
          <li>
            <b>q-value:</b> the p-value adjusted for the fact that we tested thousands of features at once.{' '}
            <b>This is the number to trust.</b> A q of 0.10 means roughly 10% of entries at that cutoff could be false
            alarms. Lower = more reliable.
          </li>
        </ul>
        <div>
          <b>Comparing entries:</b> rows are sorted by q-value, so the most reliable findings sit at the top. To decide
          which features matter most, look for entries with <i>both</i> a low q-value <i>and</i> a large effect size —
          those are the strongest candidates for enrollment criteria. The <b>Suggested Eligibility Criteria</b> panel
          above already distills the top signals into plain-language rules.
        </div>
      </InterpretationNote>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem' }}>
        <div>
          <label style={{ fontSize: '0.85rem', marginRight: 6 }}>
            <b>Rule:</b>
          </label>
          <label style={{ fontSize: '0.85rem', marginRight: 8 }}>
            <input type="radio" checked={rule === 'majority'} onChange={() => setRule('majority')} /> Majority (≥50% of
            trials)
          </label>
          <label style={{ fontSize: '0.85rem' }}>
            <input type="radio" checked={rule === 'any'} onChange={() => setRule('any')} /> Any trial
          </label>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem' }}>
            <b>q-value cutoff:</b>{' '}
            <input
              type="range"
              min={0.01}
              max={0.5}
              step={0.01}
              value={qCutoff}
              onChange={(e) => setQCutoff(parseFloat(e.target.value))}
            />{' '}
            {qCutoff.toFixed(2)}
          </label>
        </div>
        <div>
          <label style={{ fontSize: '0.85rem' }}>
            <b>Feature type:</b>{' '}
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="clinical">Clinical</option>
              <option value="mutation">Mutation</option>
              <option value="cnv">CNV</option>
              <option value="expression">Expression</option>
            </select>
          </label>
        </div>
        <button
          onClick={() =>
            window.open(
              `${api.defaults.baseURL}/simulation/moa-responder-similarity/${simId}/download?rule=${rule}&q_cutoff=${qCutoff}`,
              '_blank',
            )
          }
          style={{ padding: '4px 12px' }}
        >
          Download full CSV
        </button>
      </div>

      {loading && <div>Running analysis…</div>}
      {error && <div style={{ color: 'crimson' }}>Error: {error}</div>}

      {result && !loading && (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.8rem', fontSize: '0.85rem' }}>
            <div style={{ padding: '6px 12px', background: '#e8f5e9', borderRadius: 4 }}>
              <b>Responders:</b> {result.groups.n_responders}
            </div>
            <div style={{ padding: '6px 12px', background: '#ffebee', borderRadius: 4 }}>
              <b>Non-Responders:</b> {result.groups.n_nonresponders}
            </div>
            <div style={{ padding: '6px 12px', background: '#eceff1', borderRadius: 4 }}>
              <b>Trials in cohort:</b> {result.meta.n_trials_in_cohort}
            </div>
            <div style={{ padding: '6px 12px', background: '#eceff1', borderRadius: 4 }}>
              <b>Features tested:</b> {result.meta.total_features}
            </div>
          </div>

          {result.combinations !== undefined && (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ marginBottom: '0.3rem' }}>
                Multi-Criteria Enrollment Rules{' '}
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#607d8b' }}>
                  ({result.combinations.length} rule{result.combinations.length === 1 ? '' : 's'} found)
                </span>
              </h4>
              <InterpretationNote>
                Each row below is a <b>combination</b> of patient criteria that, when applied together, selects a
                sub-group highly enriched for predicted responders.
                <b> Precision</b> = share of patients matching the rule who are responders.
                <b> Lift</b> = how much the rule beats the overall responder rate (lift of 2.0 = twice as likely).
                Higher precision, higher lift, and larger n = stronger rule. Use these as candidate{' '}
                <i>combined inclusion criteria</i> for future trials.
              </InterpretationNote>
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 4 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f5f5f5' }}>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>Combined Rule</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px' }}>n patients</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px' }}>Responders</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px' }}>Precision</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px' }}>Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.combinations.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: '8px', color: '#888' }}>
                          No multi-criteria rule met the precision/support thresholds for this MOA. This usually means
                          either the cohort is too small or no combination of features gives a clearly better enrichment
                          than the single-feature suggestions below.
                        </td>
                      </tr>
                    )}
                    {result.combinations.map((c: any, i: number) => (
                      <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                        <td style={{ padding: '4px 8px' }}>{c.rule}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.n_patients}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                          {c.n_responders}/{c.n_patients}
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{(c.precision * 100).toFixed(0)}%</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{c.lift.toFixed(2)}×</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.suggestions && result.suggestions.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h4 style={{ marginBottom: '0.3rem' }}>Suggested Eligibility Criteria</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                {result.suggestions.map((s: any, i: number) => (
                  <li key={i}>
                    {s.text} <span style={{ color: '#607d8b' }}>(q={s.q_value?.toExponential(2)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f5f5f5' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Feature</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Responder</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Non-Responder</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Effect</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>p</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>q</th>
                </tr>
              </thead>
              <tbody>
                {features.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '8px', color: '#888' }}>
                      No features passed the q-value cutoff.
                    </td>
                  </tr>
                )}
                {features.map((f: any, i: number) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '4px 8px' }}>{f.feature}</td>
                    <td style={{ padding: '4px 8px' }}>{f.category}</td>
                    <td style={{ padding: '4px 8px' }}>{f.responder_summary}</td>
                    <td style={{ padding: '4px 8px' }}>{f.nonresponder_summary}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {f.effect_label}: {f.effect_size != null ? f.effect_size.toFixed(3) : '—'}
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{f.p_value?.toExponential(2)}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right' }}>{f.q_value?.toExponential(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Violin Plot ──────────────────────────────────────────────────────────

// Small info box shown above a chart to explain how to interpret it.
function InterpretationNote({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.75rem',
        color: '#37474f',
        lineHeight: 1.5,
        background: '#eef6fb',
        border: '1px solid #b3dcf5',
        borderRadius: 4,
        padding: '6px 10px',
        margin: '0 0 0.6rem',
      }}
    >
      {children}
    </div>
  );
}

// Collapse drug name variants ("sorafenib tosylate" → "sorafenib") so that
// salt forms, hydrates, and parenthetical qualifiers group into the parent
// therapy. Returns a stable, lowercased canonical key plus a display label.
const SALT_SUFFIXES = [
  // Sulfonates
  'ditosylate',
  'tosylate',
  'tosilate',
  'dimesylate',
  'mesylate',
  'mesilate',
  'methanesulfonate',
  'besylate',
  'besilate',
  'benzenesulfonate',
  'esylate',
  'ethanesulfonate',
  'napsylate',
  'naphthalenesulfonate',
  'camsylate',
  'camphorsulfonate',
  'isethionate',
  'xinafoate',
  'edisylate',
  // Halide / inorganic
  'hydrochloride',
  'hcl',
  'dihydrochloride',
  'trihydrochloride',
  'hydrobromide',
  'dihydrobromide',
  'hydroiodide',
  'bromide',
  'chloride',
  'iodide',
  'fluoride',
  'nitrate',
  'perchlorate',
  // Sulfur / phosphorus
  'sulfate',
  'sulphate',
  'hemisulfate',
  'bisulfate',
  'disulfate',
  'phosphate',
  'diphosphate',
  'hydrogenphosphate',
  'dihydrogenphosphate',
  // Carboxylates / dicarboxylates
  'citrate',
  'dicitrate',
  'tricitrate',
  'maleate',
  'dimaleate',
  'hemifumarate',
  'fumarate',
  'succinate',
  'hemisuccinate',
  'tartrate',
  'bitartrate',
  'hemitartrate',
  'malate',
  'hemimalate',
  'acetate',
  'diacetate',
  'trifluoroacetate',
  'tfa',
  'lactate',
  'bilactate',
  'gluconate',
  'glucoheptonate',
  'gluceptate',
  'oxalate',
  'palmitate',
  'stearate',
  'pamoate',
  'embonate',
  'propionate',
  'butyrate',
  'valerate',
  'caproate',
  'enanthate',
  'cypionate',
  'decanoate',
  'undecanoate',
  'hexanoate',
  'octanoate',
  'benzoate',
  'hippurate',
  'salicylate',
  'mucate',
  'orotate',
  'tannate',
  'aspartate',
  'glutamate',
  'lactobionate',
  'saccharate',
  'furoate',
  'carbonate',
  'bicarbonate',
  'methylsulfate',
  'methyl sulfate',
  'ethylsulfate',
  'hyclate',
  'teoclate',
  // Counter-ions
  'sodium',
  'disodium',
  'trisodium',
  'potassium',
  'dipotassium',
  'calcium',
  'hemicalcium',
  'magnesium',
  'zinc',
  'lithium',
  'ammonium',
  'choline',
  'meglumine',
  'diolamine',
  'olamine',
  'tromethamine',
  'arginine',
  'lysine',
  // Hydrates / solvates / forms
  'hemihydrate',
  'monohydrate',
  'dihydrate',
  'trihydrate',
  'tetrahydrate',
  'pentahydrate',
  'heptahydrate',
  'decahydrate',
  'anhydrous',
  'solvate',
  'ethanolate',
  'methanolate',
  'racemate',
  'free base',
  'free acid',
];
function canonicalizeDrugName(raw: string): { key: string; label: string } {
  if (!raw) return { key: '', label: '' };
  let s = String(raw).trim();
  // Strip parenthetical qualifiers: "Sorafenib (BAY 43-9006)" → "Sorafenib"
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  let lower = s.toLowerCase();
  // Repeatedly strip trailing salt/form tokens
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of SALT_SUFFIXES) {
      if (lower.endsWith(' ' + suf)) {
        lower = lower.slice(0, -(suf.length + 1)).trim();
        changed = true;
      }
    }
  }
  // Title-case the canonical label
  const label = lower
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
  return { key: lower, label };
}

// Note: CSV helpers (rowsToCSV/downloadCSV/csvEscape) were removed when
// Simulation moved to the shared exports module.
const csvButtonStyle: React.CSSProperties = {
  padding: '0.35rem 0.75rem',
  background: '#1c3e72',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
};

// Build an NCT ID → drugs[] lookup from a simulation result payload, by
// scanning every trial collection that includes a drugs array.
function buildDrugLookup(data: any): Record<string, string[]> {
  const lookup: Record<string, string[]> = {};
  const sources = [data?.testing_trials, data?.training_trials, data?.testing_violin_data, data?.excluded_trials];
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const t of src) {
      if (t?.nct_id && Array.isArray(t.drugs) && !lookup[t.nct_id]) {
        lookup[t.nct_id] = t.drugs;
      }
    }
  }
  return lookup;
}

// Build a "<b>Drug1, Drug2</b><br>NCT12345" axis label. Drugs are filtered to
// only those that belong to the MOA category being analyzed.
function formatTrialLabel(nctId: string, drugs: string[] | undefined, moaDrugNames: string[] | undefined): string {
  const wrappedNct = wrapLabel(nctId);
  if (!drugs || drugs.length === 0) return wrappedNct;
  const moaSet = new Set((moaDrugNames || []).map((d) => d.toUpperCase()));
  const moaDrugs = moaSet.size === 0 ? drugs : drugs.filter((d) => moaSet.has(d.toUpperCase()));
  if (moaDrugs.length === 0) return wrappedNct;
  return `<b>${moaDrugs.join(', ')}</b><br>${wrappedNct}`;
}

// Wrap long labels at word boundaries, forcing a break at most every 35 chars
function wrapLabel(s: string, max = 35): string {
  if (!s) return '';
  const words = String(s).split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  // Hard-break any remaining line longer than max
  const out: string[] = [];
  for (const ln of lines) {
    if (ln.length <= max) out.push(ln);
    else {
      for (let i = 0; i < ln.length; i += max) out.push(ln.slice(i, i + max));
    }
  }
  return out.join('<br>');
}

function ViolinPlot({
  data,
  learnedThreshold,
  drugLookup,
  moaDrugNames,
}: {
  data: any[];
  learnedThreshold?: number;
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = Math.max(720, 150 * data.length + 260);

  useEffect(() => {
    if (!plotRef.current || !data.length) return;

    const traces: any[] = [];

    data.forEach((trial, i) => {
      // Violin for predicted rates
      const trialDrugs = trial.drugs || drugLookup?.[trial.nct_id];
      const wrappedName = formatTrialLabel(trial.nct_id, trialDrugs, moaDrugNames);
      traces.push({
        type: 'box',
        y: trial.predicted_rates,
        name: wrappedName,
        x0: wrappedName,
        boxmean: true,
        boxpoints: false,
        width: 0.6,
        line: { color: `hsl(${(i * 360) / data.length}, 70%, 50%)` },
        showlegend: false,
      });

      // Actual response rate point
      traces.push({
        type: 'scatter',
        x: [wrappedName],
        y: [trial.actual_response_rate],
        mode: 'markers',
        marker: { size: 14, color: '#c62828', symbol: 'diamond', line: { width: 2, color: '#fff' } },
        name: i === 0 ? 'Actual RR' : '',
        showlegend: i === 0,
        legendrank: 1,
        hovertemplate: `<b>${trial.nct_id}</b><br>Actual RR: ${(trial.actual_response_rate * 100).toFixed(1)}%<extra></extra>`,
      });

      // Drug RR range
      if (trial.drug_rr_range && trial.drug_rr_range.min != null) {
        traces.push({
          type: 'scatter',
          x: [wrappedName, wrappedName],
          y: [trial.drug_rr_range.min, trial.drug_rr_range.max],
          mode: 'lines',
          line: { color: '#ff9800', width: 4 },
          name: i === 0 ? 'Therapy Response Rate Range' : '',
          showlegend: i === 0,
          legendrank: 2,
          hovertemplate: `Range: ${(trial.drug_rr_range.min * 100).toFixed(1)}% - ${(trial.drug_rr_range.max * 100).toFixed(1)}%<extra></extra>`,
        });
      }
    });

    const layout: any = {
      font: { size: 20 },
      title: {
        text: `Simulated vs Observed Response Rate Analysis${learnedThreshold != null ? `<br><sub>Learned DCNA Threshold: ${learnedThreshold.toFixed(4)}</sub>` : ''}`,
      },
      yaxis: { title: { text: 'Response Rate' }, tickformat: '.0%', zeroline: true, range: [0, 1], automargin: true },
      xaxis: {
        title: { text: 'Trial', standoff: 20 },
        tickangle: -45,
        automargin: true,
      },
      height: 560,
      width: plotWidth,
      margin: { l: 70, r: 30, t: 60, b: 160 },
      showlegend: true,
      legend: {
        x: 0.99,
        y: 0.99,
        xanchor: 'right',
        yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.92)',
        bordercolor: '#ddd',
        borderwidth: 1,
      },
      boxmode: 'group',
      boxgap: 0.3,
      boxgroupgap: 0.1,
    };

    Plotly.newPlot(plotRef.current, traces, withProvenance(layout, '/simulation/simulated-vs-observed'), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('simulated_vs_observed'),
        width: plotWidth,
        height: 700,
        scale: 4,
      },
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [data, plotWidth, learnedThreshold, drugLookup, moaDrugNames]);

  const handleExport = () => {
    import('xlsx').then((XLSX) => {
      const toPct = (v: number) => (v == null || isNaN(v) ? null : v * 100);
      const pctl = (sorted: number[], p: number): number => {
        if (!sorted.length) return NaN;
        return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
      };

      // Build per-trial column data
      type TrialCol = {
        label: string;
        predicted: number[];
        stats: Record<string, any>;
      };
      const allTrials: TrialCol[] = [];

      for (const trial of data) {
        const drugs = (trial.drugs || drugLookup?.[trial.nct_id] || []).join('; ');
        const rates: number[] = Array.isArray(trial.predicted_rates) ? trial.predicted_rates : [];
        const sorted = [...rates].sort((a, b) => a - b);
        const n = sorted.length;
        const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
        const median = n ? (n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
        const q1 = n ? pctl(sorted, 0.25) : 0;
        const q3 = n ? pctl(sorted, 0.75) : 0;
        const min = n ? sorted[0] : 0;
        const max = n ? sorted[n - 1] : 0;
        const variance = n > 1 ? sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
        const sd = Math.sqrt(variance);
        const obs = trial.actual_response_rate;

        const label = `${drugs || trial.nct_id} (${trial.nct_id})`;
        allTrials.push({
          label,
          predicted: rates,
          stats: {
            nct_id: trial.nct_id,
            arm_group: trial.arm_group || '',
            drugs,
            mean_predicted_rr: toPct(mean),
            median_predicted_rr: toPct(median),
            q1_predicted_rr: toPct(q1),
            q3_predicted_rr: toPct(q3),
            min_predicted_rr: toPct(min),
            max_predicted_rr: toPct(max),
            sd_predicted_rr: toPct(sd),
            n_predictions: n,
            observed_rr: toPct(obs ?? NaN),
            drug_rr_range_min: toPct(trial.drug_rr_range?.min ?? NaN),
            drug_rr_range_max: toPct(trial.drug_rr_range?.max ?? NaN),
          },
        });
      }

      // ── Sheet 1: Summary (transposed) ──
      const metricKeys = [
        'nct_id',
        'arm_group',
        'drugs',
        'mean_predicted_rr',
        'median_predicted_rr',
        'q1_predicted_rr',
        'q3_predicted_rr',
        'min_predicted_rr',
        'max_predicted_rr',
        'sd_predicted_rr',
        'n_predictions',
        'observed_rr',
        'drug_rr_range_min',
        'drug_rr_range_max',
      ];
      const summaryData: any[][] = [['metric', ...allTrials.map((t) => t.label)]];
      for (const key of metricKeys) {
        summaryData.push([key, ...allTrials.map((t) => t.stats[key] ?? '')]);
      }

      // ── Sheet 2: Predicted Rates — trial labels as columns, rates down rows ──
      const maxPred = Math.max(...allTrials.map((t) => t.predicted.length), 0);
      const predData: any[][] = [allTrials.map((t) => t.label)];
      for (let i = 0; i < maxPred; i++) {
        predData.push(allTrials.map((t) => (t.predicted[i] != null ? t.predicted[i] * 100 : '')));
      }

      // Build workbook
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
      const ws2 = XLSX.utils.aoa_to_sheet(predData);
      XLSX.utils.book_append_sheet(wb, ws2, 'Predicted Rates');

      XLSX.writeFile(wb, 'simulated_vs_observed.xlsx');
    });
  };

  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Simulated vs Observed Response Rate Analysis</h3>
        <button onClick={handleExport} style={csvButtonStyle}>
          Download XLSX
        </button>
      </div>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={plotRef} style={{ width: plotWidth, minWidth: plotWidth }} />
      </div>
    </div>
  );
}

// ── Per-Therapy Aggregated Box Plot ──────────────────────────────────────
// Aggregates predicted_rates from every testing trial onto a per-therapy
// box plot. Drug name variants (e.g. "sorafenib tosylate") collapse onto a
// single canonical entry ("Sorafenib"). Only therapies belonging to the
// MOA being analyzed are shown.

function PerTherapyBoxPlot({
  data,
  trainingTrials,
  drugLookup,
  moaDrugNames,
  moaCategory,
  confidenceLevel = 95,
  showStatAnalysis = true,
}: {
  data: any[];
  trainingTrials?: any[];
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
  moaCategory?: string;
  confidenceLevel?: number;
  showStatAnalysis?: boolean;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  // Build the per-therapy aggregation. Training and testing therapies are
  // aggregated separately so we can render them as two groups separated by
  // a vertical dashed divider (mimicking the example figure).
  type Group = {
    label: string;
    predicted: number[]; // reconstructed / collected per-iteration rates
    observedRates: number[]; // one actual clinical trial RR per arm
    meanPred: number; // mean of predicted across arms (for + marker)
    trials: Set<string>;
    armCount: number;
  };

  // Deterministic pseudo-normal sampler for reconstructing approximate
  // per-iteration distributions from (mean, std) summary stats for training
  // trials (the raw training predicted_rates arrays are not persisted).
  const boxMuller = (mean: number, std: number, n: number): number[] => {
    const out: number[] = [];
    let i = 0;
    // Fixed seed via Math.sin of index for determinism within a render
    while (i < n) {
      const u1 = Math.max(1e-9, Math.abs(Math.sin((i + 1) * 12.9898) % 1));
      const u2 = Math.max(1e-9, Math.abs(Math.sin((i + 1) * 78.233) % 1));
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      out.push(Math.min(1, Math.max(0, mean + z * std)));
      i += 1;
    }
    return out;
  };

  const buildGroups = (trials: any[], useRawRates: boolean): Group[] => {
    const moaSet = new Set((moaDrugNames || []).map((d) => canonicalizeDrugName(d).key));
    const map = new Map<string, Group>();
    for (const trial of trials) {
      const drugs: string[] = trial.drugs || drugLookup?.[trial.nct_id] || [];
      let rates: number[] = [];
      if (useRawRates && Array.isArray(trial.predicted_rates) && trial.predicted_rates.length) {
        rates = trial.predicted_rates;
      } else if (typeof trial.mean_predicted_rate === 'number') {
        const std = typeof trial.std_predicted_rate === 'number' ? trial.std_predicted_rate : 0.02;
        rates = boxMuller(trial.mean_predicted_rate, std, 200);
      }
      if (!drugs.length || !rates.length) continue;
      const actual = typeof trial.actual_response_rate === 'number' ? trial.actual_response_rate : null;
      const seen = new Set<string>();
      for (const drug of drugs) {
        const { key, label } = canonicalizeDrugName(drug);
        if (!key) continue;
        if (moaSet.size > 0 && !moaSet.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!map.has(key)) {
          map.set(key, { label, predicted: [], observedRates: [], meanPred: 0, trials: new Set(), armCount: 0 });
        }
        const g = map.get(key)!;
        g.predicted.push(...rates);
        if (actual != null) g.observedRates.push(actual);
        g.trials.add(trial.nct_id);
        g.armCount += 1;
      }
    }
    // Compute mean predicted per group
    for (const g of map.values()) {
      g.meanPred = g.predicted.length ? g.predicted.reduce((a, b) => a + b, 0) / g.predicted.length : 0;
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  };

  const trainingGroups: Group[] = buildGroups(trainingTrials || [], false);
  const testingGroups: Group[] = buildGroups(data, true);
  const groups: Group[] = [...trainingGroups, ...testingGroups];

  // MOA-wide observed response rate range (min → max) drawn as a shaded band
  const allObserved: number[] = [];
  for (const g of groups) allObserved.push(...g.observedRates);
  const bandMin = allObserved.length ? Math.min(...allObserved) : null;
  const bandMax = allObserved.length ? Math.max(...allObserved) : null;

  // Build the title: "<MOA singular> Response Rate Predictions"
  // Each word is title-cased EXCEPT all-uppercase tokens (gene names like
  // VEGFR, EGFR, BRAF, HER2) which stay fully capitalized.
  const titleText = (() => {
    const base = (moaCategory || '').trim();
    if (!base) return 'Response Rate Predictions';
    const singular = base.replace(
      /\b(Inhibitors|Agonists|Antagonists|Modulators|Blockers|Activators|Agents|Analogues|Analogs)\b/gi,
      (m) => m.slice(0, -1),
    );
    const cased = singular
      .split(/\s+/)
      .map((w) => {
        if (!w) return w;
        // Preserve gene-name-style tokens: 2+ chars that are entirely
        // uppercase letters/digits (e.g. VEGFR, HER2, BRAF, PD-1).
        if (w.length >= 2 && /^[A-Z0-9-]+$/.test(w)) return w;
        return w[0].toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
    return `${cased} Response Rate Predictions`;
  })();

  // Tightly size the figure so there is only a small margin of empty space
  // around the content. Width scales with the number of groups; height is
  // the sum of the fixed plot area, top title, tick-label gutter, legend, and
  // the footer annotation (which grows when the Statistical Analysis block
  // is shown).
  const plotWidth = Math.max(1300, 160 * groups.length + 300);
  // Bottom margin budget (px):
  //   - x tick labels at -45°       ~110
  //   - two-row manual legend       ~ 90
  //   - footer (cohort agreement)   ~ 60
  //   - footer (stat-analysis block)+110  (conditional)
  //   - "†" footnote                ~ 30
  //   - small breathing room        ~ 20
  // Bottom layout (stacked): tick labels, small gap, annotation box, padding.
  const tickLabelArea = 90; // horizontal multi-line x-axis labels
  const gapAboveBox = 24; // whitespace between tick labels and box
  const annotationBoxHeight = showStatAnalysis ? 230 : 120;
  const bottomPadding = 24; // breathing room below the box
  const marginBottom = tickLabelArea + gapAboveBox + annotationBoxHeight + bottomPadding;
  // Top area (title + padding) and plot area proper
  const marginTop = 130;
  const plotAreaHeight = 420;
  const plotHeight = marginTop + plotAreaHeight + marginBottom;

  useEffect(() => {
    if (!plotRef.current || groups.length === 0) return;

    const wrapLabel = (s: string, maxLen = 12): string => {
      const words = s.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        if (!cur) {
          cur = w;
          continue;
        }
        if ((cur + ' ' + w).length > maxLen) {
          lines.push(cur);
          cur = w;
        } else {
          cur += ' ' + w;
        }
      }
      if (cur) lines.push(cur);
      return lines.join('<br>');
    };

    // Stable category labels, tagged so Plotly keeps training and testing
    // buckets separated even if a drug appears in both.
    const xLabelFor = (g: Group, bucket: 'train' | 'test'): string =>
      `<b>${wrapLabel(g.label)}</b><br>(${g.armCount} trials)${bucket === 'train' ? '\u200B' : ''}`;

    const traces: any[] = [];

    // One box per therapy (training + testing), black outlines to match
    // the reference image aesthetic.
    const pushBoxes = (gs: Group[], bucket: 'train' | 'test') => {
      gs.forEach((g) => {
        const xl = xLabelFor(g, bucket);
        traces.push({
          type: 'box',
          y: g.predicted,
          x: g.predicted.map(() => xl),
          name: g.label,
          boxmean: false,
          boxpoints: false,
          whiskerwidth: 0.6,
          width: 0.55,
          line: { color: '#000', width: 1.2 },
          fillcolor: 'rgba(255,255,255,1)',
          showlegend: false,
          hoveron: 'boxes',
          hoverinfo: 'skip',
        });
        // Invisible scatter overlay to provide a richer hover tooltip on top
        // of the box (Plotly box traces ignore custom hovertemplate fields).
        {
          const sortedPredHover = [...g.predicted].sort((a, b) => a - b);
          const medianPred =
            sortedPredHover.length === 0
              ? 0
              : sortedPredHover.length % 2
                ? sortedPredHover[Math.floor(sortedPredHover.length / 2)]
                : (sortedPredHover[sortedPredHover.length / 2 - 1] + sortedPredHover[sortedPredHover.length / 2]) / 2;
          const q1Pred = sortedPredHover.length ? sortedPredHover[Math.floor(0.25 * (sortedPredHover.length - 1))] : 0;
          const q3Pred = sortedPredHover.length ? sortedPredHover[Math.floor(0.75 * (sortedPredHover.length - 1))] : 0;
          // Place ~20 hover anchor points spanning the full box height so the
          // tooltip appears anywhere along the box's vertical extent.
          const hoverYs: number[] = [];
          const hi = sortedPredHover[sortedPredHover.length - 1] ?? 0;
          const lo = sortedPredHover[0] ?? 0;
          for (let i = 0; i <= 20; i++) {
            hoverYs.push(lo + ((hi - lo) * i) / 20);
          }
          traces.push({
            type: 'scatter',
            mode: 'markers',
            x: hoverYs.map(() => xl),
            y: hoverYs,
            marker: { size: 22, color: 'rgba(0,0,0,0)', line: { width: 0 } },
            showlegend: false,
            hovertemplate:
              `<b>${g.label}</b><br>` +
              `Arms: ${g.armCount}<br>` +
              `Mean predicted RR: ${(g.meanPred * 100).toFixed(1)}%<br>` +
              `Median: ${(medianPred * 100).toFixed(1)}%<br>` +
              `Q1–Q3: ${(q1Pred * 100).toFixed(1)}%–${(q3Pred * 100).toFixed(1)}%<br>` +
              `Min–Max: ${(lo * 100).toFixed(1)}%–${(hi * 100).toFixed(1)}%` +
              `<extra></extra>`,
          });
        }
        // Mean predicted response rate — black "+" marker
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [xl],
          y: [g.meanPred],
          marker: { symbol: 'cross-thin-open', size: 14, color: '#000', line: { color: '#000', width: 2 } },
          showlegend: false,
          hoverinfo: 'skip',
        });
        // Mean observed clinical trial response rate — single red open circle,
        // with ±1 SD error bars when ≥2 trials contribute.
        if (g.observedRates.length) {
          const n = g.observedRates.length;
          const meanObs = g.observedRates.reduce((a, b) => a + b, 0) / n;
          let sd = 0;
          if (n >= 2) {
            const variance = g.observedRates.reduce((acc, v) => acc + (v - meanObs) ** 2, 0) / (n - 1);
            sd = Math.sqrt(variance);
          }
          const markerTrace: any = {
            type: 'scatter',
            mode: 'markers',
            x: [xl],
            y: [meanObs],
            marker: { symbol: 'circle-open', size: 12, color: '#e63946', line: { color: '#e63946', width: 2 } },
            showlegend: false,
            hovertemplate:
              `<b>${g.label}</b><br>` +
              `Mean Observed RR: ${(meanObs * 100).toFixed(1)}%` +
              (n >= 2 ? `<br>SD: ${(sd * 100).toFixed(1)}% (n=${n})` : ` (n=${n})`) +
              `<extra></extra>`,
          };
          if (n >= 2 && sd > 0) {
            markerTrace.error_y = {
              type: 'data',
              array: [sd],
              arrayminus: [sd],
              color: '#e63946',
              thickness: 2,
              width: 8,
              visible: true,
            };
          }
          traces.push(markerTrace);
        }
      });
    };
    pushBoxes(trainingGroups, 'train');
    pushBoxes(testingGroups, 'test');

    const annotations: any[] = [];

    // ── Per-box statistical comparison: empirical 2-sided p-value of the
    // mean observed RR against the simulator's predicted distribution.
    // Significance markers are placed just above each box.
    // Significance thresholds tied to the user-chosen confidence level.
    // Primary cutoff is α = 1 − CL/100 (e.g. CL=95 → α=0.05). Tiered stars
    // use α, α/5, α/50 so a 95% CL recovers the conventional 0.05/0.01/0.001.
    const alphaSig = 1 - confidenceLevel / 100;
    const alphaTier1 = alphaSig; // *
    const alphaTier2 = alphaSig / 5; // **
    const alphaTier3 = alphaSig / 50; // ***
    const fmtAlpha = (a: number): string => {
      if (a >= 0.01) return a.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
      if (a >= 0.0001) return a.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      return a.toExponential(1);
    };
    const sigStars = (p: number): string => {
      if (p < alphaTier3) return '***';
      if (p < alphaTier2) return '**';
      if (p < alphaTier1) return '*';
      return 'ns';
    };
    const empiricalTwoSidedP = (predicted: number[], meanObs: number): number => {
      const n = predicted.length;
      if (n === 0) return NaN;
      let nLess = 0;
      let nMore = 0;
      for (const v of predicted) {
        if (v <= meanObs) nLess += 1;
        if (v >= meanObs) nMore += 1;
      }
      const p = (2 * Math.min(nLess, nMore)) / n;
      return Math.max(p, 1 / n); // floor at 1/n
    };
    const annotateSig = (gs: Group[], bucket: 'train' | 'test') => {
      gs.forEach((g) => {
        if (!g.observedRates.length || !g.predicted.length) return;
        const meanObs = g.observedRates.reduce((a, b) => a + b, 0) / g.observedRates.length;
        const p = empiricalTwoSidedP(g.predicted, meanObs);
        const yMax = Math.max(...g.predicted, meanObs);
        annotations.push({
          x: xLabelFor(g, bucket),
          y: Math.min(0.99, yMax + 0.04),
          xref: 'x',
          yref: 'y',
          text: `<b>${sigStars(p)}</b>`,
          showarrow: false,
          font: { size: 14, color: '#000' },
          hovertext: `${g.label}: empirical 2-sided p = ${p.toExponential(2)} (n_obs = ${g.observedRates.length})`,
        });
      });
    };

    // ── Global cohort-level agreement: per-therapy mean predicted vs mean
    // observed across every therapy with ≥1 contributing trial.
    const pairs: { pred: number; obs: number; covered: boolean }[] = [];
    const percentile = (sorted: number[], p: number): number => {
      if (sorted.length === 0) return NaN;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
      return sorted[idx];
    };
    // Restrict cohort agreement to TESTING therapies only (exclude training).
    for (const g of testingGroups) {
      if (!g.observedRates.length || !g.predicted.length) continue;
      const meanObs = g.observedRates.reduce((a, b) => a + b, 0) / g.observedRates.length;
      const sortedPred = [...g.predicted].sort((a, b) => a - b);
      const alpha = 1 - confidenceLevel / 100;
      const loQ = percentile(sortedPred, alpha / 2);
      const hiQ = percentile(sortedPred, 1 - alpha / 2);
      const covered = meanObs >= loQ && meanObs <= hiQ;
      pairs.push({ pred: g.meanPred, obs: meanObs, covered });
    }
    let footerText = '';
    if (pairs.length >= 2) {
      const n = pairs.length;
      const meanP = pairs.reduce((s, q) => s + q.pred, 0) / n;
      const meanO = pairs.reduce((s, q) => s + q.obs, 0) / n;
      const varP = pairs.reduce((s, q) => s + (q.pred - meanP) ** 2, 0) / n;
      const varO = pairs.reduce((s, q) => s + (q.obs - meanO) ** 2, 0) / n;
      const cov = pairs.reduce((s, q) => s + (q.pred - meanP) * (q.obs - meanO), 0) / n;
      const ccc = (2 * cov) / (varP + varO + (meanP - meanO) ** 2);
      const mae = pairs.reduce((s, q) => s + Math.abs(q.pred - q.obs), 0) / n;
      const bias = pairs.reduce((s, q) => s + (q.pred - q.obs), 0) / n;
      // Bootstrap 95% CI on the mean bias
      const B = 2000;
      const biases: number[] = [];
      // Deterministic seeded RNG
      let seed = 42;
      const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let b = 0; b < B; b++) {
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const idx = Math.floor(rand() * n);
          const q = pairs[idx];
          acc += q.pred - q.obs;
        }
        biases.push(acc / n);
      }
      biases.sort((a, b) => a - b);
      const alphaBoot = 1 - confidenceLevel / 100;
      const lo = biases[Math.floor((alphaBoot / 2) * B)];
      const hi = biases[Math.floor((1 - alphaBoot / 2) * B)];
      const coverage = pairs.filter((q) => q.covered).length / n;
      const clLabel = `${confidenceLevel}%`;
      const statLine = showStatAnalysis
        ? `<br><br><span style="font-size:13px;color:#555">` +
          `<b>Statistical Analysis:</b> empirical 2-sided p-value testing whether the mean observed RR<br>` +
          `falls within the therapy's predicted distribution ` +
          `(<b>***</b> p&lt;${fmtAlpha(alphaTier3)} · ` +
          `<b>**</b> p&lt;${fmtAlpha(alphaTier2)} · ` +
          `<b>*</b> p&lt;${fmtAlpha(alphaTier1)} · <b>ns</b> not significant)` +
          `</span>`
        : '';
      footerText =
        `<b>Cohort agreement</b> (n = ${n} testing therapies): ` +
        `MAE = ${(mae * 100).toFixed(1)} pp · Lin's CCC = ${ccc.toFixed(2)}<br>` +
        `Mean bias = ${(bias * 100).toFixed(1)} pp [${clLabel} CI ${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}] · ` +
        `${clLabel} CI coverage = ${(coverage * 100).toFixed(0)}% (${pairs.filter((q) => q.covered).length}/${n})` +
        statLine +
        `<br><b>†</b> Independent clinical trials used only for testing.`;
    }
    annotateSig(trainingGroups, 'train');
    annotateSig(testingGroups, 'test');
    if (footerText) {
      annotations.push({
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 0,
        xanchor: 'center',
        yanchor: 'top',
        yshift: -(tickLabelArea + gapAboveBox),
        text: footerText,
        showarrow: false,
        font: { size: 15, color: '#222' },
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: '#ccc',
        borderwidth: 1,
        borderpad: 4,
      });
    }

    // Custom legend is drawn manually below using shapes + annotations so the
    // marker glyphs can include error-bar caps (Plotly's built-in legend does
    // not render error bars on legend symbols). Built-in legend is hidden.

    // Vertical dashed line separating training and testing therapies
    const shapes: any[] = [];
    if (trainingGroups.length > 0 && testingGroups.length > 0) {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: trainingGroups.length - 0.5,
        x1: trainingGroups.length - 0.5,
        y0: 0,
        y1: 1,
        line: { color: '#e63946', width: 2, dash: 'dash' },
      });
    }

    // MOA-wide shaded response rate band (on secondary y-axis so it spans x)
    if (bandMin != null && bandMax != null && bandMax > bandMin) {
      shapes.push({
        type: 'rect',
        xref: 'paper',
        yref: 'y',
        x0: 0,
        x1: 1,
        y0: bandMin,
        y1: bandMax,
        fillcolor: 'rgba(230, 57, 70, 0.18)',
        line: { width: 0 },
        layer: 'below',
      });
    }

    // ── Custom legend (top of plot) ──────────────────────────────────────
    // Plotly's built-in legend does not render error-bar caps on legend
    // symbols, so we draw the legend manually using paper-coord shapes with
    // pixel-precise sizing.
    const legendY = 0.96; // paper coords (above plot area)
    const drawGlyph = (cx: number, cy: number, kind: 'predBox' | 'predCross' | 'obsCircle' | 'rangeSwatch') => {
      const black = '#000';
      const red = '#e63946';
      if (kind === 'predBox') {
        // Black square outline (box)
        shapes.push({
          type: 'rect',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -8,
          x1: 8,
          y0: -7,
          y1: 7,
          line: { color: black, width: 2 },
          fillcolor: 'rgba(0,0,0,0)',
        });
        // Vertical whisker (top + bottom) extending past the box
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: 0,
          x1: 0,
          y0: -14,
          y1: 14,
          line: { color: black, width: 1.5 },
        });
        // End caps
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -5,
          x1: 5,
          y0: -14,
          y1: -14,
          line: { color: black, width: 1.5 },
        });
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -5,
          x1: 5,
          y0: 14,
          y1: 14,
          line: { color: black, width: 1.5 },
        });
      } else if (kind === 'predCross') {
        // Black + (cross-thin-open look)
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -9,
          x1: 9,
          y0: 0,
          y1: 0,
          line: { color: black, width: 2 },
        });
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: 0,
          x1: 0,
          y0: -9,
          y1: 9,
          line: { color: black, width: 2 },
        });
      } else if (kind === 'obsCircle') {
        // Red open circle
        shapes.push({
          type: 'circle',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -7,
          x1: 7,
          y0: -7,
          y1: 7,
          line: { color: red, width: 2 },
          fillcolor: 'rgba(0,0,0,0)',
        });
        // Vertical error bar
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: 0,
          x1: 0,
          y0: -14,
          y1: 14,
          line: { color: red, width: 1.5 },
        });
        // End caps
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -5,
          x1: 5,
          y0: -14,
          y1: -14,
          line: { color: red, width: 1.5 },
        });
        shapes.push({
          type: 'line',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -5,
          x1: 5,
          y0: 14,
          y1: 14,
          line: { color: red, width: 1.5 },
        });
      } else if (kind === 'rangeSwatch') {
        // Filled red shaded square
        shapes.push({
          type: 'rect',
          xref: 'paper',
          yref: 'paper',
          xsizemode: 'pixel',
          ysizemode: 'pixel',
          xanchor: cx,
          yanchor: cy,
          x0: -10,
          x1: 10,
          y0: -8,
          y1: 8,
          fillcolor: 'rgba(230, 57, 70, 0.18)',
          line: { color: 'rgba(230, 57, 70, 0.6)', width: 1 },
        });
      }
    };

    type LegendItem = { kind: 'predBox' | 'predCross' | 'obsCircle' | 'rangeSwatch'; label: string };
    const legendItems: LegendItem[] = [
      { kind: 'predBox', label: 'Predicted Response Rate Distribution' },
      { kind: 'predCross', label: 'Mean Predicted Response Rate' },
      { kind: 'obsCircle', label: 'Clinical Trial Response Rate (mean ± SD)' },
    ];
    if (bandMin != null && bandMax != null && bandMax > bandMin) {
      legendItems.push({
        kind: 'rangeSwatch',
        label: `Observed Response Rate Range (${(bandMin * 100).toFixed(1)}%–${(bandMax * 100).toFixed(1)}%)`,
      });
    }

    // Center the legend horizontally and pack items closer together using a
    // fixed item slot width (paper coords) rather than spreading across full width.
    const nItems = legendItems.length;
    const twoRowLegend = true;
    const cols = twoRowLegend ? 2 : nItems;
    const slotWidth = twoRowLegend ? 0.42 : 0.235;
    const rowGap = 0.11;
    legendItems.forEach((item, i) => {
      const row = twoRowLegend ? Math.floor(i / cols) : 0;
      const col = twoRowLegend ? i % cols : i;
      const itemsInRow = twoRowLegend ? Math.min(cols, nItems - row * cols) : nItems;
      const totalWidth = slotWidth * itemsInRow;
      const startX = 0.5 - totalWidth / 2;
      const slotCenter = startX + slotWidth * (col + 0.5);
      const glyphX = slotCenter - slotWidth * 0.45;
      const labelX = glyphX + 0.012;
      const rowsTotal = twoRowLegend ? Math.ceil(nItems / cols) : 1;
      const yOffset = twoRowLegend ? (rowsTotal - 1 - row) * rowGap : 0;
      const y = legendY + yOffset;
      drawGlyph(glyphX, y, item.kind);
      annotations.push({
        x: labelX,
        y,
        xref: 'paper',
        yref: 'paper',
        xanchor: 'left',
        yanchor: 'middle',
        text: item.label,
        showarrow: false,
        font: { size: 13, color: '#222' },
      });
    });

    // Annotations for "Training Therapies" / "Testing Therapies" headers
    if (trainingGroups.length > 0) {
      annotations.push({
        x: (trainingGroups.length - 1) / 2,
        y: 0.8,
        xref: 'x',
        yref: 'paper',
        text: '<b>Training</b>',
        showarrow: false,
        font: { size: 18, color: '#000' },
        align: 'center',
      });
    }
    if (testingGroups.length > 0) {
      annotations.push({
        x: trainingGroups.length + (testingGroups.length - 1) / 2,
        y: 0.8,
        xref: 'x',
        yref: 'paper',
        text: '<b>Testing†</b>',
        showarrow: false,
        font: { size: 18, color: '#000' },
        align: 'center',
      });
    }

    const layout: any = {
      font: { size: 20 },
      title: { text: titleText },
      yaxis: {
        title: { text: 'Predicted Response Rate (%)', standoff: 20 },
        tickformat: '.0%',
        zeroline: false,
        range: [0, 1],
        showline: true,
        mirror: false,
        ticks: 'outside',
        automargin: true,
      },
      xaxis: {
        title: { text: '' },
        // Horizontal tick labels with <br>-wrapped text. This avoids the
        // SVG transform/text-anchor combination that PowerPoint Online and
        // other SVG importers mis-align for rotated labels.
        tickangle: 0,
        automargin: true,
        showline: true,
        mirror: false,
        ticks: 'outside',
      },
      height: plotHeight,
      width: plotWidth,
      margin: { l: 90, r: 100, t: marginTop, b: marginBottom },
      showlegend: false,
      shapes,
      annotations,
      boxmode: 'group',
    };

    Plotly.newPlot(plotRef.current, traces, withProvenance(layout, '/simulation/per-therapy'), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('per_therapy_predictions'),
        width: plotWidth,
        height: plotHeight,
        scale: 4,
      },
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [
    trainingGroups,
    testingGroups,
    plotWidth,
    plotHeight,
    titleText,
    bandMin,
    bandMax,
    moaCategory,
    confidenceLevel,
    showStatAnalysis,
    marginBottom,
    marginTop,
    tickLabelArea,
    gapAboveBox,
  ]);

  if (groups.length === 0) return null;

  const handleExport = () => {
    import('xlsx').then((XLSX) => {
      const alpha = 1 - confidenceLevel / 100;
      const alphaTier1 = alpha;
      const alphaTier2 = alpha / 5;
      const alphaTier3 = alpha / 50;
      const sigStars = (p: number): string => {
        if (p < alphaTier3) return '***';
        if (p < alphaTier2) return '**';
        if (p < alphaTier1) return '*';
        return 'ns';
      };
      const empiricalP = (predicted: number[], meanObs: number): number => {
        const n = predicted.length;
        if (n === 0) return NaN;
        let nLess = 0,
          nMore = 0;
        for (const v of predicted) {
          if (v <= meanObs) nLess++;
          if (v >= meanObs) nMore++;
        }
        return Math.max((2 * Math.min(nLess, nMore)) / n, 1 / n);
      };
      const pctl = (sorted: number[], p: number): number => {
        if (!sorted.length) return NaN;
        return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
      };
      const fmtN = (v: number) => (isNaN(v) ? null : v);
      const toPct = (v: number) => (isNaN(v) ? null : v * 100);

      // Collect therapy data
      type TherapyData = {
        label: string;
        bucket: string;
        predicted: number[];
        observedRates: number[];
        stats: Record<string, any>;
      };
      const allTherapies: TherapyData[] = [];

      const collect = (gs: Group[], bucket: string) => {
        for (const g of gs) {
          const sorted = [...g.predicted].sort((a, b) => a - b);
          const n = sorted.length;
          const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
          const median = n ? (n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
          const q1 = n ? pctl(sorted, 0.25) : 0;
          const q3 = n ? pctl(sorted, 0.75) : 0;
          const min = n ? sorted[0] : 0;
          const max = n ? sorted[n - 1] : 0;
          const variance = n > 1 ? sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
          const sd = Math.sqrt(variance);

          const nObs = g.observedRates.length;
          const meanObs = nObs ? g.observedRates.reduce((a, b) => a + b, 0) / nObs : NaN;
          const sdObs =
            nObs >= 2 ? Math.sqrt(g.observedRates.reduce((acc, v) => acc + (v - meanObs) ** 2, 0) / (nObs - 1)) : NaN;
          const pVal = nObs && n ? empiricalP(g.predicted, meanObs) : NaN;
          const sig = !isNaN(pVal) ? sigStars(pVal) : '';
          const ciLo = n ? pctl(sorted, alpha / 2) : NaN;
          const ciHi = n ? pctl(sorted, 1 - alpha / 2) : NaN;
          const covered = nObs && !isNaN(ciLo) ? meanObs >= ciLo && meanObs <= ciHi : null;

          allTherapies.push({
            label: g.label,
            bucket,
            predicted: g.predicted,
            observedRates: g.observedRates,
            stats: {
              moa_category: moaCategory || '',
              bucket,
              therapy: g.label,
              trial_nct_ids: [...g.trials].join('; '),
              arm_count: g.armCount,
              unique_trials: g.trials.size,
              mean_predicted_rr: toPct(mean),
              median_predicted_rr: toPct(median),
              q1_predicted_rr: toPct(q1),
              q3_predicted_rr: toPct(q3),
              min_predicted_rr: toPct(min),
              max_predicted_rr: toPct(max),
              sd_predicted_rr: toPct(sd),
              n_predictions: n,
              mean_observed_rr: toPct(meanObs),
              sd_observed_rr: toPct(sdObs),
              n_observed: nObs,
              empirical_p_value: fmtN(pVal),
              significance: sig,
              ci_lower: toPct(ciLo),
              ci_upper: toPct(ciHi),
              observed_in_ci: covered,
              confidence_level: confidenceLevel,
              moa_orr_band_min: toPct(bandMin ?? NaN),
              moa_orr_band_max: toPct(bandMax ?? NaN),
            },
          });
        }
      };
      collect(trainingGroups, 'training');
      collect(testingGroups, 'testing');

      // ── Sheet 1: Summary (transposed) — no raw predicted/observed arrays ──
      const metricKeys = [
        'moa_category',
        'bucket',
        'therapy',
        'trial_nct_ids',
        'arm_count',
        'unique_trials',
        'mean_predicted_rr',
        'median_predicted_rr',
        'q1_predicted_rr',
        'q3_predicted_rr',
        'min_predicted_rr',
        'max_predicted_rr',
        'sd_predicted_rr',
        'n_predictions',
        'mean_observed_rr',
        'sd_observed_rr',
        'n_observed',
        'empirical_p_value',
        'significance',
        'ci_lower',
        'ci_upper',
        'observed_in_ci',
        'confidence_level',
        'moa_orr_band_min',
        'moa_orr_band_max',
      ];
      const summaryData: any[][] = [['metric', ...allTherapies.map((t) => t.label)]];
      for (const key of metricKeys) {
        summaryData.push([key, ...allTherapies.map((t) => t.stats[key] ?? '')]);
      }
      // Append observed rates as rows beneath the summary
      const maxObs = Math.max(...allTherapies.map((t) => t.observedRates.length), 0);
      if (maxObs > 0) {
        summaryData.push([]); // blank separator row
        summaryData.push(['observed_rates', ...allTherapies.map(() => '')]);
        for (let i = 0; i < maxObs; i++) {
          summaryData.push([
            `observed_rate_${i + 1}`,
            ...allTherapies.map((t) => (t.observedRates[i] != null ? t.observedRates[i] * 100 : '')),
          ]);
        }
      }

      // ── Sheet 2: Predicted Rates — drug names as columns, rates down rows ──
      const maxPred = Math.max(...allTherapies.map((t) => t.predicted.length), 0);
      const predData: any[][] = [
        allTherapies.map((t) => t.label), // header row: drug names
      ];
      for (let i = 0; i < maxPred; i++) {
        predData.push(allTherapies.map((t) => (t.predicted[i] != null ? t.predicted[i] * 100 : '')));
      }

      // Build workbook
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
      const ws2 = XLSX.utils.aoa_to_sheet(predData);
      XLSX.utils.book_append_sheet(wb, ws2, 'Predicted Rates');

      XLSX.writeFile(wb, 'per_therapy_predictions.xlsx');
    });
  };

  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Per-Therapy Aggregated Predictions</h3>
        <button onClick={handleExport} style={csvButtonStyle}>
          Download CSV
        </button>
      </div>
      <InterpretationNote>
        <strong>How to read:</strong> each box collapses every prediction made for one therapy across the trials that
        included it. Training therapies (left of the red dashed line) are reconstructed from the simulator's per-trial
        mean ± SD; testing therapies (right) use the full per-iteration distributions. Drug-name variants (e.g.
        <em> sorafenib tosylate</em>) merge into the parent therapy (<em>Sorafenib</em>). The red shaded band spans the
        MOA-wide observed clinical ORR range. The black <code>+</code>
        marks each therapy's mean predicted response rate; the red open circle marks the mean observed clinical response
        rate (with ±1 SD error bars when ≥2 trials contribute).
        <div style={{ marginTop: 8 }}>
          <strong>Per-box significance</strong> (above each box): empirical 2-sided p-value of the mean observed RR
          against the simulator's predicted distribution, computed as
          <code> 2 × min(P(pred ≤ obs̄), P(pred ≥ obs̄))</code>. Thresholds scale with the chosen confidence level (α = 1
          − CL/100 = {(1 - confidenceLevel / 100).toString()}): <code>***</code> p&lt;
          {((1 - confidenceLevel / 100) / 50).toString()}, <code>**</code> p&lt;
          {((1 - confidenceLevel / 100) / 5).toString()}, <code>*</code> p&lt;{(1 - confidenceLevel / 100).toString()},{' '}
          <code>ns</code> otherwise. A significant marker means the trial result is unlikely to have come from the
          simulator's predicted distribution — i.e., the model and the trial disagree for that therapy. Hover the marker
          for the exact p-value.
        </div>
        <div style={{ marginTop: 8 }}>
          <strong>Cohort agreement footer</strong> (below the plot, computed across every therapy with ≥1 contributing
          clinical trial):
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            <li>
              <b>MAE</b> — mean absolute error between each therapy's mean predicted and mean observed RR, in percentage
              points. Lower is better; <em>0 pp</em> means perfect point-estimate agreement.
            </li>
            <li>
              <b>Mean bias</b> — average of (predicted − observed) across therapies, with a bootstrap {confidenceLevel}%
              CI. Positive ⇒ model systematically overshoots; negative ⇒ undershoots. A CI that crosses 0 indicates no
              significant systemic bias.
            </li>
            <li>
              <b>Lin's CCC</b> — concordance correlation coefficient combining correlation and bias. Ranges{' '}
              <em>−1 to +1</em>: <em>+1</em> perfect agreement, <em>0</em> no agreement, <em>−1</em> perfect inverse
              agreement. Rough bands: <em>&gt;0.90</em>
              excellent, <em>0.75–0.90</em> good, <em>0.5–0.75</em> moderate, <em>&lt;0.5</em>
              poor (and values near 0 mean the predicted and observed means do not co-vary across therapies, even if the
              average error is small).
            </li>
            <li>
              <b>{confidenceLevel}% CI coverage</b> — fraction of therapies whose mean observed RR falls inside the{' '}
              {(((1 - confidenceLevel / 100) / 2) * 100).toFixed(2)}–
              {(100 - ((1 - confidenceLevel / 100) / 2) * 100).toFixed(2)} percentile interval of the predicted
              distribution. A well-calibrated simulator should cover ~{confidenceLevel}%. Substantially lower ⇒
              predicted intervals are too narrow / overconfident.
            </li>
          </ul>
        </div>
      </InterpretationNote>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={plotRef} style={{ width: plotWidth, minWidth: plotWidth }} />
      </div>
    </div>
  );
}

// ── Per-Therapy Correlation Plot ─────────────────────────────────────────

function PerTherapyCorrelationPlot({
  testingTrials,
  trainingTrials,
  drugLookup,
  moaDrugNames,
  moaCategory,
}: {
  testingTrials: any[];
  trainingTrials: any[];
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
  moaCategory?: string;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [trialSet, setTrialSet] = useState<'testing' | 'all'>('testing');

  // Pearson/Spearman helpers (local copies — same math as MOA Correlation page)
  const pearson = (xs: number[], ys: number[]): number | null => {
    if (xs.length < 2 || xs.length !== ys.length) return null;
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0,
      dx = 0,
      dy = 0;
    for (let i = 0; i < n; i++) {
      const xi = xs[i] - mx,
        yi = ys[i] - my;
      num += xi * yi;
      dx += xi * xi;
      dy += yi * yi;
    }
    const d = Math.sqrt(dx * dy);
    return d === 0 ? null : num / d;
  };
  const spearman = (xs: number[], ys: number[]): number | null => {
    const rank = (arr: number[]) => {
      const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      const r = new Array(arr.length);
      let i = 0;
      while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1].v === sorted[i].v) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[sorted[k].i] = avg;
        i = j + 1;
      }
      return r;
    };
    if (xs.length < 2 || xs.length !== ys.length) return null;
    return pearson(rank(xs), rank(ys));
  };

  // Aggregate into per-therapy groups, matching the Per-Therapy box plot logic.
  type TherapyPoint = {
    label: string;
    source: 'training' | 'testing';
    meanPred: number;
    stdPred: number;
    meanObs: number;
    stdObs: number;
    nArms: number;
    trials: Set<string>;
  };

  const buildTherapyPoints = (trials: any[], source: 'training' | 'testing'): TherapyPoint[] => {
    const moaSet = new Set((moaDrugNames || []).map((d) => canonicalizeDrugName(d).key));
    type Acc = {
      label: string;
      predSum: number;
      predSumSq: number;
      predN: number;
      obs: number[];
      trials: Set<string>;
      nArms: number;
    };
    const map = new Map<string, Acc>();
    for (const trial of trials || []) {
      const drugs: string[] = trial.drugs || drugLookup?.[trial.nct_id] || [];
      if (!drugs.length) continue;
      const actual = typeof trial.actual_response_rate === 'number' ? trial.actual_response_rate : null;

      // Per-trial mean & std of predicted rate
      let trialPredMean: number | null = null;
      let trialPredStd = 0;
      if (Array.isArray(trial.predicted_rates) && trial.predicted_rates.length) {
        const rates: number[] = trial.predicted_rates;
        const m = rates.reduce((a, b) => a + b, 0) / rates.length;
        const v = rates.reduce((a, b) => a + (b - m) * (b - m), 0) / rates.length;
        trialPredMean = m;
        trialPredStd = Math.sqrt(v);
      } else if (typeof trial.mean_predicted_rate === 'number') {
        trialPredMean = trial.mean_predicted_rate;
        trialPredStd = typeof trial.std_predicted_rate === 'number' ? trial.std_predicted_rate : 0;
      }
      if (trialPredMean == null) continue;

      const seen = new Set<string>();
      for (const drug of drugs) {
        const { key, label } = canonicalizeDrugName(drug);
        if (!key) continue;
        if (moaSet.size > 0 && !moaSet.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!map.has(key)) {
          map.set(key, { label, predSum: 0, predSumSq: 0, predN: 0, obs: [], trials: new Set(), nArms: 0 });
        }
        const acc = map.get(key)!;
        // Pool predicted distribution by trial-mean weighted by arm (one sample
        // per trial mean; std is propagated via sum of variances).
        acc.predSum += trialPredMean;
        acc.predSumSq += trialPredMean * trialPredMean + trialPredStd * trialPredStd;
        acc.predN += 1;
        if (actual != null) acc.obs.push(actual);
        acc.trials.add(trial.nct_id);
        acc.nArms += 1;
      }
    }

    const out: TherapyPoint[] = [];
    for (const acc of map.values()) {
      if (acc.predN === 0) continue;
      const meanPred = acc.predSum / acc.predN;
      const varPred = Math.max(0, acc.predSumSq / acc.predN - meanPred * meanPred);
      const stdPred = Math.sqrt(varPred);
      if (acc.obs.length === 0) continue;
      const meanObs = acc.obs.reduce((a, b) => a + b, 0) / acc.obs.length;
      const varObs =
        acc.obs.length > 1 ? acc.obs.reduce((a, b) => a + (b - meanObs) * (b - meanObs), 0) / acc.obs.length : 0;
      const stdObs = Math.sqrt(varObs);
      out.push({
        label: acc.label,
        source,
        meanPred,
        stdPred,
        meanObs,
        stdObs,
        nArms: acc.nArms,
        trials: acc.trials,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  };

  const trainingPts = buildTherapyPoints(trainingTrials || [], 'training');
  const testingPts = buildTherapyPoints(testingTrials || [], 'testing');

  useEffect(() => {
    if (!plotRef.current) return;
    const points = trialSet === 'all' ? [...trainingPts, ...testingPts] : testingPts;
    if (points.length === 0) {
      Plotly.purge(plotRef.current);
      return;
    }

    const buildTrace = (pts: TherapyPoint[], source: 'training' | 'testing') => {
      const color = source === 'training' ? '#1c3e72' : '#634697';
      const xs = pts.map((p) => p.meanObs);
      const ys = pts.map((p) => p.meanPred);
      const ex = pts.map((p) => p.stdObs);
      const ey = pts.map((p) => p.stdPred);
      const labels = pts.map(
        (p) =>
          `<b>${p.label}</b> (${source})<br>` +
          `observed: ${(p.meanObs * 100).toFixed(1)}% ± ${(p.stdObs * 100).toFixed(1)}%<br>` +
          `predicted: ${(p.meanPred * 100).toFixed(1)}% ± ${(p.stdPred * 100).toFixed(1)}%<br>` +
          `${p.trials.size} trial(s), ${p.nArms} arm(s)`,
      );
      return {
        x: xs,
        y: ys,
        error_x: { type: 'data', array: ex, visible: true, thickness: 1.2, width: 3, color },
        error_y: { type: 'data', array: ey, visible: true, thickness: 1.2, width: 3, color },
        type: 'scatter',
        mode: 'markers',
        name: source === 'training' ? 'Training therapies' : 'Testing therapies',
        marker: { size: 10, color, line: { color: '#fff', width: 1 } },
        text: labels,
        hoverinfo: 'text',
      };
    };

    const traces: any[] = [];
    const trainingActive = trialSet === 'all' ? trainingPts : [];
    if (trainingActive.length > 0) traces.push(buildTrace(trainingActive, 'training'));
    if (testingPts.length > 0) traces.push(buildTrace(testingPts, 'testing'));

    const xs = points.map((p) => p.meanObs);
    const ys = points.map((p) => p.meanPred);
    const ex = points.map((p) => p.stdObs);
    const ey = points.map((p) => p.stdPred);
    const maxVal = Math.max(0.05, ...xs.map((v, i) => v + ex[i]), ...ys.map((v, i) => v + ey[i])) * 1.08;
    traces.push({
      x: [0, maxVal],
      y: [0, maxVal],
      type: 'scatter',
      mode: 'lines',
      name: 'y = x (perfect)',
      line: { color: '#999', dash: 'dash', width: 1.5 },
      hoverinfo: 'skip',
    });

    const r = pearson(xs, ys);
    const rho = spearman(xs, ys);
    const statsLines = [`n = ${xs.length}`];
    if (r != null) statsLines.push(`Pearson r = ${r.toFixed(3)}`);
    if (rho != null) statsLines.push(`Spearman ρ = ${rho.toFixed(3)}`);

    Plotly.newPlot(
      plotRef.current,
      traces,
      withProvenance(
        {
          title: { text: 'Predicted vs Observed Response Rates' },
          annotations: [
            {
              xref: 'paper',
              yref: 'paper',
              x: 0.98,
              y: 0.98,
              xanchor: 'right',
              yanchor: 'top',
              text: statsLines.join('<br>'),
              showarrow: false,
              align: 'right',
              font: { size: 11, color: '#333' },
              bgcolor: 'rgba(255,255,255,0.9)',
              bordercolor: '#ccc',
              borderwidth: 1,
              borderpad: 6,
            },
          ],
          xaxis: {
            title: { text: 'Mean Observed Response Rate (± SD across trials)' },
            range: [0, maxVal],
            tickformat: '.0%',
            zeroline: true,
            zerolinecolor: '#ddd',
            automargin: true,
          },
          yaxis: {
            title: { text: 'Mean Predicted Response Rate (± SD)' },
            range: [0, maxVal],
            tickformat: '.0%',
            zeroline: true,
            zerolinecolor: '#ddd',
            automargin: true,
          },
          height: 560,
          margin: { l: 70, r: 30, t: 60, b: 60 },
          legend: {
            x: 0.01,
            y: 0.99,
            bgcolor: 'rgba(255,255,255,0.9)',
            bordercolor: '#ddd',
            borderwidth: 1,
          },
          hovermode: 'closest',
          plot_bgcolor: '#fff',
        } as any,
        '/simulation/per-therapy-correlation',
      ),
      {
        displayModeBar: true,
        responsive: true,
        toImageButtonOptions: {
          format: 'svg',
          filename: provenanceImageFilename('per_therapy_correlation'),
          width: 800,
          height: 800,
          scale: 4,
        },
      },
    );
  }, [trialSet, testingTrials, trainingTrials, moaCategory]);

  const activePts = trialSet === 'all' ? [...trainingPts, ...testingPts] : testingPts;
  const r = pearson(
    activePts.map((p) => p.meanObs),
    activePts.map((p) => p.meanPred),
  );
  const rho = spearman(
    activePts.map((p) => p.meanObs),
    activePts.map((p) => p.meanPred),
  );

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '1rem',
        marginBottom: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Per-Therapy Correlation</h3>
        <label style={{ fontSize: '0.8rem', color: '#555' }}>
          Trial set:&nbsp;
          <select
            value={trialSet}
            onChange={(e) => setTrialSet(e.target.value as 'testing' | 'all')}
            style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
          >
            <option value="testing">Testing only</option>
            <option value="all">All (training + testing)</option>
          </select>
        </label>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: '0.5rem',
          marginBottom: '0.75rem',
        }}
      >
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{activePts.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#888' }}>Therapies</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{r != null ? r.toFixed(3) : '—'}</div>
          <div style={{ fontSize: '0.7rem', color: '#888' }}>Pearson r</div>
        </div>
        <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>
            {rho != null ? rho.toFixed(3) : '—'}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#888' }}>Spearman ρ</div>
        </div>
      </div>
      <div ref={plotRef} style={{ width: '100%' }} />
    </div>
  );
}

// ── MAE Plot ─────────────────────────────────────────────────────────────

function MAEPlot({
  mae,
  drugLookup,
  moaDrugNames,
}: {
  mae: any;
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = Math.max(720, 180 * (mae.per_trial?.length || 0) + 160);

  useEffect(() => {
    if (!plotRef.current || !mae.per_trial) return;

    const trials = mae.per_trial;
    const trace: any = {
      type: 'bar',
      x: trials.map((t: any) => formatTrialLabel(t.nct_id, t.drugs || drugLookup?.[t.nct_id], moaDrugNames)),
      y: trials.map((t: any) => t.abs_error),
      marker: {
        color: trials.map((t: any) => (t.abs_error > 0.15 ? '#c62828' : '#4a90d9')),
      },
      hovertemplate: '%{x}<br>Abs Error: %{y:.3f}<extra></extra>',
    };

    const layout: any = {
      title: `Mean Absolute Error Analysis (MAE = ${(mae.value * 100).toFixed(1)}%)`,
      yaxis: { title: { text: 'Absolute<br>Error', standoff: 10 }, tickformat: '.0%', automargin: true },
      xaxis: { title: { text: 'Trial', standoff: 20 }, tickangle: -45, automargin: true },
      height: 440,
      width: plotWidth,
      margin: { l: 80, r: 30, t: 60, b: 140 },
      shapes: [
        {
          type: 'line',
          y0: mae.value,
          y1: mae.value,
          x0: 0,
          x1: 1,
          xref: 'paper',
          line: { color: '#ff9800', width: 2, dash: 'dash' },
        },
      ],
      annotations: [
        {
          x: 0,
          y: mae.value,
          xref: 'paper',
          yref: 'y',
          text: `MAE = ${(mae.value * 100).toFixed(1)}%`,
          showarrow: false,
          font: { size: 11, color: '#ff9800' },
          xanchor: 'left',
          yanchor: 'bottom',
          yshift: 4,
          bgcolor: 'rgba(255,255,255,0.85)',
        },
      ],
    };

    Plotly.newPlot(plotRef.current, [trace], withProvenance(layout, '/simulation/mae'), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('mae_analysis'),
        width: plotWidth,
        height: 440,
        scale: 4,
      },
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [mae, plotWidth, drugLookup, moaDrugNames]);

  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Mean Absolute Error Analysis</h3>
      <InterpretationNote>
        <strong>How to read:</strong> each bar shows how far the model's predicted response rate was from the real trial
        result for one trial. Shorter bars = better prediction. The dashed orange line is the average error across all
        testing trials (MAE) — the closer to 0%, the more accurate the model.
      </InterpretationNote>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={plotRef} style={{ width: plotWidth, minWidth: plotWidth }} />
      </div>
    </div>
  );
}

// ── Bland-Altman Plot ────────────────────────────────────────────────────

function BlandAltmanPlot({
  ba,
  drugLookup,
  moaDrugNames,
  confidenceLevel = 95,
}: {
  ba: any;
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
  confidenceLevel?: number;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!plotRef.current || !ba.points) return;
    // Recompute limits-of-agreement at the user-chosen confidence level.
    // Backend ships ba.upper_loa / ba.lower_loa at 95% (mean ± 1.96·SD); we
    // back out SD and rebuild bounds with z(cl).
    const z95 = 1.959963984540054;
    const sdDiff = ((ba.upper_loa as number) - (ba.lower_loa as number)) / (2 * z95);
    const z = zForConfidence(confidenceLevel);
    const upperLoa = (ba.mean_diff as number) + z * sdDiff;
    const lowerLoa = (ba.mean_diff as number) - z * sdDiff;
    const clLabel = `${confidenceLevel}%`;

    const points = ba.points;
    const trace: any = {
      type: 'scatter',
      mode: 'markers+text',
      x: points.map((p: any) => p.mean),
      y: points.map((p: any) => p.diff),
      text: points.map((p: any) => formatTrialLabel(p.nct_id, p.drugs || drugLookup?.[p.nct_id], moaDrugNames)),
      textposition: 'top center',
      textfont: { size: 8 },
      marker: { size: 10, color: '#4a90d9' },
      hovertemplate: '<b>%{text}</b><br>Mean: %{x:.3f}<br>Diff: %{y:.3f}<extra></extra>',
    };

    const xRange = [
      Math.min(...points.map((p: any) => p.mean)) - 0.05,
      Math.max(...points.map((p: any) => p.mean)) + 0.05,
    ];

    const layout: any = {
      title: 'Bland-Altman Agreement Analysis',
      xaxis: { title: { text: 'Mean of Predicted<br>& Actual', standoff: 15 }, tickformat: '.0%', automargin: true },
      yaxis: {
        title: { text: 'Difference<br>(Predicted − Actual)', standoff: 10 },
        tickformat: '.0%',
        automargin: true,
      },
      height: 470,
      margin: { l: 90, r: 30, t: 60, b: 90 },
      shapes: [
        {
          type: 'line',
          y0: ba.mean_diff,
          y1: ba.mean_diff,
          x0: xRange[0],
          x1: xRange[1],
          line: { color: '#2e7d32', width: 2 },
        },
        {
          type: 'line',
          y0: upperLoa,
          y1: upperLoa,
          x0: xRange[0],
          x1: xRange[1],
          line: { color: '#c62828', width: 1, dash: 'dash' },
        },
        {
          type: 'line',
          y0: lowerLoa,
          y1: lowerLoa,
          x0: xRange[0],
          x1: xRange[1],
          line: { color: '#c62828', width: 1, dash: 'dash' },
        },
      ],
      annotations: [
        {
          x: xRange[1],
          y: ba.mean_diff,
          text: `Mean: ${(ba.mean_diff * 100).toFixed(1)}%`,
          showarrow: false,
          font: { size: 10, color: '#2e7d32' },
          xanchor: 'right',
          yanchor: 'bottom',
          yshift: 4,
          bgcolor: 'rgba(255,255,255,0.85)',
        },
        {
          x: xRange[1],
          y: upperLoa,
          text: `+${z.toFixed(2)}SD: ${(upperLoa * 100).toFixed(1)}% (${clLabel} LoA)`,
          showarrow: false,
          font: { size: 10, color: '#c62828' },
          xanchor: 'right',
          yanchor: 'bottom',
          yshift: 4,
          bgcolor: 'rgba(255,255,255,0.85)',
        },
        {
          x: xRange[1],
          y: lowerLoa,
          text: `-${z.toFixed(2)}SD: ${(lowerLoa * 100).toFixed(1)}% (${clLabel} LoA)`,
          showarrow: false,
          font: { size: 10, color: '#c62828' },
          xanchor: 'right',
          yanchor: 'top',
          yshift: -4,
          bgcolor: 'rgba(255,255,255,0.85)',
        },
      ],
    };

    Plotly.newPlot(plotRef.current, [trace], withProvenance(layout, '/simulation/bland-altman'), {
      responsive: true,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('bland_altman'),
        width: 1100,
        height: 560,
        scale: 4,
      },
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [ba, drugLookup, moaDrugNames, confidenceLevel]);

  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Bland-Altman Agreement Analysis</h3>
      <InterpretationNote>
        <strong>How to read:</strong> each dot is one trial. The horizontal axis is the average of the predicted and
        actual response rates; the vertical axis is how much they differ. A dot near 0 means the prediction matched the
        real result. The solid green line shows the average bias (is the model over- or under-predicting overall?), and
        the dashed red lines are the expected range for {confidenceLevel}% of predictions (mean ±{' '}
        {zForConfidence(confidenceLevel).toFixed(2)}·SD) — dots outside those lines are unusually far off.
      </InterpretationNote>
      <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a1a1a', margin: '0 0 0.5rem' }}>
        Mean difference: {(ba.mean_diff * 100).toFixed(2)}%
        <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#666', marginLeft: 8 }}>
          {confidenceLevel}% Limits of agreement: [
          {(
            ((ba.mean_diff as number) -
              zForConfidence(confidenceLevel) *
                (((ba.upper_loa as number) - (ba.lower_loa as number)) / (2 * 1.959963984540054))) *
            100
          ).toFixed(2)}
          %,{' '}
          {(
            ((ba.mean_diff as number) +
              zForConfidence(confidenceLevel) *
                (((ba.upper_loa as number) - (ba.lower_loa as number)) / (2 * 1.959963984540054))) *
            100
          ).toFixed(2)}
          %]
        </span>
      </p>
      <div ref={plotRef} style={{ width: '100%' }} />
    </div>
  );
}

// ── CI Coverage Plot ─────────────────────────────────────────────────────

function CICoveragePlot({
  ci,
  drugLookup,
  moaDrugNames,
  confidenceLevel = 95,
  testingViolinData = [],
}: {
  ci: any;
  drugLookup?: Record<string, string[]>;
  moaDrugNames?: string[];
  confidenceLevel?: number;
  testingViolinData?: any[];
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotWidth = Math.max(560, 140 * (ci.trials?.length || 0) + 220);

  // Recompute CI bounds + coverage at the user-chosen confidence level using
  // the raw per-trial predicted_rates arrays from testing_violin_data, falling
  // back to the backend-supplied 95% bounds when raw rates are unavailable.
  const recomputed = (() => {
    if (!ci.trials)
      return { trials: [], coverage_rate: 0, covered_count: 0, total_trials: 0, clLabel: `${confidenceLevel}%` };
    const alpha = 1 - confidenceLevel / 100;
    const violinByNct: Record<string, any> = {};
    for (const v of testingViolinData) violinByNct[v.nct_id] = v;
    const percentile = (sorted: number[], p: number) => {
      if (sorted.length === 0) return NaN;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
      return sorted[idx];
    };
    const trials = ci.trials.map((t: any) => {
      const v = violinByNct[t.nct_id];
      let lo = t.ci_lower;
      let hi = t.ci_upper;
      let pmean = t.predicted_mean;
      if (v && Array.isArray(v.predicted_rates) && v.predicted_rates.length) {
        const sorted = [...v.predicted_rates].sort((a: number, b: number) => a - b);
        lo = percentile(sorted, alpha / 2);
        hi = percentile(sorted, 1 - alpha / 2);
        pmean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
      }
      const covered = t.actual >= lo && t.actual <= hi;
      return { ...t, ci_lower: lo, ci_upper: hi, predicted_mean: pmean, covered };
    });
    const coveredCount = trials.filter((t: any) => t.covered).length;
    return {
      trials,
      coverage_rate: trials.length ? coveredCount / trials.length : 0,
      covered_count: coveredCount,
      total_trials: trials.length,
      clLabel: `${confidenceLevel}%`,
    };
  })();

  useEffect(() => {
    if (!plotRef.current || !ci.trials) return;

    const trials = recomputed.trials;
    const traces: any[] = [];

    // CI bars
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: trials.map((_: any, i: number) => i),
      y: trials.map((t: any) => t.predicted_mean),
      error_y: {
        type: 'data',
        symmetric: false,
        array: trials.map((t: any) => t.ci_upper - t.predicted_mean),
        arrayminus: trials.map((t: any) => t.predicted_mean - t.ci_lower),
        color: '#4a90d9',
        thickness: 2,
      },
      marker: { size: 8, color: '#4a90d9' },
      name: `Predicted (${recomputed.clLabel} CI)`,
      hovertemplate:
        '%{text}<br>Predicted: %{y:.3f}<br>CI: [%{customdata[0]:.3f}, %{customdata[1]:.3f}]<extra></extra>',
      text: trials.map((t: any) => t.nct_id),
      customdata: trials.map((t: any) => [t.ci_lower, t.ci_upper]),
    });

    // Actual points
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: trials.map((_: any, i: number) => i),
      y: trials.map((t: any) => t.actual),
      marker: {
        size: 12,
        symbol: 'diamond',
        color: trials.map((t: any) => (t.covered ? '#2e7d32' : '#c62828')),
        line: { width: 2, color: '#fff' },
      },
      name: 'Actual RR',
      hovertemplate: '%{text}<br>Actual: %{y:.3f}<br>Covered: %{customdata}<extra></extra>',
      text: trials.map((t: any) => t.nct_id),
      customdata: trials.map((t: any) => (t.covered ? 'Yes' : 'No')),
    });

    const layout: any = {
      title: {
        text: `${recomputed.clLabel} CI Coverage Analysis<br><sub>Coverage rate: ${(recomputed.coverage_rate * 100).toFixed(0)}% (${recomputed.covered_count}/${recomputed.total_trials} trials) — Green diamonds = actual RR within ${recomputed.clLabel} CI · Red = outside CI</sub>`,
      },
      xaxis: {
        title: { text: 'Trial', standoff: 20 },
        tickmode: 'array',
        tickvals: trials.map((_: any, i: number) => i),
        ticktext: trials.map((t: any) => formatTrialLabel(t.nct_id, t.drugs || drugLookup?.[t.nct_id], moaDrugNames)),
        tickangle: -45,
        range: [-0.6, trials.length - 0.4],
        automargin: true,
      },
      yaxis: { title: { text: 'Response<br>Rate', standoff: 10 }, tickformat: '.0%', range: [0, 1], automargin: true },
      height: 490,
      width: plotWidth,
      margin: { l: 80, r: 30, t: 90, b: 140 },
      showlegend: true,
      legend: {
        x: 0.02,
        y: 0.98,
        xanchor: 'left',
        yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: '#ddd',
        borderwidth: 1,
      },
    };

    Plotly.newPlot(plotRef.current, traces, withProvenance(layout, '/simulation/ci-coverage'), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('ci_coverage'),
        width: plotWidth,
        height: 490,
        scale: 4,
      },
    });
    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [ci, plotWidth, drugLookup, moaDrugNames, confidenceLevel, testingViolinData]);

  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
        {recomputed.clLabel} Confidence Interval Coverage Analysis
      </h3>
      <InterpretationNote>
        <strong>How to read:</strong> for each trial, the blue dot and vertical bar show the model's predicted response
        rate and the range it expects the real answer to fall inside
        {confidenceLevel}% of the time. The diamond is the trial's actual response rate —{' '}
        <span style={{ color: '#2e7d32', fontWeight: 600 }}>green</span> if it landed inside the predicted range,{' '}
        <span style={{ color: '#c62828', fontWeight: 600 }}>red</span> if it fell outside.
      </InterpretationNote>
      <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1a1a1a', margin: '0 0 0.5rem' }}>
        Coverage rate: {(recomputed.coverage_rate * 100).toFixed(0)}% ({recomputed.covered_count}/
        {recomputed.total_trials} trials).
        <span style={{ fontSize: '0.78rem', fontWeight: 400, color: '#666', marginLeft: 8 }}>
          Green diamonds = actual RR within {recomputed.clLabel} CI. Red = outside CI.
        </span>
      </p>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div ref={plotRef} style={{ width: plotWidth, minWidth: plotWidth }} />
      </div>
    </div>
  );
}

// ── Exclusion Badge ────────────────────────────────────────────────────

function ExclusionBadge({ reason, method }: { reason: string; method?: string }) {
  const colorMap: Record<string, { bg: string; fg: string }> = {
    enrollment_floor: { bg: '#fce4ec', fg: '#c62828' },
    perfect_rr: { bg: '#fce4ec', fg: '#c62828' },
    statistical: { bg: '#fff3e0', fg: '#e65100' },
  };
  const { bg, fg } = colorMap[method || ''] || { bg: '#f5f5f5', fg: '#616161' };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        fontSize: '0.7rem',
        fontWeight: 500,
        borderRadius: 10,
        background: bg,
        color: fg,
        lineHeight: 1.4,
      }}
      title={reason}
    >
      {reason}
    </span>
  );
}

// ── Criteria Pills ──────────────────────────────────────────────────────

function CriteriaPills({ criteria }: { criteria?: string[] }) {
  if (!criteria || criteria.length === 0) {
    return <span style={{ fontSize: '0.72rem', color: '#999' }}>None</span>;
  }

  const getColor = (label: string): { bg: string; fg: string } => {
    const l = label.toLowerCase();
    if (l.includes('mgmt') || l.includes('methylat')) return { bg: '#e8f5e9', fg: '#2e7d32' };
    if (l.includes('idh')) return { bg: '#e3f2fd', fg: '#1565c0' };
    if (l.includes('egfr')) return { bg: '#fff3e0', fg: '#e65100' };
    if (l.includes('tp53') || l.includes('pten')) return { bg: '#fce4ec', fg: '#c62828' };
    if (l.includes('braf') || l.includes('nf1')) return { bg: '#fff8e1', fg: '#f57f17' };
    if (l.includes('amplif') || l.includes('delet') || l.includes('gain') || l.includes('loss'))
      return { bg: '#ede7f6', fg: '#4527a0' };
    if (l.includes('fusion') || l.includes('fgfr')) return { bg: '#e0f7fa', fg: '#00695c' };
    if (l.includes('recurrent') || l.includes('newly') || l.includes('prior') || l.includes('alkylator'))
      return { bg: '#f5f5f5', fg: '#616161' };
    if (l.includes('tmb') || l.includes('msi') || l.includes('pd-l1')) return { bg: '#e8eaf6', fg: '#283593' };
    return { bg: '#f3e5f5', fg: '#7b1fa2' };
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {criteria.map((c) => {
        const { bg, fg } = getColor(c);
        return (
          <span
            key={c}
            style={{
              display: 'inline-block',
              padding: '1px 7px',
              fontSize: '0.7rem',
              fontWeight: 500,
              borderRadius: 10,
              whiteSpace: 'nowrap',
              background: bg,
              color: fg,
            }}
          >
            {c}
          </span>
        );
      })}
    </div>
  );
}

// ── MOA Autocomplete ────────────────────────────────────────────────────

function MOAAutocomplete({
  categories,
  value,
  onChange,
}: {
  categories: MOACategory[];
  value: string;
  onChange: (val: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showIndividual, setShowIndividual] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Derive display text from selected value
  const selectedCat = categories.find((c) => c.value === value);
  const displayText = selectedCat ? selectedCat.category : '';

  // Sync query with display text
  useEffect(() => {
    setQuery(displayText);
  }, [displayText]);

  // Filter: search matches against category name, drug names, and member names
  const matchesQuery = (c: MOACategory, q: string): boolean => {
    const lower = q.toLowerCase();
    if (c.category.toLowerCase().includes(lower)) return true;
    if (c.drugs?.some((d) => d.toLowerCase().includes(lower))) return true;
    if (c.members?.some((m) => m.toLowerCase().includes(lower))) return true;
    return false;
  };

  const filtered = categories.filter((c) => {
    if (!matchesQuery(c, query)) return false;
    // When not showing individual, hide items that are part of a group
    if (!showIndividual && !c.is_group && c.part_of_group) return false;
    return true;
  });

  // Separate groups from individuals for rendering
  const groups = filtered.filter((c) => c.is_group);
  const individuals = filtered.filter((c) => !c.is_group);

  const allItems = [...groups, ...individuals];

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setHighlightIdx(-1);
    },
    [onChange],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Revert query to display text if no valid selection
        if (!categories.some((c) => c.value === value)) {
          setQuery(displayText);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [categories, value, displayText]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIdx] as HTMLElement;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, allItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && allItems[highlightIdx]) {
          handleSelect(allItems[highlightIdx].value);
        } else if (allItems.length === 1) {
          handleSelect(allItems[0].value);
        }
        break;
      case 'Escape':
        setOpen(false);
        setQuery(displayText);
        break;
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        placeholder="Type to search MOA categories or drug names..."
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlightIdx(-1);
          if (value && e.target.value !== displayText) {
            onChange('');
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '0.5rem',
          border: '1px solid #ccc',
          borderRadius: 4,
          fontSize: '0.85rem',
          boxSizing: 'border-box',
          borderColor: open ? '#4a90d9' : '#ccc',
          outline: 'none',
        }}
      />
      {value && (
        <span
          onClick={() => {
            setQuery('');
            onChange('');
          }}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            cursor: 'pointer',
            color: '#999',
            fontSize: '0.9rem',
            lineHeight: 1,
          }}
          title="Clear selection"
        >
          &times;
        </span>
      )}
      {open && allItems.length > 0 && (
        <ul
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            maxHeight: 340,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #ccc',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {/* Section header: Therapy Groups */}
          {groups.length > 0 && (
            <li
              style={{
                padding: '6px 10px',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#1a1a2e',
                background: '#f0f4ff',
                borderBottom: '1px solid #e0e4ef',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              Therapy Groups (combined MOAs)
            </li>
          )}
          {groups.map((c) => {
            const idx = allItems.indexOf(c);
            return (
              <li
                key={c.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(c.value);
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{
                  padding: '7px 10px',
                  fontSize: '0.83rem',
                  cursor: 'pointer',
                  background: idx === highlightIdx ? '#e8f0fe' : '#fafbff',
                  borderBottom: '1px solid #f0f0f0',
                  borderLeft: '3px solid #4a90d9',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{c.value.replace('group:', '')}</span>
                  <span style={{ fontSize: '0.72rem', color: '#888', marginLeft: 8, whiteSpace: 'nowrap' }}>
                    {c.drug_count} drugs
                  </span>
                </div>
                <div style={{ fontSize: '0.73rem', color: '#666', marginTop: 2 }}>[{c.drugs.join(', ')}]</div>
                {c.members.length > 0 && (
                  <div style={{ fontSize: '0.68rem', color: '#999', marginTop: 1 }}>
                    Combines: {c.members.join(', ')}
                  </div>
                )}
              </li>
            );
          })}

          {/* Section header: Individual MOAs */}
          {individuals.length > 0 && (
            <li
              style={{
                padding: '6px 10px',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#1a1a2e',
                background: '#f5f5f5',
                borderBottom: '1px solid #e0e0e0',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                position: 'sticky',
                top: groups.length > 0 ? 28 : 0,
                zIndex: 1,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Individual MOA Targets</span>
              {categories.some((c) => c.part_of_group) && (
                <label
                  style={{
                    fontWeight: 400,
                    textTransform: 'none',
                    fontSize: '0.68rem',
                    color: '#666',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showIndividual}
                    onChange={(e) => {
                      e.stopPropagation();
                      setShowIndividual(e.target.checked);
                    }}
                    style={{ marginRight: 3, verticalAlign: 'middle' }}
                  />
                  Show grouped members
                </label>
              )}
            </li>
          )}
          {individuals.map((c) => {
            const idx = allItems.indexOf(c);
            return (
              <li
                key={c.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(c.value);
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{
                  padding: '6px 10px',
                  fontSize: '0.83rem',
                  cursor: 'pointer',
                  background: idx === highlightIdx ? '#e8f0fe' : '#fff',
                  borderBottom: '1px solid #f5f5f5',
                  opacity: c.part_of_group ? 0.75 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    {c.category}
                    {c.part_of_group && (
                      <span style={{ fontSize: '0.68rem', color: '#aaa', marginLeft: 6 }}>(in group)</span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#888', marginLeft: 8, whiteSpace: 'nowrap' }}>
                    {c.drug_count} drugs
                  </span>
                </div>
                {c.drugs && c.drugs.length > 0 && (
                  <div style={{ fontSize: '0.73rem', color: '#666', marginTop: 2 }}>[{c.drugs.join(', ')}]</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && allItems.length === 0 && query && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            background: '#fff',
            border: '1px solid #ccc',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            padding: '8px 10px',
            fontSize: '0.82rem',
            color: '#999',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          No matching categories
        </div>
      )}
    </div>
  );
}

// ── Sortable table support ───────────────────────────────────────────────
type SortDir = 'asc' | 'desc' | null;
type Accessor = (row: any) => any;
type ColType = 'string' | 'number';
interface ColDef {
  key: string;
  type: ColType;
  accessor: Accessor;
}

function useSortedRows(
  rows: any[] | undefined,
  cols: Record<string, ColDef>,
  initialKey: string,
  initialDir: SortDir = 'asc',
) {
  const [sortKey, setSortKey] = useState<string>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const onSort = useCallback(
    (key: string) => {
      const def = cols[key];
      const firstDir: SortDir = def?.type === 'number' ? 'desc' : 'asc';
      const secondDir: SortDir = firstDir === 'desc' ? 'asc' : 'desc';
      if (sortKey !== key || sortDir === null) {
        setSortKey(key);
        setSortDir(firstDir);
      } else if (sortDir === firstDir) {
        setSortDir(secondDir);
      } else {
        // third click → clear sort
        setSortKey('');
        setSortDir(null);
      }
    },
    [cols, sortKey, sortDir],
  );

  const sorted = (() => {
    if (!rows) return [];
    const def = cols[sortKey];
    if (!def || sortDir === null) return [...rows];
    const sign = sortDir === 'asc' ? 1 : -1;
    const isNum = def.type === 'number';
    return [...rows].sort((a, b) => {
      const av = def.accessor(a);
      const bv = def.accessor(b);
      const aMissing = av == null || (isNum && Number.isNaN(av));
      const bMissing = bv == null || (isNum && Number.isNaN(bv));
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1; // missing values always sink to the bottom
      if (bMissing) return -1;
      if (isNum) return (Number(av) - Number(bv)) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
  })();

  return { sorted, sortKey, sortDir, onSort };
}

function SortableTH({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
  style,
}: {
  label: string;
  colKey: string;
  sortKey: string;
  sortDir: SortDir;
  onSort: (k: string) => void;
  align?: 'left' | 'right' | 'center';
  style?: React.CSSProperties;
}) {
  const isActive = sortKey === colKey && sortDir !== null;
  const arrow = isActive ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      onClick={() => onSort(colKey)}
      style={{
        ...thStyle,
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        color: isActive ? '#1c3e72' : undefined,
        ...(style || {}),
      }}
      title="Click to sort"
    >
      {label}
      {arrow}
    </th>
  );
}

const _criteriaText = (c: any): string => {
  if (!c) return '';
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.label || '')).join(' ');
  if (typeof c === 'string') return c;
  return '';
};
const _drugsText = (d: any): string => (Array.isArray(d) ? d.join(' ') : '');

const TRAINING_COLS: Record<string, ColDef> = {
  nct_id: { key: 'nct_id', type: 'string', accessor: (r) => r.nct_id },
  title: { key: 'title', type: 'string', accessor: (r) => r.title || '' },
  enrollment: { key: 'enrollment', type: 'number', accessor: (r) => r.enrollment },
  age: { key: 'age', type: 'number', accessor: (r) => parseFloat(r.min_age) || parseFloat(r.max_age) || NaN },
  criteria: { key: 'criteria', type: 'string', accessor: (r) => _criteriaText(r.molecular_criteria) },
  eligible_patients: { key: 'eligible_patients', type: 'number', accessor: (r) => r.eligible_patients },
  actual_response_rate: { key: 'actual_response_rate', type: 'number', accessor: (r) => r.actual_response_rate },
  mean_predicted_rate: { key: 'mean_predicted_rate', type: 'number', accessor: (r) => r.mean_predicted_rate },
  mean_threshold: { key: 'mean_threshold', type: 'number', accessor: (r) => r.mean_threshold },
  std_threshold: { key: 'std_threshold', type: 'number', accessor: (r) => r.std_threshold },
  drugs: { key: 'drugs', type: 'string', accessor: (r) => _drugsText(r.drugs) },
};

const TESTING_COLS: Record<string, ColDef> = {
  nct_id: { key: 'nct_id', type: 'string', accessor: (r) => r.nct_id },
  title: { key: 'title', type: 'string', accessor: (r) => r.title || '' },
  enrollment: { key: 'enrollment', type: 'number', accessor: (r) => r.enrollment },
  age: { key: 'age', type: 'number', accessor: (r) => parseFloat(r.min_age) || parseFloat(r.max_age) || NaN },
  criteria: { key: 'criteria', type: 'string', accessor: (r) => _criteriaText(r.molecular_criteria) },
  eligible_patients: { key: 'eligible_patients', type: 'number', accessor: (r) => r.eligible_patients },
  actual_response_rate: { key: 'actual_response_rate', type: 'number', accessor: (r) => r.actual_response_rate },
  mean_predicted_rate: { key: 'mean_predicted_rate', type: 'number', accessor: (r) => r.mean_predicted_rate },
  abs_error: {
    key: 'abs_error',
    type: 'number',
    accessor: (r) => Math.abs((r.mean_predicted_rate ?? 0) - (r.actual_response_rate ?? 0)),
  },
  drugs: { key: 'drugs', type: 'string', accessor: (r) => _drugsText(r.drugs) },
};

const EXCLUDED_COLS: Record<string, ColDef> = {
  nct_id: { key: 'nct_id', type: 'string', accessor: (r) => r.nct_id },
  title: { key: 'title', type: 'string', accessor: (r) => r.title || '' },
  enrollment: { key: 'enrollment', type: 'number', accessor: (r) => r.enrollment },
  age: { key: 'age', type: 'number', accessor: (r) => parseFloat(r.min_age) || parseFloat(r.max_age) || NaN },
  criteria: { key: 'criteria', type: 'string', accessor: (r) => _criteriaText(r.molecular_criteria) },
  actual_response_rate: { key: 'actual_response_rate', type: 'number', accessor: (r) => r.actual_response_rate },
  drugs: { key: 'drugs', type: 'string', accessor: (r) => _drugsText(r.drugs) },
  exclusion_reason: { key: 'exclusion_reason', type: 'string', accessor: (r) => r.exclusion_reason || '' },
};

function TrainingTrialsTable({ data }: { data: any }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedRows(data.training_trials, TRAINING_COLS, 'nct_id', 'asc');
  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Training Trials (Threshold Learning)</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#f0f4ff' }}>
            <SortableTH label="NCT ID" colKey="nct_id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH label="Title" colKey="title" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Enrollment"
              colKey="enrollment"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Age" colKey="age" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Matched Eligibility Criteria"
              colKey="criteria"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableTH
              label="Eligible Patients"
              colKey="eligible_patients"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Actual RR"
              colKey="actual_response_rate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Mean Predicted RR"
              colKey="mean_predicted_rate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Mean Threshold"
              colKey="mean_threshold"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Std Threshold"
              colKey="std_threshold"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Drugs" colKey="drugs" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t: any) => (
            <tr key={t.nct_id + (t.arm_group || '')} style={{ borderBottom: '1px solid #eee' }}>
              <td style={tdStyle}>
                {t.nct_id.split(':')[0]}
                {t.arm_group && (
                  <div style={{ fontSize: '0.68rem', color: '#7b1fa2', fontWeight: 500, marginTop: 1 }}>
                    {t.arm_group}
                  </div>
                )}
              </td>
              <td
                style={{
                  ...tdStyle,
                  maxWidth: 250,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={t.title}
              >
                {t.title}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{t.enrollment}</td>
              <td style={{ ...tdStyle, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {formatAgeRange(t.min_age, t.max_age)}
              </td>
              <td style={tdStyle}>
                <CriteriaPills criteria={t.molecular_criteria} />
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {t.eligible_patients} / {t.total_patients}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{(t.actual_response_rate * 100).toFixed(1)}%</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>
                {t.mean_predicted_rate != null ? (t.mean_predicted_rate * 100).toFixed(1) + '%' : '-'}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{t.mean_threshold?.toFixed(4)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{t.std_threshold?.toFixed(4)}</td>
              <td style={{ ...tdStyle, fontSize: '0.72rem' }}>
                <DrugList drugs={t.drugs} moaDrugNames={data.moa_drug_names} />
                {t.arm_drugs && t.arm_drugs.length > 0 && (
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: 2 }}>(arm-specific)</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestingTrialsTable({ data }: { data: any }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedRows(data.testing_trials, TESTING_COLS, 'nct_id', 'asc');
  return (
    <div
      style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}
    >
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Testing Trials (Threshold Validation)</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#f0fff4' }}>
            <SortableTH label="NCT ID" colKey="nct_id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH label="Title" colKey="title" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Enrollment"
              colKey="enrollment"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Age" colKey="age" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Matched Eligibility Criteria"
              colKey="criteria"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableTH
              label="Eligible Patients"
              colKey="eligible_patients"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Actual RR"
              colKey="actual_response_rate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Predicted RR (mean)"
              colKey="mean_predicted_rate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH
              label="Abs Error"
              colKey="abs_error"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Drugs" colKey="drugs" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t: any) => {
            const absErr = Math.abs((t.mean_predicted_rate ?? 0) - (t.actual_response_rate ?? 0));
            return (
              <tr key={t.nct_id + (t.arm_group || '')} style={{ borderBottom: '1px solid #eee' }}>
                <td style={tdStyle}>
                  {t.nct_id.split(':')[0]}
                  {t.arm_group && (
                    <div style={{ fontSize: '0.68rem', color: '#7b1fa2', fontWeight: 500, marginTop: 1 }}>
                      {t.arm_group}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    maxWidth: 250,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={t.title}
                >
                  {t.title}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{t.enrollment}</td>
                <td style={{ ...tdStyle, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                  {formatAgeRange(t.min_age, t.max_age)}
                </td>
                <td style={tdStyle}>
                  <CriteriaPills criteria={t.molecular_criteria} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {t.eligible_patients} / {t.total_patients}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{(t.actual_response_rate * 100).toFixed(1)}%</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{(t.mean_predicted_rate * 100).toFixed(1)}%</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: absErr > 0.15 ? '#c62828' : '#2e7d32' }}>
                  {(absErr * 100).toFixed(1)}%
                </td>
                <td style={{ ...tdStyle, fontSize: '0.72rem' }}>
                  <DrugList drugs={t.drugs} moaDrugNames={data.moa_drug_names} />
                  {t.arm_drugs && t.arm_drugs.length > 0 && (
                    <div style={{ fontSize: '0.65rem', color: '#666', marginTop: 2 }}>(arm-specific)</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExcludedTrialsTable({ data }: { data: any }) {
  const { sorted, sortKey, sortDir, onSort } = useSortedRows(data.excluded_trials, EXCLUDED_COLS, 'nct_id', 'asc');
  return (
    <div
      style={{
        background: '#fff8f0',
        border: '1px solid #ffe0b2',
        borderRadius: 8,
        padding: '1rem',
        marginBottom: '1rem',
      }}
    >
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', color: '#e65100' }}>
        Excluded Trials — Outlier Detection ({data.excluded_trials.length})
      </h3>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: '#888' }}>
        These trial arms were excluded from the simulation because their response rates were flagged as statistical
        outliers. They are shown here for transparency with all available metrics.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#fff3e0' }}>
            <SortableTH label="NCT ID" colKey="nct_id" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH label="Title" colKey="title" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Enrollment"
              colKey="enrollment"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Age" colKey="age" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Matched Eligibility Criteria"
              colKey="criteria"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableTH
              label="Actual RR"
              colKey="actual_response_rate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              align="right"
            />
            <SortableTH label="Drugs" colKey="drugs" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTH
              label="Exclusion Reason"
              colKey="exclusion_reason"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t: any) => (
            <tr key={t.nct_id + (t.arm_group || '')} style={{ borderBottom: '1px solid #ffe0b2' }}>
              <td style={tdStyle}>
                {t.nct_id.split(':')[0]}
                {t.arm_group && (
                  <div style={{ fontSize: '0.68rem', color: '#7b1fa2', fontWeight: 500, marginTop: 1 }}>
                    {t.arm_group}
                  </div>
                )}
              </td>
              <td
                style={{
                  ...tdStyle,
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={t.title}
              >
                {t.title}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{t.enrollment}</td>
              <td style={{ ...tdStyle, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {formatAgeRange(t.min_age, t.max_age)}
              </td>
              <td style={tdStyle}>
                <CriteriaPills criteria={t.molecular_criteria} />
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: '#c62828' }}>
                {(t.actual_response_rate * 100).toFixed(1)}%
              </td>
              <td style={{ ...tdStyle, fontSize: '0.72rem' }}>
                <DrugList drugs={t.drugs} moaDrugNames={data.moa_drug_names} />
              </td>
              <td style={{ ...tdStyle, fontSize: '0.72rem' }}>
                <ExclusionBadge reason={t.exclusion_reason} method={t.exclusion_method} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render drug names with MOA-matching drugs in bold. */
function DrugList({ drugs, moaDrugNames }: { drugs?: string[]; moaDrugNames?: string[] }) {
  if (!drugs || drugs.length === 0) return <span style={{ color: '#999' }}>-</span>;

  const moaSet = new Set((moaDrugNames || []).map((d: string) => d.toUpperCase()));

  return (
    <span>
      {drugs.map((drug: string, i: number) => {
        const isMoa = moaSet.has(drug.toUpperCase());
        return (
          <span key={drug + i}>
            {i > 0 && ', '}
            <span style={isMoa ? { fontWeight: 700 } : undefined}>{drug}</span>
          </span>
        );
      })}
    </span>
  );
}

// ── Criteria autocomplete suggestions ────────────────────────────────────
// Each entry maps to a recognised pattern in parse_molecular_criteria().
// The `category` groups suggestions visually in the dropdown.

const CRITERIA_SUGGESTIONS: { label: string; category: string }[] = [
  // EGFR
  { label: 'EGFR amplified', category: 'EGFR' },
  { label: 'EGFRvIII positive', category: 'EGFR' },
  { label: 'EGFRvIII negative', category: 'EGFR' },
  { label: 'EGFR overexpressed', category: 'EGFR' },
  { label: 'EGFR mutant', category: 'EGFR' },
  { label: 'EGFR altered', category: 'EGFR' },
  // MGMT
  { label: 'MGMT methylated', category: 'MGMT' },
  { label: 'MGMT unmethylated', category: 'MGMT' },
  // IDH
  { label: 'IDH mutant', category: 'IDH' },
  { label: 'IDH wildtype', category: 'IDH' },
  { label: 'IDH1 R132H', category: 'IDH' },
  // TP53
  { label: 'TP53 mutant', category: 'TP53' },
  { label: 'TP53 wildtype', category: 'TP53' },
  // PTEN
  { label: 'PTEN loss', category: 'PTEN' },
  { label: 'PTEN mutant', category: 'PTEN' },
  { label: 'PTEN intact', category: 'PTEN' },
  // BRAF
  { label: 'BRAF V600E', category: 'BRAF' },
  { label: 'BRAF mutant', category: 'BRAF' },
  // ATRX
  { label: 'ATRX loss', category: 'ATRX' },
  // 1p/19q
  { label: '1p/19q codeletion', category: '1p/19q' },
  { label: '1p/19q intact', category: '1p/19q' },
  // TERT
  { label: 'TERT promoter mutant', category: 'TERT' },
  // CDKN2A
  { label: 'CDKN2A deleted', category: 'CDKN2A' },
  // Amplifications
  { label: 'CDK4 amplified', category: 'Amplifications' },
  { label: 'MDM2 amplified', category: 'Amplifications' },
  { label: 'PDGFRA amplified', category: 'Amplifications' },
  { label: 'MET amplified', category: 'Amplifications' },
  { label: 'MYC amplified', category: 'Amplifications' },
  { label: 'MYCN amplified', category: 'Amplifications' },
  // Mutations
  { label: 'NF1 mutant', category: 'Mutations' },
  { label: 'PIK3CA mutant', category: 'Mutations' },
  { label: 'RB1 mutant', category: 'Mutations' },
  // Fusions
  { label: 'NTRK fusion', category: 'Fusions' },
  { label: 'ALK fusion', category: 'Fusions' },
  { label: 'ROS1 fusion', category: 'Fusions' },
  { label: 'FGFR altered', category: 'Fusions' },
  // TMB / MSI
  { label: 'TMB high', category: 'TMB / MSI' },
  { label: 'MSI high', category: 'TMB / MSI' },
  // PD-L1
  { label: 'PD-L1 positive', category: 'PD-L1' },
  // H3K27M
  { label: 'H3 K27M', category: 'H3K27M' },
  // Recurrence / prior treatment
  { label: 'Recurrent GBM', category: 'Clinical' },
  { label: 'Newly diagnosed', category: 'Clinical' },
  { label: 'Prior temozolomide', category: 'Clinical' },
  { label: 'Prior bevacizumab', category: 'Clinical' },
  { label: 'Alkylator resistant', category: 'Clinical' },
];

/** Autocomplete input for eligibility criteria. */
function CriteriaAutocomplete({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const query = value.toLowerCase().trim();
  const filtered = query
    ? CRITERIA_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(query))
    : CRITERIA_SUGGESTIONS;

  // Group filtered suggestions by category
  const grouped: { category: string; items: typeof filtered }[] = [];
  const catOrder: string[] = [];
  for (const s of filtered) {
    if (!catOrder.includes(s.category)) catOrder.push(s.category);
  }
  for (const cat of catOrder) {
    grouped.push({ category: cat, items: filtered.filter((s) => s.category === cat) });
  }

  // Flat list for keyboard nav
  const flatItems = grouped.flatMap((g) => g.items);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll focused item into view
  useEffect(() => {
    if (focusIdx >= 0 && listRef.current) {
      const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
      el?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focusIdx]);

  const select = (label: string) => {
    onChange(label);
    setOpen(false);
    setFocusIdx(-1);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      setFocusIdx(0);
      e.preventDefault();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx((p) => Math.min(p + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx((p) => Math.max(p - 1, 0));
    } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < flatItems.length) {
      e.preventDefault();
      select(flatItems[focusIdx].label);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Build a flat rendered list that includes category headers as non-selectable items
  let flatIdx = 0;
  const rows: React.ReactNode[] = [];
  for (const g of grouped) {
    rows.push(
      <li
        key={`hdr-${g.category}`}
        style={{
          padding: '4px 10px',
          fontSize: '0.7rem',
          fontWeight: 700,
          color: '#888',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          background: '#fafafa',
          cursor: 'default',
          borderBottom: '1px solid #eee',
        }}
      >
        {g.category}
      </li>,
    );
    for (const item of g.items) {
      const idx = flatIdx++;
      const isFocused = idx === focusIdx;
      // Highlight the matching substring
      const matchStart = item.label.toLowerCase().indexOf(query);
      let labelNode: React.ReactNode = item.label;
      if (query && matchStart >= 0) {
        const before = item.label.slice(0, matchStart);
        const match = item.label.slice(matchStart, matchStart + query.length);
        const after = item.label.slice(matchStart + query.length);
        labelNode = (
          <>
            {before}
            <b style={{ color: '#1e3a8a' }}>{match}</b>
            {after}
          </>
        );
      }
      rows.push(
        <li
          key={item.label}
          onMouseDown={(e) => {
            e.preventDefault();
            select(item.label);
          }}
          onMouseEnter={() => setFocusIdx(idx)}
          style={{
            padding: '6px 12px',
            fontSize: '0.85rem',
            cursor: 'pointer',
            background: isFocused ? '#e3f2fd' : '#fff',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {labelNode}
        </li>,
      );
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setFocusIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        style={{ width: '100%', padding: '6px', fontSize: '0.85rem', boxSizing: 'border-box' }}
        autoComplete="off"
      />
      {open && rows.length > 0 && (
        <ul
          ref={listRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 280,
            overflowY: 'auto',
            margin: 0,
            padding: 0,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #ccc',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {rows}
        </ul>
      )}
    </div>
  );
}

// ── Proposed-Drug Simulation ─────────────────────────────────────────────

function ProposedDrugSimulation({
  simId,
  moaCategory,
  moaDrugNames,
  allResponseRates,
  learnedThreshold,
}: {
  simId: string;
  moaCategory?: string;
  moaDrugNames?: string[];
  allResponseRates?: number[];
  learnedThreshold?: number;
}) {
  const [drugName, setDrugName] = useState('');
  const [criteria, setCriteria] = useState<{ text: string; type: 'inclusion' | 'exclusion' }[]>([
    { text: '', type: 'inclusion' },
  ]);
  const [criteriaLogic, setCriteriaLogic] = useState<'all' | 'any' | 'at_least'>('all');
  const [criteriaMinCount, setCriteriaMinCount] = useState(1);
  const [trialSize, setTrialSize] = useState(100);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const scatterRef = useRef<HTMLDivElement>(null);

  const runSimulation = () => {
    if (!drugName.trim()) {
      setError('Please enter a drug name.');
      return;
    }
    setError(null);
    setRunning(true);
    setResult(null);
    api
      .post('/simulation/proposed-drug', {
        sim_id: simId,
        drug_name: drugName.trim(),
        eligibility_criteria_v2: criteria
          .filter((c) => c.text.trim().length > 0)
          .map((c) => ({ text: c.text.trim(), type: c.type })),
        criteria_logic: criteriaLogic,
        criteria_min_count: criteriaMinCount,
        trial_size: trialSize,
        n_iterations: 1000,
      })
      .then(({ data }) => setResult(data))
      .catch((e) => setError(e?.response?.data?.detail || e.message || 'Simulation failed'))
      .finally(() => setRunning(false));
  };

  // MOA name → Title Case (with fully-caps gene tokens)
  const formatMoaTitle = (base?: string): string => {
    const s = (base || '').trim();
    if (!s) return '';
    const singular = s.replace(
      /\b(Inhibitors|Agonists|Antagonists|Modulators|Blockers|Activators|Agents|Analogues|Analogs)\b/gi,
      (m) => m.slice(0, -1),
    );
    return singular
      .split(/\s+/)
      .map((w) => {
        if (!w) return w;
        if (w.length >= 2 && /^[A-Z0-9-]+$/.test(w)) return w;
        return w[0].toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
  };

  // Box plot
  useEffect(() => {
    if (!result || !boxRef.current) return;
    const rates = result.predicted_rates as number[];
    const drugRaw = result.drug_name as string;
    const drug = drugRaw ? drugRaw.charAt(0).toUpperCase() + drugRaw.slice(1).toLowerCase() : '';
    const meanRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

    const boxTrace: any = {
      type: 'box',
      y: rates,
      x: rates.map(() => drug),
      name: drug,
      boxpoints: false,
      whiskerwidth: 0.6,
      width: 0.55,
      line: { color: '#000', width: 1.2 },
      fillcolor: 'rgba(255,255,255,1)',
      showlegend: false,
    };

    const traces: any[] = [boxTrace];

    // Mean predicted response rate — black "+" marker matching the
    // per-therapy box plot styling.
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: [drug],
      y: [meanRate],
      marker: { symbol: 'cross-thin-open', size: 14, color: '#000', line: { color: '#000', width: 2 } },
      showlegend: false,
      hoverinfo: 'skip',
    });

    // Legend-only placeholder for the mean predicted + marker
    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: [null],
      y: [null],
      marker: { symbol: 'cross-thin-open', size: 14, color: '#000', line: { color: '#000', width: 2 } },
      name: `Mean Predicted Response Rate: ${(meanRate * 100).toFixed(1)}%`,
      hoverinfo: 'skip',
    });

    // MOA class-wide observed response rate range — shaded red band
    const rrAll = (allResponseRates || []).filter((v) => typeof v === 'number' && !isNaN(v));
    const moaTitle = formatMoaTitle(moaCategory);
    const bandLegendName = moaTitle ? `${moaTitle} Response Rate Range` : 'MOA Response Rate Range';
    const shapes: any[] = [];
    if (rrAll.length >= 2) {
      const rrMin = Math.min(...rrAll);
      const rrMax = Math.max(...rrAll);
      shapes.push({
        type: 'rect',
        xref: 'paper',
        yref: 'y',
        x0: 0,
        x1: 1,
        y0: rrMin,
        y1: rrMax,
        fillcolor: 'rgba(230, 57, 70, 0.18)',
        line: { width: 0 },
        layer: 'below',
      });
      // Legend-only swatch for the shaded band
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { symbol: 'square', size: 16, color: 'rgba(230, 57, 70, 0.35)', line: { color: '#e63946', width: 1 } },
        name: bandLegendName,
        hoverinfo: 'skip',
      });
    }

    const layout: any = {
      font: { size: 20, family: 'Arial, Helvetica, sans-serif' },
      title: { text: `<b>${drug} Predicted Response Rate Simulation</b>`, font: { size: 24 } },
      yaxis: {
        title: { text: '<b>Predicted Response Rate (%)</b>', font: { size: 22 }, standoff: 20 },
        tickformat: '.0%',
        range: [0, 1],
        tickfont: { size: 18 },
        automargin: true,
        showline: true,
        ticks: 'outside',
        zeroline: false,
      },
      xaxis: {
        title: { text: '' },
        tickfont: { size: 18 },
        automargin: true,
        type: 'category',
        showline: true,
        ticks: 'outside',
      },
      height: 640,
      width: 820,
      margin: { l: 110, r: 30, t: 140, b: 100 },
      showlegend: true,
      legend: {
        x: 0.5,
        y: 1.12,
        xanchor: 'center',
        yanchor: 'top',
        bgcolor: 'rgba(255,255,255,0.95)',
        bordercolor: '#333',
        borderwidth: 1,
        font: { size: 16 },
      },
      shapes,
    };
    Plotly.newPlot(boxRef.current, traces, withProvenance(layout, `/simulation/proposed-rr/${drug}`), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename(`${drug}_proposed_rr`),
        width: 820,
        height: 560,
        scale: 4,
      },
    });
    return () => {
      if (boxRef.current) Plotly.purge(boxRef.current);
    };
  }, [result, allResponseRates, moaCategory]);

  // Scatter plot (patient classification — all TCGA patients)
  useEffect(() => {
    if (!result || !scatterRef.current) return;
    const patients = result.patients as any[];
    const drugRaw = result.drug_name as string;
    const drug = drugRaw ? drugRaw.charAt(0).toUpperCase() + drugRaw.slice(1).toLowerCase() : '';
    const thr = result.learned_threshold as number;
    const critNames = (result.criteria as string[]) || [];
    const critTypes = (result.criteria_types as string[]) || [];
    const hasCriteria = critNames.some((c: string) => c && c.trim());

    const eligibleCount = patients.filter((p: any) => p.eligible).length;
    const ineligibleCount = patients.length - eligibleCount;

    // Shift x so the responder cutoff lives at 0, then FORCE each point onto
    // the side matching its classification (responders to the right of 0,
    // non-responders to the left).
    const eps = 0.005;
    const shifted = patients.map((p: any) => {
      const raw = p.dcna - thr;
      const isResp = p.dcna > thr && p.expr > 0;
      let x = raw;
      if (isResp && x <= 0) x = eps - x;
      if (!isResp && x >= 0) x = -(x + eps);
      return { ...p, x, responder: isResp };
    });

    // Marker sizes: eligible = large, ineligible = small
    const SIZE_ELIGIBLE = 12;
    const SIZE_INELIGIBLE = 5;

    const traces: any[] = [];

    // ── Legend entries ──
    // Compute the four quadrant counts
    const respElig = shifted.filter((p: any) => p.responder && p.eligible).length;
    const respInelig = shifted.filter((p: any) => p.responder && !p.eligible).length;
    const nonElig = shifted.filter((p: any) => !p.responder && p.eligible).length;
    const nonInelig = shifted.filter((p: any) => !p.responder && !p.eligible).length;

    if (hasCriteria) {
      // Four combined entries: colour = responder class, size = eligibility, count in label
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_ELIGIBLE, color: '#e74c3c', line: { color: '#333', width: 0.5 } },
        name: `Responder + Eligible (${respElig})`,
        legendgroup: 'combo',
        showlegend: true,
        hoverinfo: 'skip',
      });
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_INELIGIBLE, color: '#e74c3c', opacity: 0.35, line: { color: '#333', width: 0.3 } },
        name: `Responder + Ineligible (${respInelig})`,
        legendgroup: 'combo',
        showlegend: true,
        hoverinfo: 'skip',
      });
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_ELIGIBLE, color: '#4a90d9', line: { color: '#333', width: 0.5 } },
        name: `Non-Responder + Eligible (${nonElig})`,
        legendgroup: 'combo',
        showlegend: true,
        hoverinfo: 'skip',
      });
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_INELIGIBLE, color: '#4a90d9', opacity: 0.35, line: { color: '#333', width: 0.3 } },
        name: `Non-Responder + Ineligible (${nonInelig})`,
        legendgroup: 'combo',
        showlegend: true,
        hoverinfo: 'skip',
      });

      // Per-criterion legend entries
      for (let i = 0; i < critNames.length; i++) {
        if (!critNames[i] || !critNames[i].trim()) continue;
        const isExcl = (critTypes[i] || 'inclusion') === 'exclusion';
        const tag = isExcl ? '✕ Exclude' : '✓ Include';
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [null],
          y: [null],
          marker: {
            size: 10,
            symbol: 'diamond',
            color: isExcl ? '#e57373' : '#81c784',
            line: { color: '#333', width: 0.5 },
          },
          name: `${critNames[i]} (${tag})`,
          legendgroup: 'criteria',
          legendgrouptitle: { text: 'Criteria' },
          showlegend: true,
          hoverinfo: 'skip',
        });
      }
    } else {
      // No criteria — simple responder / non-responder legend
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_ELIGIBLE, color: '#e74c3c', line: { color: '#333', width: 0.5 } },
        name: `Predicted Responder (${respElig + respInelig})`,
        legendgroup: 'class',
        showlegend: true,
        hoverinfo: 'skip',
      });
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: [null],
        y: [null],
        marker: { size: SIZE_ELIGIBLE, color: '#4a90d9', line: { color: '#333', width: 0.5 } },
        name: `Predicted Non-Responder (${nonElig + nonInelig})`,
        legendgroup: 'class',
        showlegend: true,
        hoverinfo: 'skip',
      });
    }

    // ── Data traces: group by (responder × eligible) ──
    const groups: Map<string, { resp: boolean; elig: boolean; pts: any[] }> = new Map();
    for (const p of shifted) {
      const k = `${p.responder ? 'R' : 'N'}|${p.eligible ? 'E' : 'I'}`;
      if (!groups.has(k)) groups.set(k, { resp: p.responder, elig: p.eligible, pts: [] });
      groups.get(k)!.pts.push(p);
    }
    for (const g of groups.values()) {
      const color = g.resp ? '#e74c3c' : '#4a90d9';
      const size = g.elig ? SIZE_ELIGIBLE : SIZE_INELIGIBLE;
      const opacity = g.elig ? 0.7 : 0.35;
      traces.push({
        type: 'scatter',
        mode: 'markers',
        x: g.pts.map((p: any) => p.x),
        y: g.pts.map(() => (Math.random() - 0.5) * 1.8),
        marker: { size, color, opacity, line: { color: '#333', width: g.elig ? 0.5 : 0.2 } },
        text: g.pts.map((p: any) => {
          const matchedStr = hasCriteria
            ? (p.matched_criteria || []).map((i: number) => critNames[i] || `C${i + 1}`).join(', ') || 'none'
            : 'n/a';
          return (
            `${p.patient_id}<br>Responsiveness: ${p.x.toFixed(3)}<br>` +
            `Expr: ${p.expr.toFixed(3)}<br>` +
            `Eligible: ${p.eligible ? 'Yes' : 'No'}<br>` +
            `Matched criteria: ${matchedStr}`
          );
        }),
        hoverinfo: 'text',
        showlegend: false,
      });
    }

    const xs = shifted.map((p: any) => p.x);
    const xmin = Math.min(...xs, 0);
    const xmax = Math.max(...xs, 0);
    const pad = (xmax - xmin) * 0.05 || 0.1;

    const layout: any = {
      font: { size: 20, family: 'Arial, Helvetica, sans-serif' },
      xaxis: {
        title: { text: `<b>Predicted Responsiveness to ${drug}</b>`, font: { size: 22 }, standoff: 15 },
        zeroline: false,
        range: [xmin - pad, xmax + pad],
        automargin: true,
        tickfont: { size: 18 },
      },
      yaxis: { visible: false, range: [-1.2, 1.2] },
      height: 520,
      width: 960,
      margin: { l: 30, r: 320, t: 60, b: 90 },
      title: {
        text: `<b>${patients.length} TCGA Patients — ${eligibleCount} Eligible, ${ineligibleCount} Ineligible</b>`,
        font: { size: 18 },
        y: 0.98,
        x: 0.5,
        xanchor: 'center' as const,
        yanchor: 'top' as const,
      },
      showlegend: true,
      legend: {
        x: 1.02,
        y: 1,
        xanchor: 'left',
        bgcolor: 'rgba(255,255,255,0.95)',
        bordercolor: '#333',
        borderwidth: 1,
        groupclick: 'togglegroup',
        font: { size: 16 },
      },
      shapes: [
        {
          type: 'line',
          x0: 0,
          x1: 0,
          y0: -1.2,
          y1: 1.2,
          line: { color: '#000', width: 2, dash: 'solid' },
        },
      ],
    };
    Plotly.newPlot(scatterRef.current, traces, withProvenance(layout, `/simulation/patient-classification/${drug}`), {
      responsive: false,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename(`${drug}_patient_classification`),
        width: 960,
        height: 400,
        scale: 4,
      },
    });
    return () => {
      if (scatterRef.current) Plotly.purge(scatterRef.current);
    };
  }, [result]);

  const availableDrugs = (moaDrugNames || []).slice().sort();

  return (
    <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Proposed-Drug Simulation</h3>
      <p style={{ fontSize: '0.85rem', color: '#555', marginTop: 0 }}>
        Simulate a proposed new drug from the <b>{moaCategory || 'same'}</b> MOA family against a TCGA cohort. The
        simulation runs 1000 iterations using the learned DCNA threshold ({' '}
        <code>{(result?.learned_threshold ?? learnedThreshold)?.toFixed(4) || '…'}</code>) and a gene-expression
        threshold &gt; 0 to classify responders.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <label style={{ display: 'block' }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Drug name</div>
          <input
            type="text"
            value={drugName}
            onChange={(e) => setDrugName(e.target.value)}
            placeholder="e.g. Niraparib"
            list="proposed-drug-options"
            style={{ width: '100%', padding: '6px', fontSize: '0.85rem' }}
          />
          <datalist id="proposed-drug-options">
            {availableDrugs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label style={{ display: 'block' }}>
          <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>Trial size (N patients)</div>
          <input
            type="number"
            value={trialSize}
            min={5}
            max={2000}
            onChange={(e) => setTrialSize(parseInt(e.target.value || '0', 10))}
            style={{ width: '100%', padding: '6px', fontSize: '0.85rem' }}
          />
        </label>
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6 }}>Eligibility criteria</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, fontSize: '0.82rem' }}>
          <span style={{ fontWeight: 600, color: '#555' }}>Inclusion logic:</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="crit-logic"
              checked={criteriaLogic === 'all'}
              onChange={() => setCriteriaLogic('all')}
            />
            <span>ALL criteria met</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="crit-logic"
              checked={criteriaLogic === 'any'}
              onChange={() => setCriteriaLogic('any')}
            />
            <span>ANY criterion met</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="crit-logic"
              checked={criteriaLogic === 'at_least'}
              onChange={() => setCriteriaLogic('at_least')}
            />
            <span>At least</span>
          </label>
          {criteriaLogic === 'at_least' && (
            <input
              type="number"
              value={criteriaMinCount}
              min={1}
              max={criteria.filter((c) => c.type === 'inclusion').length || 1}
              onChange={(e) => setCriteriaMinCount(Math.max(1, parseInt(e.target.value || '1', 10)))}
              style={{ width: 48, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'center' }}
            />
          )}
          {criteriaLogic === 'at_least' && <span>criteria met</span>}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#777', marginBottom: 6 }}>
          {criteriaLogic === 'all' && 'Patients must match ALL inclusion criteria and NONE of the exclusion criteria.'}
          {criteriaLogic === 'any' &&
            'Patients must match at least ONE inclusion criterion and NONE of the exclusion criteria.'}
          {criteriaLogic === 'at_least' &&
            `Patients must match at least ${criteriaMinCount} inclusion criteria and NONE of the exclusion criteria.`}
        </div>
        {criteria.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <select
              value={c.type}
              onChange={(e) => {
                const next = criteria.slice();
                next[i] = { ...next[i], type: e.target.value as 'inclusion' | 'exclusion' };
                setCriteria(next);
              }}
              style={{
                padding: '6px 4px',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid #ccc',
                width: 100,
                background: c.type === 'inclusion' ? '#e8f5e9' : '#fce4ec',
                color: c.type === 'inclusion' ? '#2e7d32' : '#c62828',
              }}
            >
              <option value="inclusion">Include</option>
              <option value="exclusion">Exclude</option>
            </select>
            <CriteriaAutocomplete
              value={c.text}
              onChange={(v) => {
                const next = criteria.slice();
                next[i] = { ...next[i], text: v };
                setCriteria(next);
              }}
              placeholder={`Criterion ${i + 1} (e.g. EGFRvIII positive)`}
            />
            <button
              onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
              disabled={criteria.length === 1}
              style={{ padding: '0 10px', cursor: 'pointer' }}
              title="Remove this criterion"
            >
              -
            </button>
          </div>
        ))}
        <button
          onClick={() => setCriteria([...criteria, { text: '', type: 'inclusion' }])}
          style={{ padding: '4px 10px', fontSize: '0.8rem', cursor: 'pointer' }}
        >
          + Add criterion
        </button>
      </div>
      <button
        onClick={runSimulation}
        disabled={running}
        style={{
          padding: '8px 16px',
          background: running ? '#999' : '#1e3a8a',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: running ? 'wait' : 'pointer',
          fontWeight: 600,
        }}
      >
        {running ? 'Running 1000 iterations…' : 'Run Proposed-Drug Simulation'}
      </button>
      {error && <div style={{ marginTop: '0.75rem', color: '#c62828', fontSize: '0.85rem' }}>Error: {error}</div>}

      {result && (
        <div style={{ marginTop: '1rem' }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}
          >
            <div style={{ fontSize: '0.85rem' }}>
              <b>{result.drug_name}</b> — {result.eligible_count} eligible / {result.total_patients} total TCGA patients
              — mean predicted RR: <b>{(result.mean_predicted_rate * 100).toFixed(1)}%</b>
            </div>
            <button
              onClick={() => {
                import('xlsx').then((XLSX) => {
                  const toPct = (v: number) => (v == null || isNaN(v) ? null : v * 100);
                  const rates = (result.predicted_rates as number[]) || [];
                  const sorted = [...rates].sort((a, b) => a - b);
                  const pctl = (s: number[], p: number): number => {
                    if (!s.length) return NaN;
                    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
                  };
                  const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : NaN;
                  const median = pctl(sorted, 0.5);
                  const q1 = pctl(sorted, 0.25);
                  const q3 = pctl(sorted, 0.75);
                  const minV = sorted.length ? sorted[0] : NaN;
                  const maxV = sorted.length ? sorted[sorted.length - 1] : NaN;
                  const sd =
                    rates.length > 1
                      ? Math.sqrt(rates.reduce((s, v) => s + (v - mean) ** 2, 0) / (rates.length - 1))
                      : NaN;

                  const rrAll = (allResponseRates || []).filter((v) => typeof v === 'number' && !isNaN(v));
                  const moaBandMin = rrAll.length >= 2 ? Math.min(...rrAll) : NaN;
                  const moaBandMax = rrAll.length >= 2 ? Math.max(...rrAll) : NaN;

                  // Summary sheet (transposed: metrics as rows)
                  const summaryRows: (string | number | null)[][] = [
                    ['Metric', result.drug_name],
                    ['MOA Category', moaCategory || ''],
                    ['Trial Size (N patients)', result.trial_size],
                    ['N Iterations', result.n_iterations],
                    ['Eligible TCGA Patients', result.eligible_count],
                    ['Learned DCNA Threshold', result.learned_threshold],
                    ['Eligibility Criteria', (result.criteria || []).join('; ')],
                    ['Mean Predicted RR (%)', toPct(mean)],
                    ['Median Predicted RR (%)', toPct(median)],
                    ['Q1 Predicted RR (%)', toPct(q1)],
                    ['Q3 Predicted RR (%)', toPct(q3)],
                    ['Min Predicted RR (%)', toPct(minV)],
                    ['Max Predicted RR (%)', toPct(maxV)],
                    ['SD Predicted RR (%)', toPct(sd)],
                    ['MOA Band Min (%)', toPct(moaBandMin)],
                    ['MOA Band Max (%)', toPct(moaBandMax)],
                  ];

                  // Predicted Rates sheet
                  const predHeader = [result.drug_name];
                  const predRows: (string | number | null)[][] = [predHeader];
                  for (const r of rates) {
                    predRows.push([toPct(r)]);
                  }

                  const wb = XLSX.utils.book_new();
                  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
                  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
                  const ws2 = XLSX.utils.aoa_to_sheet(predRows);
                  XLSX.utils.book_append_sheet(wb, ws2, 'Predicted Rates');

                  XLSX.writeFile(wb, `${result.drug_name || 'proposed_drug'}_simulation.xlsx`);
                });
              }}
              style={csvButtonStyle}
            >
              Download XLSX
            </button>
          </div>
          <div ref={boxRef} style={{ width: 820, minWidth: 820 }} />
          <div ref={scatterRef} style={{ width: 900, minWidth: 900, marginTop: '1rem' }} />
        </div>
      )}
    </div>
  );
}

// ── Style helpers ────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
  fontWeight: 600,
  fontSize: '0.78rem',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: '0.8rem',
};
