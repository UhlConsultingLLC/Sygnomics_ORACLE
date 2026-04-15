// Bootstrap helpers for the MOA Correlation page.
//
// All-pure-TS implementation, no deps. Runs on the main thread; typical usage
// is B ≤ 10,000 with a few hundred points, which finishes comfortably below
// one second on modern hardware. For very large B the caller should yield
// control via requestAnimationFrame inside the resampling loop.
//
// Supports four resampling schemes:
//   - "trial":      standard case bootstrap; resample the N points with
//                   replacement and recompute statistics
//   - "simulation": points stay fixed; redraw each point's y via the
//                   point's own `yDrawFn` (propagates per-trial simulation
//                   uncertainty without sample-size uncertainty)
//   - "nested":     combines the above — resample points AND redraw y
//   - "stratified": resample with replacement within each MOA bucket, so
//                   bucket sizes are preserved
//
// CI construction supports percentile (default) and BCa (bias-corrected and
// accelerated, Efron 1987).
//
// Curve fit for the CI band is simple OLS on (x, y); intercepts and slopes
// are stored per iteration so the band can be materialized at any xGrid.

export type ResamplingScheme = 'trial' | 'simulation' | 'nested' | 'stratified';
export type CIMethod = 'percentile' | 'bca';
export type CurveType = 'ols' | 'none';

export interface BootstrapInputPoint {
  x: number;
  y: number;                 // point estimate (e.g. mean_predicted_rate)
  yDrawFn?: () => number;    // fresh draw from the point's predictive distribution
  moaKey: string;            // used for stratification + per-MOA output
  label?: string;            // optional display label (e.g. nct_id or therapy name)
}

export interface BootstrapConfig {
  B: number;
  scheme: ResamplingScheme;
  ciLevel: number;           // e.g. 0.95
  ciMethod: CIMethod;
  curveType: CurveType;
  seed?: number;             // if provided, resampling is deterministic
}

export interface MOABootStats {
  n: number;
  rHat: number | null;
  rCI: [number, number] | null;
  rhoHat: number | null;
  rhoCI: [number, number] | null;
}

export interface BootstrapResult {
  config: BootstrapConfig;
  nPoints: number;

  // Per-iteration records (kept so callers can recompute bands on any xGrid)
  rValues: number[];
  rhoValues: number[];
  slopes: number[];
  intercepts: number[];

  // Point estimates computed on the original data
  rHat: number | null;
  rhoHat: number | null;
  slopeHat: number | null;
  interceptHat: number | null;

  // CIs
  rCI: [number, number] | null;
  rhoCI: [number, number] | null;

  // Mean number of distinct original points appearing in each resample
  // (averaged across all B iterations). For "simulation" this equals nPoints
  // because that scheme does not resample points. For case bootstraps the
  // expected value is ≈ n * (1 − 1/e) ≈ 0.632 n.
  meanUniqueCount: number;

  // Per-MOA summary (keyed by moaKey from the input points)
  perMoa: Record<string, MOABootStats>;
}

// ─────────────────────────────────────────────────────────────────────────
// Basic stats
// ─────────────────────────────────────────────────────────────────────────

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = xs[i] - mx, yi = ys[i] - my;
    num += xi * yi;
    dx += xi * xi;
    dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

function rankAvg(arr: number[]): number[] {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const r = new Array<number>(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[indexed[k].i] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  return pearson(rankAvg(xs), rankAvg(ys));
}

export function olsFit(
  xs: number[],
  ys: number[]
): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

// ─────────────────────────────────────────────────────────────────────────
// RNG (seedable for reproducibility)
// ─────────────────────────────────────────────────────────────────────────

// Mulberry32 — fast, adequate for resampling. Not cryptographic.
export function makeRng(seed?: number): () => number {
  if (seed == null || Number.isNaN(seed)) return Math.random;
  let a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller — standard normal draw from a uniform RNG.
export function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─────────────────────────────────────────────────────────────────────────
// Normal CDF / quantile (Abramowitz-Stegun / Beasley-Springer-Moro)
// ─────────────────────────────────────────────────────────────────────────

export function pnorm(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-0.5 * z * z);
  const p = d * t *
    ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530);
  return z > 0 ? 1 - p : p;
}

