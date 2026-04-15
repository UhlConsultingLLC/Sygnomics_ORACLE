import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/pages/MOACorrelation.tsx");import.meta.env = {"BASE_URL": "/", "DEV": true, "MODE": "development", "PROD": false, "SSR": false};import __vite__cjsImport0_react from "/node_modules/.vite/deps/react.js?v=48f48bda"; const useState = __vite__cjsImport0_react["useState"]; const useEffect = __vite__cjsImport0_react["useEffect"]; const useRef = __vite__cjsImport0_react["useRef"]; const useSyncExternalStore = __vite__cjsImport0_react["useSyncExternalStore"]; const useMemo = __vite__cjsImport0_react["useMemo"];
import axios from "/node_modules/.vite/deps/axios.js?v=48f48bda";
import __vite__cjsImport2_plotly_js_dist_plotly_min_js from "/node_modules/.vite/deps/plotly__js_dist_plotly__min__js.js?v=48f48bda"; const Plotly = __vite__cjsImport2_plotly_js_dist_plotly_min_js;
import { pearson, spearman, runBootstrap, materializeBand, makeRng, gaussian, runJackknife, runLeaveKOut } from "/src/utils/bootstrap.ts";
var _jsxFileName = "F:/Master_Python_Scripts/CT_Collection_Threshold_Learning/frontend/src/pages/MOACorrelation.tsx";
import __vite__cjsImport4_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=48f48bda"; const _jsxDEV = __vite__cjsImport4_react_jsxDevRuntime["jsxDEV"]; const _Fragment = __vite__cjsImport4_react_jsxDevRuntime["Fragment"];
var _s = $RefreshSig$(), _s2 = $RefreshSig$();
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000" });
// ─────────────────────────────────────────────────────────────────────────
// Module-level persistent store
// ─────────────────────────────────────────────────────────────────────────
// Lives outside React's component lifecycle so the analysis keeps running
// even when the user navigates away from the page. State (config + progress
// + results) is also mirrored to sessionStorage so a hard refresh restores
// the in-flight or completed analysis as long as the API server is up.
const STORAGE_KEY = "moa_correlation_state_v1";
const defaultBootConfig = {
	B: 2e3,
	scheme: "nested",
	ciLevel: .95,
	ciMethod: "percentile",
	curveType: "ols",
	seed: ""
};
const defaultLkoConfig = {
	k: 3,
	B: 1e3,
	ciLevel: .95,
	seed: ""
};
const defaultState = {
	selected: [],
	nIterations: 500,
	trialSet: "testing",
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
	showPoints: true,
	showFitLine: true,
	showBand: true,
	showRefLine: true
};
const loadInitial = () => {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return defaultState;
		const parsed = JSON.parse(raw);
		// Reset `running` on cold load — if the page was in flight, the polling
		// loop in this module is gone after a hard refresh.
		return {
			...defaultState,
			...parsed,
			running: false,
			robustnessRunning: false
		};
	} catch {
		return defaultState;
	}
};
const store = {
	state: loadInitial(),
	listeners: new Set(),
	cancel: false,
	activeSimIds: new Map(),
	subscribe(fn) {
		store.listeners.add(fn);
		return () => store.listeners.delete(fn);
	},
	getSnapshot() {
		return store.state;
	},
	setState(patch) {
		const next = typeof patch === "function" ? patch(store.state) : patch;
		store.state = {
			...store.state,
			...next
		};
		try {
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
		} catch {}
		store.listeners.forEach((l) => l());
	}
};
const useStore = () => {
	_s();
	return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};
