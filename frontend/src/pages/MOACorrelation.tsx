import { useState, useEffect, useRef, useSyncExternalStore, useMemo } from 'react';
import axios from 'axios';
import Plotly from 'plotly.js/dist/plotly.min.js';
import { InterpretBox, InlineHelp } from '../components/Interpretation';
import { withProvenance, provenanceImageFilename } from '../utils/provenance';
import {
  pearson, spearman,
  runBootstrap, materializeBand, makeRng, gaussian,
  runJackknife, runLeaveKOut,
  permutationTest,
  calibrationTestWald, confidenceEllipse,
  type BootstrapConfig, type BootstrapResult, type BootstrapInputPoint,
  type ResamplingScheme, type CIMethod, type CurveType,
  type JackknifeResult, type LeaveKOutResult,
  type PermutationResult, type CalibrationTestResult,
} from '../utils/bootstrap';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

// ─────────────────────────────────────────────────────────────────────────
// Module-level persistent store
// ─────────────────────────────────────────────────────────────────────────
// Lives outside React's component lifecycle so the analysis keeps running
// even when the user navigates away from the page. State (config + progress
// + results) is also mirrored to sessionStorage so a hard refresh restores
// the in-flight or completed analysis as long as the API server is up.

const STORAGE_KEY = 'moa_correlation_state_v1';

type TrialSet = 'testing' | 'all';

interface BootstrapUIConfig {
  B: number;
  scheme: ResamplingScheme;
  ciLevel: number;
  ciMethod: CIMethod;
  curveType: CurveType;
  seed: string;   // kept as string so blank = undefined
}

interface LeaveKOutUIConfig {
  k: number;
  B: number;
  ciLevel: number;
  seed: string;
}

// Keys for the annotation-box metrics users can toggle on/off
// independently. Each corresponds to one line drawn below the
// correlation plot.
type AnnotationKey =
  | 'n'
  | 'omitted'
  | 'pearson'
  | 'spearman'
  | 'permutation'
  | 'calibration'
  | 'bootstrap'
  | 'avgUnique';

interface StoreState {
  selected: string[];
  nIterations: number;
  trialSet: TrialSet;
  running: boolean;
  statuses: RunStatus[];
  results: MOAResult[];
  // Bootstrap panel
  bootConfig: BootstrapUIConfig;
  bootResult: BootstrapResult | null;
  bootRunning: boolean;
  // Robustness panel
  lkoConfig: LeaveKOutUIConfig;
  jackknife: JackknifeResult | null;
  leaveKOut: LeaveKOutResult | null;
  robustnessRunning: boolean;
  showInfluencePlot: boolean;
  showCalibrationPlot: boolean;
  // Plot display toggles
  showPoints: boolean;
  showFitLine: boolean;
  showBand: boolean;
  showRefLine: boolean;
  // Which lines to include in the annotation box below the correlation plot.
  // Lines still appear only when their upstream data exists (e.g., the
  // calibration line is skipped when no bootstrap has been run) — toggles
  // only gate the decision once data is available.
  annotationVisibility: Record<AnnotationKey, boolean>;
  // Points the user has clicked to exclude from all stats (r, ρ, CIs,
  // per-MOA table, fit line, CI band). Stored as compound IDs built by
  // `pointId()`; persisted as an array so sessionStorage works.
  omitted: string[];
}

// Compound ID for a single correlation-plot point.
//   kind='trial'   → inner is nct_id
//   kind='therapy' → inner is canonicalized drug key
// The moa value is included so the same trial/drug appearing in multiple
// MOA groups can be omitted independently.
const pointId = (moaValue: string, kind: 'trial' | 'therapy', inner: string) =>
  `${moaValue}::${kind}::${inner}`;

const defaultBootConfig: BootstrapUIConfig = {
  B: 2000,
  scheme: 'nested',
  ciLevel: 0.95,
  ciMethod: 'percentile',
  curveType: 'ols',
  seed: '',
};

const defaultLkoConfig: LeaveKOutUIConfig = {
  k: 3,
  B: 1000,
  ciLevel: 0.95,
  seed: '',
};

const defaultAnnotationVisibility: Record<AnnotationKey, boolean> = {
  n: true,
  omitted: true,
  pearson: true,
  spearman: true,
  permutation: true,
  calibration: true,
  bootstrap: true,
  avgUnique: true,
};

// Human-readable labels for each annotation line, used by the toggle UI
// and nowhere else. Order defines render order in the toggle row.
const ANNOTATION_LABELS: Array<{ key: AnnotationKey; label: string; hint: string }> = [
  { key: 'n',           label: 'n',                hint: 'Number of points contributing to the stats.' },
  { key: 'omitted',     label: '(# omitted)',      hint: "User-omitted point count. When both 'n' and this are on, the count is shown in parentheses after n (e.g., 'n = 42 (3 omitted)'). When only this is on, it appears on its own line. Nothing is shown when zero points are omitted." },
  { key: 'pearson',     label: 'Pearson r',        hint: 'Linear correlation, its bootstrap CI (when available), and its permutation p-value.' },
  { key: 'spearman',    label: 'Spearman ρ',       hint: 'Rank correlation, its bootstrap CI (when available), and its permutation p-value.' },
  { key: 'permutation', label: 'permutation test', hint: 'One-line note about the permutation B and two-sided nature (appears only when permutation p-values are present).' },
  { key: 'calibration', label: 'calibration',      hint: 'OLS slope, intercept, and bootstrap-Wald p vs the y = x null. Appears only when an OLS bootstrap has been run.' },
  { key: 'bootstrap',   label: 'bootstrap config', hint: 'Resampling configuration: B × scheme, CI level, CI method. Appears only when a bootstrap has been run.' },
  { key: 'avgUnique',   label: 'avg unique',       hint: 'Mean distinct original points per bootstrap replicate (≈63% of n for case bootstraps, 100% for "simulation").' },
];

const defaultState: StoreState = {
  selected: [],
  nIterations: 500,
  trialSet: 'testing',
  running: false,
  statuses: [],
  results: [],
  bootConfig: defaultBootConfig,
  bootResult: null,
  bootRunning: false,
  lkoConfig: defaultLkoConfig,
  jackknife: null,
  leaveKOut: null,
  robustnessRunning: false,
  showInfluencePlot: true,
  showCalibrationPlot: true,
  showPoints: true,
  showFitLine: true,
  showBand: true,
  showRefLine: true,
  annotationVisibility: defaultAnnotationVisibility,
  omitted: [],
};

const loadInitial = (): StoreState => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    // Reset `running` on cold load — if the page was in flight, the polling
    // loop in this module is gone after a hard refresh.
    return { ...defaultState, ...parsed, running: false, robustnessRunning: false };
  } catch {
    return defaultState;
  }
};

const store = {
  state: loadInitial(),
  listeners: new Set<() => void>(),
  cancel: false,
  activeSimIds: new Map<string, string>(), // moa_value -> sim_id (for resume polling)

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
    } catch { /* quota or disabled */ }
    store.listeners.forEach((l) => l());
  },
};

const useStore = (): StoreState =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

interface MOACategory {
  category: string;
  value: string;
  drug_count: number;
  is_group: boolean;
  label?: string;
}

interface TestingTrial {
  nct_id: string;
  title?: string;
  actual_response_rate: number;
  mean_predicted_rate: number;
  std_predicted_rate: number;
  drugs?: string[];
  // Optional per-iteration simulation values (length ~ n_iterations).
  // When present, bootstrap "simulation" / "nested" schemes draw from this
  // array instead of a Gaussian approximation around (mean, std).
  fractions_above_threshold?: number[];
}

type Aggregation = 'trial' | 'therapy';

// Minimal drug-name canonicalization: lowercase + strip common salt suffixes
// so "Lapatinib Ditosylate" collapses with "Lapatinib" for grouping.
const SALT_SUFFIXES = [
  'hydrochloride', 'dihydrochloride', 'hcl',
  'sulfate', 'sulphate', 'bisulfate',
  'mesylate', 'dimesylate', 'tosylate', 'ditosylate',
  'besylate', 'besilate', 'camsylate', 'isethionate',
  'maleate', 'fumarate', 'citrate', 'tartrate', 'succinate',
  'acetate', 'phosphate', 'nitrate',
  'sodium', 'potassium', 'calcium', 'magnesium', 'meglumine',
  'bromide', 'chloride', 'iodide', 'fluoride',
  'hemihydrate', 'monohydrate', 'dihydrate', 'trihydrate', 'pentahydrate',
];
function canonicalizeDrug(raw: string): { key: string; label: string } {
  const base = (raw || '').trim();
  if (!base) return { key: '', label: '' };
  let words = base.split(/\s+/);
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
    if (SALT_SUFFIXES.includes(last)) words.pop();
    else break;
  }
  const label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return { key: label.toLowerCase(), label };
}

interface MOAResult {
  moa_category: string;
  moa_value: string;
  testing_trials: TestingTrial[];
  training_trials: TestingTrial[];
  excluded_nct_ids: string[];
}

interface RunStatus {
  moa_value: string;
  moa_label: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  stage?: string;
  detail?: string;
  pct?: number;
  error?: string;
}

// MOA-distinct colors (Sygnomics-leaning palette)
const MOA_COLORS = [
  '#634697', '#a12a8b', '#057fa5', '#1c3e72', '#2c639e',
  '#c2185b', '#00897b', '#f57c00', '#5e35b1', '#43a047',
];

// Font sizes used in every Plotly figure on this page.
// Adjust here to resize all plot text uniformly — do NOT hard-code sizes
// inside individual Plotly layouts.
const PLOT_FONTS = {
  title: 30,            // main chart title
  axisTitle: 24,        // x / y axis titles
  tick: 20,             // axis tick labels
  legend: 20,           // legend entries
  annotation: 22,       // stat callout text
  body: 22,             // global font fallback
  // Influence plot rotates many long trial IDs on the x-axis; keep that
  // tick font a touch smaller so labels don't collide, but still bumped.
  influenceTick: 16,
  captionSmall: 14,     // sub-axis / auxiliary labels
} as const;

// Small stat callout used in the robustness summary grid.
function StatCell(props: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        padding: '0.5rem 0.6rem',
        background: '#f8f9fa',
        borderRadius: 6,
        border: '1px solid #eee',
      }}
    >
      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1c3e72' }}>
        {props.value}
      </div>
      <div style={{ fontSize: '0.68rem', color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>{props.label}</span>
        {props.hint && <InlineHelp size={10} text={props.hint} />}
      </div>
    </div>
  );
}

// (Stats helpers `pearson`, `spearman`, `olsFit`, bootstrap core imported from
//  ../utils/bootstrap)

// Module-level run loop. Lives outside React lifecycle so leaving the page
// does not stop or reset the analysis.
async function runAnalysis(
  categoryLookup: (v: string) => string,
  selectedSnapshot: string[],
  nIterations: number,
) {
  if (store.state.running || selectedSnapshot.length === 0) return;
  store.cancel = false;
  store.activeSimIds.clear();

  const initial: RunStatus[] = selectedSnapshot.map((value) => ({
    moa_value: value,
    moa_label: categoryLookup(value),
    status: 'queued' as const,
  }));
  store.setState({ running: true, statuses: initial, results: [] });

  const collected: MOAResult[] = [];

  for (let i = 0; i < selectedSnapshot.length; i++) {
    if (store.cancel) break;
    const value = selectedSnapshot[i];
    const label = initial[i].moa_label;
    try {
      store.setState((s) => ({
        statuses: s.statuses.map((st, idx) =>
          idx === i ? { ...st, status: 'running', stage: 'starting…', pct: 0 } : st
        ),
      }));
      const startResp = await api.post('/simulation/moa-run', {
        moa_category: value,
        n_iterations: nIterations,
        save_plots: false,
      });
      const simId: string = startResp.data.sim_id;
      store.activeSimIds.set(value, simId);

      let done = false;
      while (!done) {
        if (store.cancel) break;
        await new Promise((r) => setTimeout(r, 1500));
        const { data } = await api.get(`/simulation/moa-status/${simId}`);
        store.setState((s) => ({
          statuses: s.statuses.map((st, idx) =>
            idx === i
              ? {
                  ...st,
                  status: data.status,
                  stage: data.stage,
                  detail: data.detail,
                  pct: data.progress_pct,
                  error: data.error,
                }
              : st
          ),
        }));
        if (data.status === 'complete' && data.result) {
          const excluded: string[] = (data.result.excluded_trials || [])
            .map((t: any) => t.nct_id)
            .filter((s: any) => typeof s === 'string');
          const excludedSet = new Set(excluded);
          const filt = (arr: any[]): TestingTrial[] =>
            (arr || [])
              .filter(
                (t: any) =>
                  typeof t.actual_response_rate === 'number' &&
                  typeof t.mean_predicted_rate === 'number' &&
                  !excludedSet.has(t.nct_id)
              )
              .map((t: any) => ({
                nct_id: t.nct_id,
                title: t.title,
                actual_response_rate: t.actual_response_rate,
                mean_predicted_rate: t.mean_predicted_rate,
                std_predicted_rate: t.std_predicted_rate || 0,
                drugs: Array.isArray(t.drugs) ? t.drugs : [],
                fractions_above_threshold: Array.isArray(t.fractions_above_threshold)
                  ? (t.fractions_above_threshold as number[])
                  : undefined,
              }));
          collected.push({
            moa_category: data.result.moa_category || label,
            moa_value: value,
            testing_trials: filt(data.result.testing_trials),
            training_trials: filt(data.result.training_trials),
            excluded_nct_ids: excluded,
          });
          store.setState({ results: [...collected] });
          done = true;
        } else if (data.status === 'error') {
          done = true;
        }
      }
    } catch (e: any) {
      store.setState((s) => ({
        statuses: s.statuses.map((st, idx) =>
          idx === i ? { ...st, status: 'error', error: String(e?.message || e) } : st
        ),
      }));
    }
  }
  store.setState({ running: false });
}