export function qnorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const A = [-3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2,
             1.383577518672690e+2, -3.066479806614716e+1, 2.506628277459239e+0];
  const B = [-5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2,
             6.680131188771972e+1, -1.328068155288572e+1];
  const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e+0,
             -2.549732539343734e+0, 4.374664141464968e+0, 2.938163982698783e+0];
  const D = [7.784695709041462e-3, 3.224671290700398e-1,
             2.445134137142996e+0, 3.754408661907416e+0];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
           ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
           (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
          ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
}

// ─────────────────────────────────────────────────────────────────────────
// CI constructors
// ─────────────────────────────────────────────────────────────────────────

export function percentileCI(values: number[], ciLevel: number): [number, number] | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const alpha = (1 - ciLevel) / 2;
  const loIdx = Math.max(0, Math.floor(alpha * sorted.length));
  const hiIdx = Math.min(sorted.length - 1, Math.ceil((1 - alpha) * sorted.length) - 1);
  return [sorted[loIdx], sorted[hiIdx]];
}

export function bcaCI(
  values: number[],
  thetaHat: number,
  jackknife: number[],
  ciLevel: number
): [number, number] | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 2 || !Number.isFinite(thetaHat)) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const B = sorted.length;

  // Bias-correction z0
  const propLess = sorted.filter((v) => v < thetaHat).length / B;
  // Clip to avoid ±∞
  const z0 = qnorm(Math.max(1 / (B + 1), Math.min(B / (B + 1), propLess)));

  // Acceleration a via jackknife
  let a = 0;
  if (jackknife.length >= 2) {
    const jMean = jackknife.reduce((s, v) => s + v, 0) / jackknife.length;
    let num = 0, den = 0;
    for (const j of jackknife) {
      const d = jMean - j;
      num += d * d * d;
      den += d * d;
    }
    const denom = 6 * Math.pow(den, 1.5);
    a = denom === 0 ? 0 : num / denom;
  }

  const alpha = (1 - ciLevel) / 2;
  const zLo = qnorm(alpha), zHi = qnorm(1 - alpha);
  const pLo = pnorm(z0 + (z0 + zLo) / (1 - a * (z0 + zLo)));
  const pHi = pnorm(z0 + (z0 + zHi) / (1 - a * (z0 + zHi)));
  const loIdx = Math.max(0, Math.min(B - 1, Math.floor(pLo * B)));
  const hiIdx = Math.max(0, Math.min(B - 1, Math.ceil(pHi * B) - 1));
  return [sorted[loIdx], sorted[hiIdx]];
}

function jackknifePearson(xs: number[], ys: number[]): number[] {
  const out: number[] = [];
  const n = xs.length;
  if (n < 3) return out;
  for (let k = 0; k < n; k++) {
    const sx = xs.filter((_, i) => i !== k);
    const sy = ys.filter((_, i) => i !== k);
    const v = pearson(sx, sy);
    if (v != null) out.push(v);
  }
  return out;
}