_s(useStore, "FpwL93IKMLJZuQQXefVtWynbBPQ=");
// Minimal drug-name canonicalization: lowercase + strip common salt suffixes
// so "Lapatinib Ditosylate" collapses with "Lapatinib" for grouping.
const SALT_SUFFIXES = [
	"hydrochloride",
	"dihydrochloride",
	"hcl",
	"sulfate",
	"sulphate",
	"bisulfate",
	"mesylate",
	"dimesylate",
	"tosylate",
	"ditosylate",
	"besylate",
	"besilate",
	"camsylate",
	"isethionate",
	"maleate",
	"fumarate",
	"citrate",
	"tartrate",
	"succinate",
	"acetate",
	"phosphate",
	"nitrate",
	"sodium",
	"potassium",
	"calcium",
	"magnesium",
	"meglumine",
	"bromide",
	"chloride",
	"iodide",
	"fluoride",
	"hemihydrate",
	"monohydrate",
	"dihydrate",
	"trihydrate",
	"pentahydrate"
];
function canonicalizeDrug(raw) {
	const base = (raw || "").trim();
	if (!base) return {
		key: "",
		label: ""
	};
	let words = base.split(/\s+/);
	while (words.length > 1) {
		const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
		if (SALT_SUFFIXES.includes(last)) words.pop();
		else break;
	}
	const label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
	return {
		key: label.toLowerCase(),
		label
	};
}
// MOA-distinct colors (Sygnomics-leaning palette)
const MOA_COLORS = [
	"#634697",
	"#a12a8b",
	"#057fa5",
	"#1c3e72",
	"#2c639e",
	"#c2185b",
	"#00897b",
	"#f57c00",
	"#5e35b1",
	"#43a047"
];
// Small stat callout used in the robustness summary grid.
function StatCell(props) {
	return /* @__PURE__ */ _jsxDEV("div", {
		style: {
			padding: "0.5rem 0.6rem",
			background: "#f8f9fa",
			borderRadius: 6,
			border: "1px solid #eee"
		},
		title: props.hint,
		children: [/* @__PURE__ */ _jsxDEV("div", {
			style: {
				fontSize: "0.92rem",
				fontWeight: 700,
				color: "#1c3e72"
			},
			children: props.value
		}, void 0, false, {
			fileName: _jsxFileName,
			lineNumber: 230,
			columnNumber: 7
		}, this), /* @__PURE__ */ _jsxDEV("div", {
			style: {
				fontSize: "0.68rem",
				color: "#888",
				marginTop: 2
			},
			children: props.label
		}, void 0, false, {
			fileName: _jsxFileName,
			lineNumber: 233,
			columnNumber: 7
		}, this)]
	}, void 0, true, {
		fileName: _jsxFileName,
		lineNumber: 221,
		columnNumber: 5
	}, this);
}
_c = StatCell;
// (Stats helpers `pearson`, `spearman`, `olsFit`, bootstrap core imported from
//  ../utils/bootstrap)
// Module-level run loop. Lives outside React lifecycle so leaving the page
// does not stop or reset the analysis.
async function runAnalysis(categoryLookup, selectedSnapshot, nIterations) {
	if (store.state.running || selectedSnapshot.length === 0) return;
	store.cancel = false;
	store.activeSimIds.clear();
	const initial = selectedSnapshot.map((value) => ({
		moa_value: value,
		moa_label: categoryLookup(value),
		status: "queued"
	}));
	store.setState({
		running: true,
		statuses: initial,
		results: []
	});
	const collected = [];
	for (let i = 0; i < selectedSnapshot.length; i++) {
		if (store.cancel) break;
		const value = selectedSnapshot[i];
		const label = initial[i].moa_label;
		try {
			store.setState((s) => ({ statuses: s.statuses.map((st, idx) => idx === i ? {
				...st,
				status: "running",
				stage: "starting…",
				pct: 0
			} : st) }));
			const startResp = await api.post("/simulation/moa-run", {
				moa_category: value,
				n_iterations: nIterations,
				save_plots: false
			});
			const simId = startResp.data.sim_id;
			store.activeSimIds.set(value, simId);
			let done = false;
			while (!done) {
				if (store.cancel) break;
				await new Promise((r) => setTimeout(r, 1500));
				const { data } = await api.get(`/simulation/moa-status/${simId}`);
				store.setState((s) => ({ statuses: s.statuses.map((st, idx) => idx === i ? {
					...st,
					status: data.status,
					stage: data.stage,
					detail: data.detail,
					pct: data.progress_pct,
					error: data.error
				} : st) }));
				if (data.status === "complete" && data.result) {
					const excluded = (data.result.excluded_trials || []).map((t) => t.nct_id).filter((s) => typeof s === "string");
					const excludedSet = new Set(excluded);
					const filt = (arr) => (arr || []).filter((t) => typeof t.actual_response_rate === "number" && typeof t.mean_predicted_rate === "number" && !excludedSet.has(t.nct_id)).map((t) => ({
						nct_id: t.nct_id,
						title: t.title,
						actual_response_rate: t.actual_response_rate,
						mean_predicted_rate: t.mean_predicted_rate,
						std_predicted_rate: t.std_predicted_rate || 0,
						drugs: Array.isArray(t.drugs) ? t.drugs : [],
						fractions_above_threshold: Array.isArray(t.fractions_above_threshold) ? t.fractions_above_threshold : undefined
					}));
					collected.push({
						moa_category: data.result.moa_category || label,
						moa_value: value,
						testing_trials: filt(data.result.testing_trials),
						training_trials: filt(data.result.training_trials),
						excluded_nct_ids: excluded
					});
					store.setState({ results: [...collected] });
					done = true;
				} else if (data.status === "error") {
					done = true;
				}
			}
		} catch (e) {
			store.setState((s) => ({ statuses: s.statuses.map((st, idx) => idx === i ? {
				...st,
				status: "error",
				error: String(e?.message || e)
			} : st) }));
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
function runBootstrapAnalysis(points, uiCfg) {
	if (store.state.bootRunning) return;
	if (points.length < 3) {
		store.setState({ bootResult: null });
		return;
	}
	const seedNum = uiCfg.seed.trim() === "" ? undefined : Number(uiCfg.seed);
	const cfg = {
		B: uiCfg.B,
		scheme: uiCfg.scheme,
		ciLevel: uiCfg.ciLevel,
		ciMethod: uiCfg.ciMethod,
		curveType: uiCfg.curveType,
		seed: Number.isFinite(seedNum) ? seedNum : undefined
	};
	store.setState({ bootRunning: true });
	// Defer to next tick so the UI can show "running"
	setTimeout(() => {
		try {
			const result = runBootstrap(points, cfg);
			store.setState({
				bootResult: result,
				bootRunning: false
			});
		} catch (e) {
			console.error("Bootstrap failed", e);
			store.setState({ bootRunning: false });
		}
	}, 10);
}
function clearBootstrap() {
	store.setState({ bootResult: null });
}
// ─────────────────────────────────────────────────────────────────────────
// Robustness runner
// ─────────────────────────────────────────────────────────────────────────
// Jackknife + leave-k-out are cheap (≤ few hundred ms at n≤100, B≤5000) but
// we still defer to the next tick so the "Running…" state can paint.
function runRobustnessAnalysis(points, lkoCfg) {
	if (store.state.robustnessRunning) return;
	if (points.length < 4) {
		store.setState({
			jackknife: null,
			leaveKOut: null
		});
		return;
	}
	const seedNum = lkoCfg.seed.trim() === "" ? undefined : Number(lkoCfg.seed);
	store.setState({ robustnessRunning: true });
	setTimeout(() => {
		try {
			const jk = runJackknife(points);
			const lk = runLeaveKOut(points, {
				k: lkoCfg.k,
				B: lkoCfg.B,
				ciLevel: lkoCfg.ciLevel,
				seed: Number.isFinite(seedNum) ? seedNum : undefined
			});
			store.setState({
				jackknife: jk,
				leaveKOut: lk,
				robustnessRunning: false
			});
		} catch (e) {
			console.error("Robustness analysis failed", e);
			store.setState({ robustnessRunning: false });
		}
	}, 10);
}
function clearRobustness() {
	store.setState({
		jackknife: null,
		leaveKOut: null
	});
}
export default function MOACorrelation() {
	_s2();
	const { selected, nIterations, trialSet, running, statuses, results, bootConfig, bootResult, bootRunning, lkoConfig, jackknife, leaveKOut, robustnessRunning, showInfluencePlot, showPoints, showFitLine, showBand, showRefLine } = useStore();
	const [categories, setCategories] = useState([]);
	const [aggregation, setAggregation] = useState("trial");
	const [showXErrors, setShowXErrors] = useState(true);
	const [showYErrors, setShowYErrors] = useState(true);
	const plotRef = useRef(null);
	const influenceRef = useRef(null);
	// Invalidate bootstrap + robustness results whenever the underlying points change
	useEffect(() => {
		const patch = {};
		if (store.state.bootResult) patch.bootResult = null;
		if (store.state.jackknife) patch.jackknife = null;
		if (store.state.leaveKOut) patch.leaveKOut = null;
		if (Object.keys(patch).length > 0) store.setState(patch);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		results,
		trialSet,
		aggregation
	]);
	const setBootConfig = (patch) => store.setState((s) => ({ bootConfig: {
		...s.bootConfig,
		...patch
	} }));
	const setLkoConfig = (patch) => store.setState((s) => ({ lkoConfig: {
		...s.lkoConfig,
		...patch
	} }));
	const aggregateByTherapy = (tlist) => {
		const map = new Map();
		for (const t of tlist) {
			const drugs = t.drugs && t.drugs.length ? t.drugs : ["(unknown drug)"];
			const seen = new Set();
			for (const d of drugs) {
				const { key, label } = canonicalizeDrug(d);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				if (!map.has(key)) {
					map.set(key, {
						label,
						obs: [],
						predMeans: [],
						predVars: [],
						trials: new Set(),
						nArms: 0
					});
				}
				const a = map.get(key);
				a.obs.push(t.actual_response_rate);
				a.predMeans.push(t.mean_predicted_rate);
				a.predVars.push((t.std_predicted_rate || 0) ** 2);
				a.trials.add(t.nct_id);
				a.nArms += 1;
			}
		}
		const out = [];
		for (const a of map.values()) {
			const meanObs = a.obs.reduce((x, y) => x + y, 0) / a.obs.length;
			const varObs = a.obs.length > 1 ? a.obs.reduce((x, y) => x + (y - meanObs) * (y - meanObs), 0) / a.obs.length : 0;
			const meanPred = a.predMeans.reduce((x, y) => x + y, 0) / a.predMeans.length;
			// Pooled predicted SD: sqrt(mean of within-trial variance + variance of trial means)
			const meanVarWithin = a.predVars.reduce((x, y) => x + y, 0) / a.predVars.length;
			const varBetween = a.predMeans.length > 1 ? a.predMeans.reduce((x, y) => x + (y - meanPred) * (y - meanPred), 0) / a.predMeans.length : 0;
			out.push({
				label: a.label,
				meanObs,
				stdObs: Math.sqrt(varObs),
				meanPred,
				stdPred: Math.sqrt(meanVarWithin + varBetween),
				nTrials: a.trials.size,
				nArms: a.nArms
			});
		}
		return out.sort((a, b) => a.label.localeCompare(b.label));
	};
	// Returns the trial array selected by the current toggle.
	const trialsFor = (r) => trialSet === "all" ? [...r.training_trials || [], ...r.testing_trials || []] : r.testing_trials || [];
	// Load MOA categories
	useEffect(() => {
		api.get("/simulation/moa-categories").then(({ data }) => {
			const sorted = [...data].sort((a, b) => (a.label || a.value).localeCompare(b.label || b.value));
			setCategories(sorted);
		});
	}, []);
	const setSelected = (next) => {
		store.setState((s) => ({ selected: typeof next === "function" ? next(s.selected) : next }));
	};
	const setNIterations = (n) => store.setState({ nIterations: n });
	const toggleMOA = (value) => {
		setSelected((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
	};
	const handleRun = () => {
		const lookup = (v) => categories.find((c) => c.value === v)?.category || v;
		runAnalysis(lookup, selected, nIterations);
	};
	const handleCancel = () => cancelAnalysis();
	// Build BootstrapInputPoint[] from current results + aggregation. This
	// matches what's rendered on the plot exactly, so bootstrap CIs refer to
	// the same points the user sees.
	const bootPoints = useMemo(() => {
		const out = [];
		results.forEach((r) => {
			const tlist = trialsFor(r);
			if (tlist.length === 0) return;
			if (aggregation === "therapy") {
				const pts = aggregateByTherapy(tlist);
				for (const p of pts) {
					// Therapy-level draw: Gaussian around (meanPred, pooled stdPred),
					// clipped to [0,1]. Uses a fresh per-call RNG so draws don't depend
					// on the outer bootstrap seed (that's handled by point order).
					const mean = p.meanPred;
					const sd = p.stdPred;
					const rng = makeRng();
					out.push({
						x: p.meanObs,
						y: mean,
						moaKey: r.moa_value,
						label: p.label,
						yDrawFn: sd > 0 ? () => Math.max(0, Math.min(1, mean + sd * gaussian(rng))) : undefined
					});
				}
			} else {
				for (const t of tlist) {
					const draws = t.fractions_above_threshold;
					const mean = t.mean_predicted_rate;
					const sd = t.std_predicted_rate || 0;
					const rng = makeRng();
					out.push({
						x: t.actual_response_rate,
						y: mean,
						moaKey: r.moa_value,
						label: t.nct_id,
						yDrawFn: draws && draws.length > 0 ? () => draws[Math.floor(rng() * draws.length)] : sd > 0 ? () => Math.max(0, Math.min(1, mean + sd * gaussian(rng))) : undefined
					});
				}
			}
		});
		return out;
	}, [
		results,
		trialSet,
		aggregation
	]);
	const handleBootRun = () => runBootstrapAnalysis(bootPoints, bootConfig);
	const handleBootClear = () => clearBootstrap();
	const handleRobRun = () => runRobustnessAnalysis(bootPoints, lkoConfig);
	const handleRobClear = () => clearRobustness();
	// Render correlation plot whenever results change
	useEffect(() => {
		if (!plotRef.current) return;
		if (results.length === 0) {
			Plotly.purge(plotRef.current);
			return;
		}
		const traces = [];
		const allActual = [];
		const allPredicted = [];
		const extents = [];
		results.forEach((r, idx) => {
			const color = MOA_COLORS[idx % MOA_COLORS.length];
			const tlist = trialsFor(r);
			if (tlist.length === 0) return;
			if (aggregation === "therapy") {
				const pts = aggregateByTherapy(tlist);
				if (pts.length === 0) return;
				const xs = pts.map((p) => p.meanObs);
				const ys = pts.map((p) => p.meanPred);
				const ex = pts.map((p) => p.stdObs);
				const ey = pts.map((p) => p.stdPred);
				const labels = pts.map((p) => `<b>${p.label}</b><br>${r.moa_category}<br>` + `observed: ${(p.meanObs * 100).toFixed(1)}% ± ${(p.stdObs * 100).toFixed(1)}%<br>` + `predicted: ${(p.meanPred * 100).toFixed(1)}% ± ${(p.stdPred * 100).toFixed(1)}%<br>` + `${p.nTrials} trial(s), ${p.nArms} arm(s)`);
				allActual.push(...xs);
				allPredicted.push(...ys);
				for (let i = 0; i < xs.length; i++) {
					extents.push(xs[i] + (showXErrors ? ex[i] : 0), ys[i] + (showYErrors ? ey[i] : 0));
				}
				traces.push({
					x: xs,
					y: ys,
					error_x: {
						type: "data",
						array: ex,
						visible: showPoints && showXErrors,
						thickness: 1.2,
						width: 3,
						color
					},
					error_y: {
						type: "data",
						array: ey,
						visible: showPoints && showYErrors,
						thickness: 1.2,
						width: 3,
						color
					},
					type: "scatter",
					mode: "markers",
					name: r.moa_category,
					marker: {
						size: 10,
						color,
						line: {
							color: "#fff",
							width: 1
						}
					},
					text: labels,
					hoverinfo: "text",
					visible: showPoints ? true : "legendonly"
				});
			} else {
				const xs = tlist.map((t) => t.actual_response_rate);
				const ys = tlist.map((t) => t.mean_predicted_rate);
				const errs = tlist.map((t) => t.std_predicted_rate || 0);
				const labels = tlist.map((t) => `${t.nct_id}<br>actual: ${(t.actual_response_rate * 100).toFixed(1)}%` + `<br>predicted: ${(t.mean_predicted_rate * 100).toFixed(1)}% ± ${((t.std_predicted_rate || 0) * 100).toFixed(1)}%`);
				allActual.push(...xs);
				allPredicted.push(...ys);
				for (let i = 0; i < xs.length; i++) {
					extents.push(xs[i], ys[i] + (showYErrors ? errs[i] : 0));
				}
				traces.push({
					x: xs,
					y: ys,
					error_y: {
						type: "data",
						array: errs,
						visible: showPoints && showYErrors,
						thickness: 1.2,
						width: 3,
						color
					},
					type: "scatter",
					mode: "markers",
					name: r.moa_category,
					marker: {
						size: 9,
						color,
						line: {
							color: "#fff",
							width: 1
						}
					},
					text: labels,
					hoverinfo: "text",
					visible: showPoints ? true : "legendonly"
				});
			}
		});
		// y = x reference line. Axis upper limit includes mean + error bar extents
		// so no whisker is clipped. Shared between x & y so the plot stays square.
		const maxVal = Math.max(.05, ...allActual, ...allPredicted, ...extents) * 1.08;
		traces.push({
			x: [0, maxVal],
			y: [0, maxVal],
			type: "scatter",
			mode: "lines",
			name: "y = x (perfect)",
			line: {
				color: "#999",
				dash: "dash",
				width: 1.5
			},
			hoverinfo: "skip",
			visible: showRefLine ? true : "legendonly"
		});
		// Bootstrap CI band + OLS fit line
		if (bootResult && bootResult.config.curveType === "ols") {
			const nGrid = 50;
			const xGrid = Array.from({ length: nGrid }, (_, i) => i / (nGrid - 1) * maxVal);
			const band = materializeBand(bootResult, xGrid);
			if (band && showBand) {
				// Lower invisible boundary
				traces.push({
					x: xGrid,
					y: band.lower,
					type: "scatter",
					mode: "lines",
					line: {
						color: "rgba(0,0,0,0)",
						width: 0
					},
					hoverinfo: "skip",
					showlegend: false
				});
				// Upper boundary with fill down to the previous trace
				const ciPct = Math.round(bootResult.config.ciLevel * 100);
				traces.push({
					x: xGrid,
					y: band.upper,
					type: "scatter",
					mode: "lines",
					name: `${ciPct}% CI band`,
					line: {
						color: "rgba(99,70,151,0.35)",
						width: 0
					},
					fill: "tonexty",
					fillcolor: "rgba(99,70,151,0.18)",
					hoverinfo: "skip"
				});
			}
			if (showFitLine && bootResult.slopeHat != null && bootResult.interceptHat != null) {
				const s = bootResult.slopeHat, i0 = bootResult.interceptHat;
				traces.push({
					x: [0, maxVal],
					y: [i0, i0 + s * maxVal],
					type: "scatter",
					mode: "lines",
					name: "OLS fit",
					line: {
						color: "#634697",
						width: 2
					},
					hoverinfo: "skip"
				});
			}
		}
		const r = pearson(allActual, allPredicted);
		const rho = spearman(allActual, allPredicted);
		const fmt = (v) => v.toFixed(3);
		const fmtCI = (ci) => ci ? ` [${fmt(ci[0])}, ${fmt(ci[1])}]` : "";
		const statsLines = [`n = ${allActual.length}`];
		if (r != null) {
			const ci = bootResult ? bootResult.rCI : null;
			statsLines.push(`Pearson r = ${fmt(r)}${fmtCI(ci)}`);
		}
		if (rho != null) {
			const ci = bootResult ? bootResult.rhoCI : null;
			statsLines.push(`Spearman ρ = ${fmt(rho)}${fmtCI(ci)}`);
		}
		if (bootResult) {
			const pct = Math.round(bootResult.config.ciLevel * 100);
			statsLines.push(`bootstrap: ${bootResult.config.B} × ${bootResult.config.scheme}, ${pct}% ${bootResult.config.ciMethod === "bca" ? "BCa" : "pctl"}`);
		}
		const layout = {
			title: {
				text: "Predicted vs Observed Response Rates",
				font: { size: 26 }
			},
			font: { size: 18 },
			annotations: [{
				xref: "paper",
				yref: "paper",
				x: .98,
				y: .98,
				xanchor: "right",
				yanchor: "top",
				text: statsLines.join("<br>"),
				showarrow: false,
				align: "right",
				font: {
					size: 18,
					color: "#333"
				},
				bgcolor: "rgba(255,255,255,0.9)",
				bordercolor: "#ccc",
				borderwidth: 1,
				borderpad: 6
			}],
			xaxis: {
				title: {
					text: aggregation === "therapy" ? `Mean Observed Response Rate${showXErrors ? " (± SD across trials)" : ""}` : "Actual Response Rate (observed)",
					font: { size: 21 }
				},
				tickfont: { size: 17 },
				range: [0, maxVal],
				tickformat: ".0%",
				zeroline: true,
				zerolinecolor: "#ddd",
				automargin: true
			},
			yaxis: {
				title: {
					text: aggregation === "therapy" ? `Mean Predicted Response Rate${showYErrors ? " (± SD)" : ""}` : `Predicted Response Rate${showYErrors ? " (mean ± SD)" : ""}`,
					font: { size: 21 }
				},
				tickfont: { size: 17 },
				range: [0, maxVal],
				tickformat: ".0%",
				zeroline: true,
				zerolinecolor: "#ddd",
				automargin: true
			},
			height: 560,
			margin: {
				l: 80,
				r: 30,
				t: 70,
				b: 70
			},
			legend: {
				x: .01,
				y: .99,
				bgcolor: "rgba(255,255,255,0.9)",
				bordercolor: "#ddd",
				borderwidth: 1,
				font: { size: 17 }
			},
			hovermode: "closest",
			plot_bgcolor: "#fff"
		};
		Plotly.newPlot(plotRef.current, traces, layout, {
			displayModeBar: true,
			responsive: true,
			toImageButtonOptions: {
				format: "svg",
				filename: "moa_correlation",
				width: 800,
				height: 800,
				scale: 4
			}
		});
	}, [
		results,
		trialSet,
		aggregation,
		showXErrors,
		showYErrors,
		bootResult,
		showPoints,
		showFitLine,
		showBand,
		showRefLine
	]);
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
		const sorted = [...infl].sort((a, b) => Math.abs(b.deltaR ?? 0) - Math.abs(a.deltaR ?? 0));
		// Map each MOA to its plot color (matching the correlation plot legend).
		const moaColor = {};
		results.forEach((r, idx) => {
			moaColor[r.moa_value] = MOA_COLORS[idx % MOA_COLORS.length];
		});
		const deltas = sorted.map((p) => p.deltaR ?? 0);
		const labels = sorted.map((p) => p.label);
		const colors = sorted.map((p) => (p.deltaR ?? 0) > 0 ? "#c2185b" : "#2c639e");
		const hover = sorted.map((p) => {
			const moaName = results.find((r) => r.moa_value === p.moaKey)?.moa_category ?? p.moaKey;
			return `<b>${p.label}</b><br>` + `${moaName}<br>` + `x = ${(p.x * 100).toFixed(1)}%, y = ${(p.y * 100).toFixed(1)}%<br>` + `Δr = ${(p.deltaR ?? 0).toFixed(4)}<br>` + `r without this point = ${p.rMinus != null ? p.rMinus.toFixed(3) : "—"}`;
		});
		// Thin strip below the bars colored by MOA to show cohort membership
		const moaStrip = sorted.map((p) => moaColor[p.moaKey] ?? "#bbb");
		const traces = [{
			x: labels,
			y: deltas,
			type: "bar",
			marker: {
				color: colors,
				line: {
					color: "#fff",
					width: .5
				}
			},
			text: hover,
			hoverinfo: "text",
			name: "Δr"
		}, (
		// MOA color strip as a second bar trace at a tiny negative value,
		// rendered below the main bars. Gives a quick visual MOA cue.
		{
			x: labels,
			y: sorted.map(() => -jackknife.maxAbsDeltaR * .04 - .002),
			base: sorted.map(() => -jackknife.maxAbsDeltaR * .08 - .004),
			type: "bar",
			marker: { color: moaStrip },
			hoverinfo: "skip",
			showlegend: false,
			yaxis: "y"
		})];
		const layout = {
			barmode: "overlay",
			height: Math.min(420, 220 + Math.max(0, sorted.length - 20) * 6),
			margin: {
				l: 60,
				r: 20,
				t: 30,
				b: 110
			},
			xaxis: {
				tickfont: { size: 11 },
				tickangle: -45,
				automargin: true,
				title: {
					text: "",
					font: { size: 12 }
				}
			},
			yaxis: {
				title: {
					text: "Δ Pearson r",
					font: { size: 13 }
				},
				zeroline: true,
				zerolinecolor: "#333",
				zerolinewidth: 1
			},
			showlegend: false,
			plot_bgcolor: "#fff",
			hovermode: "closest",
			shapes: [(
			// Dashed reference at Δr = 0
			{
				type: "line",
				xref: "paper",
				yref: "y",
				x0: 0,
				x1: 1,
				y0: 0,
				y1: 0,
				line: {
					color: "#333",
					width: 1,
					dash: "dot"
				}
			})]
		};
		Plotly.newPlot(influenceRef.current, traces, layout, {
			displayModeBar: true,
			responsive: true,
			toImageButtonOptions: {
				format: "svg",
				filename: "moa_influence",
				scale: 4
			}
		});
	}, [
		jackknife,
		showInfluencePlot,
		results
	]);
	const overallR = (() => {
		const xs = [], ys = [];
		results.forEach((r) => {
			const tlist = trialsFor(r);
			if (aggregation === "therapy") {
				aggregateByTherapy(tlist).forEach((p) => {
					xs.push(p.meanObs);
					ys.push(p.meanPred);
				});
			} else {
				tlist.forEach((t) => {
					xs.push(t.actual_response_rate);
					ys.push(t.mean_predicted_rate);
				});
			}
		});
		return {
			r: pearson(xs, ys),
			rho: spearman(xs, ys),
			n: xs.length
		};
	})();
	return /* @__PURE__ */ _jsxDEV("div", { children: [
		/* @__PURE__ */ _jsxDEV("h1", {
			style: {
				fontSize: "1.5rem",
				marginBottom: "0.5rem"
			},
			children: "MOA Correlation Analysis"
		}, void 0, false, {
			fileName: _jsxFileName,
			lineNumber: 979,
			columnNumber: 7
		}, this),
		/* @__PURE__ */ _jsxDEV("p", {
			style: {
				color: "#666",
				fontSize: "0.85rem",
				marginBottom: "1rem",
				maxWidth: 900
			},
			children: "Select one or more drug Mechanisms of Action. ORACLE runs a training/testing simulation for each MOA group and compares the predicted response-rate distribution for every testing trial to that trial's actual observed response rate. The correlation plot below shows each testing trial as a point — x is the observed rate, y is the mean predicted rate, and the vertical bar is ±1 SD of the prediction range."
		}, void 0, false, {
			fileName: _jsxFileName,
			lineNumber: 980,
			columnNumber: 7
		}, this),
		/* @__PURE__ */ _jsxDEV("div", {
			style: {
				background: "#fff",
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: "1rem",
				marginBottom: "1rem"
			},
			children: [
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						margin: "0 0 0.5rem"
					},
					children: [/* @__PURE__ */ _jsxDEV("h3", {
						style: {
							margin: 0,
							fontSize: "1rem"
						},
						children: "Select MOAs"
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 991,
						columnNumber: 11
					}, this), /* @__PURE__ */ _jsxDEV("div", {
						style: {
							display: "flex",
							gap: 6
						},
						children: [/* @__PURE__ */ _jsxDEV("button", {
							onClick: () => setSelected(categories.map((c) => c.value)),
							disabled: running || categories.length === 0,
							style: {
								padding: "0.3rem 0.7rem",
								fontSize: "0.75rem",
								borderRadius: 4,
								border: "1px solid #634697",
								background: "#fff",
								color: "#634697",
								cursor: running || categories.length === 0 ? "not-allowed" : "pointer",
								fontWeight: 600
							},
							children: "Select All"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 993,
							columnNumber: 13
						}, this), /* @__PURE__ */ _jsxDEV("button", {
							onClick: () => setSelected([]),
							disabled: running || selected.length === 0,
							style: {
								padding: "0.3rem 0.7rem",
								fontSize: "0.75rem",
								borderRadius: 4,
								border: "1px solid #999",
								background: "#fff",
								color: "#555",
								cursor: running || selected.length === 0 ? "not-allowed" : "pointer",
								fontWeight: 600
							},
							children: "Deselect All"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1005,
							columnNumber: 13
						}, this)]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 992,
						columnNumber: 11
					}, this)]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 990,
					columnNumber: 9
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						maxHeight: 220,
						overflowY: "auto",
						padding: 4,
						border: "1px solid #eee",
						borderRadius: 6
					},
					children: categories.map((c) => {
						const isSelected = selected.includes(c.value);
						return /* @__PURE__ */ _jsxDEV("button", {
							onClick: () => toggleMOA(c.value),
							disabled: running,
							style: {
								padding: "0.35rem 0.7rem",
								fontSize: "0.78rem",
								borderRadius: 16,
								border: isSelected ? "1.5px solid #634697" : "1px solid #ccc",
								background: isSelected ? "#634697" : "#fafafa",
								color: isSelected ? "#fff" : "#333",
								cursor: running ? "not-allowed" : "pointer",
								fontWeight: c.is_group ? 600 : 400
							},
							title: `${c.drug_count} drug(s)`,
							children: c.category
						}, c.value, false, {
							fileName: _jsxFileName,
							lineNumber: 1023,
							columnNumber: 15
						}, this);
					})
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 1019,
					columnNumber: 9
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: "1rem",
						marginTop: "0.85rem"
					},
					children: [
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["Iterations:\xA0", /* @__PURE__ */ _jsxDEV("input", {
								type: "number",
								min: 50,
								max: 2e3,
								step: 50,
								value: nIterations,
								disabled: running,
								onChange: (e) => setNIterations(Math.max(50, Math.min(2e3, parseInt(e.target.value) || 500))),
								style: {
									width: 80,
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4
								}
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1048,
								columnNumber: 13
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1046,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["Trial set:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: trialSet,
								onChange: (e) => store.setState({ trialSet: e.target.value }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								title: "Use only the held-out testing trials, or include training trials too",
								children: [/* @__PURE__ */ _jsxDEV("option", {
									value: "testing",
									children: "Testing only"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1067,
									columnNumber: 15
								}, this), /* @__PURE__ */ _jsxDEV("option", {
									value: "all",
									children: "All (training + testing)"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1068,
									columnNumber: 15
								}, this)]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1061,
								columnNumber: 13
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1059,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["Aggregation:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: aggregation,
								onChange: (e) => setAggregation(e.target.value),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								title: "Per-trial: one point per trial. Per-therapy: one point per unique drug (mean ± SD across that drug's trials).",
								children: [/* @__PURE__ */ _jsxDEV("option", {
									value: "trial",
									children: "Per trial"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1079,
									columnNumber: 15
								}, this), /* @__PURE__ */ _jsxDEV("option", {
									value: "therapy",
									children: "Per therapy"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1080,
									columnNumber: 15
								}, this)]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1073,
								columnNumber: 13
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1071,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							title: "Show horizontal error bars (SD of observed rates across the therapy's trials). Per-therapy aggregation only.",
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showXErrors,
								onChange: (e) => setShowXErrors(e.target.checked),
								disabled: aggregation === "trial"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1087,
								columnNumber: 13
							}, this), "X error bars"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1083,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							title: "Show vertical error bars (SD of predicted rates).",
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showYErrors,
								onChange: (e) => setShowYErrors(e.target.checked)
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1099,
								columnNumber: 13
							}, this), "Y error bars"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1095,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("span", {
							style: {
								fontSize: "0.8rem",
								color: "#888"
							},
							children: [
								selected.length,
								" MOA",
								selected.length === 1 ? "" : "s",
								" selected"
							]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1106,
							columnNumber: 11
						}, this),
						/* @__PURE__ */ _jsxDEV("div", { style: { flex: 1 } }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1109,
							columnNumber: 11
						}, this),
						running ? /* @__PURE__ */ _jsxDEV("button", {
							onClick: handleCancel,
							style: {
								padding: "0.45rem 1rem",
								background: "#a12a8b",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: "pointer"
							},
							children: "Cancel"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1111,
							columnNumber: 13
						}, this) : /* @__PURE__ */ _jsxDEV("button", {
							onClick: handleRun,
							disabled: selected.length === 0,
							style: {
								padding: "0.45rem 1rem",
								background: selected.length === 0 ? "#bbb" : "#634697",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: selected.length === 0 ? "not-allowed" : "pointer",
								fontWeight: 600
							},
							children: "Run Correlation Analysis"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1118,
							columnNumber: 13
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1045,
					columnNumber: 9
				}, this)
			]
		}, void 0, true, {
			fileName: _jsxFileName,
			lineNumber: 989,
			columnNumber: 7
		}, this),
		results.length > 0 && /* @__PURE__ */ _jsxDEV("div", {
			style: {
				background: "#fff",
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: "1rem",
				marginBottom: "1rem"
			},
			children: [
				/* @__PURE__ */ _jsxDEV("h3", {
					style: {
						margin: "0 0 0.5rem",
						fontSize: "1rem"
					},
					children: "Bootstrap & plot controls"
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 1140,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("p", {
					style: {
						margin: "0 0 0.75rem",
						color: "#666",
						fontSize: "0.78rem",
						maxWidth: 900
					},
					children: [
						"Bootstrap resamples the ",
						aggregation === "therapy" ? "therapies" : "testing trials",
						" ",
						"currently on the plot to estimate confidence intervals around the correlation coefficients and to draw a CI band around the OLS fit line. Computation runs client-side — no backend call."
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1141,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: "0.9rem",
						marginBottom: "0.75rem"
					},
					children: [
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["Iterations B:\xA0", /* @__PURE__ */ _jsxDEV("input", {
								type: "number",
								min: 100,
								max: 1e4,
								step: 100,
								value: bootConfig.B,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ B: Math.max(100, Math.min(1e4, parseInt(e.target.value) || 2e3)) }),
								style: {
									width: 80,
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4
								}
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1152,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1150,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "How points are resampled each iteration. See docs.",
							children: ["Scheme:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: bootConfig.scheme,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ scheme: e.target.value }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								children: [
									/* @__PURE__ */ _jsxDEV("option", {
										value: "trial",
										children: "Trial resample (case bootstrap)"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1175,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: "simulation",
										children: "Simulation redraw (points fixed)"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1176,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: "nested",
										children: "Nested (trial + simulation)"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1177,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: "stratified",
										children: "Stratified by MOA"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1178,
										columnNumber: 17
									}, this)
								]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1169,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1166,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["CI level:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: bootConfig.ciLevel,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ ciLevel: parseFloat(e.target.value) }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								children: [
									/* @__PURE__ */ _jsxDEV("option", {
										value: .9,
										children: "90%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1190,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: .95,
										children: "95%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1191,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: .99,
										children: "99%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1192,
										columnNumber: 17
									}, this)
								]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1184,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1182,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "Percentile = sort & trim. BCa = bias-corrected + accelerated (more accurate for skewed distributions).",
							children: ["CI method:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: bootConfig.ciMethod,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ ciMethod: e.target.value }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								children: [/* @__PURE__ */ _jsxDEV("option", {
									value: "percentile",
									children: "Percentile"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1205,
									columnNumber: 17
								}, this), /* @__PURE__ */ _jsxDEV("option", {
									value: "bca",
									children: "BCa"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1206,
									columnNumber: 17
								}, this)]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1199,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1196,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "Curve fit used to draw the CI band. OLS = simple linear regression.",
							children: ["Band curve:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: bootConfig.curveType,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ curveType: e.target.value }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								children: [/* @__PURE__ */ _jsxDEV("option", {
									value: "ols",
									children: "OLS line"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1219,
									columnNumber: 17
								}, this), /* @__PURE__ */ _jsxDEV("option", {
									value: "none",
									children: "None (stats only)"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1220,
									columnNumber: 17
								}, this)]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1213,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1210,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "Blank = fresh seed each run. Any integer makes resampling reproducible.",
							children: ["Seed:\xA0", /* @__PURE__ */ _jsxDEV("input", {
								type: "text",
								value: bootConfig.seed,
								disabled: bootRunning,
								onChange: (e) => setBootConfig({ seed: e.target.value }),
								placeholder: "(random)",
								style: {
									width: 80,
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4
								}
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1227,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1224,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("span", {
							style: {
								fontSize: "0.78rem",
								color: "#888"
							},
							children: [
								bootPoints.length,
								" point",
								bootPoints.length === 1 ? "" : "s",
								" available"
							]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1237,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("div", { style: { flex: 1 } }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1241,
							columnNumber: 13
						}, this),
						bootResult && !bootRunning && /* @__PURE__ */ _jsxDEV("button", {
							onClick: handleBootClear,
							style: {
								padding: "0.4rem 0.9rem",
								background: "#fff",
								color: "#555",
								border: "1px solid #ccc",
								borderRadius: 4,
								cursor: "pointer",
								fontSize: "0.8rem"
							},
							children: "Clear"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1243,
							columnNumber: 15
						}, this),
						/* @__PURE__ */ _jsxDEV("button", {
							onClick: handleBootRun,
							disabled: bootRunning || bootPoints.length < 3,
							style: {
								padding: "0.45rem 1rem",
								background: bootRunning || bootPoints.length < 3 ? "#bbb" : "#057fa5",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: bootRunning || bootPoints.length < 3 ? "not-allowed" : "pointer",
								fontWeight: 600
							},
							children: bootRunning ? "Running…" : bootResult ? "Re-run bootstrap" : "Run bootstrap"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1250,
							columnNumber: 13
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1149,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						gap: "1rem",
						alignItems: "center",
						paddingTop: "0.6rem",
						borderTop: "1px solid #eee"
					},
					children: [
						/* @__PURE__ */ _jsxDEV("span", {
							style: {
								fontSize: "0.78rem",
								color: "#888",
								fontWeight: 600
							},
							children: "Show on plot:"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1268,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showPoints,
								onChange: (e) => store.setState({ showPoints: e.target.checked })
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1270,
								columnNumber: 15
							}, this), "Individual points"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1269,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showFitLine,
								onChange: (e) => store.setState({ showFitLine: e.target.checked }),
								disabled: !bootResult
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1278,
								columnNumber: 15
							}, this), "OLS fit line"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1277,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showBand,
								onChange: (e) => store.setState({ showBand: e.target.checked }),
								disabled: !bootResult
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1287,
								columnNumber: 15
							}, this), "CI band"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1286,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showRefLine,
								onChange: (e) => store.setState({ showRefLine: e.target.checked })
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1296,
								columnNumber: 15
							}, this), "y = x reference"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1295,
							columnNumber: 13
						}, this),
						!bootResult && /* @__PURE__ */ _jsxDEV("span", {
							style: {
								fontSize: "0.75rem",
								color: "#aaa"
							},
							children: "Run bootstrap to enable fit line & CI band."
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1304,
							columnNumber: 15
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1266,
					columnNumber: 11
				}, this)
			]
		}, void 0, true, {
			fileName: _jsxFileName,
			lineNumber: 1139,
			columnNumber: 9
		}, this),
		results.length > 0 && /* @__PURE__ */ _jsxDEV("div", {
			style: {
				background: "#fff",
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: "1rem",
				marginBottom: "1rem"
			},
			children: [
				/* @__PURE__ */ _jsxDEV("h3", {
					style: {
						margin: "0 0 0.5rem",
						fontSize: "1rem"
					},
					children: "Robustness analysis"
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 1315,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("p", {
					style: {
						margin: "0 0 0.75rem",
						color: "#666",
						fontSize: "0.78rem",
						maxWidth: 900
					},
					children: [
						"Sensitivity to individual points. ",
						/* @__PURE__ */ _jsxDEV("strong", { children: "Jackknife" }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1317,
							columnNumber: 47
						}, this),
						" recomputes Pearson r / Spearman ρ / the OLS slope with each point removed in turn — the influence plot shows how much each point moves r. ",
						/* @__PURE__ */ _jsxDEV("strong", { children: "Leave-k-out" }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1319,
							columnNumber: 67
						}, this),
						"randomly drops k points B times to show how much r swings under chunk removal. These answer \"does one trial carry the result?\" — complementary to the bootstrap CI."
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1316,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: "0.9rem",
						marginBottom: "0.75rem"
					},
					children: [
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "Number of points to randomly drop each iteration.",
							children: [
								"Leave k out:\xA0",
								/* @__PURE__ */ _jsxDEV("input", {
									type: "number",
									min: 1,
									max: Math.max(1, bootPoints.length - 3),
									step: 1,
									value: lkoConfig.k,
									disabled: robustnessRunning,
									onChange: (e) => setLkoConfig({ k: Math.max(1, Math.min(Math.max(1, bootPoints.length - 3), parseInt(e.target.value) || 1)) }),
									style: {
										width: 60,
										padding: "0.25rem 0.4rem",
										border: "1px solid #ccc",
										borderRadius: 4
									}
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1329,
									columnNumber: 15
								}, this),
								/* @__PURE__ */ _jsxDEV("span", {
									style: {
										color: "#aaa",
										marginLeft: 4
									},
									children: ["/ ", bootPoints.length]
								}, void 0, true, {
									fileName: _jsxFileName,
									lineNumber: 1346,
									columnNumber: 15
								}, this)
							]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1326,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["Iterations B:\xA0", /* @__PURE__ */ _jsxDEV("input", {
								type: "number",
								min: 100,
								max: 1e4,
								step: 100,
								value: lkoConfig.B,
								disabled: robustnessRunning,
								onChange: (e) => setLkoConfig({ B: Math.max(100, Math.min(1e4, parseInt(e.target.value) || 1e3)) }),
								style: {
									width: 80,
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4
								}
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1353,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1351,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							children: ["CI level:\xA0", /* @__PURE__ */ _jsxDEV("select", {
								value: lkoConfig.ciLevel,
								disabled: robustnessRunning,
								onChange: (e) => setLkoConfig({ ciLevel: parseFloat(e.target.value) }),
								style: {
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4,
									fontSize: "0.8rem"
								},
								children: [
									/* @__PURE__ */ _jsxDEV("option", {
										value: .9,
										children: "90%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1375,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: .95,
										children: "95%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1376,
										columnNumber: 17
									}, this),
									/* @__PURE__ */ _jsxDEV("option", {
										value: .99,
										children: "99%"
									}, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1377,
										columnNumber: 17
									}, this)
								]
							}, void 0, true, {
								fileName: _jsxFileName,
								lineNumber: 1369,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1367,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555"
							},
							title: "Blank = fresh seed each run. Any integer makes leave-k-out reproducible.",
							children: ["Seed:\xA0", /* @__PURE__ */ _jsxDEV("input", {
								type: "text",
								value: lkoConfig.seed,
								disabled: robustnessRunning,
								onChange: (e) => setLkoConfig({ seed: e.target.value }),
								placeholder: "(random)",
								style: {
									width: 80,
									padding: "0.25rem 0.4rem",
									border: "1px solid #ccc",
									borderRadius: 4
								}
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1384,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1381,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("label", {
							style: {
								fontSize: "0.8rem",
								color: "#555",
								display: "flex",
								alignItems: "center",
								gap: 4
							},
							title: "Show the per-point Δr bar chart below.",
							children: [/* @__PURE__ */ _jsxDEV("input", {
								type: "checkbox",
								checked: showInfluencePlot,
								onChange: (e) => store.setState({ showInfluencePlot: e.target.checked })
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1396,
								columnNumber: 15
							}, this), "Influence plot"]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1394,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("div", { style: { flex: 1 } }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1404,
							columnNumber: 13
						}, this),
						(jackknife || leaveKOut) && !robustnessRunning && /* @__PURE__ */ _jsxDEV("button", {
							onClick: handleRobClear,
							style: {
								padding: "0.4rem 0.9rem",
								background: "#fff",
								color: "#555",
								border: "1px solid #ccc",
								borderRadius: 4,
								cursor: "pointer",
								fontSize: "0.8rem"
							},
							children: "Clear"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1406,
							columnNumber: 15
						}, this),
						/* @__PURE__ */ _jsxDEV("button", {
							onClick: handleRobRun,
							disabled: robustnessRunning || bootPoints.length < 4,
							style: {
								padding: "0.45rem 1rem",
								background: robustnessRunning || bootPoints.length < 4 ? "#bbb" : "#00897b",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: robustnessRunning || bootPoints.length < 4 ? "not-allowed" : "pointer",
								fontWeight: 600
							},
							children: robustnessRunning ? "Running…" : jackknife || leaveKOut ? "Re-run robustness" : "Run robustness"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1413,
							columnNumber: 13
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1325,
					columnNumber: 11
				}, this),
				(jackknife || leaveKOut) && /* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
						gap: "0.5rem",
						marginTop: "0.5rem"
					},
					children: [
						jackknife && /* @__PURE__ */ _jsxDEV(_Fragment, { children: [
							/* @__PURE__ */ _jsxDEV(StatCell, {
								label: "max |Δr| (any one point)",
								value: jackknife.maxAbsDeltaR.toFixed(3),
								hint: "Largest swing in Pearson r from removing a single point."
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1435,
								columnNumber: 19
							}, this),
							/* @__PURE__ */ _jsxDEV(StatCell, {
								label: "max |Δρ|",
								value: jackknife.maxAbsDeltaRho.toFixed(3)
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1440,
								columnNumber: 19
							}, this),
							/* @__PURE__ */ _jsxDEV(StatCell, {
								label: "max |Δ slope|",
								value: jackknife.maxAbsDeltaSlope.toFixed(3)
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1444,
								columnNumber: 19
							}, this)
						] }, void 0, true),
						leaveKOut && leaveKOut.rRange && /* @__PURE__ */ _jsxDEV(StatCell, {
							label: `r range, leave-${leaveKOut.config.k}-out`,
							value: `[${leaveKOut.rRange[0].toFixed(3)}, ${leaveKOut.rRange[1].toFixed(3)}]`,
							hint: `Min / max r across ${leaveKOut.config.B} random k-drops.`
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1451,
							columnNumber: 17
						}, this),
						leaveKOut && leaveKOut.rCI && /* @__PURE__ */ _jsxDEV(StatCell, {
							label: `${Math.round(leaveKOut.config.ciLevel * 100)}% r band`,
							value: `[${leaveKOut.rCI[0].toFixed(3)}, ${leaveKOut.rCI[1].toFixed(3)}]`,
							hint: `Percentile band of r across k-drop resamples. Not a confidence interval — read as "if I dropped k random points, r usually lands here."`
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1458,
							columnNumber: 17
						}, this),
						leaveKOut && leaveKOut.rhoCI && /* @__PURE__ */ _jsxDEV(StatCell, {
							label: `${Math.round(leaveKOut.config.ciLevel * 100)}% ρ band`,
							value: `[${leaveKOut.rhoCI[0].toFixed(3)}, ${leaveKOut.rhoCI[1].toFixed(3)}]`
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1465,
							columnNumber: 17
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1432,
					columnNumber: 13
				}, this),
				jackknife && showInfluencePlot && jackknife.influence.length > 0 && /* @__PURE__ */ _jsxDEV("div", {
					style: { marginTop: "1rem" },
					children: [
						/* @__PURE__ */ _jsxDEV("h4", {
							style: {
								margin: "0 0 0.4rem",
								fontSize: "0.88rem"
							},
							children: "Influence plot — Δ Pearson r when each point is removed"
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1476,
							columnNumber: 15
						}, this),
						/* @__PURE__ */ _jsxDEV("p", {
							style: {
								margin: "0 0 0.5rem",
								color: "#888",
								fontSize: "0.72rem"
							},
							children: [
								"Bars above zero: removing that point ",
								/* @__PURE__ */ _jsxDEV("em", { children: "increases" }, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1480,
									columnNumber: 54
								}, this),
								" r (point was pulling r down). Bars below zero: removing that point ",
								/* @__PURE__ */ _jsxDEV("em", { children: "decreases" }, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1481,
									columnNumber: 54
								}, this),
								" r (point supports the correlation)."
							]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1479,
							columnNumber: 15
						}, this),
						/* @__PURE__ */ _jsxDEV("div", {
							ref: influenceRef,
							style: { width: "100%" }
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1483,
							columnNumber: 15
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1475,
					columnNumber: 13
				}, this)
			]
		}, void 0, true, {
			fileName: _jsxFileName,
			lineNumber: 1314,
			columnNumber: 9
		}, this),
		statuses.length > 0 && /* @__PURE__ */ _jsxDEV("div", {
			style: {
				background: "#fff",
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: "1rem",
				marginBottom: "1rem"
			},
			children: [/* @__PURE__ */ _jsxDEV("h3", {
				style: {
					margin: "0 0 0.5rem",
					fontSize: "0.95rem"
				},
				children: "Simulation Progress"
			}, void 0, false, {
				fileName: _jsxFileName,
				lineNumber: 1492,
				columnNumber: 11
			}, this), statuses.map((s) => /* @__PURE__ */ _jsxDEV("div", {
				style: {
					marginBottom: 6,
					fontSize: "0.8rem"
				},
				children: [
					/* @__PURE__ */ _jsxDEV("div", {
						style: {
							display: "flex",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ _jsxDEV("span", { children: [
							/* @__PURE__ */ _jsxDEV("strong", { children: s.moa_label }, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1496,
								columnNumber: 23
							}, this),
							" — ",
							/* @__PURE__ */ _jsxDEV("span", {
								style: { color: s.status === "complete" ? "#2e7d32" : s.status === "error" ? "#c62828" : "#555" },
								children: s.status
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1496,
								columnNumber: 56
							}, this),
							" ",
							s.stage && `(${s.stage})`
						] }, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1496,
							columnNumber: 17
						}, this), /* @__PURE__ */ _jsxDEV("span", {
							style: { color: "#888" },
							children: s.pct ? `${Math.round(s.pct)}%` : ""
						}, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1497,
							columnNumber: 17
						}, this)]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 1495,
						columnNumber: 15
					}, this),
					s.status !== "complete" && s.status !== "error" && /* @__PURE__ */ _jsxDEV("div", {
						style: {
							height: 4,
							background: "#eee",
							borderRadius: 2,
							overflow: "hidden",
							marginTop: 2
						},
						children: /* @__PURE__ */ _jsxDEV("div", { style: {
							width: `${s.pct || 0}%`,
							height: "100%",
							background: "#634697",
							transition: "width 0.3s"
						} }, void 0, false, {
							fileName: _jsxFileName,
							lineNumber: 1501,
							columnNumber: 19
						}, this)
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 1500,
						columnNumber: 17
					}, this),
					s.error && /* @__PURE__ */ _jsxDEV("div", {
						style: {
							color: "#c62828",
							fontSize: "0.75rem"
						},
						children: s.error
					}, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 1504,
						columnNumber: 27
					}, this)
				]
			}, s.moa_value, true, {
				fileName: _jsxFileName,
				lineNumber: 1494,
				columnNumber: 13
			}, this))]
		}, void 0, true, {
			fileName: _jsxFileName,
			lineNumber: 1491,
			columnNumber: 9
		}, this),
		results.length > 0 && /* @__PURE__ */ _jsxDEV("div", {
			style: {
				background: "#fff",
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: "1rem",
				marginBottom: "1rem"
			},
			children: [
				/* @__PURE__ */ _jsxDEV("h3", {
					style: {
						margin: "0 0 0.75rem",
						fontSize: "1rem"
					},
					children: "Correlation Plot"
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 1513,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
						gap: "0.5rem",
						marginBottom: "0.75rem"
					},
					children: [
						/* @__PURE__ */ _jsxDEV("div", {
							style: {
								textAlign: "center",
								padding: "0.5rem",
								background: "#f8f9fa",
								borderRadius: 6
							},
							children: [/* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "1.1rem",
									fontWeight: 700,
									color: "#1c3e72"
								},
								children: overallR.n
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1516,
								columnNumber: 15
							}, this), /* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "0.7rem",
									color: "#888"
								},
								children: aggregation === "therapy" ? "Therapies" : "Testing Trials"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1517,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1515,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("div", {
							style: {
								textAlign: "center",
								padding: "0.5rem",
								background: "#f8f9fa",
								borderRadius: 6
							},
							children: [/* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "1.1rem",
									fontWeight: 700,
									color: "#1c3e72"
								},
								children: overallR.r != null ? overallR.r.toFixed(3) : "—"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1520,
								columnNumber: 15
							}, this), /* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "0.7rem",
									color: "#888"
								},
								children: "Pearson r"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1521,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1519,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("div", {
							style: {
								textAlign: "center",
								padding: "0.5rem",
								background: "#f8f9fa",
								borderRadius: 6
							},
							children: [/* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "1.1rem",
									fontWeight: 700,
									color: "#1c3e72"
								},
								children: overallR.rho != null ? overallR.rho.toFixed(3) : "—"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1524,
								columnNumber: 15
							}, this), /* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "0.7rem",
									color: "#888"
								},
								children: "Spearman ρ"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1525,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1523,
							columnNumber: 13
						}, this),
						/* @__PURE__ */ _jsxDEV("div", {
							style: {
								textAlign: "center",
								padding: "0.5rem",
								background: "#f8f9fa",
								borderRadius: 6
							},
							children: [/* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "1.1rem",
									fontWeight: 700,
									color: "#1c3e72"
								},
								children: results.length
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1528,
								columnNumber: 15
							}, this), /* @__PURE__ */ _jsxDEV("div", {
								style: {
									fontSize: "0.7rem",
									color: "#888"
								},
								children: "MOA Groups"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1529,
								columnNumber: 15
							}, this)]
						}, void 0, true, {
							fileName: _jsxFileName,
							lineNumber: 1527,
							columnNumber: 13
						}, this)
					]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1514,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("div", {
					ref: plotRef,
					style: { width: "100%" }
				}, void 0, false, {
					fileName: _jsxFileName,
					lineNumber: 1532,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("h4", {
					style: {
						marginTop: "1rem",
						marginBottom: "0.5rem",
						fontSize: "0.9rem"
					},
					children: ["Per-MOA Correlations", bootResult && /* @__PURE__ */ _jsxDEV("span", {
						style: {
							fontWeight: 400,
							color: "#888",
							fontSize: "0.78rem",
							marginLeft: 8
						},
						children: [
							"(CIs from B = ",
							bootResult.config.B,
							", ",
							Math.round(bootResult.config.ciLevel * 100),
							"%",
							" ",
							bootResult.config.ciMethod === "bca" ? "BCa" : "percentile",
							")"
						]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 1538,
						columnNumber: 15
					}, this)]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1535,
					columnNumber: 11
				}, this),
				/* @__PURE__ */ _jsxDEV("table", {
					style: {
						width: "100%",
						borderCollapse: "collapse",
						fontSize: "0.8rem"
					},
					children: [/* @__PURE__ */ _jsxDEV("thead", { children: /* @__PURE__ */ _jsxDEV("tr", {
						style: { background: "#f0f0f0" },
						children: [
							/* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "left",
									padding: "0.4rem"
								},
								children: "MOA"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1547,
								columnNumber: 17
							}, this),
							/* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "right",
									padding: "0.4rem"
								},
								children: "n"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1548,
								columnNumber: 17
							}, this),
							/* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "right",
									padding: "0.4rem"
								},
								children: "Pearson r"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1549,
								columnNumber: 17
							}, this),
							bootResult && /* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "right",
									padding: "0.4rem"
								},
								children: "r CI"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1550,
								columnNumber: 32
							}, this),
							/* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "right",
									padding: "0.4rem"
								},
								children: "Spearman ρ"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1551,
								columnNumber: 17
							}, this),
							bootResult && /* @__PURE__ */ _jsxDEV("th", {
								style: {
									textAlign: "right",
									padding: "0.4rem"
								},
								children: "ρ CI"
							}, void 0, false, {
								fileName: _jsxFileName,
								lineNumber: 1552,
								columnNumber: 32
							}, this)
						]
					}, void 0, true, {
						fileName: _jsxFileName,
						lineNumber: 1546,
						columnNumber: 15
					}, this) }, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 1545,
						columnNumber: 13
					}, this), /* @__PURE__ */ _jsxDEV("tbody", { children: results.map((r, idx) => {
						const tlist = trialsFor(r);
						let xs;
						let ys;
						if (aggregation === "therapy") {
							const pts = aggregateByTherapy(tlist);
							xs = pts.map((p) => p.meanObs);
							ys = pts.map((p) => p.meanPred);
						} else {
							xs = tlist.map((t) => t.actual_response_rate);
							ys = tlist.map((t) => t.mean_predicted_rate);
						}
						const pr = pearson(xs, ys);
						const sr = spearman(xs, ys);
						const moaStats = bootResult ? bootResult.perMoa[r.moa_value] : null;
						const fmtCI = (ci) => ci ? `[${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]` : "—";
						return /* @__PURE__ */ _jsxDEV("tr", {
							style: { borderTop: "1px solid #eee" },
							children: [
								/* @__PURE__ */ _jsxDEV("td", {
									style: { padding: "0.4rem" },
									children: [/* @__PURE__ */ _jsxDEV("span", { style: {
										display: "inline-block",
										width: 10,
										height: 10,
										borderRadius: "50%",
										background: MOA_COLORS[idx % MOA_COLORS.length],
										marginRight: 6
									} }, void 0, false, {
										fileName: _jsxFileName,
										lineNumber: 1576,
										columnNumber: 23
									}, this), r.moa_category]
								}, void 0, true, {
									fileName: _jsxFileName,
									lineNumber: 1575,
									columnNumber: 21
								}, this),
								/* @__PURE__ */ _jsxDEV("td", {
									style: {
										textAlign: "right",
										padding: "0.4rem"
									},
									children: xs.length
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1582,
									columnNumber: 21
								}, this),
								/* @__PURE__ */ _jsxDEV("td", {
									style: {
										textAlign: "right",
										padding: "0.4rem"
									},
									children: pr != null ? pr.toFixed(3) : "—"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1583,
									columnNumber: 21
								}, this),
								bootResult && /* @__PURE__ */ _jsxDEV("td", {
									style: {
										textAlign: "right",
										padding: "0.4rem",
										color: "#666"
									},
									children: fmtCI(moaStats?.rCI)
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1585,
									columnNumber: 23
								}, this),
								/* @__PURE__ */ _jsxDEV("td", {
									style: {
										textAlign: "right",
										padding: "0.4rem"
									},
									children: sr != null ? sr.toFixed(3) : "—"
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1589,
									columnNumber: 21
								}, this),
								bootResult && /* @__PURE__ */ _jsxDEV("td", {
									style: {
										textAlign: "right",
										padding: "0.4rem",
										color: "#666"
									},
									children: fmtCI(moaStats?.rhoCI)
								}, void 0, false, {
									fileName: _jsxFileName,
									lineNumber: 1591,
									columnNumber: 23
								}, this)
							]
						}, r.moa_value, true, {
							fileName: _jsxFileName,
							lineNumber: 1574,
							columnNumber: 19
						}, this);
					}) }, void 0, false, {
						fileName: _jsxFileName,
						lineNumber: 1555,
						columnNumber: 13
					}, this)]
				}, void 0, true, {
					fileName: _jsxFileName,
					lineNumber: 1544,
					columnNumber: 11
				}, this)
			]
		}, void 0, true, {
			fileName: _jsxFileName,
			lineNumber: 1512,
			columnNumber: 9
		}, this)
	] }, void 0, true, {
		fileName: _jsxFileName,
		lineNumber: 978,
		columnNumber: 5
	}, this);
}
_s2(MOACorrelation, "OpcaQVERbBxCYVpLzq474RTSBbQ=", false, function() {
	return [useStore];
});
_c2 = MOACorrelation;
var _c, _c2;
$RefreshReg$(_c, "StatCell");
$RefreshReg$(_c2, "MOACorrelation");
import * as RefreshRuntime from "/@react-refresh";
const inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
import * as __vite_react_currentExports from "/src/pages/MOACorrelation.tsx";
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "@vitejs/plugin-react can't detect preamble. Something is wrong."
    );
  }

  const currentExports = __vite_react_currentExports;
  queueMicrotask(() => {
    RefreshRuntime.registerExportsForReactRefresh("F:/Master_Python_Scripts/CT_Collection_Threshold_Learning/frontend/src/pages/MOACorrelation.tsx", currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate("F:/Master_Python_Scripts/CT_Collection_Threshold_Learning/frontend/src/pages/MOACorrelation.tsx", currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
function $RefreshReg$(type, id) { return RefreshRuntime.register(type, "F:/Master_Python_Scripts/CT_Collection_Threshold_Learning/frontend/src/pages/MOACorrelation.tsx" + ' ' + id); }
function $RefreshSig$() { return RefreshRuntime.createSignatureFunctionForTransform(); }

//# sourceMappingURL=data:application/json;base64,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QUc7U0FBWTs7Ozs7UUFDdEUsd0JBQUMsTUFBRDtTQUFJLE9BQU87VUFBRSxXQUFXO1VBQVMsU0FBUztVQUFVO21CQUFHLE1BQU0sT0FBTyxHQUFHLFFBQVEsRUFBRSxHQUFHO1NBQVM7Ozs7O1FBQzVGLGNBQ0Msd0JBQUMsTUFBRDtTQUFJLE9BQU87VUFBRSxXQUFXO1VBQVMsU0FBUztVQUFVLE9BQU87VUFBUTttQkFDaEUsTUFBTSxVQUFVLElBQUk7U0FDbEI7Ozs7O1FBRVAsd0JBQUMsTUFBRDtTQUFJLE9BQU87VUFBRSxXQUFXO1VBQVMsU0FBUztVQUFVO21CQUFHLE1BQU0sT0FBTyxHQUFHLFFBQVEsRUFBRSxHQUFHO1NBQVM7Ozs7O1FBQzVGLGNBQ0Msd0JBQUMsTUFBRDtTQUFJLE9BQU87VUFBRSxXQUFXO1VBQVMsU0FBUztVQUFVLE9BQU87VUFBUTttQkFDaEUsTUFBTSxVQUFVLE1BQU07U0FDcEI7Ozs7O1FBRUo7U0FyQkksRUFBRTs7OztjQXFCTjtPQUVQLEVBQ0k7Ozs7Y0FDRjs7Ozs7O0lBQ0o7Ozs7OztFQUVKOzs7Ozs7OztFQUVUIiwibmFtZXMiOltdLCJzb3VyY2VzIjpbIk1PQUNvcnJlbGF0aW9uLnRzeCJdLCJ2ZXJzaW9uIjozLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB1c2VTdGF0ZSwgdXNlRWZmZWN0LCB1c2VSZWYsIHVzZVN5bmNFeHRlcm5hbFN0b3JlLCB1c2VNZW1vIH0gZnJvbSAncmVhY3QnO1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcbmltcG9ydCBQbG90bHkgZnJvbSAncGxvdGx5LmpzL2Rpc3QvcGxvdGx5Lm1pbi5qcyc7XG5pbXBvcnQge1xuICBwZWFyc29uLCBzcGVhcm1hbixcbiAgcnVuQm9vdHN0cmFwLCBtYXRlcmlhbGl6ZUJhbmQsIG1ha2VSbmcsIGdhdXNzaWFuLFxuICBydW5KYWNra25pZmUsIHJ1bkxlYXZlS091dCxcbiAgdHlwZSBCb290c3RyYXBDb25maWcsIHR5cGUgQm9vdHN0cmFwUmVzdWx0LCB0eXBlIEJvb3RzdHJhcElucHV0UG9pbnQsXG4gIHR5cGUgUmVzYW1wbGluZ1NjaGVtZSwgdHlwZSBDSU1ldGhvZCwgdHlwZSBDdXJ2ZVR5cGUsXG4gIHR5cGUgSmFja2tuaWZlUmVzdWx0LCB0eXBlIExlYXZlS091dFJlc3VsdCxcbn0gZnJvbSAnLi4vdXRpbHMvYm9vdHN0cmFwJztcblxuY29uc3QgYXBpID0gYXhpb3MuY3JlYXRlKHtcbiAgYmFzZVVSTDogaW1wb3J0Lm1ldGEuZW52LlZJVEVfQVBJX1VSTCB8fCAnaHR0cDovL2xvY2FsaG9zdDo4MDAwJyxcbn0pO1xuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIE1vZHVsZS1sZXZlbCBwZXJzaXN0ZW50IHN0b3JlXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIExpdmVzIG91dHNpZGUgUmVhY3QncyBjb21wb25lbnQgbGlmZWN5Y2xlIHNvIHRoZSBhbmFseXNpcyBrZWVwcyBydW5uaW5nXG4vLyBldmVuIHdoZW4gdGhlIHVzZXIgbmF2aWdhdGVzIGF3YXkgZnJvbSB0aGUgcGFnZS4gU3RhdGUgKGNvbmZpZyArIHByb2dyZXNzXG4vLyArIHJlc3VsdHMpIGlzIGFsc28gbWlycm9yZWQgdG8gc2Vzc2lvblN0b3JhZ2Ugc28gYSBoYXJkIHJlZnJlc2ggcmVzdG9yZXNcbi8vIHRoZSBpbi1mbGlnaHQgb3IgY29tcGxldGVkIGFuYWx5c2lzIGFzIGxvbmcgYXMgdGhlIEFQSSBzZXJ2ZXIgaXMgdXAuXG5cbmNvbnN0IFNUT1JBR0VfS0VZID0gJ21vYV9jb3JyZWxhdGlvbl9zdGF0ZV92MSc7XG5cbnR5cGUgVHJpYWxTZXQgPSAndGVzdGluZycgfCAnYWxsJztcblxuaW50ZXJmYWNlIEJvb3RzdHJhcFVJQ29uZmlnIHtcbiAgQjogbnVtYmVyO1xuICBzY2hlbWU6IFJlc2FtcGxpbmdTY2hlbWU7XG4gIGNpTGV2ZWw6IG51bWJlcjtcbiAgY2lNZXRob2Q6IENJTWV0aG9kO1xuICBjdXJ2ZVR5cGU6IEN1cnZlVHlwZTtcbiAgc2VlZDogc3RyaW5nOyAgIC8vIGtlcHQgYXMgc3RyaW5nIHNvIGJsYW5rID0gdW5kZWZpbmVkXG59XG5cbmludGVyZmFjZSBMZWF2ZUtPdXRVSUNvbmZpZyB7XG4gIGs6IG51bWJlcjtcbiAgQjogbnVtYmVyO1xuICBjaUxldmVsOiBudW1iZXI7XG4gIHNlZWQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFN0b3JlU3RhdGUge1xuICBzZWxlY3RlZDogc3RyaW5nW107XG4gIG5JdGVyYXRpb25zOiBudW1iZXI7XG4gIHRyaWFsU2V0OiBUcmlhbFNldDtcbiAgcnVubmluZzogYm9vbGVhbjtcbiAgc3RhdHVzZXM6IFJ1blN0YXR1c1tdO1xuICByZXN1bHRzOiBNT0FSZXN1bHRbXTtcbiAgLy8gQm9vdHN0cmFwIHBhbmVsXG4gIGJvb3RDb25maWc6IEJvb3RzdHJhcFVJQ29uZmlnO1xuICBib290UmVzdWx0OiBCb290c3RyYXBSZXN1bHQgfCBudWxsO1xuICBib290UnVubmluZzogYm9vbGVhbjtcbiAgLy8gUm9idXN0bmVzcyBwYW5lbFxuICBsa29Db25maWc6IExlYXZlS091dFVJQ29uZmlnO1xuICBqYWNra25pZmU6IEphY2trbmlmZVJlc3VsdCB8IG51bGw7XG4gIGxlYXZlS091dDogTGVhdmVLT3V0UmVzdWx0IHwgbnVsbDtcbiAgcm9idXN0bmVzc1J1bm5pbmc6IGJvb2xlYW47XG4gIHNob3dJbmZsdWVuY2VQbG90OiBib29sZWFuO1xuICAvLyBQbG90IGRpc3BsYXkgdG9nZ2xlc1xuICBzaG93UG9pbnRzOiBib29sZWFuO1xuICBzaG93Rml0TGluZTogYm9vbGVhbjtcbiAgc2hvd0JhbmQ6IGJvb2xlYW47XG4gIHNob3dSZWZMaW5lOiBib29sZWFuO1xufVxuXG5jb25zdCBkZWZhdWx0Qm9vdENvbmZpZzogQm9vdHN0cmFwVUlDb25maWcgPSB7XG4gIEI6IDIwMDAsXG4gIHNjaGVtZTogJ25lc3RlZCcsXG4gIGNpTGV2ZWw6IDAuOTUsXG4gIGNpTWV0aG9kOiAncGVyY2VudGlsZScsXG4gIGN1cnZlVHlwZTogJ29scycsXG4gIHNlZWQ6ICcnLFxufTtcblxuY29uc3QgZGVmYXVsdExrb0NvbmZpZzogTGVhdmVLT3V0VUlDb25maWcgPSB7XG4gIGs6IDMsXG4gIEI6IDEwMDAsXG4gIGNpTGV2ZWw6IDAuOTUsXG4gIHNlZWQ6ICcnLFxufTtcblxuY29uc3QgZGVmYXVsdFN0YXRlOiBTdG9yZVN0YXRlID0ge1xuICBzZWxlY3RlZDogW10sXG4gIG5JdGVyYXRpb25zOiA1MDAsXG4gIHRyaWFsU2V0OiAndGVzdGluZycsXG4gIHJ1bm5pbmc6IGZhbHNlLFxuICBzdGF0dXNlczogW10sXG4gIHJlc3VsdHM6IFtdLFxuICBib290Q29uZmlnOiBkZWZhdWx0Qm9vdENvbmZpZyxcbiAgYm9vdFJlc3VsdDogbnVsbCxcbiAgYm9vdFJ1bm5pbmc6IGZhbHNlLFxuICBsa29Db25maWc6IGRlZmF1bHRMa29Db25maWcsXG4gIGphY2trbmlmZTogbnVsbCxcbiAgbGVhdmVLT3V0OiBudWxsLFxuICByb2J1c3RuZXNzUnVubmluZzogZmFsc2UsXG4gIHNob3dJbmZsdWVuY2VQbG90OiB0cnVlLFxuICBzaG93UG9pbnRzOiB0cnVlLFxuICBzaG93Rml0TGluZTogdHJ1ZSxcbiAgc2hvd0JhbmQ6IHRydWUsXG4gIHNob3dSZWZMaW5lOiB0cnVlLFxufTtcblxuY29uc3QgbG9hZEluaXRpYWwgPSAoKTogU3RvcmVTdGF0ZSA9PiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmF3ID0gc2Vzc2lvblN0b3JhZ2UuZ2V0SXRlbShTVE9SQUdFX0tFWSk7XG4gICAgaWYgKCFyYXcpIHJldHVybiBkZWZhdWx0U3RhdGU7XG4gICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xuICAgIC8vIFJlc2V0IGBydW5uaW5nYCBvbiBjb2xkIGxvYWQg4oCUIGlmIHRoZSBwYWdlIHdhcyBpbiBmbGlnaHQsIHRoZSBwb2xsaW5nXG4gICAgLy8gbG9vcCBpbiB0aGlzIG1vZHVsZSBpcyBnb25lIGFmdGVyIGEgaGFyZCByZWZyZXNoLlxuICAgIHJldHVybiB7IC4uLmRlZmF1bHRTdGF0ZSwgLi4ucGFyc2VkLCBydW5uaW5nOiBmYWxzZSwgcm9idXN0bmVzc1J1bm5pbmc6IGZhbHNlIH07XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBkZWZhdWx0U3RhdGU7XG4gIH1cbn07XG5cbmNvbnN0IHN0b3JlID0ge1xuICBzdGF0ZTogbG9hZEluaXRpYWwoKSxcbiAgbGlzdGVuZXJzOiBuZXcgU2V0PCgpID0+IHZvaWQ+KCksXG4gIGNhbmNlbDogZmFsc2UsXG4gIGFjdGl2ZVNpbUlkczogbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKSwgLy8gbW9hX3ZhbHVlIC0+IHNpbV9pZCAoZm9yIHJlc3VtZSBwb2xsaW5nKVxuXG4gIHN1YnNjcmliZShmbjogKCkgPT4gdm9pZCkge1xuICAgIHN0b3JlLmxpc3RlbmVycy5hZGQoZm4pO1xuICAgIHJldHVybiAoKSA9PiBzdG9yZS5saXN0ZW5lcnMuZGVsZXRlKGZuKTtcbiAgfSxcbiAgZ2V0U25hcHNob3QoKSB7XG4gICAgcmV0dXJuIHN0b3JlLnN0YXRlO1xuICB9LFxuICBzZXRTdGF0ZShwYXRjaDogUGFydGlhbDxTdG9yZVN0YXRlPiB8ICgoczogU3RvcmVTdGF0ZSkgPT4gUGFydGlhbDxTdG9yZVN0YXRlPikpIHtcbiAgICBjb25zdCBuZXh0ID0gdHlwZW9mIHBhdGNoID09PSAnZnVuY3Rpb24nID8gcGF0Y2goc3RvcmUuc3RhdGUpIDogcGF0Y2g7XG4gICAgc3RvcmUuc3RhdGUgPSB7IC4uLnN0b3JlLnN0YXRlLCAuLi5uZXh0IH07XG4gICAgdHJ5IHtcbiAgICAgIHNlc3Npb25TdG9yYWdlLnNldEl0ZW0oU1RPUkFHRV9LRVksIEpTT04uc3RyaW5naWZ5KHN0b3JlLnN0YXRlKSk7XG4gICAgfSBjYXRjaCB7IC8qIHF1b3RhIG9yIGRpc2FibGVkICovIH1cbiAgICBzdG9yZS5saXN0ZW5lcnMuZm9yRWFjaCgobCkgPT4gbCgpKTtcbiAgfSxcbn07XG5cbmNvbnN0IHVzZVN0b3JlID0gKCk6IFN0b3JlU3RhdGUgPT5cbiAgdXNlU3luY0V4dGVybmFsU3RvcmUoc3RvcmUuc3Vic2NyaWJlLCBzdG9yZS5nZXRTbmFwc2hvdCwgc3RvcmUuZ2V0U25hcHNob3QpO1xuXG5pbnRlcmZhY2UgTU9BQ2F0ZWdvcnkge1xuICBjYXRlZ29yeTogc3RyaW5nO1xuICB2YWx1ZTogc3RyaW5nO1xuICBkcnVnX2NvdW50OiBudW1iZXI7XG4gIGlzX2dyb3VwOiBib29sZWFuO1xuICBsYWJlbD86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFRlc3RpbmdUcmlhbCB7XG4gIG5jdF9pZDogc3RyaW5nO1xuICB0aXRsZT86IHN0cmluZztcbiAgYWN0dWFsX3Jlc3BvbnNlX3JhdGU6IG51bWJlcjtcbiAgbWVhbl9wcmVkaWN0ZWRfcmF0ZTogbnVtYmVyO1xuICBzdGRfcHJlZGljdGVkX3JhdGU6IG51bWJlcjtcbiAgZHJ1Z3M/OiBzdHJpbmdbXTtcbiAgLy8gT3B0aW9uYWwgcGVyLWl0ZXJhdGlvbiBzaW11bGF0aW9uIHZhbHVlcyAobGVuZ3RoIH4gbl9pdGVyYXRpb25zKS5cbiAgLy8gV2hlbiBwcmVzZW50LCBib290c3RyYXAgXCJzaW11bGF0aW9uXCIgLyBcIm5lc3RlZFwiIHNjaGVtZXMgZHJhdyBmcm9tIHRoaXNcbiAgLy8gYXJyYXkgaW5zdGVhZCBvZiBhIEdhdXNzaWFuIGFwcHJveGltYXRpb24gYXJvdW5kIChtZWFuLCBzdGQpLlxuICBmcmFjdGlvbnNfYWJvdmVfdGhyZXNob2xkPzogbnVtYmVyW107XG59XG5cbnR5cGUgQWdncmVnYXRpb24gPSAndHJpYWwnIHwgJ3RoZXJhcHknO1xuXG4vLyBNaW5pbWFsIGRydWctbmFtZSBjYW5vbmljYWxpemF0aW9uOiBsb3dlcmNhc2UgKyBzdHJpcCBjb21tb24gc2FsdCBzdWZmaXhlc1xuLy8gc28gXCJMYXBhdGluaWIgRGl0b3N5bGF0ZVwiIGNvbGxhcHNlcyB3aXRoIFwiTGFwYXRpbmliXCIgZm9yIGdyb3VwaW5nLlxuY29uc3QgU0FMVF9TVUZGSVhFUyA9IFtcbiAgJ2h5ZHJvY2hsb3JpZGUnLCAnZGloeWRyb2NobG9yaWRlJywgJ2hjbCcsXG4gICdzdWxmYXRlJywgJ3N1bHBoYXRlJywgJ2Jpc3VsZmF0ZScsXG4gICdtZXN5bGF0ZScsICdkaW1lc3lsYXRlJywgJ3Rvc3lsYXRlJywgJ2RpdG9zeWxhdGUnLFxuICAnYmVzeWxhdGUnLCAnYmVzaWxhdGUnLCAnY2Ftc3lsYXRlJywgJ2lzZXRoaW9uYXRlJyxcbiAgJ21hbGVhdGUnLCAnZnVtYXJhdGUnLCAnY2l0cmF0ZScsICd0YXJ0cmF0ZScsICdzdWNjaW5hdGUnLFxuICAnYWNldGF0ZScsICdwaG9zcGhhdGUnLCAnbml0cmF0ZScsXG4gICdzb2RpdW0nLCAncG90YXNzaXVtJywgJ2NhbGNpdW0nLCAnbWFnbmVzaXVtJywgJ21lZ2x1bWluZScsXG4gICdicm9taWRlJywgJ2NobG9yaWRlJywgJ2lvZGlkZScsICdmbHVvcmlkZScsXG4gICdoZW1paHlkcmF0ZScsICdtb25vaHlkcmF0ZScsICdkaWh5ZHJhdGUnLCAndHJpaHlkcmF0ZScsICdwZW50YWh5ZHJhdGUnLFxuXTtcbmZ1bmN0aW9uIGNhbm9uaWNhbGl6ZURydWcocmF3OiBzdHJpbmcpOiB7IGtleTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0ge1xuICBjb25zdCBiYXNlID0gKHJhdyB8fCAnJykudHJpbSgpO1xuICBpZiAoIWJhc2UpIHJldHVybiB7IGtleTogJycsIGxhYmVsOiAnJyB9O1xuICBsZXQgd29yZHMgPSBiYXNlLnNwbGl0KC9cXHMrLyk7XG4gIHdoaWxlICh3b3Jkcy5sZW5ndGggPiAxKSB7XG4gICAgY29uc3QgbGFzdCA9IHdvcmRzW3dvcmRzLmxlbmd0aCAtIDFdLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXpdL2csICcnKTtcbiAgICBpZiAoU0FMVF9TVUZGSVhFUy5pbmNsdWRlcyhsYXN0KSkgd29yZHMucG9wKCk7XG4gICAgZWxzZSBicmVhaztcbiAgfVxuICBjb25zdCBsYWJlbCA9IHdvcmRzLm1hcCgodykgPT4gdy5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHcuc2xpY2UoMSkudG9Mb3dlckNhc2UoKSkuam9pbignICcpO1xuICByZXR1cm4geyBrZXk6IGxhYmVsLnRvTG93ZXJDYXNlKCksIGxhYmVsIH07XG59XG5cbmludGVyZmFjZSBNT0FSZXN1bHQge1xuICBtb2FfY2F0ZWdvcnk6IHN0cmluZztcbiAgbW9hX3ZhbHVlOiBzdHJpbmc7XG4gIHRlc3RpbmdfdHJpYWxzOiBUZXN0aW5nVHJpYWxbXTtcbiAgdHJhaW5pbmdfdHJpYWxzOiBUZXN0aW5nVHJpYWxbXTtcbiAgZXhjbHVkZWRfbmN0X2lkczogc3RyaW5nW107XG59XG5cbmludGVyZmFjZSBSdW5TdGF0dXMge1xuICBtb2FfdmFsdWU6IHN0cmluZztcbiAgbW9hX2xhYmVsOiBzdHJpbmc7XG4gIHN0YXR1czogJ3F1ZXVlZCcgfCAncnVubmluZycgfCAnY29tcGxldGUnIHwgJ2Vycm9yJztcbiAgc3RhZ2U/OiBzdHJpbmc7XG4gIGRldGFpbD86IHN0cmluZztcbiAgcGN0PzogbnVtYmVyO1xuICBlcnJvcj86IHN0cmluZztcbn1cblxuLy8gTU9BLWRpc3RpbmN0IGNvbG9ycyAoU3lnbm9taWNzLWxlYW5pbmcgcGFsZXR0ZSlcbmNvbnN0IE1PQV9DT0xPUlMgPSBbXG4gICcjNjM0Njk3JywgJyNhMTJhOGInLCAnIzA1N2ZhNScsICcjMWMzZTcyJywgJyMyYzYzOWUnLFxuICAnI2MyMTg1YicsICcjMDA4OTdiJywgJyNmNTdjMDAnLCAnIzVlMzViMScsICcjNDNhMDQ3Jyxcbl07XG5cbi8vIFNtYWxsIHN0YXQgY2FsbG91dCB1c2VkIGluIHRoZSByb2J1c3RuZXNzIHN1bW1hcnkgZ3JpZC5cbmZ1bmN0aW9uIFN0YXRDZWxsKHByb3BzOiB7IGxhYmVsOiBzdHJpbmc7IHZhbHVlOiBzdHJpbmc7IGhpbnQ/OiBzdHJpbmcgfSkge1xuICByZXR1cm4gKFxuICAgIDxkaXZcbiAgICAgIHN0eWxlPXt7XG4gICAgICAgIHBhZGRpbmc6ICcwLjVyZW0gMC42cmVtJyxcbiAgICAgICAgYmFja2dyb3VuZDogJyNmOGY5ZmEnLFxuICAgICAgICBib3JkZXJSYWRpdXM6IDYsXG4gICAgICAgIGJvcmRlcjogJzFweCBzb2xpZCAjZWVlJyxcbiAgICAgIH19XG4gICAgICB0aXRsZT17cHJvcHMuaGludH1cbiAgICA+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMC45MnJlbScsIGZvbnRXZWlnaHQ6IDcwMCwgY29sb3I6ICcjMWMzZTcyJyB9fT5cbiAgICAgICAge3Byb3BzLnZhbHVlfVxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMC42OHJlbScsIGNvbG9yOiAnIzg4OCcsIG1hcmdpblRvcDogMiB9fT5cbiAgICAgICAge3Byb3BzLmxhYmVsfVxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG4gICk7XG59XG5cbi8vIChTdGF0cyBoZWxwZXJzIGBwZWFyc29uYCwgYHNwZWFybWFuYCwgYG9sc0ZpdGAsIGJvb3RzdHJhcCBjb3JlIGltcG9ydGVkIGZyb21cbi8vICAuLi91dGlscy9ib290c3RyYXApXG5cbi8vIE1vZHVsZS1sZXZlbCBydW4gbG9vcC4gTGl2ZXMgb3V0c2lkZSBSZWFjdCBsaWZlY3ljbGUgc28gbGVhdmluZyB0aGUgcGFnZVxuLy8gZG9lcyBub3Qgc3RvcCBvciByZXNldCB0aGUgYW5hbHlzaXMuXG5hc3luYyBmdW5jdGlvbiBydW5BbmFseXNpcyhcbiAgY2F0ZWdvcnlMb29rdXA6ICh2OiBzdHJpbmcpID0+IHN0cmluZyxcbiAgc2VsZWN0ZWRTbmFwc2hvdDogc3RyaW5nW10sXG4gIG5JdGVyYXRpb25zOiBudW1iZXIsXG4pIHtcbiAgaWYgKHN0b3JlLnN0YXRlLnJ1bm5pbmcgfHwgc2VsZWN0ZWRTbmFwc2hvdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgc3RvcmUuY2FuY2VsID0gZmFsc2U7XG4gIHN0b3JlLmFjdGl2ZVNpbUlkcy5jbGVhcigpO1xuXG4gIGNvbnN0IGluaXRpYWw6IFJ1blN0YXR1c1tdID0gc2VsZWN0ZWRTbmFwc2hvdC5tYXAoKHZhbHVlKSA9PiAoe1xuICAgIG1vYV92YWx1ZTogdmFsdWUsXG4gICAgbW9hX2xhYmVsOiBjYXRlZ29yeUxvb2t1cCh2YWx1ZSksXG4gICAgc3RhdHVzOiAncXVldWVkJyBhcyBjb25zdCxcbiAgfSkpO1xuICBzdG9yZS5zZXRTdGF0ZSh7IHJ1bm5pbmc6IHRydWUsIHN0YXR1c2VzOiBpbml0aWFsLCByZXN1bHRzOiBbXSB9KTtcblxuICBjb25zdCBjb2xsZWN0ZWQ6IE1PQVJlc3VsdFtdID0gW107XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3RlZFNuYXBzaG90Lmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKHN0b3JlLmNhbmNlbCkgYnJlYWs7XG4gICAgY29uc3QgdmFsdWUgPSBzZWxlY3RlZFNuYXBzaG90W2ldO1xuICAgIGNvbnN0IGxhYmVsID0gaW5pdGlhbFtpXS5tb2FfbGFiZWw7XG4gICAgdHJ5IHtcbiAgICAgIHN0b3JlLnNldFN0YXRlKChzKSA9PiAoe1xuICAgICAgICBzdGF0dXNlczogcy5zdGF0dXNlcy5tYXAoKHN0LCBpZHgpID0+XG4gICAgICAgICAgaWR4ID09PSBpID8geyAuLi5zdCwgc3RhdHVzOiAncnVubmluZycsIHN0YWdlOiAnc3RhcnRpbmfigKYnLCBwY3Q6IDAgfSA6IHN0XG4gICAgICAgICksXG4gICAgICB9KSk7XG4gICAgICBjb25zdCBzdGFydFJlc3AgPSBhd2FpdCBhcGkucG9zdCgnL3NpbXVsYXRpb24vbW9hLXJ1bicsIHtcbiAgICAgICAgbW9hX2NhdGVnb3J5OiB2YWx1ZSxcbiAgICAgICAgbl9pdGVyYXRpb25zOiBuSXRlcmF0aW9ucyxcbiAgICAgICAgc2F2ZV9wbG90czogZmFsc2UsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHNpbUlkOiBzdHJpbmcgPSBzdGFydFJlc3AuZGF0YS5zaW1faWQ7XG4gICAgICBzdG9yZS5hY3RpdmVTaW1JZHMuc2V0KHZhbHVlLCBzaW1JZCk7XG5cbiAgICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgICB3aGlsZSAoIWRvbmUpIHtcbiAgICAgICAgaWYgKHN0b3JlLmNhbmNlbCkgYnJlYWs7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyKSA9PiBzZXRUaW1lb3V0KHIsIDE1MDApKTtcbiAgICAgICAgY29uc3QgeyBkYXRhIH0gPSBhd2FpdCBhcGkuZ2V0KGAvc2ltdWxhdGlvbi9tb2Etc3RhdHVzLyR7c2ltSWR9YCk7XG4gICAgICAgIHN0b3JlLnNldFN0YXRlKChzKSA9PiAoe1xuICAgICAgICAgIHN0YXR1c2VzOiBzLnN0YXR1c2VzLm1hcCgoc3QsIGlkeCkgPT5cbiAgICAgICAgICAgIGlkeCA9PT0gaVxuICAgICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgICAgIC4uLnN0LFxuICAgICAgICAgICAgICAgICAgc3RhdHVzOiBkYXRhLnN0YXR1cyxcbiAgICAgICAgICAgICAgICAgIHN0YWdlOiBkYXRhLnN0YWdlLFxuICAgICAgICAgICAgICAgICAgZGV0YWlsOiBkYXRhLmRldGFpbCxcbiAgICAgICAgICAgICAgICAgIHBjdDogZGF0YS5wcm9ncmVzc19wY3QsXG4gICAgICAgICAgICAgICAgICBlcnJvcjogZGF0YS5lcnJvcixcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIDogc3RcbiAgICAgICAgICApLFxuICAgICAgICB9KSk7XG4gICAgICAgIGlmIChkYXRhLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJyAmJiBkYXRhLnJlc3VsdCkge1xuICAgICAgICAgIGNvbnN0IGV4Y2x1ZGVkOiBzdHJpbmdbXSA9IChkYXRhLnJlc3VsdC5leGNsdWRlZF90cmlhbHMgfHwgW10pXG4gICAgICAgICAgICAubWFwKCh0OiBhbnkpID0+IHQubmN0X2lkKVxuICAgICAgICAgICAgLmZpbHRlcigoczogYW55KSA9PiB0eXBlb2YgcyA9PT0gJ3N0cmluZycpO1xuICAgICAgICAgIGNvbnN0IGV4Y2x1ZGVkU2V0ID0gbmV3IFNldChleGNsdWRlZCk7XG4gICAgICAgICAgY29uc3QgZmlsdCA9IChhcnI6IGFueVtdKTogVGVzdGluZ1RyaWFsW10gPT5cbiAgICAgICAgICAgIChhcnIgfHwgW10pXG4gICAgICAgICAgICAgIC5maWx0ZXIoXG4gICAgICAgICAgICAgICAgKHQ6IGFueSkgPT5cbiAgICAgICAgICAgICAgICAgIHR5cGVvZiB0LmFjdHVhbF9yZXNwb25zZV9yYXRlID09PSAnbnVtYmVyJyAmJlxuICAgICAgICAgICAgICAgICAgdHlwZW9mIHQubWVhbl9wcmVkaWN0ZWRfcmF0ZSA9PT0gJ251bWJlcicgJiZcbiAgICAgICAgICAgICAgICAgICFleGNsdWRlZFNldC5oYXModC5uY3RfaWQpXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgLm1hcCgodDogYW55KSA9PiAoe1xuICAgICAgICAgICAgICAgIG5jdF9pZDogdC5uY3RfaWQsXG4gICAgICAgICAgICAgICAgdGl0bGU6IHQudGl0bGUsXG4gICAgICAgICAgICAgICAgYWN0dWFsX3Jlc3BvbnNlX3JhdGU6IHQuYWN0dWFsX3Jlc3BvbnNlX3JhdGUsXG4gICAgICAgICAgICAgICAgbWVhbl9wcmVkaWN0ZWRfcmF0ZTogdC5tZWFuX3ByZWRpY3RlZF9yYXRlLFxuICAgICAgICAgICAgICAgIHN0ZF9wcmVkaWN0ZWRfcmF0ZTogdC5zdGRfcHJlZGljdGVkX3JhdGUgfHwgMCxcbiAgICAgICAgICAgICAgICBkcnVnczogQXJyYXkuaXNBcnJheSh0LmRydWdzKSA/IHQuZHJ1Z3MgOiBbXSxcbiAgICAgICAgICAgICAgICBmcmFjdGlvbnNfYWJvdmVfdGhyZXNob2xkOiBBcnJheS5pc0FycmF5KHQuZnJhY3Rpb25zX2Fib3ZlX3RocmVzaG9sZClcbiAgICAgICAgICAgICAgICAgID8gKHQuZnJhY3Rpb25zX2Fib3ZlX3RocmVzaG9sZCBhcyBudW1iZXJbXSlcbiAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgY29sbGVjdGVkLnB1c2goe1xuICAgICAgICAgICAgbW9hX2NhdGVnb3J5OiBkYXRhLnJlc3VsdC5tb2FfY2F0ZWdvcnkgfHwgbGFiZWwsXG4gICAgICAgICAgICBtb2FfdmFsdWU6IHZhbHVlLFxuICAgICAgICAgICAgdGVzdGluZ190cmlhbHM6IGZpbHQoZGF0YS5yZXN1bHQudGVzdGluZ190cmlhbHMpLFxuICAgICAgICAgICAgdHJhaW5pbmdfdHJpYWxzOiBmaWx0KGRhdGEucmVzdWx0LnRyYWluaW5nX3RyaWFscyksXG4gICAgICAgICAgICBleGNsdWRlZF9uY3RfaWRzOiBleGNsdWRlZCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdG9yZS5zZXRTdGF0ZSh7IHJlc3VsdHM6IFsuLi5jb2xsZWN0ZWRdIH0pO1xuICAgICAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKGRhdGEuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgICAgICAgZG9uZSA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIHN0b3JlLnNldFN0YXRlKChzKSA9PiAoe1xuICAgICAgICBzdGF0dXNlczogcy5zdGF0dXNlcy5tYXAoKHN0LCBpZHgpID0+XG4gICAgICAgICAgaWR4ID09PSBpID8geyAuLi5zdCwgc3RhdHVzOiAnZXJyb3InLCBlcnJvcjogU3RyaW5nKGU/Lm1lc3NhZ2UgfHwgZSkgfSA6IHN0XG4gICAgICAgICksXG4gICAgICB9KSk7XG4gICAgfVxuICB9XG4gIHN0b3JlLnNldFN0YXRlKHsgcnVubmluZzogZmFsc2UgfSk7XG59XG5cbmZ1bmN0aW9uIGNhbmNlbEFuYWx5c2lzKCkge1xuICBzdG9yZS5jYW5jZWwgPSB0cnVlO1xuICBzdG9yZS5zZXRTdGF0ZSh7IHJ1bm5pbmc6IGZhbHNlIH0pO1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEJvb3RzdHJhcCBydW5uZXJcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gT3BlcmF0ZXMgb24gYWxyZWFkeS1sb2FkZWQgYHJlc3VsdHNgLiBSdW5zIG9uIHRoZSBtYWluIHRocmVhZCBpbiBhIHNpbmdsZVxuLy8gc3luY2hyb25vdXMgY2FsbDsgZm9yIHRoZSBCIHZhbHVlcyB3ZSBleHBvc2UgdGhpcyBmaW5pc2hlcyBpbiA8MXMuXG5mdW5jdGlvbiBydW5Cb290c3RyYXBBbmFseXNpcyhwb2ludHM6IEJvb3RzdHJhcElucHV0UG9pbnRbXSwgdWlDZmc6IEJvb3RzdHJhcFVJQ29uZmlnKSB7XG4gIGlmIChzdG9yZS5zdGF0ZS5ib290UnVubmluZykgcmV0dXJuO1xuICBpZiAocG9pbnRzLmxlbmd0aCA8IDMpIHtcbiAgICBzdG9yZS5zZXRTdGF0ZSh7IGJvb3RSZXN1bHQ6IG51bGwgfSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNlZWROdW0gPSB1aUNmZy5zZWVkLnRyaW0oKSA9PT0gJycgPyB1bmRlZmluZWQgOiBOdW1iZXIodWlDZmcuc2VlZCk7XG4gIGNvbnN0IGNmZzogQm9vdHN0cmFwQ29uZmlnID0ge1xuICAgIEI6IHVpQ2ZnLkIsXG4gICAgc2NoZW1lOiB1aUNmZy5zY2hlbWUsXG4gICAgY2lMZXZlbDogdWlDZmcuY2lMZXZlbCxcbiAgICBjaU1ldGhvZDogdWlDZmcuY2lNZXRob2QsXG4gICAgY3VydmVUeXBlOiB1aUNmZy5jdXJ2ZVR5cGUsXG4gICAgc2VlZDogTnVtYmVyLmlzRmluaXRlKHNlZWROdW0pID8gKHNlZWROdW0gYXMgbnVtYmVyKSA6IHVuZGVmaW5lZCxcbiAgfTtcbiAgc3RvcmUuc2V0U3RhdGUoeyBib290UnVubmluZzogdHJ1ZSB9KTtcbiAgLy8gRGVmZXIgdG8gbmV4dCB0aWNrIHNvIHRoZSBVSSBjYW4gc2hvdyBcInJ1bm5pbmdcIlxuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gcnVuQm9vdHN0cmFwKHBvaW50cywgY2ZnKTtcbiAgICAgIHN0b3JlLnNldFN0YXRlKHsgYm9vdFJlc3VsdDogcmVzdWx0LCBib290UnVubmluZzogZmFsc2UgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcignQm9vdHN0cmFwIGZhaWxlZCcsIGUpO1xuICAgICAgc3RvcmUuc2V0U3RhdGUoeyBib290UnVubmluZzogZmFsc2UgfSk7XG4gICAgfVxuICB9LCAxMCk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyQm9vdHN0cmFwKCkge1xuICBzdG9yZS5zZXRTdGF0ZSh7IGJvb3RSZXN1bHQ6IG51bGwgfSk7XG59XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gUm9idXN0bmVzcyBydW5uZXJcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gSmFja2tuaWZlICsgbGVhdmUtay1vdXQgYXJlIGNoZWFwICjiiaQgZmV3IGh1bmRyZWQgbXMgYXQgbuKJpDEwMCwgQuKJpDUwMDApIGJ1dFxuLy8gd2Ugc3RpbGwgZGVmZXIgdG8gdGhlIG5leHQgdGljayBzbyB0aGUgXCJSdW5uaW5n4oCmXCIgc3RhdGUgY2FuIHBhaW50LlxuZnVuY3Rpb24gcnVuUm9idXN0bmVzc0FuYWx5c2lzKFxuICBwb2ludHM6IEJvb3RzdHJhcElucHV0UG9pbnRbXSxcbiAgbGtvQ2ZnOiBMZWF2ZUtPdXRVSUNvbmZpZyxcbikge1xuICBpZiAoc3RvcmUuc3RhdGUucm9idXN0bmVzc1J1bm5pbmcpIHJldHVybjtcbiAgaWYgKHBvaW50cy5sZW5ndGggPCA0KSB7XG4gICAgc3RvcmUuc2V0U3RhdGUoeyBqYWNra25pZmU6IG51bGwsIGxlYXZlS091dDogbnVsbCB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc2VlZE51bSA9IGxrb0NmZy5zZWVkLnRyaW0oKSA9PT0gJycgPyB1bmRlZmluZWQgOiBOdW1iZXIobGtvQ2ZnLnNlZWQpO1xuICBzdG9yZS5zZXRTdGF0ZSh7IHJvYnVzdG5lc3NSdW5uaW5nOiB0cnVlIH0pO1xuICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgamsgPSBydW5KYWNra25pZmUocG9pbnRzKTtcbiAgICAgIGNvbnN0IGxrID0gcnVuTGVhdmVLT3V0KHBvaW50cywge1xuICAgICAgICBrOiBsa29DZmcuayxcbiAgICAgICAgQjogbGtvQ2ZnLkIsXG4gICAgICAgIGNpTGV2ZWw6IGxrb0NmZy5jaUxldmVsLFxuICAgICAgICBzZWVkOiBOdW1iZXIuaXNGaW5pdGUoc2VlZE51bSkgPyAoc2VlZE51bSBhcyBudW1iZXIpIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgICBzdG9yZS5zZXRTdGF0ZSh7IGphY2trbmlmZTogamssIGxlYXZlS091dDogbGssIHJvYnVzdG5lc3NSdW5uaW5nOiBmYWxzZSB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdSb2J1c3RuZXNzIGFuYWx5c2lzIGZhaWxlZCcsIGUpO1xuICAgICAgc3RvcmUuc2V0U3RhdGUoeyByb2J1c3RuZXNzUnVubmluZzogZmFsc2UgfSk7XG4gICAgfVxuICB9LCAxMCk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyUm9idXN0bmVzcygpIHtcbiAgc3RvcmUuc2V0U3RhdGUoeyBqYWNra25pZmU6IG51bGwsIGxlYXZlS091dDogbnVsbCB9KTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTU9BQ29ycmVsYXRpb24oKSB7XG4gIGNvbnN0IHtcbiAgICBzZWxlY3RlZCwgbkl0ZXJhdGlvbnMsIHRyaWFsU2V0LCBydW5uaW5nLCBzdGF0dXNlcywgcmVzdWx0cyxcbiAgICBib290Q29uZmlnLCBib290UmVzdWx0LCBib290UnVubmluZyxcbiAgICBsa29Db25maWcsIGphY2trbmlmZSwgbGVhdmVLT3V0LCByb2J1c3RuZXNzUnVubmluZywgc2hvd0luZmx1ZW5jZVBsb3QsXG4gICAgc2hvd1BvaW50cywgc2hvd0ZpdExpbmUsIHNob3dCYW5kLCBzaG93UmVmTGluZSxcbiAgfSA9IHVzZVN0b3JlKCk7XG4gIGNvbnN0IFtjYXRlZ29yaWVzLCBzZXRDYXRlZ29yaWVzXSA9IHVzZVN0YXRlPE1PQUNhdGVnb3J5W10+KFtdKTtcbiAgY29uc3QgW2FnZ3JlZ2F0aW9uLCBzZXRBZ2dyZWdhdGlvbl0gPSB1c2VTdGF0ZTxBZ2dyZWdhdGlvbj4oJ3RyaWFsJyk7XG4gIGNvbnN0IFtzaG93WEVycm9ycywgc2V0U2hvd1hFcnJvcnNdID0gdXNlU3RhdGU8Ym9vbGVhbj4odHJ1ZSk7XG4gIGNvbnN0IFtzaG93WUVycm9ycywgc2V0U2hvd1lFcnJvcnNdID0gdXNlU3RhdGU8Ym9vbGVhbj4odHJ1ZSk7XG4gIGNvbnN0IHBsb3RSZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuICBjb25zdCBpbmZsdWVuY2VSZWYgPSB1c2VSZWY8SFRNTERpdkVsZW1lbnQ+KG51bGwpO1xuXG4gIC8vIEludmFsaWRhdGUgYm9vdHN0cmFwICsgcm9idXN0bmVzcyByZXN1bHRzIHdoZW5ldmVyIHRoZSB1bmRlcmx5aW5nIHBvaW50cyBjaGFuZ2VcbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICBjb25zdCBwYXRjaDogUGFydGlhbDxTdG9yZVN0YXRlPiA9IHt9O1xuICAgIGlmIChzdG9yZS5zdGF0ZS5ib290UmVzdWx0KSBwYXRjaC5ib290UmVzdWx0ID0gbnVsbDtcbiAgICBpZiAoc3RvcmUuc3RhdGUuamFja2tuaWZlKSBwYXRjaC5qYWNra25pZmUgPSBudWxsO1xuICAgIGlmIChzdG9yZS5zdGF0ZS5sZWF2ZUtPdXQpIHBhdGNoLmxlYXZlS091dCA9IG51bGw7XG4gICAgaWYgKE9iamVjdC5rZXlzKHBhdGNoKS5sZW5ndGggPiAwKSBzdG9yZS5zZXRTdGF0ZShwYXRjaCk7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHJlYWN0LWhvb2tzL2V4aGF1c3RpdmUtZGVwc1xuICB9LCBbcmVzdWx0cywgdHJpYWxTZXQsIGFnZ3JlZ2F0aW9uXSk7XG5cbiAgY29uc3Qgc2V0Qm9vdENvbmZpZyA9IChwYXRjaDogUGFydGlhbDxCb290c3RyYXBVSUNvbmZpZz4pID0+XG4gICAgc3RvcmUuc2V0U3RhdGUoKHMpID0+ICh7IGJvb3RDb25maWc6IHsgLi4ucy5ib290Q29uZmlnLCAuLi5wYXRjaCB9IH0pKTtcbiAgY29uc3Qgc2V0TGtvQ29uZmlnID0gKHBhdGNoOiBQYXJ0aWFsPExlYXZlS091dFVJQ29uZmlnPikgPT5cbiAgICBzdG9yZS5zZXRTdGF0ZSgocykgPT4gKHsgbGtvQ29uZmlnOiB7IC4uLnMubGtvQ29uZmlnLCAuLi5wYXRjaCB9IH0pKTtcblxuICAvLyBBZ2dyZWdhdGUgYSB0cmlhbCBsaXN0IGludG8gdGhlcmFweS1sZXZlbCBwb2ludHMgKG9uZSBlbnRyeSBwZXIgdW5pcXVlXG4gIC8vIGNhbm9uaWNhbCBkcnVnIG5hbWUgd2l0aGluIHRoZSBNT0EgZ3JvdXAsIHBvb2xpbmcgYWNyb3NzIGFybXMvdHJpYWxzKS5cbiAgdHlwZSBUaGVyYXB5UG9pbnQgPSB7XG4gICAgbGFiZWw6IHN0cmluZztcbiAgICBtZWFuT2JzOiBudW1iZXI7XG4gICAgc3RkT2JzOiBudW1iZXI7XG4gICAgbWVhblByZWQ6IG51bWJlcjtcbiAgICBzdGRQcmVkOiBudW1iZXI7XG4gICAgblRyaWFsczogbnVtYmVyO1xuICAgIG5Bcm1zOiBudW1iZXI7XG4gIH07XG4gIGNvbnN0IGFnZ3JlZ2F0ZUJ5VGhlcmFweSA9ICh0bGlzdDogVGVzdGluZ1RyaWFsW10pOiBUaGVyYXB5UG9pbnRbXSA9PiB7XG4gICAgdHlwZSBBY2MgPSB7XG4gICAgICBsYWJlbDogc3RyaW5nO1xuICAgICAgb2JzOiBudW1iZXJbXTtcbiAgICAgIHByZWRNZWFuczogbnVtYmVyW107XG4gICAgICBwcmVkVmFyczogbnVtYmVyW107XG4gICAgICB0cmlhbHM6IFNldDxzdHJpbmc+O1xuICAgICAgbkFybXM6IG51bWJlcjtcbiAgICB9O1xuICAgIGNvbnN0IG1hcCA9IG5ldyBNYXA8c3RyaW5nLCBBY2M+KCk7XG4gICAgZm9yIChjb25zdCB0IG9mIHRsaXN0KSB7XG4gICAgICBjb25zdCBkcnVncyA9ICh0LmRydWdzICYmIHQuZHJ1Z3MubGVuZ3RoID8gdC5kcnVncyA6IFsnKHVua25vd24gZHJ1ZyknXSk7XG4gICAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGQgb2YgZHJ1Z3MpIHtcbiAgICAgICAgY29uc3QgeyBrZXksIGxhYmVsIH0gPSBjYW5vbmljYWxpemVEcnVnKGQpO1xuICAgICAgICBpZiAoIWtleSB8fCBzZWVuLmhhcyhrZXkpKSBjb250aW51ZTtcbiAgICAgICAgc2Vlbi5hZGQoa2V5KTtcbiAgICAgICAgaWYgKCFtYXAuaGFzKGtleSkpIHtcbiAgICAgICAgICBtYXAuc2V0KGtleSwgeyBsYWJlbCwgb2JzOiBbXSwgcHJlZE1lYW5zOiBbXSwgcHJlZFZhcnM6IFtdLCB0cmlhbHM6IG5ldyBTZXQoKSwgbkFybXM6IDAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYSA9IG1hcC5nZXQoa2V5KSE7XG4gICAgICAgIGEub2JzLnB1c2godC5hY3R1YWxfcmVzcG9uc2VfcmF0ZSk7XG4gICAgICAgIGEucHJlZE1lYW5zLnB1c2godC5tZWFuX3ByZWRpY3RlZF9yYXRlKTtcbiAgICAgICAgYS5wcmVkVmFycy5wdXNoKCh0LnN0ZF9wcmVkaWN0ZWRfcmF0ZSB8fCAwKSAqKiAyKTtcbiAgICAgICAgYS50cmlhbHMuYWRkKHQubmN0X2lkKTtcbiAgICAgICAgYS5uQXJtcyArPSAxO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvdXQ6IFRoZXJhcHlQb2ludFtdID0gW107XG4gICAgZm9yIChjb25zdCBhIG9mIG1hcC52YWx1ZXMoKSkge1xuICAgICAgY29uc3QgbWVhbk9icyA9IGEub2JzLnJlZHVjZSgoeCwgeSkgPT4geCArIHksIDApIC8gYS5vYnMubGVuZ3RoO1xuICAgICAgY29uc3QgdmFyT2JzID1cbiAgICAgICAgYS5vYnMubGVuZ3RoID4gMVxuICAgICAgICAgID8gYS5vYnMucmVkdWNlKCh4LCB5KSA9PiB4ICsgKHkgLSBtZWFuT2JzKSAqICh5IC0gbWVhbk9icyksIDApIC8gYS5vYnMubGVuZ3RoXG4gICAgICAgICAgOiAwO1xuICAgICAgY29uc3QgbWVhblByZWQgPSBhLnByZWRNZWFucy5yZWR1Y2UoKHgsIHkpID0+IHggKyB5LCAwKSAvIGEucHJlZE1lYW5zLmxlbmd0aDtcbiAgICAgIC8vIFBvb2xlZCBwcmVkaWN0ZWQgU0Q6IHNxcnQobWVhbiBvZiB3aXRoaW4tdHJpYWwgdmFyaWFuY2UgKyB2YXJpYW5jZSBvZiB0cmlhbCBtZWFucylcbiAgICAgIGNvbnN0IG1lYW5WYXJXaXRoaW4gPSBhLnByZWRWYXJzLnJlZHVjZSgoeCwgeSkgPT4geCArIHksIDApIC8gYS5wcmVkVmFycy5sZW5ndGg7XG4gICAgICBjb25zdCB2YXJCZXR3ZWVuID1cbiAgICAgICAgYS5wcmVkTWVhbnMubGVuZ3RoID4gMVxuICAgICAgICAgID8gYS5wcmVkTWVhbnMucmVkdWNlKCh4LCB5KSA9PiB4ICsgKHkgLSBtZWFuUHJlZCkgKiAoeSAtIG1lYW5QcmVkKSwgMCkgL1xuICAgICAgICAgICAgYS5wcmVkTWVhbnMubGVuZ3RoXG4gICAgICAgICAgOiAwO1xuICAgICAgb3V0LnB1c2goe1xuICAgICAgICBsYWJlbDogYS5sYWJlbCxcbiAgICAgICAgbWVhbk9icyxcbiAgICAgICAgc3RkT2JzOiBNYXRoLnNxcnQodmFyT2JzKSxcbiAgICAgICAgbWVhblByZWQsXG4gICAgICAgIHN0ZFByZWQ6IE1hdGguc3FydChtZWFuVmFyV2l0aGluICsgdmFyQmV0d2VlbiksXG4gICAgICAgIG5UcmlhbHM6IGEudHJpYWxzLnNpemUsXG4gICAgICAgIG5Bcm1zOiBhLm5Bcm1zLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBvdXQuc29ydCgoYSwgYikgPT4gYS5sYWJlbC5sb2NhbGVDb21wYXJlKGIubGFiZWwpKTtcbiAgfTtcblxuICAvLyBSZXR1cm5zIHRoZSB0cmlhbCBhcnJheSBzZWxlY3RlZCBieSB0aGUgY3VycmVudCB0b2dnbGUuXG4gIGNvbnN0IHRyaWFsc0ZvciA9IChyOiBNT0FSZXN1bHQpOiBUZXN0aW5nVHJpYWxbXSA9PlxuICAgIHRyaWFsU2V0ID09PSAnYWxsJ1xuICAgICAgPyBbLi4uKHIudHJhaW5pbmdfdHJpYWxzIHx8IFtdKSwgLi4uKHIudGVzdGluZ190cmlhbHMgfHwgW10pXVxuICAgICAgOiAoci50ZXN0aW5nX3RyaWFscyB8fCBbXSk7XG5cbiAgLy8gTG9hZCBNT0EgY2F0ZWdvcmllc1xuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGFwaS5nZXQoJy9zaW11bGF0aW9uL21vYS1jYXRlZ29yaWVzJykudGhlbigoeyBkYXRhIH0pID0+IHtcbiAgICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5kYXRhXS5zb3J0KChhOiBNT0FDYXRlZ29yeSwgYjogTU9BQ2F0ZWdvcnkpID0+XG4gICAgICAgIChhLmxhYmVsIHx8IGEudmFsdWUpLmxvY2FsZUNvbXBhcmUoYi5sYWJlbCB8fCBiLnZhbHVlKVxuICAgICAgKTtcbiAgICAgIHNldENhdGVnb3JpZXMoc29ydGVkKTtcbiAgICB9KTtcbiAgfSwgW10pO1xuXG4gIGNvbnN0IHNldFNlbGVjdGVkID0gKG5leHQ6IHN0cmluZ1tdIHwgKChwcmV2OiBzdHJpbmdbXSkgPT4gc3RyaW5nW10pKSA9PiB7XG4gICAgc3RvcmUuc2V0U3RhdGUoKHMpID0+ICh7XG4gICAgICBzZWxlY3RlZDogdHlwZW9mIG5leHQgPT09ICdmdW5jdGlvbicgPyAobmV4dCBhcyBhbnkpKHMuc2VsZWN0ZWQpIDogbmV4dCxcbiAgICB9KSk7XG4gIH07XG4gIGNvbnN0IHNldE5JdGVyYXRpb25zID0gKG46IG51bWJlcikgPT4gc3RvcmUuc2V0U3RhdGUoeyBuSXRlcmF0aW9uczogbiB9KTtcblxuICBjb25zdCB0b2dnbGVNT0EgPSAodmFsdWU6IHN0cmluZykgPT4ge1xuICAgIHNldFNlbGVjdGVkKChwcmV2KSA9PlxuICAgICAgcHJldi5pbmNsdWRlcyh2YWx1ZSkgPyBwcmV2LmZpbHRlcigodikgPT4gdiAhPT0gdmFsdWUpIDogWy4uLnByZXYsIHZhbHVlXVxuICAgICk7XG4gIH07XG5cbiAgY29uc3QgaGFuZGxlUnVuID0gKCkgPT4ge1xuICAgIGNvbnN0IGxvb2t1cCA9ICh2OiBzdHJpbmcpID0+XG4gICAgICBjYXRlZ29yaWVzLmZpbmQoKGMpID0+IGMudmFsdWUgPT09IHYpPy5jYXRlZ29yeSB8fCB2O1xuICAgIHJ1bkFuYWx5c2lzKGxvb2t1cCwgc2VsZWN0ZWQsIG5JdGVyYXRpb25zKTtcbiAgfTtcblxuICBjb25zdCBoYW5kbGVDYW5jZWwgPSAoKSA9PiBjYW5jZWxBbmFseXNpcygpO1xuXG4gIC8vIEJ1aWxkIEJvb3RzdHJhcElucHV0UG9pbnRbXSBmcm9tIGN1cnJlbnQgcmVzdWx0cyArIGFnZ3JlZ2F0aW9uLiBUaGlzXG4gIC8vIG1hdGNoZXMgd2hhdCdzIHJlbmRlcmVkIG9uIHRoZSBwbG90IGV4YWN0bHksIHNvIGJvb3RzdHJhcCBDSXMgcmVmZXIgdG9cbiAgLy8gdGhlIHNhbWUgcG9pbnRzIHRoZSB1c2VyIHNlZXMuXG4gIGNvbnN0IGJvb3RQb2ludHM6IEJvb3RzdHJhcElucHV0UG9pbnRbXSA9IHVzZU1lbW8oKCkgPT4ge1xuICAgIGNvbnN0IG91dDogQm9vdHN0cmFwSW5wdXRQb2ludFtdID0gW107XG4gICAgcmVzdWx0cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgICBjb25zdCB0bGlzdCA9IHRyaWFsc0ZvcihyKTtcbiAgICAgIGlmICh0bGlzdC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgIGlmIChhZ2dyZWdhdGlvbiA9PT0gJ3RoZXJhcHknKSB7XG4gICAgICAgIGNvbnN0IHB0cyA9IGFnZ3JlZ2F0ZUJ5VGhlcmFweSh0bGlzdCk7XG4gICAgICAgIGZvciAoY29uc3QgcCBvZiBwdHMpIHtcbiAgICAgICAgICAvLyBUaGVyYXB5LWxldmVsIGRyYXc6IEdhdXNzaWFuIGFyb3VuZCAobWVhblByZWQsIHBvb2xlZCBzdGRQcmVkKSxcbiAgICAgICAgICAvLyBjbGlwcGVkIHRvIFswLDFdLiBVc2VzIGEgZnJlc2ggcGVyLWNhbGwgUk5HIHNvIGRyYXdzIGRvbid0IGRlcGVuZFxuICAgICAgICAgIC8vIG9uIHRoZSBvdXRlciBib290c3RyYXAgc2VlZCAodGhhdCdzIGhhbmRsZWQgYnkgcG9pbnQgb3JkZXIpLlxuICAgICAgICAgIGNvbnN0IG1lYW4gPSBwLm1lYW5QcmVkO1xuICAgICAgICAgIGNvbnN0IHNkID0gcC5zdGRQcmVkO1xuICAgICAgICAgIGNvbnN0IHJuZyA9IG1ha2VSbmcoKTtcbiAgICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICB4OiBwLm1lYW5PYnMsXG4gICAgICAgICAgICB5OiBtZWFuLFxuICAgICAgICAgICAgbW9hS2V5OiByLm1vYV92YWx1ZSxcbiAgICAgICAgICAgIGxhYmVsOiBwLmxhYmVsLFxuICAgICAgICAgICAgeURyYXdGbjogc2QgPiAwXG4gICAgICAgICAgICAgID8gKCkgPT4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgbWVhbiArIHNkICogZ2F1c3NpYW4ocm5nKSkpXG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHQgb2YgdGxpc3QpIHtcbiAgICAgICAgICBjb25zdCBkcmF3cyA9IHQuZnJhY3Rpb25zX2Fib3ZlX3RocmVzaG9sZDtcbiAgICAgICAgICBjb25zdCBtZWFuID0gdC5tZWFuX3ByZWRpY3RlZF9yYXRlO1xuICAgICAgICAgIGNvbnN0IHNkID0gdC5zdGRfcHJlZGljdGVkX3JhdGUgfHwgMDtcbiAgICAgICAgICBjb25zdCBybmcgPSBtYWtlUm5nKCk7XG4gICAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgeDogdC5hY3R1YWxfcmVzcG9uc2VfcmF0ZSxcbiAgICAgICAgICAgIHk6IG1lYW4sXG4gICAgICAgICAgICBtb2FLZXk6IHIubW9hX3ZhbHVlLFxuICAgICAgICAgICAgbGFiZWw6IHQubmN0X2lkLFxuICAgICAgICAgICAgeURyYXdGbjpcbiAgICAgICAgICAgICAgZHJhd3MgJiYgZHJhd3MubGVuZ3RoID4gMFxuICAgICAgICAgICAgICAgID8gKCkgPT4gZHJhd3NbTWF0aC5mbG9vcihybmcoKSAqIGRyYXdzLmxlbmd0aCldXG4gICAgICAgICAgICAgICAgOiBzZCA+IDBcbiAgICAgICAgICAgICAgICAgID8gKCkgPT4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgbWVhbiArIHNkICogZ2F1c3NpYW4ocm5nKSkpXG4gICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBvdXQ7XG4gIH0sIFtyZXN1bHRzLCB0cmlhbFNldCwgYWdncmVnYXRpb25dKTtcblxuICBjb25zdCBoYW5kbGVCb290UnVuID0gKCkgPT4gcnVuQm9vdHN0cmFwQW5hbHlzaXMoYm9vdFBvaW50cywgYm9vdENvbmZpZyk7XG4gIGNvbnN0IGhhbmRsZUJvb3RDbGVhciA9ICgpID0+IGNsZWFyQm9vdHN0cmFwKCk7XG4gIGNvbnN0IGhhbmRsZVJvYlJ1biA9ICgpID0+IHJ1blJvYnVzdG5lc3NBbmFseXNpcyhib290UG9pbnRzLCBsa29Db25maWcpO1xuICBjb25zdCBoYW5kbGVSb2JDbGVhciA9ICgpID0+IGNsZWFyUm9idXN0bmVzcygpO1xuXG4gIC8vIFJlbmRlciBjb3JyZWxhdGlvbiBwbG90IHdoZW5ldmVyIHJlc3VsdHMgY2hhbmdlXG4gIHVzZUVmZmVjdCgoKSA9PiB7XG4gICAgaWYgKCFwbG90UmVmLmN1cnJlbnQpIHJldHVybjtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIFBsb3RseS5wdXJnZShwbG90UmVmLmN1cnJlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRyYWNlczogYW55W10gPSBbXTtcbiAgICBjb25zdCBhbGxBY3R1YWw6IG51bWJlcltdID0gW107XG4gICAgY29uc3QgYWxsUHJlZGljdGVkOiBudW1iZXJbXSA9IFtdO1xuICAgIGNvbnN0IGV4dGVudHM6IG51bWJlcltdID0gW107IC8vIHRyYWNrcyBtZWFuIMKxIGVycm9yIGZvciBheGlzIGxpbWl0c1xuXG4gICAgcmVzdWx0cy5mb3JFYWNoKChyLCBpZHgpID0+IHtcbiAgICAgIGNvbnN0IGNvbG9yID0gTU9BX0NPTE9SU1tpZHggJSBNT0FfQ09MT1JTLmxlbmd0aF07XG4gICAgICBjb25zdCB0bGlzdCA9IHRyaWFsc0ZvcihyKTtcbiAgICAgIGlmICh0bGlzdC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgICAgaWYgKGFnZ3JlZ2F0aW9uID09PSAndGhlcmFweScpIHtcbiAgICAgICAgY29uc3QgcHRzID0gYWdncmVnYXRlQnlUaGVyYXB5KHRsaXN0KTtcbiAgICAgICAgaWYgKHB0cy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICAgICAgY29uc3QgeHMgPSBwdHMubWFwKChwKSA9PiBwLm1lYW5PYnMpO1xuICAgICAgICBjb25zdCB5cyA9IHB0cy5tYXAoKHApID0+IHAubWVhblByZWQpO1xuICAgICAgICBjb25zdCBleCA9IHB0cy5tYXAoKHApID0+IHAuc3RkT2JzKTtcbiAgICAgICAgY29uc3QgZXkgPSBwdHMubWFwKChwKSA9PiBwLnN0ZFByZWQpO1xuICAgICAgICBjb25zdCBsYWJlbHMgPSBwdHMubWFwKFxuICAgICAgICAgIChwKSA9PlxuICAgICAgICAgICAgYDxiPiR7cC5sYWJlbH08L2I+PGJyPiR7ci5tb2FfY2F0ZWdvcnl9PGJyPmAgK1xuICAgICAgICAgICAgYG9ic2VydmVkOiAkeyhwLm1lYW5PYnMgKiAxMDApLnRvRml4ZWQoMSl9JSDCsSAkeyhwLnN0ZE9icyAqIDEwMCkudG9GaXhlZCgxKX0lPGJyPmAgK1xuICAgICAgICAgICAgYHByZWRpY3RlZDogJHsocC5tZWFuUHJlZCAqIDEwMCkudG9GaXhlZCgxKX0lIMKxICR7KHAuc3RkUHJlZCAqIDEwMCkudG9GaXhlZCgxKX0lPGJyPmAgK1xuICAgICAgICAgICAgYCR7cC5uVHJpYWxzfSB0cmlhbChzKSwgJHtwLm5Bcm1zfSBhcm0ocylgXG4gICAgICAgICk7XG4gICAgICAgIGFsbEFjdHVhbC5wdXNoKC4uLnhzKTtcbiAgICAgICAgYWxsUHJlZGljdGVkLnB1c2goLi4ueXMpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgZXh0ZW50cy5wdXNoKFxuICAgICAgICAgICAgeHNbaV0gKyAoc2hvd1hFcnJvcnMgPyBleFtpXSA6IDApLFxuICAgICAgICAgICAgeXNbaV0gKyAoc2hvd1lFcnJvcnMgPyBleVtpXSA6IDApXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICB0cmFjZXMucHVzaCh7XG4gICAgICAgICAgeDogeHMsXG4gICAgICAgICAgeTogeXMsXG4gICAgICAgICAgZXJyb3JfeDogeyB0eXBlOiAnZGF0YScsIGFycmF5OiBleCwgdmlzaWJsZTogc2hvd1BvaW50cyAmJiBzaG93WEVycm9ycywgdGhpY2tuZXNzOiAxLjIsIHdpZHRoOiAzLCBjb2xvciB9LFxuICAgICAgICAgIGVycm9yX3k6IHsgdHlwZTogJ2RhdGEnLCBhcnJheTogZXksIHZpc2libGU6IHNob3dQb2ludHMgJiYgc2hvd1lFcnJvcnMsIHRoaWNrbmVzczogMS4yLCB3aWR0aDogMywgY29sb3IgfSxcbiAgICAgICAgICB0eXBlOiAnc2NhdHRlcicsXG4gICAgICAgICAgbW9kZTogJ21hcmtlcnMnLFxuICAgICAgICAgIG5hbWU6IHIubW9hX2NhdGVnb3J5LFxuICAgICAgICAgIG1hcmtlcjogeyBzaXplOiAxMCwgY29sb3IsIGxpbmU6IHsgY29sb3I6ICcjZmZmJywgd2lkdGg6IDEgfSB9LFxuICAgICAgICAgIHRleHQ6IGxhYmVscyxcbiAgICAgICAgICBob3ZlcmluZm86ICd0ZXh0JyxcbiAgICAgICAgICB2aXNpYmxlOiBzaG93UG9pbnRzID8gdHJ1ZSA6ICdsZWdlbmRvbmx5JyxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB4cyA9IHRsaXN0Lm1hcCgodCkgPT4gdC5hY3R1YWxfcmVzcG9uc2VfcmF0ZSk7XG4gICAgICAgIGNvbnN0IHlzID0gdGxpc3QubWFwKCh0KSA9PiB0Lm1lYW5fcHJlZGljdGVkX3JhdGUpO1xuICAgICAgICBjb25zdCBlcnJzID0gdGxpc3QubWFwKCh0KSA9PiB0LnN0ZF9wcmVkaWN0ZWRfcmF0ZSB8fCAwKTtcbiAgICAgICAgY29uc3QgbGFiZWxzID0gdGxpc3QubWFwKFxuICAgICAgICAgICh0KSA9PlxuICAgICAgICAgICAgYCR7dC5uY3RfaWR9PGJyPmFjdHVhbDogJHsodC5hY3R1YWxfcmVzcG9uc2VfcmF0ZSAqIDEwMCkudG9GaXhlZCgxKX0lYCArXG4gICAgICAgICAgICBgPGJyPnByZWRpY3RlZDogJHsodC5tZWFuX3ByZWRpY3RlZF9yYXRlICogMTAwKS50b0ZpeGVkKDEpfSUgwrEgJHsoXG4gICAgICAgICAgICAgICh0LnN0ZF9wcmVkaWN0ZWRfcmF0ZSB8fCAwKSAqIDEwMFxuICAgICAgICAgICAgKS50b0ZpeGVkKDEpfSVgXG4gICAgICAgICk7XG4gICAgICAgIGFsbEFjdHVhbC5wdXNoKC4uLnhzKTtcbiAgICAgICAgYWxsUHJlZGljdGVkLnB1c2goLi4ueXMpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgZXh0ZW50cy5wdXNoKHhzW2ldLCB5c1tpXSArIChzaG93WUVycm9ycyA/IGVycnNbaV0gOiAwKSk7XG4gICAgICAgIH1cbiAgICAgICAgdHJhY2VzLnB1c2goe1xuICAgICAgICAgIHg6IHhzLFxuICAgICAgICAgIHk6IHlzLFxuICAgICAgICAgIGVycm9yX3k6IHsgdHlwZTogJ2RhdGEnLCBhcnJheTogZXJycywgdmlzaWJsZTogc2hvd1BvaW50cyAmJiBzaG93WUVycm9ycywgdGhpY2tuZXNzOiAxLjIsIHdpZHRoOiAzLCBjb2xvciB9LFxuICAgICAgICAgIHR5cGU6ICdzY2F0dGVyJyxcbiAgICAgICAgICBtb2RlOiAnbWFya2VycycsXG4gICAgICAgICAgbmFtZTogci5tb2FfY2F0ZWdvcnksXG4gICAgICAgICAgbWFya2VyOiB7IHNpemU6IDksIGNvbG9yLCBsaW5lOiB7IGNvbG9yOiAnI2ZmZicsIHdpZHRoOiAxIH0gfSxcbiAgICAgICAgICB0ZXh0OiBsYWJlbHMsXG4gICAgICAgICAgaG92ZXJpbmZvOiAndGV4dCcsXG4gICAgICAgICAgdmlzaWJsZTogc2hvd1BvaW50cyA/IHRydWUgOiAnbGVnZW5kb25seScsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8geSA9IHggcmVmZXJlbmNlIGxpbmUuIEF4aXMgdXBwZXIgbGltaXQgaW5jbHVkZXMgbWVhbiArIGVycm9yIGJhciBleHRlbnRzXG4gICAgLy8gc28gbm8gd2hpc2tlciBpcyBjbGlwcGVkLiBTaGFyZWQgYmV0d2VlbiB4ICYgeSBzbyB0aGUgcGxvdCBzdGF5cyBzcXVhcmUuXG4gICAgY29uc3QgbWF4VmFsID0gTWF0aC5tYXgoMC4wNSwgLi4uYWxsQWN0dWFsLCAuLi5hbGxQcmVkaWN0ZWQsIC4uLmV4dGVudHMpICogMS4wODtcbiAgICB0cmFjZXMucHVzaCh7XG4gICAgICB4OiBbMCwgbWF4VmFsXSxcbiAgICAgIHk6IFswLCBtYXhWYWxdLFxuICAgICAgdHlwZTogJ3NjYXR0ZXInLFxuICAgICAgbW9kZTogJ2xpbmVzJyxcbiAgICAgIG5hbWU6ICd5ID0geCAocGVyZmVjdCknLFxuICAgICAgbGluZTogeyBjb2xvcjogJyM5OTknLCBkYXNoOiAnZGFzaCcsIHdpZHRoOiAxLjUgfSxcbiAgICAgIGhvdmVyaW5mbzogJ3NraXAnLFxuICAgICAgdmlzaWJsZTogc2hvd1JlZkxpbmUgPyB0cnVlIDogJ2xlZ2VuZG9ubHknLFxuICAgIH0pO1xuXG4gICAgLy8gQm9vdHN0cmFwIENJIGJhbmQgKyBPTFMgZml0IGxpbmVcbiAgICBpZiAoYm9vdFJlc3VsdCAmJiBib290UmVzdWx0LmNvbmZpZy5jdXJ2ZVR5cGUgPT09ICdvbHMnKSB7XG4gICAgICBjb25zdCBuR3JpZCA9IDUwO1xuICAgICAgY29uc3QgeEdyaWQgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuR3JpZCB9LCAoXywgaSkgPT4gKGkgLyAobkdyaWQgLSAxKSkgKiBtYXhWYWwpO1xuICAgICAgY29uc3QgYmFuZCA9IG1hdGVyaWFsaXplQmFuZChib290UmVzdWx0LCB4R3JpZCk7XG4gICAgICBpZiAoYmFuZCAmJiBzaG93QmFuZCkge1xuICAgICAgICAvLyBMb3dlciBpbnZpc2libGUgYm91bmRhcnlcbiAgICAgICAgdHJhY2VzLnB1c2goe1xuICAgICAgICAgIHg6IHhHcmlkLFxuICAgICAgICAgIHk6IGJhbmQubG93ZXIsXG4gICAgICAgICAgdHlwZTogJ3NjYXR0ZXInLFxuICAgICAgICAgIG1vZGU6ICdsaW5lcycsXG4gICAgICAgICAgbGluZTogeyBjb2xvcjogJ3JnYmEoMCwwLDAsMCknLCB3aWR0aDogMCB9LFxuICAgICAgICAgIGhvdmVyaW5mbzogJ3NraXAnLFxuICAgICAgICAgIHNob3dsZWdlbmQ6IGZhbHNlLFxuICAgICAgICB9KTtcbiAgICAgICAgLy8gVXBwZXIgYm91bmRhcnkgd2l0aCBmaWxsIGRvd24gdG8gdGhlIHByZXZpb3VzIHRyYWNlXG4gICAgICAgIGNvbnN0IGNpUGN0ID0gTWF0aC5yb3VuZChib290UmVzdWx0LmNvbmZpZy5jaUxldmVsICogMTAwKTtcbiAgICAgICAgdHJhY2VzLnB1c2goe1xuICAgICAgICAgIHg6IHhHcmlkLFxuICAgICAgICAgIHk6IGJhbmQudXBwZXIsXG4gICAgICAgICAgdHlwZTogJ3NjYXR0ZXInLFxuICAgICAgICAgIG1vZGU6ICdsaW5lcycsXG4gICAgICAgICAgbmFtZTogYCR7Y2lQY3R9JSBDSSBiYW5kYCxcbiAgICAgICAgICBsaW5lOiB7IGNvbG9yOiAncmdiYSg5OSw3MCwxNTEsMC4zNSknLCB3aWR0aDogMCB9LFxuICAgICAgICAgIGZpbGw6ICd0b25leHR5JyxcbiAgICAgICAgICBmaWxsY29sb3I6ICdyZ2JhKDk5LDcwLDE1MSwwLjE4KScsXG4gICAgICAgICAgaG92ZXJpbmZvOiAnc2tpcCcsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKHNob3dGaXRMaW5lICYmIGJvb3RSZXN1bHQuc2xvcGVIYXQgIT0gbnVsbCAmJiBib290UmVzdWx0LmludGVyY2VwdEhhdCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHMgPSBib290UmVzdWx0LnNsb3BlSGF0LCBpMCA9IGJvb3RSZXN1bHQuaW50ZXJjZXB0SGF0O1xuICAgICAgICB0cmFjZXMucHVzaCh7XG4gICAgICAgICAgeDogWzAsIG1heFZhbF0sXG4gICAgICAgICAgeTogW2kwLCBpMCArIHMgKiBtYXhWYWxdLFxuICAgICAgICAgIHR5cGU6ICdzY2F0dGVyJyxcbiAgICAgICAgICBtb2RlOiAnbGluZXMnLFxuICAgICAgICAgIG5hbWU6ICdPTFMgZml0JyxcbiAgICAgICAgICBsaW5lOiB7IGNvbG9yOiAnIzYzNDY5NycsIHdpZHRoOiAyIH0sXG4gICAgICAgICAgaG92ZXJpbmZvOiAnc2tpcCcsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHIgPSBwZWFyc29uKGFsbEFjdHVhbCwgYWxsUHJlZGljdGVkKTtcbiAgICBjb25zdCByaG8gPSBzcGVhcm1hbihhbGxBY3R1YWwsIGFsbFByZWRpY3RlZCk7XG4gICAgY29uc3QgZm10ID0gKHY6IG51bWJlcikgPT4gdi50b0ZpeGVkKDMpO1xuICAgIGNvbnN0IGZtdENJID0gKGNpOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbCkgPT5cbiAgICAgIGNpID8gYCBbJHtmbXQoY2lbMF0pfSwgJHtmbXQoY2lbMV0pfV1gIDogJyc7XG4gICAgY29uc3Qgc3RhdHNMaW5lcyA9IFtgbiA9ICR7YWxsQWN0dWFsLmxlbmd0aH1gXTtcbiAgICBpZiAociAhPSBudWxsKSB7XG4gICAgICBjb25zdCBjaSA9IGJvb3RSZXN1bHQgPyBib290UmVzdWx0LnJDSSA6IG51bGw7XG4gICAgICBzdGF0c0xpbmVzLnB1c2goYFBlYXJzb24gciA9ICR7Zm10KHIpfSR7Zm10Q0koY2kpfWApO1xuICAgIH1cbiAgICBpZiAocmhvICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IGNpID0gYm9vdFJlc3VsdCA/IGJvb3RSZXN1bHQucmhvQ0kgOiBudWxsO1xuICAgICAgc3RhdHNMaW5lcy5wdXNoKGBTcGVhcm1hbiDPgSA9ICR7Zm10KHJobyl9JHtmbXRDSShjaSl9YCk7XG4gICAgfVxuICAgIGlmIChib290UmVzdWx0KSB7XG4gICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKGJvb3RSZXN1bHQuY29uZmlnLmNpTGV2ZWwgKiAxMDApO1xuICAgICAgc3RhdHNMaW5lcy5wdXNoKFxuICAgICAgICBgYm9vdHN0cmFwOiAke2Jvb3RSZXN1bHQuY29uZmlnLkJ9IMOXICR7Ym9vdFJlc3VsdC5jb25maWcuc2NoZW1lfSwgJHtwY3R9JSAke2Jvb3RSZXN1bHQuY29uZmlnLmNpTWV0aG9kID09PSAnYmNhJyA/ICdCQ2EnIDogJ3BjdGwnfWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgbGF5b3V0OiBQYXJ0aWFsPFBsb3RseS5MYXlvdXQ+ID0ge1xuICAgICAgdGl0bGU6IHsgdGV4dDogJ1ByZWRpY3RlZCB2cyBPYnNlcnZlZCBSZXNwb25zZSBSYXRlcycsIGZvbnQ6IHsgc2l6ZTogMjYgfSB9LFxuICAgICAgZm9udDogeyBzaXplOiAxOCB9LFxuICAgICAgYW5ub3RhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHhyZWY6ICdwYXBlcicsXG4gICAgICAgICAgeXJlZjogJ3BhcGVyJyxcbiAgICAgICAgICB4OiAwLjk4LFxuICAgICAgICAgIHk6IDAuOTgsXG4gICAgICAgICAgeGFuY2hvcjogJ3JpZ2h0JyxcbiAgICAgICAgICB5YW5jaG9yOiAndG9wJyxcbiAgICAgICAgICB0ZXh0OiBzdGF0c0xpbmVzLmpvaW4oJzxicj4nKSxcbiAgICAgICAgICBzaG93YXJyb3c6IGZhbHNlLFxuICAgICAgICAgIGFsaWduOiAncmlnaHQnLFxuICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMTgsIGNvbG9yOiAnIzMzMycgfSxcbiAgICAgICAgICBiZ2NvbG9yOiAncmdiYSgyNTUsMjU1LDI1NSwwLjkpJyxcbiAgICAgICAgICBib3JkZXJjb2xvcjogJyNjY2MnLFxuICAgICAgICAgIGJvcmRlcndpZHRoOiAxLFxuICAgICAgICAgIGJvcmRlcnBhZDogNixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB4YXhpczoge1xuICAgICAgICB0aXRsZToge1xuICAgICAgICAgIHRleHQ6XG4gICAgICAgICAgICBhZ2dyZWdhdGlvbiA9PT0gJ3RoZXJhcHknXG4gICAgICAgICAgICAgID8gYE1lYW4gT2JzZXJ2ZWQgUmVzcG9uc2UgUmF0ZSR7c2hvd1hFcnJvcnMgPyAnICjCsSBTRCBhY3Jvc3MgdHJpYWxzKScgOiAnJ31gXG4gICAgICAgICAgICAgIDogJ0FjdHVhbCBSZXNwb25zZSBSYXRlIChvYnNlcnZlZCknLFxuICAgICAgICAgIGZvbnQ6IHsgc2l6ZTogMjEgfSxcbiAgICAgICAgfSxcbiAgICAgICAgdGlja2ZvbnQ6IHsgc2l6ZTogMTcgfSxcbiAgICAgICAgcmFuZ2U6IFswLCBtYXhWYWxdLFxuICAgICAgICB0aWNrZm9ybWF0OiAnLjAlJyxcbiAgICAgICAgemVyb2xpbmU6IHRydWUsXG4gICAgICAgIHplcm9saW5lY29sb3I6ICcjZGRkJyxcbiAgICAgICAgYXV0b21hcmdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICB5YXhpczoge1xuICAgICAgICB0aXRsZToge1xuICAgICAgICAgIHRleHQ6XG4gICAgICAgICAgICBhZ2dyZWdhdGlvbiA9PT0gJ3RoZXJhcHknXG4gICAgICAgICAgICAgID8gYE1lYW4gUHJlZGljdGVkIFJlc3BvbnNlIFJhdGUke3Nob3dZRXJyb3JzID8gJyAowrEgU0QpJyA6ICcnfWBcbiAgICAgICAgICAgICAgOiBgUHJlZGljdGVkIFJlc3BvbnNlIFJhdGUke3Nob3dZRXJyb3JzID8gJyAobWVhbiDCsSBTRCknIDogJyd9YCxcbiAgICAgICAgICBmb250OiB7IHNpemU6IDIxIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHRpY2tmb250OiB7IHNpemU6IDE3IH0sXG4gICAgICAgIHJhbmdlOiBbMCwgbWF4VmFsXSxcbiAgICAgICAgdGlja2Zvcm1hdDogJy4wJScsXG4gICAgICAgIHplcm9saW5lOiB0cnVlLFxuICAgICAgICB6ZXJvbGluZWNvbG9yOiAnI2RkZCcsXG4gICAgICAgIGF1dG9tYXJnaW46IHRydWUsXG4gICAgICB9LFxuICAgICAgaGVpZ2h0OiA1NjAsXG4gICAgICBtYXJnaW46IHsgbDogODAsIHI6IDMwLCB0OiA3MCwgYjogNzAgfSxcbiAgICAgIGxlZ2VuZDogeyB4OiAwLjAxLCB5OiAwLjk5LCBiZ2NvbG9yOiAncmdiYSgyNTUsMjU1LDI1NSwwLjkpJywgYm9yZGVyY29sb3I6ICcjZGRkJywgYm9yZGVyd2lkdGg6IDEsIGZvbnQ6IHsgc2l6ZTogMTcgfSB9LFxuICAgICAgaG92ZXJtb2RlOiAnY2xvc2VzdCcsXG4gICAgICBwbG90X2JnY29sb3I6ICcjZmZmJyxcbiAgICB9O1xuXG4gICAgUGxvdGx5Lm5ld1Bsb3QocGxvdFJlZi5jdXJyZW50LCB0cmFjZXMsIGxheW91dCwge1xuICAgICAgZGlzcGxheU1vZGVCYXI6IHRydWUsXG4gICAgICByZXNwb25zaXZlOiB0cnVlLFxuICAgICAgdG9JbWFnZUJ1dHRvbk9wdGlvbnM6IHtcbiAgICAgICAgZm9ybWF0OiAnc3ZnJyxcbiAgICAgICAgZmlsZW5hbWU6ICdtb2FfY29ycmVsYXRpb24nLFxuICAgICAgICB3aWR0aDogODAwLFxuICAgICAgICBoZWlnaHQ6IDgwMCxcbiAgICAgICAgc2NhbGU6IDQsXG4gICAgICB9LFxuICAgIH0pO1xuICB9LCBbcmVzdWx0cywgdHJpYWxTZXQsIGFnZ3JlZ2F0aW9uLCBzaG93WEVycm9ycywgc2hvd1lFcnJvcnMsXG4gICAgICBib290UmVzdWx0LCBzaG93UG9pbnRzLCBzaG93Rml0TGluZSwgc2hvd0JhbmQsIHNob3dSZWZMaW5lXSk7XG5cbiAgLy8gSW5mbHVlbmNlIHBsb3Q6IM6UciBwZXIgcG9pbnQgd2hlbiByZW1vdmVkLCBzb3J0ZWQgYnkgfM6UcnwgZGVzY2VuZGluZy5cbiAgLy8gUG9zaXRpdmUgYmFycyBtZWFuIHJlbW92aW5nIHRoYXQgcG9pbnQgbWFrZXMgciBnbyB1cCAodGhlIHBvaW50IHdhcyBhXG4gIC8vIGRyYWcgb24gcik7IG5lZ2F0aXZlIGJhcnMgbWVhbiB0aGUgcG9pbnQgc3VwcG9ydHMgdGhlIGNvcnJlbGF0aW9uLlxuICB1c2VFZmZlY3QoKCkgPT4ge1xuICAgIGlmICghaW5mbHVlbmNlUmVmLmN1cnJlbnQpIHJldHVybjtcbiAgICBpZiAoIWphY2trbmlmZSB8fCAhc2hvd0luZmx1ZW5jZVBsb3QpIHtcbiAgICAgIFBsb3RseS5wdXJnZShpbmZsdWVuY2VSZWYuY3VycmVudCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGluZmwgPSBqYWNra25pZmUuaW5mbHVlbmNlLmZpbHRlcigocCkgPT4gcC5kZWx0YVIgIT0gbnVsbCk7XG4gICAgaWYgKGluZmwubGVuZ3RoID09PSAwKSB7XG4gICAgICBQbG90bHkucHVyZ2UoaW5mbHVlbmNlUmVmLmN1cnJlbnQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFNvcnQgYnkgfM6UcnwgZGVzY2VuZGluZyBzbyB0aGUgbW9zdCBpbmZsdWVudGlhbCBwb2ludHMgc2l0IG9uIHRoZSBsZWZ0LlxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5pbmZsXS5zb3J0KFxuICAgICAgKGEsIGIpID0+IE1hdGguYWJzKGIuZGVsdGFSID8/IDApIC0gTWF0aC5hYnMoYS5kZWx0YVIgPz8gMClcbiAgICApO1xuXG4gICAgLy8gTWFwIGVhY2ggTU9BIHRvIGl0cyBwbG90IGNvbG9yIChtYXRjaGluZyB0aGUgY29ycmVsYXRpb24gcGxvdCBsZWdlbmQpLlxuICAgIGNvbnN0IG1vYUNvbG9yOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgcmVzdWx0cy5mb3JFYWNoKChyLCBpZHgpID0+IHsgbW9hQ29sb3Jbci5tb2FfdmFsdWVdID0gTU9BX0NPTE9SU1tpZHggJSBNT0FfQ09MT1JTLmxlbmd0aF07IH0pO1xuXG4gICAgY29uc3QgZGVsdGFzID0gc29ydGVkLm1hcCgocCkgPT4gcC5kZWx0YVIgPz8gMCk7XG4gICAgY29uc3QgbGFiZWxzID0gc29ydGVkLm1hcCgocCkgPT4gcC5sYWJlbCk7XG4gICAgY29uc3QgY29sb3JzID0gc29ydGVkLm1hcCgocCkgPT5cbiAgICAgIChwLmRlbHRhUiA/PyAwKSA+IDAgPyAnI2MyMTg1YicgOiAnIzJjNjM5ZScgICAvLyBkcmFnID0gbWFnZW50YSwgc3VwcG9ydCA9IGJsdWVcbiAgICApO1xuICAgIGNvbnN0IGhvdmVyID0gc29ydGVkLm1hcCgocCkgPT4ge1xuICAgICAgY29uc3QgbW9hTmFtZSA9IHJlc3VsdHMuZmluZCgocikgPT4gci5tb2FfdmFsdWUgPT09IHAubW9hS2V5KT8ubW9hX2NhdGVnb3J5ID8/IHAubW9hS2V5O1xuICAgICAgcmV0dXJuIChcbiAgICAgICAgYDxiPiR7cC5sYWJlbH08L2I+PGJyPmAgK1xuICAgICAgICBgJHttb2FOYW1lfTxicj5gICtcbiAgICAgICAgYHggPSAkeyhwLnggKiAxMDApLnRvRml4ZWQoMSl9JSwgeSA9ICR7KHAueSAqIDEwMCkudG9GaXhlZCgxKX0lPGJyPmAgK1xuICAgICAgICBgzpRyID0gJHsocC5kZWx0YVIgPz8gMCkudG9GaXhlZCg0KX08YnI+YCArXG4gICAgICAgIGByIHdpdGhvdXQgdGhpcyBwb2ludCA9ICR7cC5yTWludXMgIT0gbnVsbCA/IHAuck1pbnVzLnRvRml4ZWQoMykgOiAn4oCUJ31gXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgLy8gVGhpbiBzdHJpcCBiZWxvdyB0aGUgYmFycyBjb2xvcmVkIGJ5IE1PQSB0byBzaG93IGNvaG9ydCBtZW1iZXJzaGlwXG4gICAgY29uc3QgbW9hU3RyaXAgPSBzb3J0ZWQubWFwKChwKSA9PiBtb2FDb2xvcltwLm1vYUtleV0gPz8gJyNiYmInKTtcblxuICAgIGNvbnN0IHRyYWNlczogYW55W10gPSBbXG4gICAgICB7XG4gICAgICAgIHg6IGxhYmVscyxcbiAgICAgICAgeTogZGVsdGFzLFxuICAgICAgICB0eXBlOiAnYmFyJyxcbiAgICAgICAgbWFya2VyOiB7IGNvbG9yOiBjb2xvcnMsIGxpbmU6IHsgY29sb3I6ICcjZmZmJywgd2lkdGg6IDAuNSB9IH0sXG4gICAgICAgIHRleHQ6IGhvdmVyLFxuICAgICAgICBob3ZlcmluZm86ICd0ZXh0JyxcbiAgICAgICAgbmFtZTogJ86UcicsXG4gICAgICB9LFxuICAgICAgLy8gTU9BIGNvbG9yIHN0cmlwIGFzIGEgc2Vjb25kIGJhciB0cmFjZSBhdCBhIHRpbnkgbmVnYXRpdmUgdmFsdWUsXG4gICAgICAvLyByZW5kZXJlZCBiZWxvdyB0aGUgbWFpbiBiYXJzLiBHaXZlcyBhIHF1aWNrIHZpc3VhbCBNT0EgY3VlLlxuICAgICAge1xuICAgICAgICB4OiBsYWJlbHMsXG4gICAgICAgIHk6IHNvcnRlZC5tYXAoKCkgPT4gLWphY2trbmlmZS5tYXhBYnNEZWx0YVIgKiAwLjA0IC0gMC4wMDIpLFxuICAgICAgICBiYXNlOiBzb3J0ZWQubWFwKCgpID0+IC1qYWNra25pZmUubWF4QWJzRGVsdGFSICogMC4wOCAtIDAuMDA0KSxcbiAgICAgICAgdHlwZTogJ2JhcicsXG4gICAgICAgIG1hcmtlcjogeyBjb2xvcjogbW9hU3RyaXAgfSxcbiAgICAgICAgaG92ZXJpbmZvOiAnc2tpcCcsXG4gICAgICAgIHNob3dsZWdlbmQ6IGZhbHNlLFxuICAgICAgICB5YXhpczogJ3knLFxuICAgICAgfSxcbiAgICBdO1xuXG4gICAgY29uc3QgbGF5b3V0OiBQYXJ0aWFsPFBsb3RseS5MYXlvdXQ+ID0ge1xuICAgICAgYmFybW9kZTogJ292ZXJsYXknLFxuICAgICAgaGVpZ2h0OiBNYXRoLm1pbig0MjAsIDIyMCArIE1hdGgubWF4KDAsIHNvcnRlZC5sZW5ndGggLSAyMCkgKiA2KSxcbiAgICAgIG1hcmdpbjogeyBsOiA2MCwgcjogMjAsIHQ6IDMwLCBiOiAxMTAgfSxcbiAgICAgIHhheGlzOiB7XG4gICAgICAgIHRpY2tmb250OiB7IHNpemU6IDExIH0sXG4gICAgICAgIHRpY2thbmdsZTogLTQ1LFxuICAgICAgICBhdXRvbWFyZ2luOiB0cnVlLFxuICAgICAgICB0aXRsZTogeyB0ZXh0OiAnJywgZm9udDogeyBzaXplOiAxMiB9IH0sXG4gICAgICB9LFxuICAgICAgeWF4aXM6IHtcbiAgICAgICAgdGl0bGU6IHsgdGV4dDogJ86UIFBlYXJzb24gcicsIGZvbnQ6IHsgc2l6ZTogMTMgfSB9LFxuICAgICAgICB6ZXJvbGluZTogdHJ1ZSxcbiAgICAgICAgemVyb2xpbmVjb2xvcjogJyMzMzMnLFxuICAgICAgICB6ZXJvbGluZXdpZHRoOiAxLFxuICAgICAgfSxcbiAgICAgIHNob3dsZWdlbmQ6IGZhbHNlLFxuICAgICAgcGxvdF9iZ2NvbG9yOiAnI2ZmZicsXG4gICAgICBob3Zlcm1vZGU6ICdjbG9zZXN0JyxcbiAgICAgIHNoYXBlczogW1xuICAgICAgICAvLyBEYXNoZWQgcmVmZXJlbmNlIGF0IM6UciA9IDBcbiAgICAgICAge1xuICAgICAgICAgIHR5cGU6ICdsaW5lJywgeHJlZjogJ3BhcGVyJywgeXJlZjogJ3knLFxuICAgICAgICAgIHgwOiAwLCB4MTogMSwgeTA6IDAsIHkxOiAwLFxuICAgICAgICAgIGxpbmU6IHsgY29sb3I6ICcjMzMzJywgd2lkdGg6IDEsIGRhc2g6ICdkb3QnIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG5cbiAgICBQbG90bHkubmV3UGxvdChpbmZsdWVuY2VSZWYuY3VycmVudCwgdHJhY2VzLCBsYXlvdXQsIHtcbiAgICAgIGRpc3BsYXlNb2RlQmFyOiB0cnVlLFxuICAgICAgcmVzcG9uc2l2ZTogdHJ1ZSxcbiAgICAgIHRvSW1hZ2VCdXR0b25PcHRpb25zOiB7XG4gICAgICAgIGZvcm1hdDogJ3N2ZycsXG4gICAgICAgIGZpbGVuYW1lOiAnbW9hX2luZmx1ZW5jZScsXG4gICAgICAgIHNjYWxlOiA0LFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSwgW2phY2trbmlmZSwgc2hvd0luZmx1ZW5jZVBsb3QsIHJlc3VsdHNdKTtcblxuICBjb25zdCBvdmVyYWxsUiA9ICgoKSA9PiB7XG4gICAgY29uc3QgeHM6IG51bWJlcltdID0gW10sIHlzOiBudW1iZXJbXSA9IFtdO1xuICAgIHJlc3VsdHMuZm9yRWFjaCgocikgPT4ge1xuICAgICAgY29uc3QgdGxpc3QgPSB0cmlhbHNGb3Iocik7XG4gICAgICBpZiAoYWdncmVnYXRpb24gPT09ICd0aGVyYXB5Jykge1xuICAgICAgICBhZ2dyZWdhdGVCeVRoZXJhcHkodGxpc3QpLmZvckVhY2goKHApID0+IHtcbiAgICAgICAgICB4cy5wdXNoKHAubWVhbk9icyk7XG4gICAgICAgICAgeXMucHVzaChwLm1lYW5QcmVkKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0bGlzdC5mb3JFYWNoKCh0KSA9PiB7XG4gICAgICAgICAgeHMucHVzaCh0LmFjdHVhbF9yZXNwb25zZV9yYXRlKTtcbiAgICAgICAgICB5cy5wdXNoKHQubWVhbl9wcmVkaWN0ZWRfcmF0ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiB7IHI6IHBlYXJzb24oeHMsIHlzKSwgcmhvOiBzcGVhcm1hbih4cywgeXMpLCBuOiB4cy5sZW5ndGggfTtcbiAgfSkoKTtcblxuICByZXR1cm4gKFxuICAgIDxkaXY+XG4gICAgICA8aDEgc3R5bGU9e3sgZm9udFNpemU6ICcxLjVyZW0nLCBtYXJnaW5Cb3R0b206ICcwLjVyZW0nIH19Pk1PQSBDb3JyZWxhdGlvbiBBbmFseXNpczwvaDE+XG4gICAgICA8cCBzdHlsZT17eyBjb2xvcjogJyM2NjYnLCBmb250U2l6ZTogJzAuODVyZW0nLCBtYXJnaW5Cb3R0b206ICcxcmVtJywgbWF4V2lkdGg6IDkwMCB9fT5cbiAgICAgICAgU2VsZWN0IG9uZSBvciBtb3JlIGRydWcgTWVjaGFuaXNtcyBvZiBBY3Rpb24uIE9SQUNMRSBydW5zIGEgdHJhaW5pbmcvdGVzdGluZyBzaW11bGF0aW9uXG4gICAgICAgIGZvciBlYWNoIE1PQSBncm91cCBhbmQgY29tcGFyZXMgdGhlIHByZWRpY3RlZCByZXNwb25zZS1yYXRlIGRpc3RyaWJ1dGlvbiBmb3IgZXZlcnlcbiAgICAgICAgdGVzdGluZyB0cmlhbCB0byB0aGF0IHRyaWFsJ3MgYWN0dWFsIG9ic2VydmVkIHJlc3BvbnNlIHJhdGUuIFRoZSBjb3JyZWxhdGlvbiBwbG90IGJlbG93XG4gICAgICAgIHNob3dzIGVhY2ggdGVzdGluZyB0cmlhbCBhcyBhIHBvaW50IOKAlCB4IGlzIHRoZSBvYnNlcnZlZCByYXRlLCB5IGlzIHRoZSBtZWFuIHByZWRpY3RlZFxuICAgICAgICByYXRlLCBhbmQgdGhlIHZlcnRpY2FsIGJhciBpcyDCsTEgU0Qgb2YgdGhlIHByZWRpY3Rpb24gcmFuZ2UuXG4gICAgICA8L3A+XG5cbiAgICAgIHsvKiBDb25maWd1cmF0aW9uICovfVxuICAgICAgPGRpdiBzdHlsZT17eyBiYWNrZ3JvdW5kOiAnI2ZmZicsIGJvcmRlcjogJzFweCBzb2xpZCAjZGRkJywgYm9yZGVyUmFkaXVzOiA4LCBwYWRkaW5nOiAnMXJlbScsIG1hcmdpbkJvdHRvbTogJzFyZW0nIH19PlxuICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdmbGV4JywgYWxpZ25JdGVtczogJ2NlbnRlcicsIGp1c3RpZnlDb250ZW50OiAnc3BhY2UtYmV0d2VlbicsIG1hcmdpbjogJzAgMCAwLjVyZW0nIH19PlxuICAgICAgICAgIDxoMyBzdHlsZT17eyBtYXJnaW46IDAsIGZvbnRTaXplOiAnMXJlbScgfX0+U2VsZWN0IE1PQXM8L2gzPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogJ2ZsZXgnLCBnYXA6IDYgfX0+XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgIG9uQ2xpY2s9eygpID0+IHNldFNlbGVjdGVkKGNhdGVnb3JpZXMubWFwKChjKSA9PiBjLnZhbHVlKSl9XG4gICAgICAgICAgICAgIGRpc2FibGVkPXtydW5uaW5nIHx8IGNhdGVnb3JpZXMubGVuZ3RoID09PSAwfVxuICAgICAgICAgICAgICBzdHlsZT17e1xuICAgICAgICAgICAgICAgIHBhZGRpbmc6ICcwLjNyZW0gMC43cmVtJywgZm9udFNpemU6ICcwLjc1cmVtJywgYm9yZGVyUmFkaXVzOiA0LFxuICAgICAgICAgICAgICAgIGJvcmRlcjogJzFweCBzb2xpZCAjNjM0Njk3JywgYmFja2dyb3VuZDogJyNmZmYnLCBjb2xvcjogJyM2MzQ2OTcnLFxuICAgICAgICAgICAgICAgIGN1cnNvcjogcnVubmluZyB8fCBjYXRlZ29yaWVzLmxlbmd0aCA9PT0gMCA/ICdub3QtYWxsb3dlZCcgOiAncG9pbnRlcicsXG4gICAgICAgICAgICAgICAgZm9udFdlaWdodDogNjAwLFxuICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICBTZWxlY3QgQWxsXG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gc2V0U2VsZWN0ZWQoW10pfVxuICAgICAgICAgICAgICBkaXNhYmxlZD17cnVubmluZyB8fCBzZWxlY3RlZC5sZW5ndGggPT09IDB9XG4gICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgcGFkZGluZzogJzAuM3JlbSAwLjdyZW0nLCBmb250U2l6ZTogJzAuNzVyZW0nLCBib3JkZXJSYWRpdXM6IDQsXG4gICAgICAgICAgICAgICAgYm9yZGVyOiAnMXB4IHNvbGlkICM5OTknLCBiYWNrZ3JvdW5kOiAnI2ZmZicsIGNvbG9yOiAnIzU1NScsXG4gICAgICAgICAgICAgICAgY3Vyc29yOiBydW5uaW5nIHx8IHNlbGVjdGVkLmxlbmd0aCA9PT0gMCA/ICdub3QtYWxsb3dlZCcgOiAncG9pbnRlcicsXG4gICAgICAgICAgICAgICAgZm9udFdlaWdodDogNjAwLFxuICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICBEZXNlbGVjdCBBbGxcbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiAnZmxleCcsIGZsZXhXcmFwOiAnd3JhcCcsIGdhcDogOCwgbWF4SGVpZ2h0OiAyMjAsIG92ZXJmbG93WTogJ2F1dG8nLCBwYWRkaW5nOiA0LCBib3JkZXI6ICcxcHggc29saWQgI2VlZScsIGJvcmRlclJhZGl1czogNiB9fT5cbiAgICAgICAgICB7Y2F0ZWdvcmllcy5tYXAoKGMpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzU2VsZWN0ZWQgPSBzZWxlY3RlZC5pbmNsdWRlcyhjLnZhbHVlKTtcbiAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICBrZXk9e2MudmFsdWV9XG4gICAgICAgICAgICAgICAgb25DbGljaz17KCkgPT4gdG9nZ2xlTU9BKGMudmFsdWUpfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXtydW5uaW5nfVxuICAgICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgICBwYWRkaW5nOiAnMC4zNXJlbSAwLjdyZW0nLFxuICAgICAgICAgICAgICAgICAgZm9udFNpemU6ICcwLjc4cmVtJyxcbiAgICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogMTYsXG4gICAgICAgICAgICAgICAgICBib3JkZXI6IGlzU2VsZWN0ZWQgPyAnMS41cHggc29saWQgIzYzNDY5NycgOiAnMXB4IHNvbGlkICNjY2MnLFxuICAgICAgICAgICAgICAgICAgYmFja2dyb3VuZDogaXNTZWxlY3RlZCA/ICcjNjM0Njk3JyA6ICcjZmFmYWZhJyxcbiAgICAgICAgICAgICAgICAgIGNvbG9yOiBpc1NlbGVjdGVkID8gJyNmZmYnIDogJyMzMzMnLFxuICAgICAgICAgICAgICAgICAgY3Vyc29yOiBydW5uaW5nID8gJ25vdC1hbGxvd2VkJyA6ICdwb2ludGVyJyxcbiAgICAgICAgICAgICAgICAgIGZvbnRXZWlnaHQ6IGMuaXNfZ3JvdXAgPyA2MDAgOiA0MDAsXG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICB0aXRsZT17YCR7Yy5kcnVnX2NvdW50fSBkcnVnKHMpYH1cbiAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIHtjLmNhdGVnb3J5fVxuICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSl9XG4gICAgICAgIDwvZGl2PlxuXG4gICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogJ2ZsZXgnLCBhbGlnbkl0ZW1zOiAnY2VudGVyJywgZ2FwOiAnMXJlbScsIG1hcmdpblRvcDogJzAuODVyZW0nIH19PlxuICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX0+XG4gICAgICAgICAgICBJdGVyYXRpb25zOiZuYnNwO1xuICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgIHR5cGU9XCJudW1iZXJcIlxuICAgICAgICAgICAgICBtaW49ezUwfVxuICAgICAgICAgICAgICBtYXg9ezIwMDB9XG4gICAgICAgICAgICAgIHN0ZXA9ezUwfVxuICAgICAgICAgICAgICB2YWx1ZT17bkl0ZXJhdGlvbnN9XG4gICAgICAgICAgICAgIGRpc2FibGVkPXtydW5uaW5nfVxuICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldE5JdGVyYXRpb25zKE1hdGgubWF4KDUwLCBNYXRoLm1pbigyMDAwLCBwYXJzZUludChlLnRhcmdldC52YWx1ZSkgfHwgNTAwKSkpfVxuICAgICAgICAgICAgICBzdHlsZT17eyB3aWR0aDogODAsIHBhZGRpbmc6ICcwLjI1cmVtIDAuNHJlbScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0IH19XG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JyB9fT5cbiAgICAgICAgICAgIFRyaWFsIHNldDombmJzcDtcbiAgICAgICAgICAgIDxzZWxlY3RcbiAgICAgICAgICAgICAgdmFsdWU9e3RyaWFsU2V0fVxuICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHN0b3JlLnNldFN0YXRlKHsgdHJpYWxTZXQ6IGUudGFyZ2V0LnZhbHVlIGFzIFRyaWFsU2V0IH0pfVxuICAgICAgICAgICAgICBzdHlsZT17eyBwYWRkaW5nOiAnMC4yNXJlbSAwLjRyZW0nLCBib3JkZXI6ICcxcHggc29saWQgI2NjYycsIGJvcmRlclJhZGl1czogNCwgZm9udFNpemU6ICcwLjhyZW0nIH19XG4gICAgICAgICAgICAgIHRpdGxlPVwiVXNlIG9ubHkgdGhlIGhlbGQtb3V0IHRlc3RpbmcgdHJpYWxzLCBvciBpbmNsdWRlIHRyYWluaW5nIHRyaWFscyB0b29cIlxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwidGVzdGluZ1wiPlRlc3Rpbmcgb25seTwvb3B0aW9uPlxuICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiYWxsXCI+QWxsICh0cmFpbmluZyArIHRlc3RpbmcpPC9vcHRpb24+XG4gICAgICAgICAgICA8L3NlbGVjdD5cbiAgICAgICAgICA8L2xhYmVsPlxuICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX0+XG4gICAgICAgICAgICBBZ2dyZWdhdGlvbjombmJzcDtcbiAgICAgICAgICAgIDxzZWxlY3RcbiAgICAgICAgICAgICAgdmFsdWU9e2FnZ3JlZ2F0aW9ufVxuICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldEFnZ3JlZ2F0aW9uKGUudGFyZ2V0LnZhbHVlIGFzIEFnZ3JlZ2F0aW9uKX1cbiAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuMjVyZW0gMC40cmVtJywgYm9yZGVyOiAnMXB4IHNvbGlkICNjY2MnLCBib3JkZXJSYWRpdXM6IDQsIGZvbnRTaXplOiAnMC44cmVtJyB9fVxuICAgICAgICAgICAgICB0aXRsZT1cIlBlci10cmlhbDogb25lIHBvaW50IHBlciB0cmlhbC4gUGVyLXRoZXJhcHk6IG9uZSBwb2ludCBwZXIgdW5pcXVlIGRydWcgKG1lYW4gwrEgU0QgYWNyb3NzIHRoYXQgZHJ1ZydzIHRyaWFscykuXCJcbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cInRyaWFsXCI+UGVyIHRyaWFsPC9vcHRpb24+XG4gICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJ0aGVyYXB5XCI+UGVyIHRoZXJhcHk8L29wdGlvbj5cbiAgICAgICAgICAgIDwvc2VsZWN0PlxuICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScsIGRpc3BsYXk6ICdmbGV4JywgYWxpZ25JdGVtczogJ2NlbnRlcicsIGdhcDogNCB9fVxuICAgICAgICAgICAgdGl0bGU9XCJTaG93IGhvcml6b250YWwgZXJyb3IgYmFycyAoU0Qgb2Ygb2JzZXJ2ZWQgcmF0ZXMgYWNyb3NzIHRoZSB0aGVyYXB5J3MgdHJpYWxzKS4gUGVyLXRoZXJhcHkgYWdncmVnYXRpb24gb25seS5cIlxuICAgICAgICAgID5cbiAgICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxuICAgICAgICAgICAgICBjaGVja2VkPXtzaG93WEVycm9yc31cbiAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRTaG93WEVycm9ycyhlLnRhcmdldC5jaGVja2VkKX1cbiAgICAgICAgICAgICAgZGlzYWJsZWQ9e2FnZ3JlZ2F0aW9uID09PSAndHJpYWwnfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIFggZXJyb3IgYmFyc1xuICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScsIGRpc3BsYXk6ICdmbGV4JywgYWxpZ25JdGVtczogJ2NlbnRlcicsIGdhcDogNCB9fVxuICAgICAgICAgICAgdGl0bGU9XCJTaG93IHZlcnRpY2FsIGVycm9yIGJhcnMgKFNEIG9mIHByZWRpY3RlZCByYXRlcykuXCJcbiAgICAgICAgICA+XG4gICAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgICAgdHlwZT1cImNoZWNrYm94XCJcbiAgICAgICAgICAgICAgY2hlY2tlZD17c2hvd1lFcnJvcnN9XG4gICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc2V0U2hvd1lFcnJvcnMoZS50YXJnZXQuY2hlY2tlZCl9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgWSBlcnJvciBiYXJzXG4gICAgICAgICAgPC9sYWJlbD5cbiAgICAgICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzg4OCcgfX0+XG4gICAgICAgICAgICB7c2VsZWN0ZWQubGVuZ3RofSBNT0F7c2VsZWN0ZWQubGVuZ3RoID09PSAxID8gJycgOiAncyd9IHNlbGVjdGVkXG4gICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZmxleDogMSB9fSAvPlxuICAgICAgICAgIHtydW5uaW5nID8gKFxuICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVDYW5jZWx9XG4gICAgICAgICAgICAgIHN0eWxlPXt7IHBhZGRpbmc6ICcwLjQ1cmVtIDFyZW0nLCBiYWNrZ3JvdW5kOiAnI2ExMmE4YicsIGNvbG9yOiAnI2ZmZicsIGJvcmRlcjogJ25vbmUnLCBib3JkZXJSYWRpdXM6IDQsIGN1cnNvcjogJ3BvaW50ZXInIH19XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgIENhbmNlbFxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgKSA6IChcbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgb25DbGljaz17aGFuZGxlUnVufVxuICAgICAgICAgICAgICBkaXNhYmxlZD17c2VsZWN0ZWQubGVuZ3RoID09PSAwfVxuICAgICAgICAgICAgICBzdHlsZT17e1xuICAgICAgICAgICAgICAgIHBhZGRpbmc6ICcwLjQ1cmVtIDFyZW0nLFxuICAgICAgICAgICAgICAgIGJhY2tncm91bmQ6IHNlbGVjdGVkLmxlbmd0aCA9PT0gMCA/ICcjYmJiJyA6ICcjNjM0Njk3JyxcbiAgICAgICAgICAgICAgICBjb2xvcjogJyNmZmYnLFxuICAgICAgICAgICAgICAgIGJvcmRlcjogJ25vbmUnLFxuICAgICAgICAgICAgICAgIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgICAgICAgICBjdXJzb3I6IHNlbGVjdGVkLmxlbmd0aCA9PT0gMCA/ICdub3QtYWxsb3dlZCcgOiAncG9pbnRlcicsXG4gICAgICAgICAgICAgICAgZm9udFdlaWdodDogNjAwLFxuICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICBSdW4gQ29ycmVsYXRpb24gQW5hbHlzaXNcbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICl9XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG5cbiAgICAgIHsvKiBCb290c3RyYXAgYW5hbHlzaXMgKyBwbG90IGRpc3BsYXkgY29udHJvbHMgKi99XG4gICAgICB7cmVzdWx0cy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgPGRpdiBzdHlsZT17eyBiYWNrZ3JvdW5kOiAnI2ZmZicsIGJvcmRlcjogJzFweCBzb2xpZCAjZGRkJywgYm9yZGVyUmFkaXVzOiA4LCBwYWRkaW5nOiAnMXJlbScsIG1hcmdpbkJvdHRvbTogJzFyZW0nIH19PlxuICAgICAgICAgIDxoMyBzdHlsZT17eyBtYXJnaW46ICcwIDAgMC41cmVtJywgZm9udFNpemU6ICcxcmVtJyB9fT5Cb290c3RyYXAgJmFtcDsgcGxvdCBjb250cm9sczwvaDM+XG4gICAgICAgICAgPHAgc3R5bGU9e3sgbWFyZ2luOiAnMCAwIDAuNzVyZW0nLCBjb2xvcjogJyM2NjYnLCBmb250U2l6ZTogJzAuNzhyZW0nLCBtYXhXaWR0aDogOTAwIH19PlxuICAgICAgICAgICAgQm9vdHN0cmFwIHJlc2FtcGxlcyB0aGUge2FnZ3JlZ2F0aW9uID09PSAndGhlcmFweScgPyAndGhlcmFwaWVzJyA6ICd0ZXN0aW5nIHRyaWFscyd9eycgJ31cbiAgICAgICAgICAgIGN1cnJlbnRseSBvbiB0aGUgcGxvdCB0byBlc3RpbWF0ZSBjb25maWRlbmNlIGludGVydmFscyBhcm91bmQgdGhlIGNvcnJlbGF0aW9uXG4gICAgICAgICAgICBjb2VmZmljaWVudHMgYW5kIHRvIGRyYXcgYSBDSSBiYW5kIGFyb3VuZCB0aGUgT0xTIGZpdCBsaW5lLlxuICAgICAgICAgICAgQ29tcHV0YXRpb24gcnVucyBjbGllbnQtc2lkZSDigJQgbm8gYmFja2VuZCBjYWxsLlxuICAgICAgICAgIDwvcD5cblxuICAgICAgICAgIHsvKiBCb290c3RyYXAgY29uZmlnIHJvdyAqL31cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdmbGV4JywgZmxleFdyYXA6ICd3cmFwJywgYWxpZ25JdGVtczogJ2NlbnRlcicsIGdhcDogJzAuOXJlbScsIG1hcmdpbkJvdHRvbTogJzAuNzVyZW0nIH19PlxuICAgICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JyB9fT5cbiAgICAgICAgICAgICAgSXRlcmF0aW9ucyBCOiZuYnNwO1xuICAgICAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgICAgICB0eXBlPVwibnVtYmVyXCJcbiAgICAgICAgICAgICAgICBtaW49ezEwMH0gbWF4PXsxMDAwMH0gc3RlcD17MTAwfVxuICAgICAgICAgICAgICAgIHZhbHVlPXtib290Q29uZmlnLkJ9XG4gICAgICAgICAgICAgICAgZGlzYWJsZWQ9e2Jvb3RSdW5uaW5nfVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT5cbiAgICAgICAgICAgICAgICAgIHNldEJvb3RDb25maWcoe1xuICAgICAgICAgICAgICAgICAgICBCOiBNYXRoLm1heCgxMDAsIE1hdGgubWluKDEwMDAwLCBwYXJzZUludChlLnRhcmdldC52YWx1ZSkgfHwgMjAwMCkpLFxuICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgd2lkdGg6IDgwLCBwYWRkaW5nOiAnMC4yNXJlbSAwLjRyZW0nLCBib3JkZXI6ICcxcHggc29saWQgI2NjYycsIGJvcmRlclJhZGl1czogNCB9fVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9sYWJlbD5cblxuICAgICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JyB9fVxuICAgICAgICAgICAgICAgICAgIHRpdGxlPVwiSG93IHBvaW50cyBhcmUgcmVzYW1wbGVkIGVhY2ggaXRlcmF0aW9uLiBTZWUgZG9jcy5cIj5cbiAgICAgICAgICAgICAgU2NoZW1lOiZuYnNwO1xuICAgICAgICAgICAgICA8c2VsZWN0XG4gICAgICAgICAgICAgICAgdmFsdWU9e2Jvb3RDb25maWcuc2NoZW1lfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXtib290UnVubmluZ31cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldEJvb3RDb25maWcoeyBzY2hlbWU6IGUudGFyZ2V0LnZhbHVlIGFzIFJlc2FtcGxpbmdTY2hlbWUgfSl9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuMjVyZW0gMC40cmVtJywgYm9yZGVyOiAnMXB4IHNvbGlkICNjY2MnLCBib3JkZXJSYWRpdXM6IDQsIGZvbnRTaXplOiAnMC44cmVtJyB9fVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cInRyaWFsXCI+VHJpYWwgcmVzYW1wbGUgKGNhc2UgYm9vdHN0cmFwKTwvb3B0aW9uPlxuICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJzaW11bGF0aW9uXCI+U2ltdWxhdGlvbiByZWRyYXcgKHBvaW50cyBmaXhlZCk8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwibmVzdGVkXCI+TmVzdGVkICh0cmlhbCArIHNpbXVsYXRpb24pPC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cInN0cmF0aWZpZWRcIj5TdHJhdGlmaWVkIGJ5IE1PQTwvb3B0aW9uPlxuICAgICAgICAgICAgICA8L3NlbGVjdD5cbiAgICAgICAgICAgIDwvbGFiZWw+XG5cbiAgICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX0+XG4gICAgICAgICAgICAgIENJIGxldmVsOiZuYnNwO1xuICAgICAgICAgICAgICA8c2VsZWN0XG4gICAgICAgICAgICAgICAgdmFsdWU9e2Jvb3RDb25maWcuY2lMZXZlbH1cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17Ym9vdFJ1bm5pbmd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRCb290Q29uZmlnKHsgY2lMZXZlbDogcGFyc2VGbG9hdChlLnRhcmdldC52YWx1ZSkgfSl9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuMjVyZW0gMC40cmVtJywgYm9yZGVyOiAnMXB4IHNvbGlkICNjY2MnLCBib3JkZXJSYWRpdXM6IDQsIGZvbnRTaXplOiAnMC44cmVtJyB9fVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT17MC45MH0+OTAlPC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT17MC45NX0+OTUlPC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT17MC45OX0+OTklPC9vcHRpb24+XG4gICAgICAgICAgICAgIDwvc2VsZWN0PlxuICAgICAgICAgICAgPC9sYWJlbD5cblxuICAgICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JyB9fVxuICAgICAgICAgICAgICAgICAgIHRpdGxlPVwiUGVyY2VudGlsZSA9IHNvcnQgJiB0cmltLiBCQ2EgPSBiaWFzLWNvcnJlY3RlZCArIGFjY2VsZXJhdGVkIChtb3JlIGFjY3VyYXRlIGZvciBza2V3ZWQgZGlzdHJpYnV0aW9ucykuXCI+XG4gICAgICAgICAgICAgIENJIG1ldGhvZDombmJzcDtcbiAgICAgICAgICAgICAgPHNlbGVjdFxuICAgICAgICAgICAgICAgIHZhbHVlPXtib290Q29uZmlnLmNpTWV0aG9kfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXtib290UnVubmluZ31cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldEJvb3RDb25maWcoeyBjaU1ldGhvZDogZS50YXJnZXQudmFsdWUgYXMgQ0lNZXRob2QgfSl9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuMjVyZW0gMC40cmVtJywgYm9yZGVyOiAnMXB4IHNvbGlkICNjY2MnLCBib3JkZXJSYWRpdXM6IDQsIGZvbnRTaXplOiAnMC44cmVtJyB9fVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cInBlcmNlbnRpbGVcIj5QZXJjZW50aWxlPC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cImJjYVwiPkJDYTwvb3B0aW9uPlxuICAgICAgICAgICAgICA8L3NlbGVjdD5cbiAgICAgICAgICAgIDwvbGFiZWw+XG5cbiAgICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX1cbiAgICAgICAgICAgICAgICAgICB0aXRsZT1cIkN1cnZlIGZpdCB1c2VkIHRvIGRyYXcgdGhlIENJIGJhbmQuIE9MUyA9IHNpbXBsZSBsaW5lYXIgcmVncmVzc2lvbi5cIj5cbiAgICAgICAgICAgICAgQmFuZCBjdXJ2ZTombmJzcDtcbiAgICAgICAgICAgICAgPHNlbGVjdFxuICAgICAgICAgICAgICAgIHZhbHVlPXtib290Q29uZmlnLmN1cnZlVHlwZX1cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17Ym9vdFJ1bm5pbmd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRCb290Q29uZmlnKHsgY3VydmVUeXBlOiBlLnRhcmdldC52YWx1ZSBhcyBDdXJ2ZVR5cGUgfSl9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuMjVyZW0gMC40cmVtJywgYm9yZGVyOiAnMXB4IHNvbGlkICNjY2MnLCBib3JkZXJSYWRpdXM6IDQsIGZvbnRTaXplOiAnMC44cmVtJyB9fVxuICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIm9sc1wiPk9MUyBsaW5lPC9vcHRpb24+XG4gICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIm5vbmVcIj5Ob25lIChzdGF0cyBvbmx5KTwvb3B0aW9uPlxuICAgICAgICAgICAgICA8L3NlbGVjdD5cbiAgICAgICAgICAgIDwvbGFiZWw+XG5cbiAgICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX1cbiAgICAgICAgICAgICAgICAgICB0aXRsZT1cIkJsYW5rID0gZnJlc2ggc2VlZCBlYWNoIHJ1bi4gQW55IGludGVnZXIgbWFrZXMgcmVzYW1wbGluZyByZXByb2R1Y2libGUuXCI+XG4gICAgICAgICAgICAgIFNlZWQ6Jm5ic3A7XG4gICAgICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgICAgIHR5cGU9XCJ0ZXh0XCJcbiAgICAgICAgICAgICAgICB2YWx1ZT17Ym9vdENvbmZpZy5zZWVkfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXtib290UnVubmluZ31cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHNldEJvb3RDb25maWcoeyBzZWVkOiBlLnRhcmdldC52YWx1ZSB9KX1cbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj1cIihyYW5kb20pXCJcbiAgICAgICAgICAgICAgICBzdHlsZT17eyB3aWR0aDogODAsIHBhZGRpbmc6ICcwLjI1cmVtIDAuNHJlbScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0IH19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2xhYmVsPlxuXG4gICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogJzAuNzhyZW0nLCBjb2xvcjogJyM4ODgnIH19PlxuICAgICAgICAgICAgICB7Ym9vdFBvaW50cy5sZW5ndGh9IHBvaW50e2Jvb3RQb2ludHMubGVuZ3RoID09PSAxID8gJycgOiAncyd9IGF2YWlsYWJsZVxuICAgICAgICAgICAgPC9zcGFuPlxuXG4gICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZsZXg6IDEgfX0gLz5cbiAgICAgICAgICAgIHtib290UmVzdWx0ICYmICFib290UnVubmluZyAmJiAoXG4gICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICBvbkNsaWNrPXtoYW5kbGVCb290Q2xlYXJ9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuNHJlbSAwLjlyZW0nLCBiYWNrZ3JvdW5kOiAnI2ZmZicsIGNvbG9yOiAnIzU1NScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0LCBjdXJzb3I6ICdwb2ludGVyJywgZm9udFNpemU6ICcwLjhyZW0nIH19XG4gICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICBDbGVhclxuICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgIG9uQ2xpY2s9e2hhbmRsZUJvb3RSdW59XG4gICAgICAgICAgICAgIGRpc2FibGVkPXtib290UnVubmluZyB8fCBib290UG9pbnRzLmxlbmd0aCA8IDN9XG4gICAgICAgICAgICAgIHN0eWxlPXt7XG4gICAgICAgICAgICAgICAgcGFkZGluZzogJzAuNDVyZW0gMXJlbScsXG4gICAgICAgICAgICAgICAgYmFja2dyb3VuZDogYm9vdFJ1bm5pbmcgfHwgYm9vdFBvaW50cy5sZW5ndGggPCAzID8gJyNiYmInIDogJyMwNTdmYTUnLFxuICAgICAgICAgICAgICAgIGNvbG9yOiAnI2ZmZicsIGJvcmRlcjogJ25vbmUnLCBib3JkZXJSYWRpdXM6IDQsXG4gICAgICAgICAgICAgICAgY3Vyc29yOiBib290UnVubmluZyB8fCBib290UG9pbnRzLmxlbmd0aCA8IDMgPyAnbm90LWFsbG93ZWQnIDogJ3BvaW50ZXInLFxuICAgICAgICAgICAgICAgIGZvbnRXZWlnaHQ6IDYwMCxcbiAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAge2Jvb3RSdW5uaW5nID8gJ1J1bm5pbmfigKYnIDogYm9vdFJlc3VsdCA/ICdSZS1ydW4gYm9vdHN0cmFwJyA6ICdSdW4gYm9vdHN0cmFwJ31cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuXG4gICAgICAgICAgey8qIFBsb3QgZGlzcGxheSB0b2dnbGVzICovfVxuICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZGlzcGxheTogJ2ZsZXgnLCBmbGV4V3JhcDogJ3dyYXAnLCBnYXA6ICcxcmVtJywgYWxpZ25JdGVtczogJ2NlbnRlcicsXG4gICAgICAgICAgICAgICAgICAgICAgICBwYWRkaW5nVG9wOiAnMC42cmVtJywgYm9yZGVyVG9wOiAnMXB4IHNvbGlkICNlZWUnIH19PlxuICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFNpemU6ICcwLjc4cmVtJywgY29sb3I6ICcjODg4JywgZm9udFdlaWdodDogNjAwIH19PlNob3cgb24gcGxvdDo8L3NwYW4+XG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnLCBkaXNwbGF5OiAnZmxleCcsIGFsaWduSXRlbXM6ICdjZW50ZXInLCBnYXA6IDQgfX0+XG4gICAgICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXG4gICAgICAgICAgICAgICAgY2hlY2tlZD17c2hvd1BvaW50c31cbiAgICAgICAgICAgICAgICBvbkNoYW5nZT17KGUpID0+IHN0b3JlLnNldFN0YXRlKHsgc2hvd1BvaW50czogZS50YXJnZXQuY2hlY2tlZCB9KX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgSW5kaXZpZHVhbCBwb2ludHNcbiAgICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnLCBkaXNwbGF5OiAnZmxleCcsIGFsaWduSXRlbXM6ICdjZW50ZXInLCBnYXA6IDQgfX0+XG4gICAgICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXG4gICAgICAgICAgICAgICAgY2hlY2tlZD17c2hvd0ZpdExpbmV9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzdG9yZS5zZXRTdGF0ZSh7IHNob3dGaXRMaW5lOiBlLnRhcmdldC5jaGVja2VkIH0pfVxuICAgICAgICAgICAgICAgIGRpc2FibGVkPXshYm9vdFJlc3VsdH1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgT0xTIGZpdCBsaW5lXG4gICAgICAgICAgICA8L2xhYmVsPlxuICAgICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JywgZGlzcGxheTogJ2ZsZXgnLCBhbGlnbkl0ZW1zOiAnY2VudGVyJywgZ2FwOiA0IH19PlxuICAgICAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxuICAgICAgICAgICAgICAgIGNoZWNrZWQ9e3Nob3dCYW5kfVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc3RvcmUuc2V0U3RhdGUoeyBzaG93QmFuZDogZS50YXJnZXQuY2hlY2tlZCB9KX1cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17IWJvb3RSZXN1bHR9XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgIENJIGJhbmRcbiAgICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnLCBkaXNwbGF5OiAnZmxleCcsIGFsaWduSXRlbXM6ICdjZW50ZXInLCBnYXA6IDQgfX0+XG4gICAgICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgICAgIHR5cGU9XCJjaGVja2JveFwiXG4gICAgICAgICAgICAgICAgY2hlY2tlZD17c2hvd1JlZkxpbmV9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzdG9yZS5zZXRTdGF0ZSh7IHNob3dSZWZMaW5lOiBlLnRhcmdldC5jaGVja2VkIH0pfVxuICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICB5ID0geCByZWZlcmVuY2VcbiAgICAgICAgICAgIDwvbGFiZWw+XG4gICAgICAgICAgICB7IWJvb3RSZXN1bHQgJiYgKFxuICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBmb250U2l6ZTogJzAuNzVyZW0nLCBjb2xvcjogJyNhYWEnIH19PlxuICAgICAgICAgICAgICAgIFJ1biBib290c3RyYXAgdG8gZW5hYmxlIGZpdCBsaW5lICZhbXA7IENJIGJhbmQuXG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgKX1cblxuICAgICAgey8qIFJvYnVzdG5lc3MgcGFuZWwgKGphY2trbmlmZSArIGxlYXZlLWstb3V0KSAqL31cbiAgICAgIHtyZXN1bHRzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICA8ZGl2IHN0eWxlPXt7IGJhY2tncm91bmQ6ICcjZmZmJywgYm9yZGVyOiAnMXB4IHNvbGlkICNkZGQnLCBib3JkZXJSYWRpdXM6IDgsIHBhZGRpbmc6ICcxcmVtJywgbWFyZ2luQm90dG9tOiAnMXJlbScgfX0+XG4gICAgICAgICAgPGgzIHN0eWxlPXt7IG1hcmdpbjogJzAgMCAwLjVyZW0nLCBmb250U2l6ZTogJzFyZW0nIH19PlJvYnVzdG5lc3MgYW5hbHlzaXM8L2gzPlxuICAgICAgICAgIDxwIHN0eWxlPXt7IG1hcmdpbjogJzAgMCAwLjc1cmVtJywgY29sb3I6ICcjNjY2JywgZm9udFNpemU6ICcwLjc4cmVtJywgbWF4V2lkdGg6IDkwMCB9fT5cbiAgICAgICAgICAgIFNlbnNpdGl2aXR5IHRvIGluZGl2aWR1YWwgcG9pbnRzLiA8c3Ryb25nPkphY2trbmlmZTwvc3Ryb25nPiByZWNvbXB1dGVzXG4gICAgICAgICAgICBQZWFyc29uIHIgLyBTcGVhcm1hbiDPgSAvIHRoZSBPTFMgc2xvcGUgd2l0aCBlYWNoIHBvaW50IHJlbW92ZWQgaW4gdHVybiDigJRcbiAgICAgICAgICAgIHRoZSBpbmZsdWVuY2UgcGxvdCBzaG93cyBob3cgbXVjaCBlYWNoIHBvaW50IG1vdmVzIHIuIDxzdHJvbmc+TGVhdmUtay1vdXQ8L3N0cm9uZz5cbiAgICAgICAgICAgIHJhbmRvbWx5IGRyb3BzIGsgcG9pbnRzIEIgdGltZXMgdG8gc2hvdyBob3cgbXVjaCByIHN3aW5ncyB1bmRlciBjaHVuayByZW1vdmFsLlxuICAgICAgICAgICAgVGhlc2UgYW5zd2VyIFwiZG9lcyBvbmUgdHJpYWwgY2FycnkgdGhlIHJlc3VsdD9cIiDigJQgY29tcGxlbWVudGFyeSB0byB0aGUgYm9vdHN0cmFwIENJLlxuICAgICAgICAgIDwvcD5cblxuICAgICAgICAgIHsvKiBMS08gY29uZmlnIHJvdyAqL31cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdmbGV4JywgZmxleFdyYXA6ICd3cmFwJywgYWxpZ25JdGVtczogJ2NlbnRlcicsIGdhcDogJzAuOXJlbScsIG1hcmdpbkJvdHRvbTogJzAuNzVyZW0nIH19PlxuICAgICAgICAgICAgPGxhYmVsIHN0eWxlPXt7IGZvbnRTaXplOiAnMC44cmVtJywgY29sb3I6ICcjNTU1JyB9fVxuICAgICAgICAgICAgICAgICAgIHRpdGxlPVwiTnVtYmVyIG9mIHBvaW50cyB0byByYW5kb21seSBkcm9wIGVhY2ggaXRlcmF0aW9uLlwiPlxuICAgICAgICAgICAgICBMZWF2ZSBrIG91dDombmJzcDtcbiAgICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgICAgdHlwZT1cIm51bWJlclwiXG4gICAgICAgICAgICAgICAgbWluPXsxfVxuICAgICAgICAgICAgICAgIG1heD17TWF0aC5tYXgoMSwgYm9vdFBvaW50cy5sZW5ndGggLSAzKX1cbiAgICAgICAgICAgICAgICBzdGVwPXsxfVxuICAgICAgICAgICAgICAgIHZhbHVlPXtsa29Db25maWcua31cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17cm9idXN0bmVzc1J1bm5pbmd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PlxuICAgICAgICAgICAgICAgICAgc2V0TGtvQ29uZmlnKHtcbiAgICAgICAgICAgICAgICAgICAgazogTWF0aC5tYXgoMSwgTWF0aC5taW4oXG4gICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoMSwgYm9vdFBvaW50cy5sZW5ndGggLSAzKSxcbiAgICAgICAgICAgICAgICAgICAgICBwYXJzZUludChlLnRhcmdldC52YWx1ZSkgfHwgMSxcbiAgICAgICAgICAgICAgICAgICAgKSksXG4gICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzdHlsZT17eyB3aWR0aDogNjAsIHBhZGRpbmc6ICcwLjI1cmVtIDAuNHJlbScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0IH19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiAnI2FhYScsIG1hcmdpbkxlZnQ6IDQgfX0+XG4gICAgICAgICAgICAgICAgLyB7Ym9vdFBvaW50cy5sZW5ndGh9XG4gICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgIDwvbGFiZWw+XG5cbiAgICAgICAgICAgIDxsYWJlbCBzdHlsZT17eyBmb250U2l6ZTogJzAuOHJlbScsIGNvbG9yOiAnIzU1NScgfX0+XG4gICAgICAgICAgICAgIEl0ZXJhdGlvbnMgQjombmJzcDtcbiAgICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgICAgdHlwZT1cIm51bWJlclwiXG4gICAgICAgICAgICAgICAgbWluPXsxMDB9IG1heD17MTAwMDB9IHN0ZXA9ezEwMH1cbiAgICAgICAgICAgICAgICB2YWx1ZT17bGtvQ29uZmlnLkJ9XG4gICAgICAgICAgICAgICAgZGlzYWJsZWQ9e3JvYnVzdG5lc3NSdW5uaW5nfVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT5cbiAgICAgICAgICAgICAgICAgIHNldExrb0NvbmZpZyh7XG4gICAgICAgICAgICAgICAgICAgIEI6IE1hdGgubWF4KDEwMCwgTWF0aC5taW4oMTAwMDAsIHBhcnNlSW50KGUudGFyZ2V0LnZhbHVlKSB8fCAxMDAwKSksXG4gICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzdHlsZT17eyB3aWR0aDogODAsIHBhZGRpbmc6ICcwLjI1cmVtIDAuNHJlbScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0IH19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2xhYmVsPlxuXG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnIH19PlxuICAgICAgICAgICAgICBDSSBsZXZlbDombmJzcDtcbiAgICAgICAgICAgICAgPHNlbGVjdFxuICAgICAgICAgICAgICAgIHZhbHVlPXtsa29Db25maWcuY2lMZXZlbH1cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17cm9idXN0bmVzc1J1bm5pbmd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRMa29Db25maWcoeyBjaUxldmVsOiBwYXJzZUZsb2F0KGUudGFyZ2V0LnZhbHVlKSB9KX1cbiAgICAgICAgICAgICAgICBzdHlsZT17eyBwYWRkaW5nOiAnMC4yNXJlbSAwLjRyZW0nLCBib3JkZXI6ICcxcHggc29saWQgI2NjYycsIGJvcmRlclJhZGl1czogNCwgZm9udFNpemU6ICcwLjhyZW0nIH19XG4gICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPXswLjkwfT45MCU8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPXswLjk1fT45NSU8L29wdGlvbj5cbiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPXswLjk5fT45OSU8L29wdGlvbj5cbiAgICAgICAgICAgICAgPC9zZWxlY3Q+XG4gICAgICAgICAgICA8L2xhYmVsPlxuXG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnIH19XG4gICAgICAgICAgICAgICAgICAgdGl0bGU9XCJCbGFuayA9IGZyZXNoIHNlZWQgZWFjaCBydW4uIEFueSBpbnRlZ2VyIG1ha2VzIGxlYXZlLWstb3V0IHJlcHJvZHVjaWJsZS5cIj5cbiAgICAgICAgICAgICAgU2VlZDombmJzcDtcbiAgICAgICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICAgICAgdHlwZT1cInRleHRcIlxuICAgICAgICAgICAgICAgIHZhbHVlPXtsa29Db25maWcuc2VlZH1cbiAgICAgICAgICAgICAgICBkaXNhYmxlZD17cm9idXN0bmVzc1J1bm5pbmd9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2U9eyhlKSA9PiBzZXRMa29Db25maWcoeyBzZWVkOiBlLnRhcmdldC52YWx1ZSB9KX1cbiAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj1cIihyYW5kb20pXCJcbiAgICAgICAgICAgICAgICBzdHlsZT17eyB3aWR0aDogODAsIHBhZGRpbmc6ICcwLjI1cmVtIDAuNHJlbScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0IH19XG4gICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2xhYmVsPlxuXG4gICAgICAgICAgICA8bGFiZWwgc3R5bGU9e3sgZm9udFNpemU6ICcwLjhyZW0nLCBjb2xvcjogJyM1NTUnLCBkaXNwbGF5OiAnZmxleCcsIGFsaWduSXRlbXM6ICdjZW50ZXInLCBnYXA6IDQgfX1cbiAgICAgICAgICAgICAgICAgICB0aXRsZT1cIlNob3cgdGhlIHBlci1wb2ludCDOlHIgYmFyIGNoYXJ0IGJlbG93LlwiPlxuICAgICAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgICAgICB0eXBlPVwiY2hlY2tib3hcIlxuICAgICAgICAgICAgICAgIGNoZWNrZWQ9e3Nob3dJbmZsdWVuY2VQbG90fVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlPXsoZSkgPT4gc3RvcmUuc2V0U3RhdGUoeyBzaG93SW5mbHVlbmNlUGxvdDogZS50YXJnZXQuY2hlY2tlZCB9KX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgSW5mbHVlbmNlIHBsb3RcbiAgICAgICAgICAgIDwvbGFiZWw+XG5cbiAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZmxleDogMSB9fSAvPlxuICAgICAgICAgICAgeyhqYWNra25pZmUgfHwgbGVhdmVLT3V0KSAmJiAhcm9idXN0bmVzc1J1bm5pbmcgJiYgKFxuICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgb25DbGljaz17aGFuZGxlUm9iQ2xlYXJ9XG4gICAgICAgICAgICAgICAgc3R5bGU9e3sgcGFkZGluZzogJzAuNHJlbSAwLjlyZW0nLCBiYWNrZ3JvdW5kOiAnI2ZmZicsIGNvbG9yOiAnIzU1NScsIGJvcmRlcjogJzFweCBzb2xpZCAjY2NjJywgYm9yZGVyUmFkaXVzOiA0LCBjdXJzb3I6ICdwb2ludGVyJywgZm9udFNpemU6ICcwLjhyZW0nIH19XG4gICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICBDbGVhclxuICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgIG9uQ2xpY2s9e2hhbmRsZVJvYlJ1bn1cbiAgICAgICAgICAgICAgZGlzYWJsZWQ9e3JvYnVzdG5lc3NSdW5uaW5nIHx8IGJvb3RQb2ludHMubGVuZ3RoIDwgNH1cbiAgICAgICAgICAgICAgc3R5bGU9e3tcbiAgICAgICAgICAgICAgICBwYWRkaW5nOiAnMC40NXJlbSAxcmVtJyxcbiAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kOiByb2J1c3RuZXNzUnVubmluZyB8fCBib290UG9pbnRzLmxlbmd0aCA8IDQgPyAnI2JiYicgOiAnIzAwODk3YicsXG4gICAgICAgICAgICAgICAgY29sb3I6ICcjZmZmJywgYm9yZGVyOiAnbm9uZScsIGJvcmRlclJhZGl1czogNCxcbiAgICAgICAgICAgICAgICBjdXJzb3I6IHJvYnVzdG5lc3NSdW5uaW5nIHx8IGJvb3RQb2ludHMubGVuZ3RoIDwgNCA/ICdub3QtYWxsb3dlZCcgOiAncG9pbnRlcicsXG4gICAgICAgICAgICAgICAgZm9udFdlaWdodDogNjAwLFxuICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICB7cm9idXN0bmVzc1J1bm5pbmdcbiAgICAgICAgICAgICAgICA/ICdSdW5uaW5n4oCmJ1xuICAgICAgICAgICAgICAgIDogKGphY2trbmlmZSB8fCBsZWF2ZUtPdXQpID8gJ1JlLXJ1biByb2J1c3RuZXNzJyA6ICdSdW4gcm9idXN0bmVzcyd9XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICA8L2Rpdj5cblxuICAgICAgICAgIHsvKiBTdW1tYXJ5IHN0YXRzICovfVxuICAgICAgICAgIHsoamFja2tuaWZlIHx8IGxlYXZlS091dCkgJiYgKFxuICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBkaXNwbGF5OiAnZ3JpZCcsIGdyaWRUZW1wbGF0ZUNvbHVtbnM6ICdyZXBlYXQoYXV0by1maWxsLCBtaW5tYXgoMTcwcHgsIDFmcikpJywgZ2FwOiAnMC41cmVtJywgbWFyZ2luVG9wOiAnMC41cmVtJyB9fT5cbiAgICAgICAgICAgICAge2phY2trbmlmZSAmJiAoXG4gICAgICAgICAgICAgICAgPD5cbiAgICAgICAgICAgICAgICAgIDxTdGF0Q2VsbFxuICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIm1heCB8zpRyfCAoYW55IG9uZSBwb2ludClcIlxuICAgICAgICAgICAgICAgICAgICB2YWx1ZT17amFja2tuaWZlLm1heEFic0RlbHRhUi50b0ZpeGVkKDMpfVxuICAgICAgICAgICAgICAgICAgICBoaW50PVwiTGFyZ2VzdCBzd2luZyBpbiBQZWFyc29uIHIgZnJvbSByZW1vdmluZyBhIHNpbmdsZSBwb2ludC5cIlxuICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgIDxTdGF0Q2VsbFxuICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIm1heCB8zpTPgXxcIlxuICAgICAgICAgICAgICAgICAgICB2YWx1ZT17amFja2tuaWZlLm1heEFic0RlbHRhUmhvLnRvRml4ZWQoMyl9XG4gICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgPFN0YXRDZWxsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPVwibWF4IHzOlCBzbG9wZXxcIlxuICAgICAgICAgICAgICAgICAgICB2YWx1ZT17amFja2tuaWZlLm1heEFic0RlbHRhU2xvcGUudG9GaXhlZCgzKX1cbiAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC8+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgIHtsZWF2ZUtPdXQgJiYgbGVhdmVLT3V0LnJSYW5nZSAmJiAoXG4gICAgICAgICAgICAgICAgPFN0YXRDZWxsXG4gICAgICAgICAgICAgICAgICBsYWJlbD17YHIgcmFuZ2UsIGxlYXZlLSR7bGVhdmVLT3V0LmNvbmZpZy5rfS1vdXRgfVxuICAgICAgICAgICAgICAgICAgdmFsdWU9e2BbJHtsZWF2ZUtPdXQuclJhbmdlWzBdLnRvRml4ZWQoMyl9LCAke2xlYXZlS091dC5yUmFuZ2VbMV0udG9GaXhlZCgzKX1dYH1cbiAgICAgICAgICAgICAgICAgIGhpbnQ9e2BNaW4gLyBtYXggciBhY3Jvc3MgJHtsZWF2ZUtPdXQuY29uZmlnLkJ9IHJhbmRvbSBrLWRyb3BzLmB9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAge2xlYXZlS091dCAmJiBsZWF2ZUtPdXQuckNJICYmIChcbiAgICAgICAgICAgICAgICA8U3RhdENlbGxcbiAgICAgICAgICAgICAgICAgIGxhYmVsPXtgJHtNYXRoLnJvdW5kKGxlYXZlS091dC5jb25maWcuY2lMZXZlbCAqIDEwMCl9JSByIGJhbmRgfVxuICAgICAgICAgICAgICAgICAgdmFsdWU9e2BbJHtsZWF2ZUtPdXQuckNJWzBdLnRvRml4ZWQoMyl9LCAke2xlYXZlS091dC5yQ0lbMV0udG9GaXhlZCgzKX1dYH1cbiAgICAgICAgICAgICAgICAgIGhpbnQ9e2BQZXJjZW50aWxlIGJhbmQgb2YgciBhY3Jvc3Mgay1kcm9wIHJlc2FtcGxlcy4gTm90IGEgY29uZmlkZW5jZSBpbnRlcnZhbCDigJQgcmVhZCBhcyBcImlmIEkgZHJvcHBlZCBrIHJhbmRvbSBwb2ludHMsIHIgdXN1YWxseSBsYW5kcyBoZXJlLlwiYH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICB7bGVhdmVLT3V0ICYmIGxlYXZlS091dC5yaG9DSSAmJiAoXG4gICAgICAgICAgICAgICAgPFN0YXRDZWxsXG4gICAgICAgICAgICAgICAgICBsYWJlbD17YCR7TWF0aC5yb3VuZChsZWF2ZUtPdXQuY29uZmlnLmNpTGV2ZWwgKiAxMDApfSUgz4EgYmFuZGB9XG4gICAgICAgICAgICAgICAgICB2YWx1ZT17YFske2xlYXZlS091dC5yaG9DSVswXS50b0ZpeGVkKDMpfSwgJHtsZWF2ZUtPdXQucmhvQ0lbMV0udG9GaXhlZCgzKX1dYH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgKX1cblxuICAgICAgICAgIHsvKiBJbmZsdWVuY2UgcGxvdCAqL31cbiAgICAgICAgICB7amFja2tuaWZlICYmIHNob3dJbmZsdWVuY2VQbG90ICYmIGphY2trbmlmZS5pbmZsdWVuY2UubGVuZ3RoID4gMCAmJiAoXG4gICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IG1hcmdpblRvcDogJzFyZW0nIH19PlxuICAgICAgICAgICAgICA8aDQgc3R5bGU9e3sgbWFyZ2luOiAnMCAwIDAuNHJlbScsIGZvbnRTaXplOiAnMC44OHJlbScgfX0+XG4gICAgICAgICAgICAgICAgSW5mbHVlbmNlIHBsb3Qg4oCUIM6UIFBlYXJzb24gciB3aGVuIGVhY2ggcG9pbnQgaXMgcmVtb3ZlZFxuICAgICAgICAgICAgICA8L2g0PlxuICAgICAgICAgICAgICA8cCBzdHlsZT17eyBtYXJnaW46ICcwIDAgMC41cmVtJywgY29sb3I6ICcjODg4JywgZm9udFNpemU6ICcwLjcycmVtJyB9fT5cbiAgICAgICAgICAgICAgICBCYXJzIGFib3ZlIHplcm86IHJlbW92aW5nIHRoYXQgcG9pbnQgPGVtPmluY3JlYXNlczwvZW0+IHIgKHBvaW50IHdhcyBwdWxsaW5nIHIgZG93bikuXG4gICAgICAgICAgICAgICAgQmFycyBiZWxvdyB6ZXJvOiByZW1vdmluZyB0aGF0IHBvaW50IDxlbT5kZWNyZWFzZXM8L2VtPiByIChwb2ludCBzdXBwb3J0cyB0aGUgY29ycmVsYXRpb24pLlxuICAgICAgICAgICAgICA8L3A+XG4gICAgICAgICAgICAgIDxkaXYgcmVmPXtpbmZsdWVuY2VSZWZ9IHN0eWxlPXt7IHdpZHRoOiAnMTAwJScgfX0gLz5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICl9XG4gICAgICAgIDwvZGl2PlxuICAgICAgKX1cblxuICAgICAgey8qIFJ1biBwcm9ncmVzcyAqL31cbiAgICAgIHtzdGF0dXNlcy5sZW5ndGggPiAwICYmIChcbiAgICAgICAgPGRpdiBzdHlsZT17eyBiYWNrZ3JvdW5kOiAnI2ZmZicsIGJvcmRlcjogJzFweCBzb2xpZCAjZGRkJywgYm9yZGVyUmFkaXVzOiA4LCBwYWRkaW5nOiAnMXJlbScsIG1hcmdpbkJvdHRvbTogJzFyZW0nIH19PlxuICAgICAgICAgIDxoMyBzdHlsZT17eyBtYXJnaW46ICcwIDAgMC41cmVtJywgZm9udFNpemU6ICcwLjk1cmVtJyB9fT5TaW11bGF0aW9uIFByb2dyZXNzPC9oMz5cbiAgICAgICAgICB7c3RhdHVzZXMubWFwKChzKSA9PiAoXG4gICAgICAgICAgICA8ZGl2IGtleT17cy5tb2FfdmFsdWV9IHN0eWxlPXt7IG1hcmdpbkJvdHRvbTogNiwgZm9udFNpemU6ICcwLjhyZW0nIH19PlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdmbGV4JywganVzdGlmeUNvbnRlbnQ6ICdzcGFjZS1iZXR3ZWVuJyB9fT5cbiAgICAgICAgICAgICAgICA8c3Bhbj48c3Ryb25nPntzLm1vYV9sYWJlbH08L3N0cm9uZz4g4oCUIDxzcGFuIHN0eWxlPXt7IGNvbG9yOiBzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlJyA/ICcjMmU3ZDMyJyA6IHMuc3RhdHVzID09PSAnZXJyb3InID8gJyNjNjI4MjgnIDogJyM1NTUnIH19PntzLnN0YXR1c308L3NwYW4+IHtzLnN0YWdlICYmIGAoJHtzLnN0YWdlfSlgfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBzdHlsZT17eyBjb2xvcjogJyM4ODgnIH19PntzLnBjdCA/IGAke01hdGgucm91bmQocy5wY3QpfSVgIDogJyd9PC9zcGFuPlxuICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICAge3Muc3RhdHVzICE9PSAnY29tcGxldGUnICYmIHMuc3RhdHVzICE9PSAnZXJyb3InICYmIChcbiAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGhlaWdodDogNCwgYmFja2dyb3VuZDogJyNlZWUnLCBib3JkZXJSYWRpdXM6IDIsIG92ZXJmbG93OiAnaGlkZGVuJywgbWFyZ2luVG9wOiAyIH19PlxuICAgICAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyB3aWR0aDogYCR7cy5wY3QgfHwgMH0lYCwgaGVpZ2h0OiAnMTAwJScsIGJhY2tncm91bmQ6ICcjNjM0Njk3JywgdHJhbnNpdGlvbjogJ3dpZHRoIDAuM3MnIH19IC8+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgIHtzLmVycm9yICYmIDxkaXYgc3R5bGU9e3sgY29sb3I6ICcjYzYyODI4JywgZm9udFNpemU6ICcwLjc1cmVtJyB9fT57cy5lcnJvcn08L2Rpdj59XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICApKX1cbiAgICAgICAgPC9kaXY+XG4gICAgICApfVxuXG4gICAgICB7LyogQ29ycmVsYXRpb24gcmVzdWx0cyAqL31cbiAgICAgIHtyZXN1bHRzLmxlbmd0aCA+IDAgJiYgKFxuICAgICAgICA8ZGl2IHN0eWxlPXt7IGJhY2tncm91bmQ6ICcjZmZmJywgYm9yZGVyOiAnMXB4IHNvbGlkICNkZGQnLCBib3JkZXJSYWRpdXM6IDgsIHBhZGRpbmc6ICcxcmVtJywgbWFyZ2luQm90dG9tOiAnMXJlbScgfX0+XG4gICAgICAgICAgPGgzIHN0eWxlPXt7IG1hcmdpbjogJzAgMCAwLjc1cmVtJywgZm9udFNpemU6ICcxcmVtJyB9fT5Db3JyZWxhdGlvbiBQbG90PC9oMz5cbiAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGRpc3BsYXk6ICdncmlkJywgZ3JpZFRlbXBsYXRlQ29sdW1uczogJ3JlcGVhdChhdXRvLWZpbGwsIG1pbm1heCgxNjBweCwgMWZyKSknLCBnYXA6ICcwLjVyZW0nLCBtYXJnaW5Cb3R0b206ICcwLjc1cmVtJyB9fT5cbiAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgdGV4dEFsaWduOiAnY2VudGVyJywgcGFkZGluZzogJzAuNXJlbScsIGJhY2tncm91bmQ6ICcjZjhmOWZhJywgYm9yZGVyUmFkaXVzOiA2IH19PlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMS4xcmVtJywgZm9udFdlaWdodDogNzAwLCBjb2xvcjogJyMxYzNlNzInIH19PntvdmVyYWxsUi5ufTwvZGl2PlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMC43cmVtJywgY29sb3I6ICcjODg4JyB9fT57YWdncmVnYXRpb24gPT09ICd0aGVyYXB5JyA/ICdUaGVyYXBpZXMnIDogJ1Rlc3RpbmcgVHJpYWxzJ308L2Rpdj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgPGRpdiBzdHlsZT17eyB0ZXh0QWxpZ246ICdjZW50ZXInLCBwYWRkaW5nOiAnMC41cmVtJywgYmFja2dyb3VuZDogJyNmOGY5ZmEnLCBib3JkZXJSYWRpdXM6IDYgfX0+XG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFNpemU6ICcxLjFyZW0nLCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiAnIzFjM2U3MicgfX0+e292ZXJhbGxSLnIgIT0gbnVsbCA/IG92ZXJhbGxSLnIudG9GaXhlZCgzKSA6ICfigJQnfTwvZGl2PlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMC43cmVtJywgY29sb3I6ICcjODg4JyB9fT5QZWFyc29uIHI8L2Rpdj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgPGRpdiBzdHlsZT17eyB0ZXh0QWxpZ246ICdjZW50ZXInLCBwYWRkaW5nOiAnMC41cmVtJywgYmFja2dyb3VuZDogJyNmOGY5ZmEnLCBib3JkZXJSYWRpdXM6IDYgfX0+XG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFNpemU6ICcxLjFyZW0nLCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiAnIzFjM2U3MicgfX0+e292ZXJhbGxSLnJobyAhPSBudWxsID8gb3ZlcmFsbFIucmhvLnRvRml4ZWQoMykgOiAn4oCUJ308L2Rpdj5cbiAgICAgICAgICAgICAgPGRpdiBzdHlsZT17eyBmb250U2l6ZTogJzAuN3JlbScsIGNvbG9yOiAnIzg4OCcgfX0+U3BlYXJtYW4gz4E8L2Rpdj5cbiAgICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgICAgPGRpdiBzdHlsZT17eyB0ZXh0QWxpZ246ICdjZW50ZXInLCBwYWRkaW5nOiAnMC41cmVtJywgYmFja2dyb3VuZDogJyNmOGY5ZmEnLCBib3JkZXJSYWRpdXM6IDYgfX0+XG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9e3sgZm9udFNpemU6ICcxLjFyZW0nLCBmb250V2VpZ2h0OiA3MDAsIGNvbG9yOiAnIzFjM2U3MicgfX0+e3Jlc3VsdHMubGVuZ3RofTwvZGl2PlxuICAgICAgICAgICAgICA8ZGl2IHN0eWxlPXt7IGZvbnRTaXplOiAnMC43cmVtJywgY29sb3I6ICcjODg4JyB9fT5NT0EgR3JvdXBzPC9kaXY+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8ZGl2IHJlZj17cGxvdFJlZn0gc3R5bGU9e3sgd2lkdGg6ICcxMDAlJyB9fSAvPlxuXG4gICAgICAgICAgey8qIFBlci1NT0EgY29ycmVsYXRpb25zICovfVxuICAgICAgICAgIDxoNCBzdHlsZT17eyBtYXJnaW5Ub3A6ICcxcmVtJywgbWFyZ2luQm90dG9tOiAnMC41cmVtJywgZm9udFNpemU6ICcwLjlyZW0nIH19PlxuICAgICAgICAgICAgUGVyLU1PQSBDb3JyZWxhdGlvbnNcbiAgICAgICAgICAgIHtib290UmVzdWx0ICYmIChcbiAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3sgZm9udFdlaWdodDogNDAwLCBjb2xvcjogJyM4ODgnLCBmb250U2l6ZTogJzAuNzhyZW0nLCBtYXJnaW5MZWZ0OiA4IH19PlxuICAgICAgICAgICAgICAgIChDSXMgZnJvbSBCID0ge2Jvb3RSZXN1bHQuY29uZmlnLkJ9LCB7TWF0aC5yb3VuZChib290UmVzdWx0LmNvbmZpZy5jaUxldmVsICogMTAwKX0leycgJ31cbiAgICAgICAgICAgICAgICB7Ym9vdFJlc3VsdC5jb25maWcuY2lNZXRob2QgPT09ICdiY2EnID8gJ0JDYScgOiAncGVyY2VudGlsZSd9KVxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICApfVxuICAgICAgICAgIDwvaDQ+XG4gICAgICAgICAgPHRhYmxlIHN0eWxlPXt7IHdpZHRoOiAnMTAwJScsIGJvcmRlckNvbGxhcHNlOiAnY29sbGFwc2UnLCBmb250U2l6ZTogJzAuOHJlbScgfX0+XG4gICAgICAgICAgICA8dGhlYWQ+XG4gICAgICAgICAgICAgIDx0ciBzdHlsZT17eyBiYWNrZ3JvdW5kOiAnI2YwZjBmMCcgfX0+XG4gICAgICAgICAgICAgICAgPHRoIHN0eWxlPXt7IHRleHRBbGlnbjogJ2xlZnQnLCBwYWRkaW5nOiAnMC40cmVtJyB9fT5NT0E8L3RoPlxuICAgICAgICAgICAgICAgIDx0aCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nIH19Pm48L3RoPlxuICAgICAgICAgICAgICAgIDx0aCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nIH19PlBlYXJzb24gcjwvdGg+XG4gICAgICAgICAgICAgICAge2Jvb3RSZXN1bHQgJiYgPHRoIHN0eWxlPXt7IHRleHRBbGlnbjogJ3JpZ2h0JywgcGFkZGluZzogJzAuNHJlbScgfX0+ciBDSTwvdGg+fVxuICAgICAgICAgICAgICAgIDx0aCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nIH19PlNwZWFybWFuIM+BPC90aD5cbiAgICAgICAgICAgICAgICB7Ym9vdFJlc3VsdCAmJiA8dGggc3R5bGU9e3sgdGV4dEFsaWduOiAncmlnaHQnLCBwYWRkaW5nOiAnMC40cmVtJyB9fT7PgSBDSTwvdGg+fVxuICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgPC90aGVhZD5cbiAgICAgICAgICAgIDx0Ym9keT5cbiAgICAgICAgICAgICAge3Jlc3VsdHMubWFwKChyLCBpZHgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB0bGlzdCA9IHRyaWFsc0ZvcihyKTtcbiAgICAgICAgICAgICAgICBsZXQgeHM6IG51bWJlcltdO1xuICAgICAgICAgICAgICAgIGxldCB5czogbnVtYmVyW107XG4gICAgICAgICAgICAgICAgaWYgKGFnZ3JlZ2F0aW9uID09PSAndGhlcmFweScpIHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IHB0cyA9IGFnZ3JlZ2F0ZUJ5VGhlcmFweSh0bGlzdCk7XG4gICAgICAgICAgICAgICAgICB4cyA9IHB0cy5tYXAoKHApID0+IHAubWVhbk9icyk7XG4gICAgICAgICAgICAgICAgICB5cyA9IHB0cy5tYXAoKHApID0+IHAubWVhblByZWQpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICB4cyA9IHRsaXN0Lm1hcCgodCkgPT4gdC5hY3R1YWxfcmVzcG9uc2VfcmF0ZSk7XG4gICAgICAgICAgICAgICAgICB5cyA9IHRsaXN0Lm1hcCgodCkgPT4gdC5tZWFuX3ByZWRpY3RlZF9yYXRlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29uc3QgcHIgPSBwZWFyc29uKHhzLCB5cyk7XG4gICAgICAgICAgICAgICAgY29uc3Qgc3IgPSBzcGVhcm1hbih4cywgeXMpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG1vYVN0YXRzID0gYm9vdFJlc3VsdCA/IGJvb3RSZXN1bHQucGVyTW9hW3IubW9hX3ZhbHVlXSA6IG51bGw7XG4gICAgICAgICAgICAgICAgY29uc3QgZm10Q0kgPSAoY2k6IFtudW1iZXIsIG51bWJlcl0gfCBudWxsIHwgdW5kZWZpbmVkKSA9PlxuICAgICAgICAgICAgICAgICAgY2kgPyBgWyR7Y2lbMF0udG9GaXhlZCgzKX0sICR7Y2lbMV0udG9GaXhlZCgzKX1dYCA6ICfigJQnO1xuICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICA8dHIga2V5PXtyLm1vYV92YWx1ZX0gc3R5bGU9e3sgYm9yZGVyVG9wOiAnMXB4IHNvbGlkICNlZWUnIH19PlxuICAgICAgICAgICAgICAgICAgICA8dGQgc3R5bGU9e3sgcGFkZGluZzogJzAuNHJlbScgfX0+XG4gICAgICAgICAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9e3tcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3BsYXk6ICdpbmxpbmUtYmxvY2snLCB3aWR0aDogMTAsIGhlaWdodDogMTAsIGJvcmRlclJhZGl1czogJzUwJScsXG4gICAgICAgICAgICAgICAgICAgICAgICBiYWNrZ3JvdW5kOiBNT0FfQ09MT1JTW2lkeCAlIE1PQV9DT0xPUlMubGVuZ3RoXSwgbWFyZ2luUmlnaHQ6IDYsXG4gICAgICAgICAgICAgICAgICAgICAgfX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICB7ci5tb2FfY2F0ZWdvcnl9XG4gICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nIH19Pnt4cy5sZW5ndGh9PC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPHRkIHN0eWxlPXt7IHRleHRBbGlnbjogJ3JpZ2h0JywgcGFkZGluZzogJzAuNHJlbScgfX0+e3ByICE9IG51bGwgPyBwci50b0ZpeGVkKDMpIDogJ+KAlCd9PC90ZD5cbiAgICAgICAgICAgICAgICAgICAge2Jvb3RSZXN1bHQgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nLCBjb2xvcjogJyM2NjYnIH19PlxuICAgICAgICAgICAgICAgICAgICAgICAge2ZtdENJKG1vYVN0YXRzPy5yQ0kpfVxuICAgICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT17eyB0ZXh0QWxpZ246ICdyaWdodCcsIHBhZGRpbmc6ICcwLjRyZW0nIH19PntzciAhPSBudWxsID8gc3IudG9GaXhlZCgzKSA6ICfigJQnfTwvdGQ+XG4gICAgICAgICAgICAgICAgICAgIHtib290UmVzdWx0ICYmIChcbiAgICAgICAgICAgICAgICAgICAgICA8dGQgc3R5bGU9e3sgdGV4dEFsaWduOiAncmlnaHQnLCBwYWRkaW5nOiAnMC40cmVtJywgY29sb3I6ICcjNjY2JyB9fT5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtmbXRDSShtb2FTdGF0cz8ucmhvQ0kpfVxuICAgICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgPC90Ym9keT5cbiAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICl9XG4gICAgPC9kaXY+XG4gICk7XG59XG4iXX0=