function cancelAnalysis() {
  store.cancel = true;
  store.setState({ running: false });
}

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap runner
// ─────────────────────────────────────────────────────────────────────────
// Operates on already-loaded `results`. Runs on the main thread in a single
// synchronous call; for the B values we expose this finishes in <1s.
function runBootstrapAnalysis(points: BootstrapInputPoint[], uiCfg: BootstrapUIConfig) {
  if (store.state.bootRunning) return;
  if (points.length < 3) {
    store.setState({ bootResult: null });
    return;
  }
  const seedNum = uiCfg.seed.trim() === '' ? undefined : Number(uiCfg.seed);
  const cfg: BootstrapConfig = {
    B: uiCfg.B,
    scheme: uiCfg.scheme,
    ciLevel: uiCfg.ciLevel,
    ciMethod: uiCfg.ciMethod,
    curveType: uiCfg.curveType,
    seed: Number.isFinite(seedNum) ? (seedNum as number) : undefined,
  };
  store.setState({ bootRunning: true });
  // Defer to next tick so the UI can show "running"
  setTimeout(() => {
    try {
      const result = runBootstrap(points, cfg);
      store.setState({ bootResult: result, bootRunning: false });
    } catch (e) {
      console.error('Bootstrap failed', e);
      store.setState({ bootRunning: false });
    }
  }, 10);
}

function clearBootstrap() {
  store.setState({ bootResult: null });
}

// ─────────────────────────────────────────────────────────────────────────
// Robustness runners
// ─────────────────────────────────────────────────────────────────────────
// Jackknife + leave-k-out are cheap (≤ few hundred ms at n≤100, B≤5000) but
// we still defer to the next tick so the "Running…" state can paint.
//
// They run independently so the user can fire one without the other:
//   - Jackknife is parameter-free (drop each point once); powers the
//     influence plot + max|Δr| summary
//   - Leave-k-out takes k, B, CI level, seed; reports a range/band for r

function runJackknifeAnalysis(points: BootstrapInputPoint[]) {
  if (store.state.robustnessRunning) return;
  if (points.length < 3) {
    store.setState({ jackknife: null });
    return;
  }
  store.setState({ robustnessRunning: true });
  setTimeout(() => {
    try {
      const jk = runJackknife(points);
      store.setState({ jackknife: jk, robustnessRunning: false });
    } catch (e) {
      console.error('Jackknife failed', e);
      store.setState({ robustnessRunning: false });
    }
  }, 10);
}

function runLeaveKOutAnalysis(
  points: BootstrapInputPoint[],
  lkoCfg: LeaveKOutUIConfig,
) {
  if (store.state.robustnessRunning) return;
  if (points.length < 4) {
    store.setState({ leaveKOut: null });
    return;
  }
  const seedNum = lkoCfg.seed.trim() === '' ? undefined : Number(lkoCfg.seed);
  store.setState({ robustnessRunning: true });
  setTimeout(() => {
    try {
      const lk = runLeaveKOut(points, {
        k: lkoCfg.k,
        B: lkoCfg.B,
        ciLevel: lkoCfg.ciLevel,
        seed: Number.isFinite(seedNum) ? (seedNum as number) : undefined,
      });
      store.setState({ leaveKOut: lk, robustnessRunning: false });
    } catch (e) {
      console.error('Leave-k-out failed', e);
      store.setState({ robustnessRunning: false });
    }
  }, 10);
}

function clearRobustness() {
  store.setState({ jackknife: null, leaveKOut: null });
}

// ─────────────────────────────────────────────────────────────────────────
// Point omission
// ─────────────────────────────────────────────────────────────────────────
// Manipulate the store.omitted list. Toggle adds/removes a single ID;
// restoreAll clears the whole list. All three also invalidate any stored
// bootstrap / robustness results, since those were computed against a
// different point set.

function toggleOmit(id: string) {
  store.setState((s) => {
    const set = new Set(s.omitted);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    return {
      omitted: Array.from(set),
      bootResult: null,
      jackknife: null,
      leaveKOut: null,
    };
  });
}

function restoreAllOmitted() {
  store.setState({
    omitted: [],
    bootResult: null,
    jackknife: null,
    leaveKOut: null,
  });
}