function jackknifeSpearman(xs: number[], ys: number[]): number[] {
  const out: number[] = [];
  const n = xs.length;
  if (n < 3) return out;
  for (let k = 0; k < n; k++) {
    const sx = xs.filter((_, i) => i !== k);
    const sy = ys.filter((_, i) => i !== k);
    const v = spearman(sx, sy);
    if (v != null) out.push(v);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Main bootstrap entrypoint
// ─────────────────────────────────────────────────────────────────────────

/** Run the bootstrap. Synchronous: expect <1s for B≤2000, n≤~300. */
export function runBootstrap(
  points: BootstrapInputPoint[],
  config: BootstrapConfig
): BootstrapResult {
  const rng = makeRng(config.seed);
  const B = Math.max(1, Math.floor(config.B));
  const n = points.length;

  const rValues: number[] = [];
  const rhoValues: number[] = [];
  const slopes: number[] = [];
  const intercepts: number[] = [];

  // Pre-compute MOA bucket indices for stratified scheme + per-MOA stats
  const moaBuckets: Map<string, number[]> = new Map();
  points.forEach((p, i) => {
    const list = moaBuckets.get(p.moaKey) || [];
    list.push(i);
    moaBuckets.set(p.moaKey, list);
  });
  const perMoaKeys = Array.from(moaBuckets.keys());
  const perMoaRSeries: Record<string, number[]> = {};
  const perMoaRhoSeries: Record<string, number[]> = {};
  for (const k of perMoaKeys) {
    perMoaRSeries[k] = [];
    perMoaRhoSeries[k] = [];
  }

  // Reusable work buffers
  const xBuf = new Array<number>(n);
  const yBuf = new Array<number>(n);

  // Flag array for counting distinct original indices in a resample.
  // Cleared (fill(0)) at the start of each resampling iteration.
  const seen = new Uint8Array(n);
  let sumUnique = 0;

  const drawY = (p: BootstrapInputPoint): number =>
    p.yDrawFn ? p.yDrawFn() : p.y;

  for (let b = 0; b < B; b++) {
    // Build resampled (x, y) arrays for this iteration.
    // Also count the number of distinct original indices appearing in
    // this resample (for the mean-unique statistic we report back).
    let uniqueThisIter = 0;
    if (config.scheme === 'simulation') {
      // No resampling — every original point is present once
      for (let i = 0; i < n; i++) {
        xBuf[i] = points[i].x;
        yBuf[i] = drawY(points[i]);
      }
      uniqueThisIter = n;
    } else if (config.scheme === 'stratified') {
      seen.fill(0);
      let w = 0;
      for (const [, indices] of moaBuckets) {
        const k = indices.length;
        for (let j = 0; j < k; j++) {
          const idx = indices[Math.floor(rng() * k)];
          if (!seen[idx]) { seen[idx] = 1; uniqueThisIter++; }
          xBuf[w] = points[idx].x;
          yBuf[w] = points[idx].y;  // simulation overlay not applied under stratified
          w++;
        }
      }
    } else {
      // "trial" or "nested"
      seen.fill(0);
      const redraw = config.scheme === 'nested';
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * n);
        if (!seen[idx]) { seen[idx] = 1; uniqueThisIter++; }
        xBuf[i] = points[idx].x;
        yBuf[i] = redraw ? drawY(points[idx]) : points[idx].y;
      }
    }
    sumUnique += uniqueThisIter;

    // (Per-MOA CIs are computed in a separate pass below; we don't need
    //  to track which original MOA each resampled slot came from here.)

    const r = pearson(xBuf, yBuf);
    const rho = spearman(xBuf, yBuf);
    const fit = config.curveType === 'ols' ? olsFit(xBuf, yBuf) : null;
    rValues.push(r ?? NaN);
    rhoValues.push(rho ?? NaN);
    slopes.push(fit ? fit.slope : NaN);
    intercepts.push(fit ? fit.intercept : NaN);
  }

  const meanUniqueCount = B > 0 ? sumUnique / B : 0;

  // Per-MOA stats — cleaner second pass using per-bucket trial resampling.
  // We do a fresh per-MOA bootstrap here with the same B so the CIs are honest
  // regardless of the outer scheme choice. Scheme specific semantics for
  // per-MOA tend to reduce to trial-resample-within-bucket, which is what
  // a user typically wants to see next to each row.
  for (const key of perMoaKeys) {
    const idxs = moaBuckets.get(key)!;
    const k = idxs.length;
    if (k < 3) {
      perMoaRSeries[key] = [];
      perMoaRhoSeries[key] = [];
      continue;
    }
    const xs = idxs.map((i) => points[i].x);
    const ysBase = idxs.map((i) => points[i].y);
    const pmRng = makeRng(
      config.seed != null ? (config.seed ^ hashStr(key)) >>> 0 : undefined
    );
    const xB = new Array<number>(k);
    const yB = new Array<number>(k);
    for (let b = 0; b < B; b++) {
      for (let j = 0; j < k; j++) {
        const draw = Math.floor(pmRng() * k);
        xB[j] = xs[draw];
        if (config.scheme === 'simulation' || config.scheme === 'nested') {
          const original = points[idxs[draw]];
          yB[j] = original.yDrawFn ? original.yDrawFn() : ysBase[draw];
        } else {
          yB[j] = ysBase[draw];
        }
      }
      const r = pearson(xB, yB);
      const rho = spearman(xB, yB);
      perMoaRSeries[key].push(r ?? NaN);
      perMoaRhoSeries[key].push(rho ?? NaN);
    }
  }

  // Point estimates on the original data
  const xOrig = points.map((p) => p.x);
  const yOrig = points.map((p) => p.y);
  const rHat = pearson(xOrig, yOrig);
  const rhoHat = spearman(xOrig, yOrig);
  const fit = olsFit(xOrig, yOrig);
  const slopeHat = fit ? fit.slope : null;
  const interceptHat = fit ? fit.intercept : null;

  // CIs
  const pick = (
    arr: number[],
    hat: number | null,
    jack: () => number[]
  ): [number, number] | null => {
    if (hat == null) return null;
    if (config.ciMethod === 'bca') {
      const ci = bcaCI(arr, hat, jack(), config.ciLevel);
      if (ci != null) return ci;
    }
    return percentileCI(arr, config.ciLevel);
  };

  const rCI = pick(rValues, rHat, () => jackknifePearson(xOrig, yOrig));
  const rhoCI = pick(rhoValues, rhoHat, () => jackknifeSpearman(xOrig, yOrig));

  const perMoa: Record<string, MOABootStats> = {};
  for (const key of perMoaKeys) {
    const idxs = moaBuckets.get(key)!;
    const xs = idxs.map((i) => points[i].x);
    const ys = idxs.map((i) => points[i].y);
    const rH = pearson(xs, ys);
    const rhoH = spearman(xs, ys);
    const rSeries = perMoaRSeries[key];
    const rhoSeries = perMoaRhoSeries[key];
    perMoa[key] = {
      n: idxs.length,
      rHat: rH,
      rhoHat: rhoH,
      rCI:
        rH != null && rSeries.length >= 2
          ? config.ciMethod === 'bca'
            ? bcaCI(rSeries, rH, jackknifePearson(xs, ys), config.ciLevel) ??
              percentileCI(rSeries, config.ciLevel)
            : percentileCI(rSeries, config.ciLevel)
          : null,
      rhoCI:
        rhoH != null && rhoSeries.length >= 2
          ? config.ciMethod === 'bca'
            ? bcaCI(rhoSeries, rhoH, jackknifeSpearman(xs, ys), config.ciLevel) ??
              percentileCI(rhoSeries, config.ciLevel)
            : percentileCI(rhoSeries, config.ciLevel)
          : null,
    };
  }

  return {
    config,
    nPoints: n,
    rValues, rhoValues, slopes, intercepts,
    rHat, rhoHat, slopeHat, interceptHat,
    rCI, rhoCI,
    meanUniqueCount,
    perMoa,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Band materialization
// ─────────────────────────────────────────────────────────────────────────

/** Compute pointwise CI band for the OLS fit at each x in `xGrid`. */
export function materializeBand(
  result: BootstrapResult,
  xGrid: number[]
): { lower: number[]; upper: number[] } | null {
  if (result.config.curveType === 'none') return null;
  const { slopes, intercepts, config } = result;
  const usable: Array<{ s: number; i: number }> = [];
  for (let k = 0; k < slopes.length; k++) {
    if (Number.isFinite(slopes[k]) && Number.isFinite(intercepts[k])) {
      usable.push({ s: slopes[k], i: intercepts[k] });
    }
  }
  if (usable.length < 10) return null;
  const alpha = (1 - config.ciLevel) / 2;
  const lower: number[] = new Array(xGrid.length);
  const upper: number[] = new Array(xGrid.length);
  const column = new Array<number>(usable.length);
  for (let g = 0; g < xGrid.length; g++) {
    const x0 = xGrid[g];
    for (let k = 0; k < usable.length; k++) {
      column[k] = usable[k].i + usable[k].s * x0;
    }
    column.sort((a, b) => a - b);
    const loIdx = Math.max(0, Math.floor(alpha * column.length));
    const hiIdx = Math.min(column.length - 1, Math.ceil((1 - alpha) * column.length) - 1);
    lower[g] = column[loIdx];
    upper[g] = column[hiIdx];
  }
  return { lower, upper };
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Robustness: jackknife (leave-one-out) + leave-k-out subsampling
// ─────────────────────────────────────────────────────────────────────────
//
// These are *sensitivity* analyses, not confidence intervals for the full
// sample — they answer "how much does my result depend on individual
// trials / on any particular subset of k trials?".
//
//   - Jackknife: drop each point in turn, record how r/ρ/slope shift.
//     Output per-point influence values suitable for a bar chart.
//
//   - Leave-k-out: randomly drop k points, record the resulting r/ρ.
//     Repeat B times. Reports the min/max range and a percentile band.
//
// Semantics note: we define Δ = (statistic with point removed) − (statistic
// on full sample). So Δr > 0 means "removing this point increases r"
// (i.e. the point was pulling r down); Δr < 0 means the point was
// supporting the correlation.

export interface InfluencePoint {
  index: number;            // original index in points array
  label: string;            // display label (falls back to `#<index>`)
  moaKey: string;
  x: number;
  y: number;
  deltaR: number | null;        // r_minus − rHat
  deltaRho: number | null;
  deltaSlope: number | null;
  deltaIntercept: number | null;
  rMinus: number | null;        // r computed without this point
  rhoMinus: number | null;
}

export interface JackknifeResult {
  n: number;
  rHat: number | null;
  rhoHat: number | null;
  slopeHat: number | null;
  interceptHat: number | null;
  influence: InfluencePoint[];
  maxAbsDeltaR: number;
  maxAbsDeltaRho: number;
  maxAbsDeltaSlope: number;
}

export interface LeaveKOutConfig {
  k: number;
  B: number;
  ciLevel: number;
  seed?: number;
}

export interface LeaveKOutResult {
  config: LeaveKOutConfig;     // k may differ from request if clamped
  n: number;
  rHat: number | null;
  rhoHat: number | null;
  rValues: number[];
  rhoValues: number[];
  rRange: [number, number] | null;
  rhoRange: [number, number] | null;
  rCI: [number, number] | null;
  rhoCI: [number, number] | null;
}

export function runJackknife(points: BootstrapInputPoint[]): JackknifeResult {
  const n = points.length;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const rHat = pearson(xs, ys);
  const rhoHat = spearman(xs, ys);
  const fitHat = olsFit(xs, ys);
  const slopeHat = fitHat ? fitHat.slope : null;
  const interceptHat = fitHat ? fitHat.intercept : null;

  const influence: InfluencePoint[] = [];
  let maxAbsDeltaR = 0;
  let maxAbsDeltaRho = 0;
  let maxAbsDeltaSlope = 0;

  if (n < 3) {
    return {
      n,
      rHat, rhoHat, slopeHat, interceptHat,
      influence, maxAbsDeltaR, maxAbsDeltaRho, maxAbsDeltaSlope,
    };
  }

  const xk = new Array<number>(n - 1);
  const yk = new Array<number>(n - 1);
  for (let k = 0; k < n; k++) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      xk[w] = xs[i];
      yk[w] = ys[i];
      w++;
    }
    const rk = pearson(xk, yk);
    const rhok = spearman(xk, yk);
    const fk = olsFit(xk, yk);
    const deltaR = rHat != null && rk != null ? rk - rHat : null;
    const deltaRho = rhoHat != null && rhok != null ? rhok - rhoHat : null;
    const deltaSlope = slopeHat != null && fk != null ? fk.slope - slopeHat : null;
    const deltaIntercept = interceptHat != null && fk != null ? fk.intercept - interceptHat : null;
    if (deltaR != null) maxAbsDeltaR = Math.max(maxAbsDeltaR, Math.abs(deltaR));
    if (deltaRho != null) maxAbsDeltaRho = Math.max(maxAbsDeltaRho, Math.abs(deltaRho));
    if (deltaSlope != null) maxAbsDeltaSlope = Math.max(maxAbsDeltaSlope, Math.abs(deltaSlope));
    influence.push({
      index: k,
      label: points[k].label ?? `#${k}`,
      moaKey: points[k].moaKey,
      x: points[k].x,
      y: points[k].y,
      deltaR, deltaRho, deltaSlope, deltaIntercept,
      rMinus: rk, rhoMinus: rhok,
    });
  }

  return {
    n,
    rHat, rhoHat, slopeHat, interceptHat,
    influence, maxAbsDeltaR, maxAbsDeltaRho, maxAbsDeltaSlope,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Calibration test: does the OLS fit match y = x?
// ─────────────────────────────────────────────────────────────────────────
//
// Null hypothesis: slope = 1 AND intercept = 0 (predictions are perfectly
// calibrated to observations — the fit line is the identity).
//
// This is a Wald-type test on the joint (slope, intercept) pair using the
// bootstrap replicates as the sampling-error distribution:
//
//   1. Compute Σ̂ = bootstrap covariance of (β_b, α_b).
//   2. Observed Mahalanobis distance² from the null:
//         D²_obs = (β̂ − 1, α̂ − 0)' Σ̂⁻¹ (β̂ − 1, α̂ − 0)
//   3. For each replicate, compute its distance² from the centre (β̂, α̂):
//         D²_b = (β_b − β̂, α_b − α̂)' Σ̂⁻¹ (β_b − β̂, α_b − α̂)
//      These simulate the sampling distribution of D² under H₀.
//   4. p = (1 + #{b : D²_b ≥ D²_obs}) / (1 + B)
//
// Also reports the asymptotic χ²(2) p-value = exp(−D²_obs / 2), which agrees
// with the bootstrap p under bivariate normality and is useful as a sanity
// check. The bootstrap p is the primary value.
//
// No new computation beyond what's already in `BootstrapResult` — it re-uses
// the `slopes` / `intercepts` arrays already stored.

export interface CalibrationTestResult {
  /** OLS slope on the original data. */
  slopeHat: number;
  /** OLS intercept on the original data. */
  interceptHat: number;
  /** Observed Mahalanobis distance² from (slope=1, intercept=0). */
  observedD2: number;
  /** Bootstrap p-value. */
  p: number | null;
  /** Asymptotic χ²(2) p-value for comparison (= exp(−D²/2)). */
  pChi2: number | null;
  /** Number of finite bootstrap replicates used. */
  nReplicates: number;
  /** Bootstrap sample covariance of (slope, intercept). */
  cov: { slope: number; intercept: number; slopeIntercept: number };
}

export function calibrationTestWald(result: BootstrapResult): CalibrationTestResult | null {
  if (result.slopeHat == null || result.interceptHat == null) return null;

  // Filter to finite bootstrap replicates
  const valid: Array<[number, number]> = [];
  const { slopes, intercepts } = result;
  for (let i = 0; i < slopes.length; i++) {
    if (Number.isFinite(slopes[i]) && Number.isFinite(intercepts[i])) {
      valid.push([slopes[i], intercepts[i]]);
    }
  }
  if (valid.length < 10) return null;

  // 2×2 sample covariance of the replicates
  const n = valid.length;
  let sMean = 0, iMean = 0;
  for (const [s, i] of valid) { sMean += s; iMean += i; }
  sMean /= n; iMean /= n;
  let sss = 0, sii = 0, ssi = 0;
  for (const [s, i] of valid) {
    const ds = s - sMean, di = i - iMean;
    sss += ds * ds;
    sii += di * di;
    ssi += ds * di;
  }
  const covSlope = sss / (n - 1);
  const covInt = sii / (n - 1);
  const covSI = ssi / (n - 1);

  // Invert Σ̂
  const det = covSlope * covInt - covSI * covSI;
  if (!Number.isFinite(det) || det <= 0) return null;
  const inv00 = covInt / det;   // [slope, slope]
  const inv11 = covSlope / det; // [intercept, intercept]
  const inv01 = -covSI / det;   // off-diagonal

  const mahal = (ds: number, di: number) =>
    ds * (inv00 * ds + inv01 * di) + di * (inv01 * ds + inv11 * di);

  // Observed D² from (β̂ − 1, α̂ − 0)
  const observedD2 = mahal(result.slopeHat - 1, result.interceptHat - 0);

  // Bootstrap distribution of D² under H₀: use replicates centred at (β̂, α̂)
  let countExceed = 0;
  for (const [s, i] of valid) {
    const d2 = mahal(s - result.slopeHat, i - result.interceptHat);
    if (d2 >= observedD2) countExceed++;
  }
  const p = (1 + countExceed) / (1 + n);

  // Asymptotic χ²(2) tail = exp(−x/2) for x ≥ 0
  const pChi2 = Number.isFinite(observedD2) && observedD2 >= 0
    ? Math.exp(-observedD2 / 2)
    : null;

  return {
    slopeHat: result.slopeHat,
    interceptHat: result.interceptHat,
    observedD2,
    p,
    pChi2,
    nReplicates: n,
    cov: { slope: covSlope, intercept: covInt, slopeIntercept: covSI },
  };
}

/**
 * Parameterise the bootstrap confidence ellipse for (slope, intercept) at
 * `ciLevel` (e.g. 0.95). The critical Mahalanobis distance² is the empirical
 * `ciLevel` quantile of D²_b over the bootstrap replicates, so the ellipse is
 * non-parametric and does not rely on bivariate normality.
 *
 * Returns `{ slope, intercept, kCrit }` where `slope[i]` / `intercept[i]`
 * trace the ellipse boundary (first and last points coincide so the polygon
 * closes) and `kCrit` is the critical D² for diagnostics.
 */
export function confidenceEllipse(
  result: BootstrapResult,
  ciLevel: number = 0.95,
  nPoints: number = 200,
): { slope: number[]; intercept: number[]; kCrit: number } | null {
  if (result.slopeHat == null || result.interceptHat == null) return null;

  const valid: Array<[number, number]> = [];
  const { slopes, intercepts } = result;
  for (let i = 0; i < slopes.length; i++) {
    if (Number.isFinite(slopes[i]) && Number.isFinite(intercepts[i])) {
      valid.push([slopes[i], intercepts[i]]);
    }
  }
  if (valid.length < 10) return null;

  // Same covariance as the calibration test
  const n = valid.length;
  let sMean = 0, iMean = 0;
  for (const [s, i] of valid) { sMean += s; iMean += i; }
  sMean /= n; iMean /= n;
  let sss = 0, sii = 0, ssi = 0;
  for (const [s, i] of valid) {
    const ds = s - sMean, di = i - iMean;
    sss += ds * ds;
    sii += di * di;
    ssi += ds * di;
  }
  const covSlope = sss / (n - 1);
  const covInt = sii / (n - 1);
  const covSI = ssi / (n - 1);

  const det = covSlope * covInt - covSI * covSI;
  if (!Number.isFinite(det) || det <= 0) return null;
  const inv00 = covInt / det;
  const inv11 = covSlope / det;
  const inv01 = -covSI / det;

  // Empirical ciLevel-quantile of D²_b centred at (β̂, α̂)
  const d2s: number[] = new Array(n);
  for (let j = 0; j < n; j++) {
    const ds = valid[j][0] - result.slopeHat;
    const di = valid[j][1] - result.interceptHat;
    d2s[j] = ds * (inv00 * ds + inv01 * di) + di * (inv01 * ds + inv11 * di);
  }
  d2s.sort((a, b) => a - b);
  const qIdx = Math.min(n - 1, Math.max(0, Math.ceil(ciLevel * n) - 1));
  const kCrit = d2s[qIdx];
  if (!Number.isFinite(kCrit) || kCrit <= 0) return null;

  // Eigendecomposition of the 2×2 covariance
  const tr = covSlope + covInt;
  const discr = Math.sqrt(Math.max(0, ((covSlope - covInt) / 2) ** 2 + covSI * covSI));
  const lambda1 = tr / 2 + discr;
  const lambda2 = tr / 2 - discr;

  // Eigenvector for λ₁ (largest). For 2×2 with off-diagonal = covSI:
  //   (covSI, λ₁ − covSlope)   when covSI ≠ 0
  //   axis-aligned otherwise
  let v1x: number, v1y: number;
  if (Math.abs(covSI) > 1e-14) {
    v1x = covSI;
    v1y = lambda1 - covSlope;
    const norm = Math.sqrt(v1x * v1x + v1y * v1y);
    v1x /= norm;
    v1y /= norm;
  } else {
    if (covSlope >= covInt) { v1x = 1; v1y = 0; } else { v1x = 0; v1y = 1; }
  }
  const v2x = -v1y, v2y = v1x;  // perpendicular

  const a1 = Math.sqrt(Math.max(0, kCrit * lambda1));
  const a2 = Math.sqrt(Math.max(0, kCrit * lambda2));
  const slopeArr: number[] = new Array(nPoints + 1);
  const interceptArr: number[] = new Array(nPoints + 1);
  for (let t = 0; t <= nPoints; t++) {
    const theta = (2 * Math.PI * t) / nPoints;
    const c = Math.cos(theta), s = Math.sin(theta);
    slopeArr[t] = result.slopeHat + a1 * c * v1x + a2 * s * v2x;
    interceptArr[t] = result.interceptHat + a1 * c * v1y + a2 * s * v2y;
  }
  return { slope: slopeArr, intercept: interceptArr, kCrit };
}

// ─────────────────────────────────────────────────────────────────────────
// Permutation test (two-sided) for Pearson r and Spearman ρ
// ─────────────────────────────────────────────────────────────────────────
//
// Null hypothesis: xs and ys are independent (exchangeable labels).
// Procedure: hold xs fixed, randomly permute ys B times, recompute the
// statistic each time, and count the proportion whose absolute value meets
// or exceeds the observed |r| (and |ρ|). Reports the two-sided p-value with
// the (1 + count) / (1 + B) correction (Phipson & Smyth 2010) so the
// reported value is never exactly zero.
//
// Implementation note: Spearman permutation shares the same shuffle as the
// Pearson permutation — ranks of y are pre-computed once, then permuted in
// lock-step with y. This keeps each iteration O(n) (no re-ranking per iter).

export interface PermutationResult {
  /** Two-sided p-value for Pearson r (null if r could not be computed). */
  pR: number | null;
  /** Two-sided p-value for Spearman ρ (null if ρ could not be computed). */
  pRho: number | null;
  /** Number of permutations whose test statistic was finite and was counted. */
  nPerm: number;
  /** Requested number of permutations. */
  B: number;
  /** Observed |r|; null if undefined on input. */
  absR: number | null;
  /** Observed |ρ|; null if undefined on input. */
  absRho: number | null;
}

export function permutationTest(
  xs: number[],
  ys: number[],
  B: number = 10000,
  seed?: number,
): PermutationResult {
  const n = xs.length;
  if (n < 3 || ys.length !== n) {
    return { pR: null, pRho: null, nPerm: 0, B, absR: null, absRho: null };
  }

  const rObs = pearson(xs, ys);
  const xr = rankAvg(xs);
  const yr = rankAvg(ys);
  const rhoObs = pearson(xr, yr); // == Spearman(xs, ys) by construction

  if (rObs == null && rhoObs == null) {
    return { pR: null, pRho: null, nPerm: 0, B, absR: null, absRho: null };
  }

  const absR = rObs == null ? null : Math.abs(rObs);
  const absRho = rhoObs == null ? null : Math.abs(rhoObs);

  const rng = makeRng(seed);
  const B1 = Math.max(1, Math.floor(B));

  // Shuffle y and rank(y) in lock-step so both statistics share a single
  // permutation and the correspondence between values and ranks is preserved.
  const yPerm = ys.slice();
  const yrPerm = yr.slice();

  let countR = 0;
  let countRho = 0;
  let doneR = 0;
  let doneRho = 0;

  for (let b = 0; b < B1; b++) {
    // Fisher-Yates shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      if (j !== i) {
        const t1 = yPerm[i]; yPerm[i] = yPerm[j]; yPerm[j] = t1;
        const t2 = yrPerm[i]; yrPerm[i] = yrPerm[j]; yrPerm[j] = t2;
      }
    }
    if (absR != null) {
      const rp = pearson(xs, yPerm);
      if (rp != null && Number.isFinite(rp)) {
        doneR++;
        if (Math.abs(rp) >= absR) countR++;
      }
    }
    if (absRho != null) {
      const rhop = pearson(xr, yrPerm);
      if (rhop != null && Number.isFinite(rhop)) {
        doneRho++;
        if (Math.abs(rhop) >= absRho) countRho++;
      }
    }
  }

  const pR = absR != null && doneR > 0 ? (1 + countR) / (1 + doneR) : null;
  const pRho = absRho != null && doneRho > 0 ? (1 + countRho) / (1 + doneRho) : null;
  const nPerm = Math.max(doneR, doneRho);

  return { pR, pRho, nPerm, B: B1, absR, absRho };
}

export function runLeaveKOut(
  points: BootstrapInputPoint[],
  config: LeaveKOutConfig
): LeaveKOutResult {
  const n = points.length;
  // Must leave at least 3 points behind for Pearson to be defined
  const k = Math.max(1, Math.min(n - 3, Math.floor(config.k)));
  const B = Math.max(1, Math.floor(config.B));
  const rng = makeRng(config.seed);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const rHat = pearson(xs, ys);
  const rhoHat = spearman(xs, ys);

  const rValues: number[] = [];
  const rhoValues: number[] = [];

  if (n - k < 3) {
    return {
      config: { ...config, k },
      n,
      rHat, rhoHat,
      rValues, rhoValues,
      rRange: null, rhoRange: null,
      rCI: null, rhoCI: null,
    };
  }

  // Fisher-Yates partial shuffle to pick n-k indices without replacement.
  // Pool is mutated in place; we only need the first (n-k) slots each iter.
  const pool = Array.from({ length: n }, (_, i) => i);
  const m = n - k;
  const xb = new Array<number>(m);
  const yb = new Array<number>(m);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(rng() * (n - i));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    for (let i = 0; i < m; i++) {
      xb[i] = xs[pool[i]];
      yb[i] = ys[pool[i]];
    }
    const r = pearson(xb, yb);
    const rho = spearman(xb, yb);
    if (r != null && Number.isFinite(r)) rValues.push(r);
    if (rho != null && Number.isFinite(rho)) rhoValues.push(rho);
  }

  const rangeOf = (arr: number[]): [number, number] | null => {
    if (arr.length === 0) return null;
    let lo = Infinity, hi = -Infinity;
    for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  };

  return {
    config: { ...config, k },
    n,
    rHat, rhoHat,
    rValues, rhoValues,
    rRange: rangeOf(rValues),
    rhoRange: rangeOf(rhoValues),
    rCI: percentileCI(rValues, config.ciLevel),
    rhoCI: percentileCI(rhoValues, config.ciLevel),
  };
}