export default function MOACorrelation() {
  const {
    selected, nIterations, trialSet, running, statuses, results,
    bootConfig, bootResult, bootRunning,
    lkoConfig, jackknife, leaveKOut, robustnessRunning, showInfluencePlot,
    showCalibrationPlot,
    showPoints, showFitLine, showBand, showRefLine,
    annotationVisibility,
    omitted,
  } = useStore();

  // Backfill any missing annotation keys when loading old stored state.
  // Guarantees every AnnotationKey resolves to a boolean even if the user's
  // sessionStorage was written before a key was added. Memoized on the raw
  // persisted object so useEffect dep arrays that reference `annotVis` stay
  // stable across renders.
  const annotVis = useMemo<Record<AnnotationKey, boolean>>(
    () => ({ ...defaultAnnotationVisibility, ...(annotationVisibility || {}) }),
    [annotationVisibility],
  );

  // Membership check for filtering points. Built fresh each render — cheap
  // for typical sizes (<100 omitted).
  const omittedSet = useMemo(() => new Set(omitted), [omitted]);
  const isOmitted = (id: string) => omittedSet.has(id);
  const [categories, setCategories] = useState<MOACategory[]>([]);
  const [aggregation, setAggregation] = useState<Aggregation>('trial');
  const [showXErrors, setShowXErrors] = useState<boolean>(true);
  const [showYErrors, setShowYErrors] = useState<boolean>(true);
  const plotRef = useRef<HTMLDivElement>(null);
  const influenceRef = useRef<HTMLDivElement>(null);
  const calibrationRef = useRef<HTMLDivElement>(null);

  // Invalidate bootstrap + robustness results whenever the underlying points change
  useEffect(() => {
    const patch: Partial<StoreState> = {};
    if (store.state.bootResult) patch.bootResult = null;
    if (store.state.jackknife) patch.jackknife = null;
    if (store.state.leaveKOut) patch.leaveKOut = null;
    if (Object.keys(patch).length > 0) store.setState(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, trialSet, aggregation]);

  const setBootConfig = (patch: Partial<BootstrapUIConfig>) =>
    store.setState((s) => ({ bootConfig: { ...s.bootConfig, ...patch } }));
  const setLkoConfig = (patch: Partial<LeaveKOutUIConfig>) =>
    store.setState((s) => ({ lkoConfig: { ...s.lkoConfig, ...patch } }));

  // Aggregate a trial list into therapy-level points (one entry per unique
  // canonical drug name within the MOA group, pooling across arms/trials).
  type TherapyPoint = {
    label: string;
    meanObs: number;
    stdObs: number;
    meanPred: number;
    stdPred: number;
    nTrials: number;
    nArms: number;
  };
  const aggregateByTherapy = (tlist: TestingTrial[]): TherapyPoint[] => {
    type Acc = {
      label: string;
      obs: number[];
      predMeans: number[];
      predVars: number[];
      trials: Set<string>;
      nArms: number;
    };
    const map = new Map<string, Acc>();
    for (const t of tlist) {
      const drugs = (t.drugs && t.drugs.length ? t.drugs : ['(unknown drug)']);
      const seen = new Set<string>();
      for (const d of drugs) {
        const { key, label } = canonicalizeDrug(d);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!map.has(key)) {
          map.set(key, { label, obs: [], predMeans: [], predVars: [], trials: new Set(), nArms: 0 });
        }
        const a = map.get(key)!;
        a.obs.push(t.actual_response_rate);
        a.predMeans.push(t.mean_predicted_rate);
        a.predVars.push((t.std_predicted_rate || 0) ** 2);
        a.trials.add(t.nct_id);
        a.nArms += 1;
      }
    }
    const out: TherapyPoint[] = [];
    for (const a of map.values()) {
      const meanObs = a.obs.reduce((x, y) => x + y, 0) / a.obs.length;
      const varObs =
        a.obs.length > 1
          ? a.obs.reduce((x, y) => x + (y - meanObs) * (y - meanObs), 0) / a.obs.length
          : 0;
      const meanPred = a.predMeans.reduce((x, y) => x + y, 0) / a.predMeans.length;
      // Pooled predicted SD: sqrt(mean of within-trial variance + variance of trial means)
      const meanVarWithin = a.predVars.reduce((x, y) => x + y, 0) / a.predVars.length;
      const varBetween =
        a.predMeans.length > 1
          ? a.predMeans.reduce((x, y) => x + (y - meanPred) * (y - meanPred), 0) /
            a.predMeans.length
          : 0;
      out.push({
        label: a.label,
        meanObs,
        stdObs: Math.sqrt(varObs),
        meanPred,
        stdPred: Math.sqrt(meanVarWithin + varBetween),
        nTrials: a.trials.size,
        nArms: a.nArms,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  };

  // Returns the trial array selected by the current toggle.
  const trialsFor = (r: MOAResult): TestingTrial[] =>
    trialSet === 'all'
      ? [...(r.training_trials || []), ...(r.testing_trials || [])]
      : (r.testing_trials || []);

  // Load MOA categories
  useEffect(() => {
    api.get('/simulation/moa-categories').then(({ data }) => {
      const sorted = [...data].sort((a: MOACategory, b: MOACategory) =>
        (a.label || a.value).localeCompare(b.label || b.value)
      );
      setCategories(sorted);
    });
  }, []);

  const setSelected = (next: string[] | ((prev: string[]) => string[])) => {
    store.setState((s) => ({
      selected: typeof next === 'function' ? (next as any)(s.selected) : next,
    }));
  };
  const setNIterations = (n: number) => store.setState({ nIterations: n });

  const toggleMOA = (value: string) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleRun = () => {
    const lookup = (v: string) =>
      categories.find((c) => c.value === v)?.category || v;
    runAnalysis(lookup, selected, nIterations);
  };

  const handleCancel = () => cancelAnalysis();

  // Build BootstrapInputPoint[] from current results + aggregation, minus
  // any points the user has clicked to omit. This matches what's rendered
  // on the plot exactly, so bootstrap CIs refer to the same points the user
  // sees (sans omitted).
  const bootPoints: BootstrapInputPoint[] = useMemo(() => {
    const out: BootstrapInputPoint[] = [];
    results.forEach((r) => {
      const tlist = trialsFor(r);
      if (tlist.length === 0) return;
      if (aggregation === 'therapy') {
        const pts = aggregateByTherapy(tlist);
        for (const p of pts) {
          const id = pointId(r.moa_value, 'therapy', p.label.toLowerCase());
          if (omittedSet.has(id)) continue;
          const mean = p.meanPred;
          const sd = p.stdPred;
          const rng = makeRng();
          out.push({
            x: p.meanObs,
            y: mean,
            moaKey: r.moa_value,
            label: p.label,
            yDrawFn: sd > 0
              ? () => Math.max(0, Math.min(1, mean + sd * gaussian(rng)))
              : undefined,
          });
        }
      } else {
        for (const t of tlist) {
          const id = pointId(r.moa_value, 'trial', t.nct_id);
          if (omittedSet.has(id)) continue;
          const draws = t.fractions_above_threshold;
          const mean = t.mean_predicted_rate;
          const sd = t.std_predicted_rate || 0;
          const rng = makeRng();
          out.push({
            x: t.actual_response_rate,
            y: mean,
            moaKey: r.moa_value,
            label: t.nct_id,
            yDrawFn:
              draws && draws.length > 0
                ? () => draws[Math.floor(rng() * draws.length)]
                : sd > 0
                  ? () => Math.max(0, Math.min(1, mean + sd * gaussian(rng)))
                  : undefined,
          });
        }
      }
    });
    return out;
  }, [results, trialSet, aggregation, omittedSet]);

  const handleBootRun = () => runBootstrapAnalysis(bootPoints, bootConfig);
  const handleBootClear = () => clearBootstrap();
  const handleJackRun = () => runJackknifeAnalysis(bootPoints);
  const handleLkoRun = () => runLeaveKOutAnalysis(bootPoints, lkoConfig);
  const handleRobClear = () => clearRobustness();

  // Two-sided permutation test p-values for the overall correlation. Runs
  // on the same (x, y) points the user sees on the plot (omitted points
  // excluded). Uses B = 10,000 by default — well under 1s for n ≤ a few
  // hundred, and memoized on the plotted point set so it does not re-run
  // on unrelated UI state changes (toggles, layout tweaks, bootstrap deps).
  // Seeded for reproducibility so the displayed p is stable across renders.
  const permOverall: PermutationResult | null = useMemo(() => {
    if (bootPoints.length < 3) return null;
    const xs = bootPoints.map((p) => p.x);
    const ys = bootPoints.map((p) => p.y);
    return permutationTest(xs, ys, 10000, 0xC0FFEE);
  }, [bootPoints]);

  // Per-MOA permutation p-values, keyed by moaKey. Iterates bootPoints and
  // groups by moa so the point set exactly matches what the table shows
  // (omitted points are already excluded from bootPoints). Cheap even at
  // B = 10,000 because n per MOA is small (typically 3–30). Seeded per-MOA
  // via a simple FNV-1a hash so the displayed p is reproducible and
  // independent across MOAs.
  // Bootstrap Wald-type calibration test: H₀ = "slope = 1 AND intercept = 0"
  // (the OLS fit is the identity line). Re-uses the bootstrap replicates
  // already stored in bootResult — no extra resampling. Null while the user
  // hasn't run the bootstrap yet.
  const calibration: CalibrationTestResult | null = useMemo(() => {
    if (!bootResult || bootResult.config.curveType !== 'ols') return null;
    return calibrationTestWald(bootResult);
  }, [bootResult]);

  const permPerMoa: Record<string, PermutationResult> = useMemo(() => {
    const byMoa: Record<string, { xs: number[]; ys: number[] }> = {};
    for (const p of bootPoints) {
      const bucket = byMoa[p.moaKey] || (byMoa[p.moaKey] = { xs: [], ys: [] });
      bucket.xs.push(p.x);
      bucket.ys.push(p.y);
    }
    const out: Record<string, PermutationResult> = {};
    const fnv = (s: string) => {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    };
    for (const key of Object.keys(byMoa)) {
      const { xs, ys } = byMoa[key];
      if (xs.length >= 3) {
        out[key] = permutationTest(xs, ys, 10000, fnv(key));
      }
    }
    return out;
  }, [bootPoints]);

  // Render correlation plot whenever results change
  useEffect(() => {
    if (!plotRef.current) return;
    if (results.length === 0) {
      Plotly.purge(plotRef.current);
      return;
    }

    const traces: any[] = [];
    const allActual: number[] = [];
    const allPredicted: number[] = [];
    const extents: number[] = []; // tracks mean ± error for axis limits

    // Split each MOA's points into active (included) vs omitted. Both
    // render, but only the active set contributes to stats + bootstrap,
    // and omitted points show with low opacity + 'x' marker so the user
    // can see what's been dropped. Click a point to toggle its status.
    results.forEach((r, idx) => {
      const color = MOA_COLORS[idx % MOA_COLORS.length];
      const tlist = trialsFor(r);
      if (tlist.length === 0) return;

      if (aggregation === 'therapy') {
        const pts = aggregateByTherapy(tlist);
        if (pts.length === 0) return;

        type Row = { x: number; y: number; ex: number; ey: number; label: string; id: string; hover: string };
        const active: Row[] = [];
        const omit: Row[] = [];
        for (const p of pts) {
          const id = pointId(r.moa_value, 'therapy', p.label.toLowerCase());
          const row: Row = {
            x: p.meanObs,
            y: p.meanPred,
            ex: p.stdObs,
            ey: p.stdPred,
            label: p.label,
            id,
            hover:
              `<b>${p.label}</b><br>${r.moa_category}<br>` +
              `observed: ${(p.meanObs * 100).toFixed(1)}% ± ${(p.stdObs * 100).toFixed(1)}%<br>` +
              `predicted: ${(p.meanPred * 100).toFixed(1)}% ± ${(p.stdPred * 100).toFixed(1)}%<br>` +
              `${p.nTrials} trial(s), ${p.nArms} arm(s)` +
              (omittedSet.has(id) ? '<br><i>(omitted — click to restore)</i>' : '<br><i>(click to omit)</i>'),
          };
          if (omittedSet.has(id)) omit.push(row); else active.push(row);
        }

        // Active trace: contributes to stats
        if (active.length > 0) {
          const xs = active.map((p) => p.x);
          const ys = active.map((p) => p.y);
          allActual.push(...xs);
          allPredicted.push(...ys);
          for (let i = 0; i < xs.length; i++) {
            extents.push(
              xs[i] + (showXErrors ? active[i].ex : 0),
              ys[i] + (showYErrors ? active[i].ey : 0),
            );
          }
          traces.push({
            x: xs,
            y: ys,
            customdata: active.map((p) => p.id),
            error_x: { type: 'data', array: active.map((p) => p.ex), visible: showPoints && showXErrors, thickness: 1.2, width: 3, color },
            error_y: { type: 'data', array: active.map((p) => p.ey), visible: showPoints && showYErrors, thickness: 1.2, width: 3, color },
            type: 'scatter',
            mode: 'markers',
            name: r.moa_category,
            marker: { size: 10, color, line: { color: '#fff', width: 1 } },
            text: active.map((p) => p.hover),
            hoverinfo: 'text',
            // Per-MOA traces use 'legendonly' when hidden so clicking their
            // legend entry can re-enable them — the checkbox is a shortcut,
            // not the only path. y = x and the fit line use `false` to
            // disappear from the legend entirely (see below).
            visible: showPoints ? true : 'legendonly',
          });
        }

        // Omitted trace: rendered faded, no error bars, hidden from legend.
        // `legendgroup` ties it to the parent so a legend click hides both.
        if (omit.length > 0) {
          traces.push({
            x: omit.map((p) => p.x),
            y: omit.map((p) => p.y),
            customdata: omit.map((p) => p.id),
            type: 'scatter',
            mode: 'markers',
            name: `${r.moa_category} (omitted)`,
            legendgroup: r.moa_category,
            showlegend: false,
            marker: { size: 10, color, symbol: 'x-thin-open', line: { color, width: 2 }, opacity: 0.45 },
            text: omit.map((p) => p.hover),
            hoverinfo: 'text',
            // Per-MOA traces use 'legendonly' when hidden so clicking their
            // legend entry can re-enable them — the checkbox is a shortcut,
            // not the only path. y = x and the fit line use `false` to
            // disappear from the legend entirely (see below).
            visible: showPoints ? true : 'legendonly',
          });
        }
      } else {
        type Row = { x: number; y: number; err: number; label: string; id: string; hover: string };
        const active: Row[] = [];
        const omit: Row[] = [];
        for (const t of tlist) {
          const id = pointId(r.moa_value, 'trial', t.nct_id);
          const row: Row = {
            x: t.actual_response_rate,
            y: t.mean_predicted_rate,
            err: t.std_predicted_rate || 0,
            label: t.nct_id,
            id,
            hover:
              `${t.nct_id}<br>${r.moa_category}<br>actual: ${(t.actual_response_rate * 100).toFixed(1)}%` +
              `<br>predicted: ${(t.mean_predicted_rate * 100).toFixed(1)}% ± ${((t.std_predicted_rate || 0) * 100).toFixed(1)}%` +
              (omittedSet.has(id) ? '<br><i>(omitted — click to restore)</i>' : '<br><i>(click to omit)</i>'),
          };
          if (omittedSet.has(id)) omit.push(row); else active.push(row);
        }

        if (active.length > 0) {
          const xs = active.map((p) => p.x);
          const ys = active.map((p) => p.y);
          allActual.push(...xs);
          allPredicted.push(...ys);
          for (let i = 0; i < xs.length; i++) {
            extents.push(xs[i], ys[i] + (showYErrors ? active[i].err : 0));
          }
          traces.push({
            x: xs,
            y: ys,
            customdata: active.map((p) => p.id),
            error_y: { type: 'data', array: active.map((p) => p.err), visible: showPoints && showYErrors, thickness: 1.2, width: 3, color },
            type: 'scatter',
            mode: 'markers',
            name: r.moa_category,
            marker: { size: 9, color, line: { color: '#fff', width: 1 } },
            text: active.map((p) => p.hover),
            hoverinfo: 'text',
            // Per-MOA traces use 'legendonly' when hidden so clicking their
            // legend entry can re-enable them — the checkbox is a shortcut,
            // not the only path. y = x and the fit line use `false` to
            // disappear from the legend entirely (see below).
            visible: showPoints ? true : 'legendonly',
          });
        }

        if (omit.length > 0) {
          traces.push({
            x: omit.map((p) => p.x),
            y: omit.map((p) => p.y),
            customdata: omit.map((p) => p.id),
            type: 'scatter',
            mode: 'markers',
            name: `${r.moa_category} (omitted)`,
            legendgroup: r.moa_category,
            showlegend: false,
            marker: { size: 9, color, symbol: 'x-thin-open', line: { color, width: 2 }, opacity: 0.45 },
            text: omit.map((p) => p.hover),
            hoverinfo: 'text',
            // Per-MOA traces use 'legendonly' when hidden so clicking their
            // legend entry can re-enable them — the checkbox is a shortcut,
            // not the only path. y = x and the fit line use `false` to
            // disappear from the legend entirely (see below).
            visible: showPoints ? true : 'legendonly',
          });
        }
      }
    });

    // y = x reference line. Axis upper limit includes mean + error bar extents
    // so no whisker is clipped. Shared between x & y so the plot stays square.
    const maxVal = Math.max(0.05, ...allActual, ...allPredicted, ...extents) * 1.08;
    traces.push({
      x: [0, maxVal],
      y: [0, maxVal],
      type: 'scatter',
      mode: 'lines',
      name: 'y = x (perfect)',
      line: { color: '#999', dash: 'dash', width: 1.5 },
      hoverinfo: 'skip',
      visible: showRefLine,
    });

    // Bootstrap CI band + OLS fit line
    if (bootResult && bootResult.config.curveType === 'ols') {
      const nGrid = 50;
      const xGrid = Array.from({ length: nGrid }, (_, i) => (i / (nGrid - 1)) * maxVal);
      const band = materializeBand(bootResult, xGrid);
      if (band && showBand) {
        // Lower invisible boundary
        traces.push({
          x: xGrid,
          y: band.lower,
          type: 'scatter',
          mode: 'lines',
          line: { color: 'rgba(0,0,0,0)', width: 0 },
          hoverinfo: 'skip',
          showlegend: false,
        });
        // Upper boundary with fill down to the previous trace
        const ciPct = Math.round(bootResult.config.ciLevel * 100);
        traces.push({
          x: xGrid,
          y: band.upper,
          type: 'scatter',
          mode: 'lines',
          name: `${ciPct}% CI band`,
          line: { color: 'rgba(99,70,151,0.35)', width: 0 },
          fill: 'tonexty',
          fillcolor: 'rgba(99,70,151,0.18)',
          hoverinfo: 'skip',
        });
      }
      if (showFitLine && bootResult.slopeHat != null && bootResult.interceptHat != null) {
        const s = bootResult.slopeHat, i0 = bootResult.interceptHat;
        traces.push({
          x: [0, maxVal],
          y: [i0, i0 + s * maxVal],
          type: 'scatter',
          mode: 'lines',
          name: 'OLS fit',
          line: { color: '#634697', width: 2 },
          hoverinfo: 'skip',
        });
      }
    }

    const r = pearson(allActual, allPredicted);
    const rho = spearman(allActual, allPredicted);
    const fmt = (v: number) => v.toFixed(3);
    const fmtCI = (ci: [number, number] | null) =>
      ci ? ` [${fmt(ci[0])}, ${fmt(ci[1])}]` : '';
    const fmtP = (p: number | null | undefined) => {
      if (p == null || !Number.isFinite(p)) return '';
      if (p < 0.001) return '  p < 0.001';
      return `  p = ${p.toFixed(3)}`;
    };
    const omittedCount = omittedSet.size;
    // Each line is gated by (a) upstream data existing AND (b) the user
    // leaving that annotation toggle on. Turning a toggle off collapses
    // that line out of the box without affecting any computation.
    const statsLines: string[] = [];
    // n and (# omitted) toggle independently. When both are on and at
    // least one point is omitted, they combine on a single line for
    // compactness; otherwise each renders alone.
    const showOmitted = annotVis.omitted && omittedCount > 0;
    if (annotVis.n && showOmitted) {
      statsLines.push(`n = ${allActual.length}  (${omittedCount} omitted)`);
    } else if (annotVis.n) {
      statsLines.push(`n = ${allActual.length}`);
    } else if (showOmitted) {
      statsLines.push(`${omittedCount} omitted`);
    }
    if (annotVis.pearson && r != null) {
      const ci = bootResult ? bootResult.rCI : null;
      statsLines.push(`Pearson r = ${fmt(r)}${fmtCI(ci)}${fmtP(permOverall?.pR)}`);
    }
    if (annotVis.spearman && rho != null) {
      const ci = bootResult ? bootResult.rhoCI : null;
      statsLines.push(`Spearman ρ = ${fmt(rho)}${fmtCI(ci)}${fmtP(permOverall?.pRho)}`);
    }
    if (annotVis.permutation && permOverall && (permOverall.pR != null || permOverall.pRho != null)) {
      statsLines.push(`permutation test: B = ${permOverall.B.toLocaleString()}, two-sided`);
    }
    if (annotVis.calibration && calibration && calibration.p != null) {
      // Calibration test: does the OLS fit match y = x?
      // Report the bootstrap-Wald p and the OLS point estimates so the user
      // can see whether any miscalibration is slope-driven, offset-driven,
      // or both. The χ² fallback is omitted here (it lives on the ellipse
      // plot) to keep this annotation compact.
      const sH = calibration.slopeHat.toFixed(3);
      const iH = calibration.interceptHat.toFixed(3);
      statsLines.push(
        `calibration (slope=1, int=0): slope=${sH}, int=${iH}${fmtP(calibration.p)}`
      );
    }
    if (bootResult) {
      if (annotVis.bootstrap) {
        const pct = Math.round(bootResult.config.ciLevel * 100);
        statsLines.push(
          `bootstrap: ${bootResult.config.B} × ${bootResult.config.scheme}, ${pct}% ${bootResult.config.ciMethod === 'bca' ? 'BCa' : 'pctl'}`
        );
      }
      if (annotVis.avgUnique) {
        // Mean number of distinct original points appearing in each resample.
        // For "simulation" this is always nPoints (no resampling); for the
        // case bootstraps it converges to ≈ 0.632 · n.
        const avg = bootResult.meanUniqueCount;
        const nPts = bootResult.nPoints;
        const avgPct = nPts > 0 ? Math.round((avg / nPts) * 100) : 0;
        statsLines.push(
          `avg unique: ${avg.toFixed(1)} / ${nPts} (${avgPct}%)`
        );
      }
    }

    // Size the stats-annotation box explicitly from the longest line's
    // character count rather than letting Plotly auto-fit it. Two reasons:
    //   1. Plotly's auto-fit uses runtime text metrics; those metrics can
    //      differ between display and SVG export re-layout, which used to
    //      clip the box on the downloaded file.
    //   2. When the exported SVG is rendered by another consumer (e.g.,
    //      PowerPoint Online), any font substitution can shift text widths.
    //      We counter this by (a) forcing a universally available family
    //      ('Arial, Helvetica, sans-serif') in both measurement and export,
    //      and (b) applying a generous per-char width factor to absorb any
    //      residual variance.
    const ANNOT_FAMILY = 'Arial, Helvetica, sans-serif';
    const ANNOT_CHAR_W = 0.62;   // em/char, conservative for sans-serif mix
    const ANNOT_LINE_H = 1.3;    // line-height multiplier
    const ANNOT_PAD = 6;         // matches borderpad
    const visualLen = (s: string) => s.replace(/&[^;]+;/g, 'x').length;
    const maxChars = Math.max(1, ...statsLines.map(visualLen));
    const fsA = PLOT_FONTS.annotation;
    const annotWidth = Math.ceil(maxChars * fsA * ANNOT_CHAR_W) + ANNOT_PAD * 2;
    const annotHeight = Math.ceil(statsLines.length * fsA * ANNOT_LINE_H) + ANNOT_PAD * 2;

    // Position the stats box BELOW the plot area rather than at top-right.
    // With explicit width needed to survive font substitution in SVG
    // consumers (e.g., PowerPoint Online), a top-right box can easily grow
    // wide enough to overlap the top-left legend. Placing it below the
    // x-axis keeps the legend and the stats tile in separate strips —
    // they can never collide regardless of font metrics.
    const MARGIN_TOP = 80;
    const PLOT_AREA_H = 400;                 // target plot area height (px)
    const AXIS_TITLE_AND_TICKS = 70;         // room for x-axis tick labels + title
    const ANNOT_TOP_GAP = 20;                // gap between axis title and stats box
    const ANNOT_BOTTOM_PAD = 20;             // gap between stats box and figure edge
    const marginBottom =
      AXIS_TITLE_AND_TICKS + ANNOT_TOP_GAP + annotHeight + ANNOT_BOTTOM_PAD;
    const figHeight = MARGIN_TOP + PLOT_AREA_H + marginBottom;
    // y in paper coords (0 = bottom of plot area, negative = below it).
    const annotY = -(AXIS_TITLE_AND_TICKS + ANNOT_TOP_GAP) / PLOT_AREA_H;

    const layout: Partial<Plotly.Layout> = {
      title: { text: 'Predicted vs Observed Response Rates', font: { size: PLOT_FONTS.title } },
      font: { size: PLOT_FONTS.body },
      // Omit the annotation entirely when the user toggles every line off.
      // An empty annotation would render as a tiny border-only box.
      annotations: statsLines.length > 0 ? [
        {
          xref: 'paper',
          yref: 'paper',
          x: 0.5,
          y: annotY,
          xanchor: 'center',
          yanchor: 'top',
          text: statsLines.join('<br>'),
          showarrow: false,
          align: 'left',
          font: { size: fsA, color: '#333', family: ANNOT_FAMILY },
          bgcolor: 'rgba(255,255,255,0.95)',
          bordercolor: '#ccc',
          borderwidth: 1,
          borderpad: ANNOT_PAD,
          width: annotWidth,
          height: annotHeight,
        },
      ] : [],
      xaxis: {
        title: {
          text:
            aggregation === 'therapy'
              ? `Mean Observed Response Rate${showXErrors ? ' (± SD across trials)' : ''}`
              : 'Actual Response Rate (observed)',
          font: { size: PLOT_FONTS.axisTitle },
        },
        tickfont: { size: PLOT_FONTS.tick },
        range: [0, maxVal],
        tickformat: '.0%',
        zeroline: true,
        zerolinecolor: '#ddd',
        automargin: true,
      },
      yaxis: {
        title: {
          text:
            aggregation === 'therapy'
              ? `Mean Predicted Response Rate${showYErrors ? ' (± SD)' : ''}`
              : `Predicted Response Rate${showYErrors ? ' (mean ± SD)' : ''}`,
          font: { size: PLOT_FONTS.axisTitle },
        },
        tickfont: { size: PLOT_FONTS.tick },
        range: [0, maxVal],
        tickformat: '.0%',
        zeroline: true,
        zerolinecolor: '#ddd',
        automargin: true,
      },
      height: figHeight,
      margin: { l: 90, r: 30, t: MARGIN_TOP, b: marginBottom },
      legend: {
        x: 0.01, y: 0.99,
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: '#ddd', borderwidth: 1,
        font: { size: PLOT_FONTS.legend },
      },
      hovermode: 'closest',
      plot_bgcolor: '#fff',
    };

    Plotly.newPlot(plotRef.current, traces, withProvenance(layout, '/moa-correlation'), {
      displayModeBar: true,
      responsive: true,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('moa_correlation'),
        width: 800,
        // IMPORTANT: match the export height to the layout's computed
        // figHeight. The annotation is placed with a paper-coord y offset
        // calibrated for PLOT_AREA_H = 400 px; forcing a different export
        // height would stretch the plot area, drag the annotation below
        // the figure bottom, and clip the last stats line.
        height: figHeight,
        scale: 4,
      },
    }).then(() => {
      // Click-to-toggle. customdata on each marker holds the compound ID.
      // Plotly fires a `plotly_click` event with the clicked point; the
      // toggleOmit store action also invalidates bootstrap/jackknife/LKO.
      const plot = plotRef.current as any;
      if (!plot) return;
      // Remove any previous listeners first — re-renders would otherwise stack them.
      if (plot.removeAllListeners) plot.removeAllListeners('plotly_click');
      plot.on('plotly_click', (ev: any) => {
        const p = ev?.points?.[0];
        const id = p?.customdata;
        if (typeof id === 'string' && id.length > 0) toggleOmit(id);
      });
    });
  }, [results, trialSet, aggregation, showXErrors, showYErrors,
      bootResult, showPoints, showFitLine, showBand, showRefLine,
      omittedSet, permOverall, calibration, annotVis]);

  // Influence plot: Δr per point when removed, sorted by |Δr| descending.
  // Positive bars mean removing that point makes r go up (the point was a
  // drag on r); negative bars mean the point supports the correlation.
  useEffect(() => {
    if (!influenceRef.current) return;
    if (!jackknife || !showInfluencePlot) {
      Plotly.purge(influenceRef.current);
      return;
    }
    const infl = jackknife.influence.filter((p) => p.deltaR != null);
    if (infl.length === 0) {
      Plotly.purge(influenceRef.current);
      return;
    }

    // Sort by |Δr| descending so the most influential points sit on the left.
    const sorted = [...infl].sort(
      (a, b) => Math.abs(b.deltaR ?? 0) - Math.abs(a.deltaR ?? 0)
    );

    // Map each MOA to its plot color (matching the correlation plot legend).
    const moaColor: Record<string, string> = {};
    results.forEach((r, idx) => { moaColor[r.moa_value] = MOA_COLORS[idx % MOA_COLORS.length]; });

    const deltas = sorted.map((p) => p.deltaR ?? 0);
    const labels = sorted.map((p) => p.label);
    const colors = sorted.map((p) =>
      (p.deltaR ?? 0) > 0 ? '#c2185b' : '#2c639e'   // drag = magenta, support = blue
    );
    const hover = sorted.map((p) => {
      const moaName = results.find((r) => r.moa_value === p.moaKey)?.moa_category ?? p.moaKey;
      return (
        `<b>${p.label}</b><br>` +
        `${moaName}<br>` +
        `x = ${(p.x * 100).toFixed(1)}%, y = ${(p.y * 100).toFixed(1)}%<br>` +
        `Δr = ${(p.deltaR ?? 0).toFixed(4)}<br>` +
        `r without this point = ${p.rMinus != null ? p.rMinus.toFixed(3) : '—'}`
      );
    });

    // Thin strip below the bars colored by MOA to show cohort membership
    const moaStrip = sorted.map((p) => moaColor[p.moaKey] ?? '#bbb');

    const traces: any[] = [
      {
        x: labels,
        y: deltas,
        type: 'bar',
        marker: { color: colors, line: { color: '#fff', width: 0.5 } },
        text: hover,
        hoverinfo: 'text',
        name: 'Δr',
      },
      // MOA color strip as a second bar trace at a tiny negative value,
      // rendered below the main bars. Gives a quick visual MOA cue.
      {
        x: labels,
        y: sorted.map(() => -jackknife.maxAbsDeltaR * 0.04 - 0.002),
        base: sorted.map(() => -jackknife.maxAbsDeltaR * 0.08 - 0.004),
        type: 'bar',
        marker: { color: moaStrip },
        hoverinfo: 'skip',
        showlegend: false,
        yaxis: 'y',
      },
    ];

    const layout: Partial<Plotly.Layout> = {
      barmode: 'overlay',
      height: Math.min(500, 280 + Math.max(0, sorted.length - 20) * 7),
      margin: { l: 90, r: 30, t: 40, b: 150 },
      font: { size: PLOT_FONTS.body },
      xaxis: {
        tickfont: { size: PLOT_FONTS.influenceTick },
        tickangle: -45,
        automargin: true,
        title: { text: '', font: { size: PLOT_FONTS.axisTitle } },
      },
      yaxis: {
        title: { text: 'Δ Pearson r', font: { size: PLOT_FONTS.axisTitle } },
        tickfont: { size: PLOT_FONTS.tick },
        zeroline: true,
        zerolinecolor: '#333',
        zerolinewidth: 1,
      },
      showlegend: false,
      plot_bgcolor: '#fff',
      hovermode: 'closest',
      shapes: [
        // Dashed reference at Δr = 0
        {
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: 0, y1: 0,
          line: { color: '#333', width: 1, dash: 'dot' },
        },
      ],
    };

    Plotly.newPlot(influenceRef.current, traces, withProvenance(layout, '/moa-correlation/influence'), {
      displayModeBar: true,
      responsive: true,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('moa_influence'),
        scale: 4,
      },
    });
  }, [jackknife, showInfluencePlot, results]);

  // Calibration plot: bootstrap (slope, intercept) cloud with a 95%
  // confidence ellipse and a crosshair at the null (1, 0). Visually answers
  // "does the fit line coincide with y = x?". If (1, 0) is inside the
  // ellipse → fail to reject calibration at α = 0.05; if outside → reject.
  useEffect(() => {
    if (!calibrationRef.current) return;
    if (!bootResult || bootResult.config.curveType !== 'ols' || !showCalibrationPlot) {
      Plotly.purge(calibrationRef.current);
      return;
    }

    // Collect finite bootstrap replicates for the scatter cloud.
    const bsX: number[] = [], bsY: number[] = [];
    for (let i = 0; i < bootResult.slopes.length; i++) {
      const s = bootResult.slopes[i], a = bootResult.intercepts[i];
      if (Number.isFinite(s) && Number.isFinite(a)) { bsX.push(s); bsY.push(a); }
    }
    if (bsX.length < 10 || bootResult.slopeHat == null || bootResult.interceptHat == null) {
      Plotly.purge(calibrationRef.current);
      return;
    }

    // 95% ellipse parameterised from the same replicates. `kCrit` is the
    // empirical Mahalanobis² quantile — included in the hover text for
    // diagnostic transparency.
    const ell = confidenceEllipse(bootResult, 0.95);

    const traces: any[] = [
      // Bootstrap replicate cloud
      {
        x: bsX,
        y: bsY,
        type: 'scattergl',
        mode: 'markers',
        name: `bootstrap (β, α), B = ${bsX.length}`,
        marker: { size: 4, color: 'rgba(5, 127, 165, 0.35)', line: { width: 0 } },
        hovertemplate: 'slope = %{x:.3f}<br>intercept = %{y:.3f}<extra></extra>',
      },
    ];
    if (ell) {
      traces.push({
        x: ell.slope,
        y: ell.intercept,
        type: 'scatter',
        mode: 'lines',
        name: '95% CI ellipse',
        line: { color: '#057fa5', width: 2 },
        fill: 'toself',
        fillcolor: 'rgba(5, 127, 165, 0.08)',
        hoverinfo: 'skip',
      });
    }
    // Observed (β̂, α̂)
    traces.push({
      x: [bootResult.slopeHat],
      y: [bootResult.interceptHat],
      type: 'scatter',
      mode: 'markers',
      name: 'observed fit',
      marker: { size: 14, color: '#634697', symbol: 'circle', line: { color: '#fff', width: 2 } },
      hovertemplate:
        `<b>observed fit</b><br>slope = ${bootResult.slopeHat.toFixed(3)}<br>` +
        `intercept = ${bootResult.interceptHat.toFixed(3)}<extra></extra>`,
    });
    // Null hypothesis point (1, 0)
    traces.push({
      x: [1],
      y: [0],
      type: 'scatter',
      mode: 'markers',
      name: 'null (slope=1, int=0)',
      marker: { size: 16, color: '#c62828', symbol: 'x-thin', line: { color: '#c62828', width: 3 } },
      hovertemplate:
        `<b>y = x (perfect calibration)</b><br>slope = 1<br>intercept = 0<extra></extra>`,
    });

    // Axis bounds: always include both (β̂, α̂), (1, 0), and the ellipse /
    // scatter extents with a small pad so nothing is flush against the edge.
    const allX = [...bsX, 1, bootResult.slopeHat];
    const allY = [...bsY, 0, bootResult.interceptHat];
    if (ell) { allX.push(...ell.slope); allY.push(...ell.intercept); }
    const xMin = Math.min(...allX), xMax = Math.max(...allX);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const xPad = Math.max((xMax - xMin) * 0.08, 0.02);
    const yPad = Math.max((yMax - yMin) * 0.08, 0.02);

    // Annotation summarising the calibration test result.
    const cal = calibration;
    const fmtPA = (p: number | null | undefined) => {
      if (p == null || !Number.isFinite(p)) return '—';
      if (p < 0.001) return 'p < 0.001';
      return `p = ${p.toFixed(3)}`;
    };
    const annotLines: string[] = [];
    if (cal) {
      annotLines.push(`calibration test (H₀: slope = 1, int = 0)`);
      annotLines.push(`bootstrap Wald: ${fmtPA(cal.p)}`);
      annotLines.push(`asymptotic χ²₂:  ${fmtPA(cal.pChi2)}`);
      annotLines.push(`D² = ${cal.observedD2.toFixed(3)}${ell ? `, kCrit₉₅ = ${ell.kCrit.toFixed(3)}` : ''}`);
    }

    const layout: Partial<Plotly.Layout> = {
      title: {
        text: 'Fit-line calibration: (slope, intercept) bootstrap distribution',
        font: { size: PLOT_FONTS.title },
      },
      height: 520,
      margin: { l: 90, r: 30, t: 60, b: 70 },
      font: { size: PLOT_FONTS.body },
      xaxis: {
        title: { text: 'slope (β)', font: { size: PLOT_FONTS.axisTitle } },
        tickfont: { size: PLOT_FONTS.tick },
        range: [xMin - xPad, xMax + xPad],
        zeroline: false,
      },
      yaxis: {
        title: { text: 'intercept (α)', font: { size: PLOT_FONTS.axisTitle } },
        tickfont: { size: PLOT_FONTS.tick },
        range: [yMin - yPad, yMax + yPad],
        zeroline: false,
      },
      legend: {
        x: 0.01, y: 0.99,
        bgcolor: 'rgba(255,255,255,0.9)',
        bordercolor: '#ddd', borderwidth: 1,
        font: { size: PLOT_FONTS.legend },
      },
      shapes: [
        // Reference lines at slope = 1 and intercept = 0 (the null point's axes).
        {
          type: 'line', xref: 'x', yref: 'paper',
          x0: 1, x1: 1, y0: 0, y1: 1,
          line: { color: '#c62828', width: 1, dash: 'dot' },
        },
        {
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: 0, y1: 0,
          line: { color: '#c62828', width: 1, dash: 'dot' },
        },
      ],
      annotations: annotLines.length > 0 ? [{
        xref: 'paper', yref: 'paper',
        x: 0.99, y: 0.99,
        xanchor: 'right', yanchor: 'top',
        text: annotLines.join('<br>'),
        showarrow: false,
        align: 'left',
        font: { size: PLOT_FONTS.annotation, family: 'Arial, Helvetica, sans-serif' },
        bgcolor: 'rgba(255,255,255,0.92)',
        bordercolor: '#ccc',
        borderwidth: 1,
        borderpad: 6,
      }] : undefined,
      plot_bgcolor: '#fff',
      hovermode: 'closest',
    };

    Plotly.newPlot(calibrationRef.current, traces, withProvenance(layout, '/moa-correlation/calibration'), {
      displayModeBar: true,
      responsive: true,
      toImageButtonOptions: {
        format: 'svg',
        filename: provenanceImageFilename('moa_calibration_ellipse'),
        width: 800,
        height: 800,
        scale: 4,
      },
    });
  }, [bootResult, showCalibrationPlot, calibration]);

  const overallR = (() => {
    const xs: number[] = [], ys: number[] = [];
    results.forEach((r) => {
      const tlist = trialsFor(r);
      if (aggregation === 'therapy') {
        aggregateByTherapy(tlist).forEach((p) => {
          if (isOmitted(pointId(r.moa_value, 'therapy', p.label.toLowerCase()))) return;
          xs.push(p.meanObs);
          ys.push(p.meanPred);
        });
      } else {
        tlist.forEach((t) => {
          if (isOmitted(pointId(r.moa_value, 'trial', t.nct_id))) return;
          xs.push(t.actual_response_rate);
          ys.push(t.mean_predicted_rate);
        });
      }
    });
    return { r: pearson(xs, ys), rho: spearman(xs, ys), n: xs.length };
  })();

  return (
    <div>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>MOA Correlation Analysis</h1>
      <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1rem', maxWidth: 900 }}>
        Select one or more drug Mechanisms of Action. ORACLE runs a training/testing simulation
        for each MOA group and compares the predicted response-rate distribution for every
        testing trial to that trial's actual observed response rate. The correlation plot below
        shows each testing trial as a point — x is the observed rate, y is the mean predicted
        rate, and the vertical bar is ±1 SD of the prediction range.
      </p>

      <InterpretBox id="moa-correlation-intro" title="How to read this page">
        <p style={{ margin: '0 0 0.5rem' }}>
          This page asks the core validation question: <em>does the simulated predicted
          response rate track the actual observed rate across testing trials?</em>{' '}
          A good model yields points that hug the <code>y = x</code> reference line,
          high Pearson r, and a calibration slope ≈ 1 / intercept ≈ 0. The sections
          build on each other — run them top-to-bottom.
        </p>
        <ul style={{ margin: '0.25rem 0 0.5rem 1.1rem', padding: 0 }}>
          <li>
            <strong>Select MOAs &amp; run</strong> — pick one or more MOA groups, choose
            iterations (more = smoother prediction distributions, slower), pick{' '}
            <em>Testing only</em> (held-out validation) or <em>All</em> (in-sample
            diagnostic). Aggregation: <em>Per trial</em> = one point per NCT ID;{' '}
            <em>Per therapy</em> collapses to one point per unique drug (mean ± SD across
            that drug's trials).
          </li>
          <li>
            <strong>Correlation plot</strong> — x is observed RR, y is mean predicted RR;
            vertical bars are ±1 SD of the prediction (or X error bars in per-therapy
            mode). Click any point to omit it from all downstream stats (omitted points
            persist, stay visible as faded ×, and can be restored).
          </li>
          <li>
            <strong>Bootstrap &amp; plot controls</strong> — resamples trials/therapies
            B times to produce CIs on r, ρ, and the OLS fit. <em>Case</em> = resample
            trials; <em>Simulation</em> = redraw from per-iteration prediction
            distributions with trials fixed; <em>Nested</em> = both; <em>Stratified</em>{' '}
            preserves per-MOA balance. BCa corrects for skew — prefer it over plain
            percentile when the bootstrap distribution is asymmetric.
          </li>
          <li>
            <strong>Robustness analysis</strong> — answers "does one trial carry the
            result?". <em>Jackknife</em> removes each point once and plots Δr; tall bars
            = high-influence points. <em>Leave-k-out</em> drops k random points B times
            and reports the r range/band — a stable correlation should not swing much.
          </li>
          <li>
            <strong>Calibration check</strong> — tests whether the OLS fit matches the{' '}
            <code>y = x</code> perfect-prediction null. The ellipse on the calibration
            plot is the 95% confidence region over (slope, intercept); if the red ×
            (null) is <em>outside</em> the ellipse, calibration is rejected at α = 0.05.
          </li>
          <li>
            <strong>Per-MOA correlations table</strong> — decomposes the overall r/ρ
            into its MOA-level components. Permutation p-values (B = 10,000) are
            bolded when p &lt; 0.05.
          </li>
        </ul>
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: '#555' }}>
          <strong>What "good" looks like:</strong> Pearson r ≥ 0.6 with a tight CI
          excluding zero, calibration slope 1.0 ± 0.2 / intercept near 0, jackknife
          max |Δr| &lt; 0.15, and leave-k-out r range remaining positive. Fail any of
          these and the predicted rates should not be treated as actionable without
          recalibration.
        </p>
      </InterpretBox>

      {/* Configuration */}
      <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Select MOAs</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setSelected(categories.map((c) => c.value))}
              disabled={running || categories.length === 0}
              style={{
                padding: '0.3rem 0.7rem', fontSize: '0.75rem', borderRadius: 4,
                border: '1px solid #634697', background: '#fff', color: '#634697',
                cursor: running || categories.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Select All
            </button>
            <button
              onClick={() => setSelected([])}
              disabled={running || selected.length === 0}
              style={{
                padding: '0.3rem 0.7rem', fontSize: '0.75rem', borderRadius: 4,
                border: '1px solid #999', background: '#fff', color: '#555',
                cursor: running || selected.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Deselect All
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 220, overflowY: 'auto', padding: 4, border: '1px solid #eee', borderRadius: 6 }}>
          {categories.map((c) => {
            const isSelected = selected.includes(c.value);
            return (
              <button
                key={c.value}
                onClick={() => toggleMOA(c.value)}
                disabled={running}
                style={{
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.78rem',
                  borderRadius: 16,
                  border: isSelected ? '1.5px solid #634697' : '1px solid #ccc',
                  background: isSelected ? '#634697' : '#fafafa',
                  color: isSelected ? '#fff' : '#333',
                  cursor: running ? 'not-allowed' : 'pointer',
                  fontWeight: c.is_group ? 600 : 400,
                }}
                title={`${c.drug_count} drug(s)`}
              >
                {c.category}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.85rem' }}>
          <label style={{ fontSize: '0.8rem', color: '#555' }}>
            Iterations:&nbsp;
            <input
              type="number"
              min={50}
              max={2000}
              step={50}
              value={nIterations}
              disabled={running}
              onChange={(e) => setNIterations(Math.max(50, Math.min(2000, parseInt(e.target.value) || 500)))}
              style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
            />
          </label>
          <label style={{ fontSize: '0.8rem', color: '#555' }}>
            Trial set:&nbsp;
            <select
              value={trialSet}
              onChange={(e) => store.setState({ trialSet: e.target.value as TrialSet })}
              style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              title="Use only the held-out testing trials, or include training trials too"
            >
              <option value="testing">Testing only</option>
              <option value="all">All (training + testing)</option>
            </select>
          </label>
          <label style={{ fontSize: '0.8rem', color: '#555' }}>
            Aggregation:&nbsp;
            <select
              value={aggregation}
              onChange={(e) => setAggregation(e.target.value as Aggregation)}
              style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              title="Per-trial: one point per trial. Per-therapy: one point per unique drug (mean ± SD across that drug's trials)."
            >
              <option value="trial">Per trial</option>
              <option value="therapy">Per therapy</option>
            </select>
          </label>
          <label
            style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Show horizontal error bars (SD of observed rates across the therapy's trials). Per-therapy aggregation only."
          >
            <input
              type="checkbox"
              checked={showXErrors}
              onChange={(e) => setShowXErrors(e.target.checked)}
              disabled={aggregation === 'trial'}
            />
            X error bars
          </label>
          <label
            style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Show vertical error bars (SD of predicted rates)."
          >
            <input
              type="checkbox"
              checked={showYErrors}
              onChange={(e) => setShowYErrors(e.target.checked)}
            />
            Y error bars
          </label>
          <span style={{ fontSize: '0.8rem', color: '#888' }}>
            {selected.length} MOA{selected.length === 1 ? '' : 's'} selected
          </span>
          <div style={{ flex: 1 }} />
          {running ? (
            <button
              onClick={handleCancel}
              style={{ padding: '0.45rem 1rem', background: '#a12a8b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={selected.length === 0}
              style={{
                padding: '0.45rem 1rem',
                background: selected.length === 0 ? '#bbb' : '#634697',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: selected.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              Run Correlation Analysis
            </button>
          )}
        </div>
      </div>

      {/* Bootstrap analysis + plot display controls */}
      {results.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Bootstrap &amp; plot controls</h3>
          <p style={{ margin: '0 0 0.75rem', color: '#666', fontSize: '0.78rem', maxWidth: 900 }}>
            Bootstrap resamples the {aggregation === 'therapy' ? 'therapies' : 'testing trials'}{' '}
            currently on the plot to estimate confidence intervals around the correlation
            coefficients and to draw a CI band around the OLS fit line.
            Computation runs client-side — no backend call.
          </p>

          {/* Bootstrap config row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.9rem', marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#555' }}>
              Iterations B:&nbsp;
              <input
                type="number"
                min={100} max={10000} step={100}
                value={bootConfig.B}
                disabled={bootRunning}
                onChange={(e) =>
                  setBootConfig({
                    B: Math.max(100, Math.min(10000, parseInt(e.target.value) || 2000)),
                  })
                }
                style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="How points are resampled each iteration. See docs.">
              Scheme:&nbsp;
              <select
                value={bootConfig.scheme}
                disabled={bootRunning}
                onChange={(e) => setBootConfig({ scheme: e.target.value as ResamplingScheme })}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              >
                <option value="trial">Trial resample (case bootstrap)</option>
                <option value="simulation">Simulation redraw (points fixed)</option>
                <option value="nested">Nested (trial + simulation)</option>
                <option value="stratified">Stratified by MOA</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}>
              CI level:&nbsp;
              <select
                value={bootConfig.ciLevel}
                disabled={bootRunning}
                onChange={(e) => setBootConfig({ ciLevel: parseFloat(e.target.value) })}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              >
                <option value={0.90}>90%</option>
                <option value={0.95}>95%</option>
                <option value={0.99}>99%</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="Percentile = sort & trim. BCa = bias-corrected + accelerated (more accurate for skewed distributions).">
              CI method:&nbsp;
              <select
                value={bootConfig.ciMethod}
                disabled={bootRunning}
                onChange={(e) => setBootConfig({ ciMethod: e.target.value as CIMethod })}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              >
                <option value="percentile">Percentile</option>
                <option value="bca">BCa</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="Curve fit used to draw the CI band. OLS = simple linear regression.">
              Band curve:&nbsp;
              <select
                value={bootConfig.curveType}
                disabled={bootRunning}
                onChange={(e) => setBootConfig({ curveType: e.target.value as CurveType })}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              >
                <option value="ols">OLS line</option>
                <option value="none">None (stats only)</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="Blank = fresh seed each run. Any integer makes resampling reproducible.">
              Seed:&nbsp;
              <input
                type="text"
                value={bootConfig.seed}
                disabled={bootRunning}
                onChange={(e) => setBootConfig({ seed: e.target.value })}
                placeholder="(random)"
                style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>

            <span style={{ fontSize: '0.78rem', color: '#888' }}>
              {bootPoints.length} point{bootPoints.length === 1 ? '' : 's'} available
            </span>

            <div style={{ flex: 1 }} />
            {bootResult && !bootRunning && (
              <button
                onClick={handleBootClear}
                style={{ padding: '0.4rem 0.9rem', background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={handleBootRun}
              disabled={bootRunning || bootPoints.length < 3}
              style={{
                padding: '0.45rem 1rem',
                background: bootRunning || bootPoints.length < 3 ? '#bbb' : '#057fa5',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: bootRunning || bootPoints.length < 3 ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {bootRunning ? 'Running…' : bootResult ? 'Re-run bootstrap' : 'Run bootstrap'}
            </button>
          </div>

          {/* Plot display toggles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center',
                        paddingTop: '0.6rem', borderTop: '1px solid #eee' }}>
            <span style={{ fontSize: '0.78rem', color: '#888', fontWeight: 600 }}>Show on plot:</span>
            <label style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={showPoints}
                onChange={(e) => store.setState({ showPoints: e.target.checked })}
              />
              Individual points
            </label>
            <label style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={showFitLine}
                onChange={(e) => store.setState({ showFitLine: e.target.checked })}
                disabled={!bootResult}
              />
              OLS fit line
            </label>
            <label style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={showBand}
                onChange={(e) => store.setState({ showBand: e.target.checked })}
                disabled={!bootResult}
              />
              CI band
            </label>
            <label style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={showRefLine}
                onChange={(e) => store.setState({ showRefLine: e.target.checked })}
              />
              y = x reference
            </label>
            {!bootResult && (
              <span style={{ fontSize: '0.75rem', color: '#aaa' }}>
                Run bootstrap to enable fit line &amp; CI band.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Robustness panel (jackknife + leave-k-out) */}
      {results.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Robustness analysis</h3>
          <p style={{ margin: '0 0 0.75rem', color: '#666', fontSize: '0.78rem', maxWidth: 900 }}>
            Sensitivity to individual points. <strong>Jackknife</strong> recomputes
            Pearson r / Spearman ρ / the OLS slope with each point removed in turn —
            the influence plot shows how much each point moves r. <strong>Leave-k-out</strong>
            randomly drops k points B times to show how much r swings under chunk removal.
            These answer "does one trial carry the result?" — complementary to the bootstrap CI.
          </p>

          {/* Jackknife row (parameter-free) */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.9rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              background: '#f7faf9', border: '1px solid #e0ece9', borderRadius: 6,
            }}
          >
            <span style={{ fontSize: '0.82rem', color: '#555', fontWeight: 600 }}>
              Jackknife (leave-one-out)
            </span>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>
              Drops each of the {bootPoints.length} point{bootPoints.length === 1 ? '' : 's'}{' '}
              once — no parameters needed
            </span>

            <label
              style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}
              title="Show the per-point Δr bar chart."
            >
              <input
                type="checkbox"
                checked={showInfluencePlot}
                onChange={(e) => store.setState({ showInfluencePlot: e.target.checked })}
              />
              Influence plot
            </label>

            <div style={{ flex: 1 }} />
            <button
              onClick={handleJackRun}
              disabled={robustnessRunning || bootPoints.length < 3}
              style={{
                padding: '0.4rem 0.9rem',
                background: robustnessRunning || bootPoints.length < 3 ? '#bbb' : '#00897b',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: robustnessRunning || bootPoints.length < 3 ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: '0.82rem',
              }}
            >
              {robustnessRunning && !jackknife
                ? 'Running…'
                : jackknife ? 'Re-run jackknife' : 'Run jackknife'}
            </button>
          </div>

          {/* Leave-k-out row */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.9rem',
              padding: '0.5rem 0.75rem',
              background: '#f6f8fb', border: '1px solid #dfe4ef', borderRadius: 6,
            }}
          >
            <span style={{ fontSize: '0.82rem', color: '#555', fontWeight: 600 }}>
              Leave-k-out
            </span>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="Number of points to randomly drop each iteration.">
              k:&nbsp;
              <input
                type="number"
                min={1}
                max={Math.max(1, bootPoints.length - 3)}
                step={1}
                value={lkoConfig.k}
                disabled={robustnessRunning}
                onChange={(e) =>
                  setLkoConfig({
                    k: Math.max(1, Math.min(
                      Math.max(1, bootPoints.length - 3),
                      parseInt(e.target.value) || 1,
                    )),
                  })
                }
                style={{ width: 60, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
              />
              <span style={{ color: '#aaa', marginLeft: 4 }}>
                / {bootPoints.length}
              </span>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}>
              Iterations B:&nbsp;
              <input
                type="number"
                min={100} max={10000} step={100}
                value={lkoConfig.B}
                disabled={robustnessRunning}
                onChange={(e) =>
                  setLkoConfig({
                    B: Math.max(100, Math.min(10000, parseInt(e.target.value) || 1000)),
                  })
                }
                style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}>
              CI level:&nbsp;
              <select
                value={lkoConfig.ciLevel}
                disabled={robustnessRunning}
                onChange={(e) => setLkoConfig({ ciLevel: parseFloat(e.target.value) })}
                style={{ padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4, fontSize: '0.8rem' }}
              >
                <option value={0.90}>90%</option>
                <option value={0.95}>95%</option>
                <option value={0.99}>99%</option>
              </select>
            </label>

            <label style={{ fontSize: '0.8rem', color: '#555' }}
                   title="Blank = fresh seed each run. Any integer makes leave-k-out reproducible.">
              Seed:&nbsp;
              <input
                type="text"
                value={lkoConfig.seed}
                disabled={robustnessRunning}
                onChange={(e) => setLkoConfig({ seed: e.target.value })}
                placeholder="(random)"
                style={{ width: 80, padding: '0.25rem 0.4rem', border: '1px solid #ccc', borderRadius: 4 }}
              />
            </label>

            <div style={{ flex: 1 }} />
            {(jackknife || leaveKOut) && !robustnessRunning && (
              <button
                onClick={handleRobClear}
                style={{ padding: '0.4rem 0.9rem', background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', fontSize: '0.82rem' }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={handleLkoRun}
              disabled={robustnessRunning || bootPoints.length < 4}
              style={{
                padding: '0.4rem 0.9rem',
                background: robustnessRunning || bootPoints.length < 4 ? '#bbb' : '#2c639e',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: robustnessRunning || bootPoints.length < 4 ? 'not-allowed' : 'pointer',
                fontWeight: 600, fontSize: '0.82rem',
              }}
            >
              {robustnessRunning && !leaveKOut
                ? 'Running…'
                : leaveKOut ? 'Re-run leave-k-out' : 'Run leave-k-out'}
            </button>
          </div>

          {/* Summary stats */}
          {(jackknife || leaveKOut) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.5rem', marginTop: '0.5rem' }}>
              {jackknife && (
                <>
                  <StatCell
                    label="max |Δr| (any one point)"
                    value={jackknife.maxAbsDeltaR.toFixed(3)}
                    hint="Largest absolute change in Pearson r when any single point is removed. Rule of thumb: < 0.05 = very stable; 0.05–0.15 = acceptable (expected for small samples); > 0.15 = one point has outsized influence — inspect the influence plot. Relative to the r CI width: if max |Δr| exceeds half the CI width, a single outlier is driving the conclusion."
                  />
                  <StatCell
                    label="max |Δρ|"
                    value={jackknife.maxAbsDeltaRho.toFixed(3)}
                    hint="Largest change in Spearman ρ (rank correlation) from removing one point. Same thresholds as |Δr|. Ρ is rank-based so it's usually more stable than r; if |Δρ| is large but |Δr| is small, an extreme-RR outlier is moving the linear fit without changing the ranks."
                  />
                  <StatCell
                    label="max |Δ slope|"
                    value={jackknife.maxAbsDeltaSlope.toFixed(3)}
                    hint="Largest change in the OLS slope from removing one point. Rule of thumb: < 0.10 = stable scaling; > 0.25 = slope is driven by a single point. Combine with |Δr|: a point can move slope without changing r (and vice versa). A high-leverage point at extreme x with on-line y will move slope but leave r nearly unchanged."
                  />
                </>
              )}
              {leaveKOut && leaveKOut.rRange && (
                <StatCell
                  label={`r range, leave-${leaveKOut.config.k}-out`}
                  value={`[${leaveKOut.rRange[0].toFixed(3)}, ${leaveKOut.rRange[1].toFixed(3)}]`}
                  hint={`Minimum and maximum Pearson r observed across ${leaveKOut.config.B} random k-point drops. Tight range straddling a single value = robust correlation. Range crossing 0 = a particular k-subset destroys the correlation; the result is not robust. Range width grows with k — dropping more points naturally creates more variability.`}
                />
              )}
              {leaveKOut && leaveKOut.rCI && (
                <StatCell
                  label={`${Math.round(leaveKOut.config.ciLevel * 100)}% r band`}
                  value={`[${leaveKOut.rCI[0].toFixed(3)}, ${leaveKOut.rCI[1].toFixed(3)}]`}
                  hint={`Percentile band of r values (trimmed tails) across k-drop resamples. NOT a confidence interval. Read as "if I randomly removed ${leaveKOut.config.k} points, r usually lands here." If this band excludes 0, the correlation survives removal of any k-subset with high probability. Narrower than the r range because extreme resamples are trimmed.`}
                />
              )}
              {leaveKOut && leaveKOut.rhoCI && (
                <StatCell
                  label={`${Math.round(leaveKOut.config.ciLevel * 100)}% ρ band`}
                  value={`[${leaveKOut.rhoCI[0].toFixed(3)}, ${leaveKOut.rhoCI[1].toFixed(3)}]`}
                  hint={`Percentile band of Spearman ρ across k-drop resamples. Compare to the r band: if ρ is stable but r isn't, the relationship is monotonic but a few extreme values are pulling the linear fit around. Both bands excluding zero is strong evidence the correlation is not driven by outliers.`}
                />
              )}
            </div>
          )}

          {/* Influence plot */}
          {jackknife && showInfluencePlot && jackknife.influence.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.88rem' }}>
                Influence plot — Δ Pearson r when each point is removed
              </h4>
              <p style={{ margin: '0 0 0.5rem', color: '#888', fontSize: '0.72rem' }}>
                Bars above zero: removing that point <em>increases</em> r (point was pulling r down).
                Bars below zero: removing that point <em>decreases</em> r (point supports the correlation).
              </p>
              <div ref={influenceRef} style={{ width: '100%' }} />
            </div>
          )}

          {/* Calibration check row */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.9rem',
              padding: '0.5rem 0.75rem', marginTop: '0.5rem',
              background: '#faf7fc', border: '1px solid #e6dfee', borderRadius: 6,
            }}
          >
            <span style={{ fontSize: '0.82rem', color: '#555', fontWeight: 600 }}>
              Calibration check
            </span>
            <span style={{ fontSize: '0.75rem', color: '#888' }}>
              Tests whether the OLS fit matches the y = x (perfect-prediction) line —
              no parameters needed, derived from the bootstrap
            </span>

            <label
              style={{ fontSize: '0.8rem', color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}
              title="Show the (slope, intercept) bootstrap cloud with the 95% confidence ellipse and the null (1, 0)."
            >
              <input
                type="checkbox"
                checked={showCalibrationPlot}
                onChange={(e) => store.setState({ showCalibrationPlot: e.target.checked })}
              />
              Calibration plot
            </label>

            <div style={{ flex: 1 }} />
            {calibration ? (
              <div style={{ fontSize: '0.8rem', color: '#555' }}>
                <span style={{ marginRight: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  slope = <strong>{calibration.slopeHat.toFixed(3)}</strong>
                  <InlineHelp
                    size={11}
                    text="OLS slope (β) from the predicted-vs-observed fit. β = 1 means a 1-pp increase in observed RR corresponds to a 1-pp increase in predicted RR (perfect scaling). β < 1 = predictions compressed toward the mean (under-responsive to high/low observed RR). β > 1 = predictions over-reactive (amplify observed differences). Rule of thumb: 0.8 ≤ β ≤ 1.2 is acceptable calibration."
                  />
                  , intercept = <strong>{calibration.interceptHat.toFixed(3)}</strong>
                  <InlineHelp
                    size={11}
                    text="OLS intercept (α). α = 0 means the fit passes through the origin. α > 0 = predictions systematically higher than observed at RR = 0 (optimistic bias). α < 0 = predictions systematically lower (pessimistic bias). Rule of thumb: |α| < 0.05 for well-calibrated predictions."
                  />
                </span>
                <span style={{
                  color: calibration.p != null && calibration.p < 0.05 ? '#c62828' : '#1c3e72',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  {calibration.p == null
                    ? 'p = —'
                    : calibration.p < 0.001 ? 'p < 0.001' : `p = ${calibration.p.toFixed(3)}`}
                  <InlineHelp
                    size={11}
                    text="Bootstrap Wald p-value for the joint null H₀: (slope = 1, intercept = 0). p ≥ 0.05 (navy) = data are consistent with y = x; you cannot reject perfect calibration. p < 0.05 (red) = fit differs significantly from perfect calibration — at least one of slope/intercept is off. Look at the calibration plot: if the red × (null) is outside the 95% ellipse, the test rejects. Failing this test does not mean predictions are useless — check magnitude of the miscalibration, not just significance."
                  />
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '0.78rem', color: '#aaa' }}>
                Run bootstrap (with OLS fit) to enable.
              </span>
            )}
          </div>

          {/* Calibration plot: (slope, intercept) cloud + 95% ellipse + null */}
          {bootResult && bootResult.config.curveType === 'ols' && showCalibrationPlot && (
            <div style={{ marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.88rem' }}>
                Calibration plot — bootstrap (slope, intercept) vs y = x null
              </h4>
              <p style={{ margin: '0 0 0.5rem', color: '#888', fontSize: '0.72rem' }}>
                Each dot is one bootstrap replicate of the OLS fit. The purple circle is the
                observed fit, the red × is the perfect-calibration null (slope = 1, intercept = 0),
                and the shaded ellipse is the 95% confidence region. If the × is <em>inside</em> the
                ellipse the data are consistent with y = x; if <em>outside</em>, the fit differs
                significantly from perfect calibration at α = 0.05.
              </p>
              <div ref={calibrationRef} style={{ width: '100%' }} />
              <InterpretBox id="moa-correlation-calibration-metrics" title="Interpreting the numbers on this plot">
                <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
                  <li>
                    <strong>slope (β)</strong> — OLS slope of predicted vs observed.
                    β = 1 ⇒ perfect scaling. β &lt; 1 = predictions compressed toward the mean
                    (under-responsive); β &gt; 1 = predictions exaggerate observed differences.
                    <em> Acceptable: 0.8 ≤ β ≤ 1.2.</em>
                  </li>
                  <li>
                    <strong>intercept (α)</strong> — OLS intercept. α = 0 ⇒ fit passes through
                    the origin. α &gt; 0 = systematically optimistic (predictions higher than
                    observed); α &lt; 0 = systematically pessimistic.
                    <em> Acceptable: |α| &lt; 0.05.</em>
                  </li>
                  <li>
                    <strong>D² (Mahalanobis distance²)</strong> — squared distance from the
                    observed (β̂, α̂) to the null (1, 0), scaled by the bootstrap covariance.
                    Small D² ⇒ observed fit close to y = x relative to sampling noise;
                    large D² ⇒ far away.
                  </li>
                  <li>
                    <strong>kCrit₉₅</strong> — the 95th-percentile D² value from the bootstrap
                    cloud (the size of the ellipse). If <em>D² &lt; kCrit₉₅</em> the observed
                    fit sits inside the 95% ellipse (× inside, fail to reject y = x).
                    If <em>D² &gt; kCrit₉₅</em>, the × is outside the ellipse and calibration
                    is rejected.
                  </li>
                  <li>
                    <strong>bootstrap Wald p</strong> — two-sided p-value from the empirical
                    D² distribution. Distribution-free; preferred when the bootstrap cloud
                    is irregular or asymmetric. <em>p &lt; 0.05 = reject y = x.</em>
                  </li>
                  <li>
                    <strong>asymptotic χ²₂ p</strong> — parametric p using the Wald statistic
                    against χ² with 2 degrees of freedom. Agrees with the bootstrap when the
                    cloud is approximately bivariate normal; disagreement flags skew or
                    non-normal sampling (trust the bootstrap-Wald in that case).
                  </li>
                </ul>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#555' }}>
                  <strong>Diagnosing miscalibration</strong> — a rejected null (p &lt; 0.05)
                  doesn't tell you <em>how</em> calibration fails. Inspect the observed point
                  relative to the null:
                  <em> right of × and above</em> ⇒ slope &gt; 1, optimistic floor ⇒ predictions
                  over-react and skew high;
                  <em> right and below</em> ⇒ slope &gt; 1 with pessimistic floor;
                  <em> left and above</em> ⇒ slope &lt; 1 with optimistic floor (most common
                  failure mode — model regresses toward the mean but over-estimates low-RR
                  trials);
                  <em> left and below</em> ⇒ slope &lt; 1 with pessimistic floor.
                  Also judge <strong>magnitude</strong>: a significant p with β = 0.95, α = 0.01
                  is far more usable than p = 0.3 with β = 0.5, α = 0.2.
                </p>
              </InterpretBox>
            </div>
          )}
        </div>
      )}

      {/* Run progress */}
      {statuses.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Simulation Progress</h3>
          {statuses.map((s) => (
            <div key={s.moa_value} style={{ marginBottom: 6, fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span><strong>{s.moa_label}</strong> — <span style={{ color: s.status === 'complete' ? '#2e7d32' : s.status === 'error' ? '#c62828' : '#555' }}>{s.status}</span> {s.stage && `(${s.stage})`}</span>
                <span style={{ color: '#888' }}>{s.pct ? `${Math.round(s.pct)}%` : ''}</span>
              </div>
              {s.status !== 'complete' && s.status !== 'error' && (
                <div style={{ height: 4, background: '#eee', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
                  <div style={{ width: `${s.pct || 0}%`, height: '100%', background: '#634697', transition: 'width 0.3s' }} />
                </div>
              )}
              {s.error && <div style={{ color: '#c62828', fontSize: '0.75rem' }}>{s.error}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Correlation results */}
      {results.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Correlation Plot</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{overallR.n}</div>
              <div style={{ fontSize: '0.7rem', color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                {aggregation === 'therapy' ? 'Therapies' : 'Testing Trials'}
                <InlineHelp
                  size={11}
                  text={
                    aggregation === 'therapy'
                      ? 'Unique drug labels after canonicalization (lowercasing + stripping salt suffixes like "hydrochloride"). One point per therapy on the plot.'
                      : 'Held-out testing trials (or all trials if trial-set = All). One point per NCT ID on the plot.'
                  }
                />
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{overallR.r != null ? overallR.r.toFixed(3) : '—'}</div>
              <div style={{ fontSize: '0.7rem', color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                Pearson r
                <InlineHelp
                  size={11}
                  text="Linear correlation between observed and predicted RR across all plotted points. Ranges −1 to +1. ≥ 0.6 is a reasonable bar for a well-calibrated model; 0 means no linear relationship."
                />
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{overallR.rho != null ? overallR.rho.toFixed(3) : '—'}</div>
              <div style={{ fontSize: '0.7rem', color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                Spearman ρ
                <InlineHelp
                  size={11}
                  text="Rank correlation — measures monotonic (not just linear) agreement. Robust to outliers. If ρ is high but r is low, the relationship is monotonic but curved (consider non-linear fit)."
                />
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: '0.5rem', background: '#f8f9fa', borderRadius: 6 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1c3e72' }}>{results.length}</div>
              <div style={{ fontSize: '0.7rem', color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                MOA Groups
                <InlineHelp
                  size={11}
                  text="Number of distinct MOA groups currently included. Each produced its own training/testing simulation; the overall r/ρ above pools points across all selected groups."
                />
              </div>
            </div>
          </div>

          {/* Annotation-line visibility toggles — gate which metrics render
              in the stats box below the plot. */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
              background: '#f7faf9', border: '1px solid #e0ece9', borderRadius: 6,
              fontSize: '0.78rem',
            }}
          >
            <span style={{ color: '#555', fontWeight: 600 }}>Show in stats box:</span>
            {ANNOTATION_LABELS.map(({ key, label, hint }) => (
              <label
                key={key}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                title={hint}
              >
                <input
                  type="checkbox"
                  checked={annotVis[key]}
                  onChange={(e) =>
                    store.setState({
                      annotationVisibility: { ...annotVis, [key]: e.target.checked },
                    })
                  }
                />
                <span style={{ color: '#333' }}>{label}</span>
              </label>
            ))}
            <div style={{ flex: 1 }} />
            <button
              onClick={() =>
                store.setState({
                  annotationVisibility: Object.fromEntries(
                    ANNOTATION_LABELS.map(({ key }) => [key, true]),
                  ) as Record<AnnotationKey, boolean>,
                })
              }
              style={{
                padding: '0.2rem 0.6rem', fontSize: '0.72rem', borderRadius: 4,
                border: '1px solid #00897b', background: '#fff', color: '#00897b',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              All on
            </button>
            <button
              onClick={() =>
                store.setState({
                  annotationVisibility: Object.fromEntries(
                    ANNOTATION_LABELS.map(({ key }) => [key, false]),
                  ) as Record<AnnotationKey, boolean>,
                })
              }
              style={{
                padding: '0.2rem 0.6rem', fontSize: '0.72rem', borderRadius: 4,
                border: '1px solid #999', background: '#fff', color: '#555',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              All off
            </button>
          </div>

          <div ref={plotRef} style={{ width: '100%' }} />

          <InterpretBox id="moa-correlation-plot-metrics" title="Interpreting the stats box below the plot">
            <p style={{ margin: '0 0 0.4rem' }}>
              The stats box beneath the plot aggregates every number describing the
              current view. Read it top-to-bottom:
            </p>
            <ul style={{ margin: '0 0 0.3rem 1.1rem', padding: 0 }}>
              <li>
                <strong>n</strong> — number of points contributing to the stats after
                omissions. <em>(k omitted)</em> is shown when you've click-excluded
                points. For meaningful correlation inference you generally want
                n ≥ 10; below that the CI will be too wide to be useful.
              </li>
              <li>
                <strong>Pearson r</strong> — linear correlation of observed vs predicted
                RR across all plotted points. Target ≥ 0.6 for a useful model;
                ≥ 0.8 is strong. Negative r means predictions run opposite to
                observation — a modeling failure. The <em>[lo, hi]</em> CI is from
                the configured bootstrap; if the CI excludes 0 the correlation is
                significant at the chosen level.
              </li>
              <li>
                <strong>Spearman ρ</strong> — rank correlation. If ρ ≫ r, the
                relationship is monotonic but curved (consider a non-linear fit).
                If r ≫ ρ, a few extreme points are inflating r — inspect the
                influence plot and jackknife max |Δr|.
              </li>
              <li>
                <strong>permutation p</strong> — the p reported next to r and ρ is a
                two-sided permutation p-value (B = 10,000). Makes no distributional
                assumption. p &lt; 0.05 = the observed correlation is stronger than
                95% of random shufflings. Bolded/colored when significant.
              </li>
              <li>
                <strong>calibration (slope=1, int=0)</strong> — a compact summary of
                the OLS fit against the y = x null. Reports slope, intercept, and
                the bootstrap-Wald p from the calibration plot. p &lt; 0.05 rejects
                perfect calibration — check the calibration plot for direction.
              </li>
              <li>
                <strong>bootstrap: B × scheme, % method</strong> — the resampling
                configuration that produced the CIs. Re-run with a different scheme
                (e.g., nested → stratified) to check that CIs don't depend on the
                resampling choice. BCa is more accurate than percentile when the
                bootstrap distribution is skewed.
              </li>
              <li>
                <strong>avg unique</strong> — the mean number of distinct original
                points appearing in each bootstrap replicate. For case bootstraps
                this is ≈ 63% of n (sampling-with-replacement property); for
                "simulation" it is always 100%. A value much below 63% signals a
                degenerate bootstrap (too few distinct points per resample) — widen
                your data or drop the scheme.
              </li>
            </ul>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#555' }}>
              <strong>Judging the overall picture:</strong> strong model = r ≥ 0.6
              with CI excluding 0, permutation p &lt; 0.05, calibration p ≥ 0.05 (or
              slope/intercept within acceptable ranges even if rejected),
              robustness max |Δr| &lt; 0.15, and leave-k-out r band staying positive.
              Weak on <em>any one</em> of those should prompt re-examination before
              trusting the predicted rates downstream.
            </p>
          </InterpretBox>

          {/* Omitted points panel */}
          <div
            style={{
              marginTop: '0.6rem',
              padding: '0.6rem 0.8rem',
              background: omitted.length > 0 ? '#fff5f8' : '#f8f9fa',
              border: `1px solid ${omitted.length > 0 ? '#f0c2d4' : '#e8e8e8'}`,
              borderRadius: 6,
              fontSize: '0.8rem',
            }}
          >
            {omitted.length === 0 ? (
              <span style={{ color: '#888' }}>
                <strong style={{ color: '#555' }}>Click any point</strong> on the plot to omit it from
                statistics. Omitted points stay visible as faded "×" markers and can be clicked again
                to restore. All stats update in real time.
              </span>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ color: '#a12a8b' }}>
                    {omitted.length} point{omitted.length === 1 ? '' : 's'} omitted
                  </strong>
                  <button
                    onClick={restoreAllOmitted}
                    style={{
                      padding: '0.3rem 0.7rem', fontSize: '0.75rem', borderRadius: 4,
                      border: '1px solid #a12a8b', background: '#fff', color: '#a12a8b',
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    Restore all
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {omitted.map((id) => {
                    // ID format: `${moaValue}::${kind}::${inner}`
                    const firstSep = id.indexOf('::');
                    const moaValue = firstSep > 0 ? id.slice(0, firstSep) : '';
                    const rest = firstSep > 0 ? id.slice(firstSep + 2) : id;
                    const nextSep = rest.indexOf('::');
                    const inner = nextSep > 0 ? rest.slice(nextSep + 2) : rest;
                    const moaName = results.find((r) => r.moa_value === moaValue)?.moa_category ?? moaValue;
                    const moaIdx = results.findIndex((r) => r.moa_value === moaValue);
                    const dotColor = moaIdx >= 0 ? MOA_COLORS[moaIdx % MOA_COLORS.length] : '#bbb';
                    return (
                      <span
                        key={id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '0.25rem 0.55rem',
                          background: '#fff', border: '1px solid #e0c5d3', borderRadius: 12,
                          fontSize: '0.75rem',
                        }}
                        title={`Omitted from ${moaName}`}
                      >
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                        <span style={{ color: '#333' }}>{inner}</span>
                        <button
                          onClick={() => toggleOmit(id)}
                          style={{
                            marginLeft: 2, padding: 0,
                            width: 18, height: 18, borderRadius: '50%',
                            border: '1px solid #c2185b', background: '#fff', color: '#c2185b',
                            cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, lineHeight: '16px',
                          }}
                          title="Restore this point"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Per-MOA correlations */}
          <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            Per-MOA Correlations
            {bootResult && (
              <span style={{ fontWeight: 400, color: '#888', fontSize: '0.78rem', marginLeft: 8 }}>
                (CIs from B = {bootResult.config.B}, {Math.round(bootResult.config.ciLevel * 100)}%{' '}
                {bootResult.config.ciMethod === 'bca' ? 'BCa' : 'percentile'})
              </span>
            )}
          </h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem' }}>MOA</th>
                <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    n
                    <InlineHelp size={11} text="Number of points contributing to this MOA's correlation after omissions. '(−k)' flags points the user has excluded." />
                  </span>
                </th>
                <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    Pearson r
                    <InlineHelp size={11} text="Linear correlation of observed vs predicted RR within this MOA group. Per-MOA r can differ sharply from the pooled value when an MOA is either the best or worst calibrated." />
                  </span>
                </th>
                {bootResult && <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    r CI
                    <InlineHelp size={11} text="Bootstrap confidence interval on Pearson r at the selected CI level. Intervals that exclude 0 indicate a significant correlation; wide intervals signal low statistical power (few points)." />
                  </span>
                </th>}
                <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    r p
                    <InlineHelp size={11} text="Two-sided permutation p-value for Pearson r (B = 10,000). Bolded when p < 0.05. Unlike parametric p-values, this makes no distributional assumptions." />
                  </span>
                </th>
                <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    Spearman ρ
                    <InlineHelp size={11} text="Rank correlation within this MOA. Robust to outliers and captures monotonic (not only linear) agreement." />
                  </span>
                </th>
                {bootResult && <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    ρ CI
                    <InlineHelp size={11} text="Bootstrap confidence interval on Spearman ρ at the selected CI level. Compare against r CI — if one excludes zero but the other does not, the relationship may be non-linear." />
                  </span>
                </th>}
                <th style={{ textAlign: 'right', padding: '0.4rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    ρ p
                    <InlineHelp size={11} text="Two-sided permutation p-value for Spearman ρ (B = 10,000). Bolded when p < 0.05." />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => {
                const tlist = trialsFor(r);
                let xs: number[];
                let ys: number[];
                let omittedHere = 0;
                if (aggregation === 'therapy') {
                  const pts = aggregateByTherapy(tlist);
                  const keep = pts.filter((p) => {
                    const keepIt = !isOmitted(pointId(r.moa_value, 'therapy', p.label.toLowerCase()));
                    if (!keepIt) omittedHere++;
                    return keepIt;
                  });
                  xs = keep.map((p) => p.meanObs);
                  ys = keep.map((p) => p.meanPred);
                } else {
                  const keep = tlist.filter((t) => {
                    const keepIt = !isOmitted(pointId(r.moa_value, 'trial', t.nct_id));
                    if (!keepIt) omittedHere++;
                    return keepIt;
                  });
                  xs = keep.map((t) => t.actual_response_rate);
                  ys = keep.map((t) => t.mean_predicted_rate);
                }
                const pr = pearson(xs, ys);
                const sr = spearman(xs, ys);
                const moaStats = bootResult ? bootResult.perMoa[r.moa_value] : null;
                const perm = permPerMoa[r.moa_value];
                const fmtCI = (ci: [number, number] | null | undefined) =>
                  ci ? `[${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]` : '—';
                const fmtPCell = (p: number | null | undefined) => {
                  if (p == null || !Number.isFinite(p)) return '—';
                  if (p < 0.001) return '< 0.001';
                  return p.toFixed(3);
                };
                // Bold/colored treatment for significant values (α = 0.05)
                const pStyle = (p: number | null | undefined): React.CSSProperties => {
                  if (p == null || !Number.isFinite(p)) return { color: '#aaa' };
                  return p < 0.05
                    ? { color: '#1c3e72', fontWeight: 600 }
                    : { color: '#666' };
                };
                return (
                  <tr key={r.moa_value} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '0.4rem' }}>
                      <span style={{
                        display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                        background: MOA_COLORS[idx % MOA_COLORS.length], marginRight: 6,
                      }} />
                      {r.moa_category}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.4rem' }}>
                      {xs.length}
                      {omittedHere > 0 && (
                        <span style={{ color: '#c2185b', marginLeft: 4, fontSize: '0.72rem' }}
                              title={`${omittedHere} point(s) omitted in this MOA`}>
                          (−{omittedHere})
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.4rem' }}>{pr != null ? pr.toFixed(3) : '—'}</td>
                    {bootResult && (
                      <td style={{ textAlign: 'right', padding: '0.4rem', color: '#666' }}>
                        {fmtCI(moaStats?.rCI)}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', padding: '0.4rem', ...pStyle(perm?.pR) }}>
                      {fmtPCell(perm?.pR)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.4rem' }}>{sr != null ? sr.toFixed(3) : '—'}</td>
                    {bootResult && (
                      <td style={{ textAlign: 'right', padding: '0.4rem', color: '#666' }}>
                        {fmtCI(moaStats?.rhoCI)}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', padding: '0.4rem', ...pStyle(perm?.pRho) }}>
                      {fmtPCell(perm?.pRho)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
