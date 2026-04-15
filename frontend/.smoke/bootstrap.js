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
// ─────────────────────────────────────────────────────────────────────────
// Basic stats
// ─────────────────────────────────────────────────────────────────────────
export function pearson(xs, ys) {
    if (xs.length < 2 || xs.length !== ys.length)
        return null;
    const n = xs.length;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        sx += xs[i];
        sy += ys[i];
    }
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
function rankAvg(arr) {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const r = new Array(arr.length);
    let i = 0;
    while (i < indexed.length) {
        let j = i;
        while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v)
            j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++)
            r[indexed[k].i] = avg;
        i = j + 1;
    }
    return r;
}
export function spearman(xs, ys) {
    if (xs.length < 2 || xs.length !== ys.length)
        return null;
    return pearson(rankAvg(xs), rankAvg(ys));
}
export function olsFit(xs, ys) {
    const n = xs.length;
    if (n < 2)
        return null;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        sx += xs[i];
        sy += ys[i];
    }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        sxx += dx * dx;
        sxy += dx * (ys[i] - my);
    }
    if (sxx === 0)
        return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx };
}
// ─────────────────────────────────────────────────────────────────────────
// RNG (seedable for reproducibility)
// ─────────────────────────────────────────────────────────────────────────
// Mulberry32 — fast, adequate for resampling. Not cryptographic.
export function makeRng(seed) {
    if (seed == null || Number.isNaN(seed))
        return Math.random;
    let a = seed | 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// Box-Muller — standard normal draw from a uniform RNG.
export function gaussian(rng) {
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
// ─────────────────────────────────────────────────────────────────────────
// Normal CDF / quantile (Abramowitz-Stegun / Beasley-Springer-Moro)
// ─────────────────────────────────────────────────────────────────────────
export function pnorm(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-0.5 * z * z);
    const p = d * t *
        ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - 0.356563782) * t + 0.319381530);
    return z > 0 ? 1 - p : p;
}
export function qnorm(p) {
    if (p <= 0)
        return -Infinity;
    if (p >= 1)
        return Infinity;
    const A = [-3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2,
        1.383577518672690e+2, -3.066479806614716e+1, 2.506628277459239e+0];
    const B = [-5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2,
        6.680131188771972e+1, -1.328068155288572e+1];
    const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e+0,
        -2.549732539343734e+0, 4.374664141464968e+0, 2.938163982698783e+0];
    const D = [7.784695709041462e-3, 3.224671290700398e-1,
        2.445134137142996e+0, 3.754408661907416e+0];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q, r;
    if (p < pLow) {
        q = Math.sqrt(-2 * Math.log(p));
        return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
            ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
    }
    if (p <= pHigh) {
        q = p - 0.5;
        r = q * q;
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
export function percentileCI(values, ciLevel) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length < 2)
        return null;
    const alpha = (1 - ciLevel) / 2;
    const loIdx = Math.max(0, Math.floor(alpha * sorted.length));
    const hiIdx = Math.min(sorted.length - 1, Math.ceil((1 - alpha) * sorted.length) - 1);
    return [sorted[loIdx], sorted[hiIdx]];
}
export function bcaCI(values, thetaHat, jackknife, ciLevel) {
    const finite = values.filter(Number.isFinite);
    if (finite.length < 2 || !Number.isFinite(thetaHat))
        return null;
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
function jackknifePearson(xs, ys) {
    const out = [];
    const n = xs.length;
    if (n < 3)
        return out;
    for (let k = 0; k < n; k++) {
        const sx = xs.filter((_, i) => i !== k);
        const sy = ys.filter((_, i) => i !== k);
        const v = pearson(sx, sy);
        if (v != null)
            out.push(v);
    }
    return out;
}
function jackknifeSpearman(xs, ys) {
    const out = [];
    const n = xs.length;
    if (n < 3)
        return out;
    for (let k = 0; k < n; k++) {
        const sx = xs.filter((_, i) => i !== k);
        const sy = ys.filter((_, i) => i !== k);
        const v = spearman(sx, sy);
        if (v != null)
            out.push(v);
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Main bootstrap entrypoint
// ─────────────────────────────────────────────────────────────────────────
/** Run the bootstrap. Synchronous: expect <1s for B≤2000, n≤~300. */
export function runBootstrap(points, config) {
    const rng = makeRng(config.seed);
    const B = Math.max(1, Math.floor(config.B));
    const n = points.length;
    const rValues = [];
    const rhoValues = [];
    const slopes = [];
    const intercepts = [];
    // Pre-compute MOA bucket indices for stratified scheme + per-MOA stats
    const moaBuckets = new Map();
    points.forEach((p, i) => {
        const list = moaBuckets.get(p.moaKey) || [];
        list.push(i);
        moaBuckets.set(p.moaKey, list);
    });
    const perMoaKeys = Array.from(moaBuckets.keys());
    const perMoaRSeries = {};
    const perMoaRhoSeries = {};
    for (const k of perMoaKeys) {
        perMoaRSeries[k] = [];
        perMoaRhoSeries[k] = [];
    }
    // Reusable work buffers
    const xBuf = new Array(n);
    const yBuf = new Array(n);
    // Flag array for counting distinct original indices in a resample.
    // Cleared (fill(0)) at the start of each resampling iteration.
    const seen = new Uint8Array(n);
    let sumUnique = 0;
    const drawY = (p) => p.yDrawFn ? p.yDrawFn() : p.y;
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
        }
        else if (config.scheme === 'stratified') {
            seen.fill(0);
            let w = 0;
            for (const [, indices] of moaBuckets) {
                const k = indices.length;
                for (let j = 0; j < k; j++) {
                    const idx = indices[Math.floor(rng() * k)];
                    if (!seen[idx]) {
                        seen[idx] = 1;
                        uniqueThisIter++;
                    }
                    xBuf[w] = points[idx].x;
                    yBuf[w] = points[idx].y; // simulation overlay not applied under stratified
                    w++;
                }
            }
        }
        else {
            // "trial" or "nested"
            seen.fill(0);
            const redraw = config.scheme === 'nested';
            for (let i = 0; i < n; i++) {
                const idx = Math.floor(rng() * n);
                if (!seen[idx]) {
                    seen[idx] = 1;
                    uniqueThisIter++;
                }
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
        const idxs = moaBuckets.get(key);
        const k = idxs.length;
        if (k < 3) {
            perMoaRSeries[key] = [];
            perMoaRhoSeries[key] = [];
            continue;
        }
        const xs = idxs.map((i) => points[i].x);
        const ysBase = idxs.map((i) => points[i].y);
        const pmRng = makeRng(config.seed != null ? (config.seed ^ hashStr(key)) >>> 0 : undefined);
        const xB = new Array(k);
        const yB = new Array(k);
        for (let b = 0; b < B; b++) {
            for (let j = 0; j < k; j++) {
                const draw = Math.floor(pmRng() * k);
                xB[j] = xs[draw];
                if (config.scheme === 'simulation' || config.scheme === 'nested') {
                    const original = points[idxs[draw]];
                    yB[j] = original.yDrawFn ? original.yDrawFn() : ysBase[draw];
                }
                else {
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
    const pick = (arr, hat, jack) => {
        if (hat == null)
            return null;
        if (config.ciMethod === 'bca') {
            const ci = bcaCI(arr, hat, jack(), config.ciLevel);
            if (ci != null)
                return ci;
        }
        return percentileCI(arr, config.ciLevel);
    };
    const rCI = pick(rValues, rHat, () => jackknifePearson(xOrig, yOrig));
    const rhoCI = pick(rhoValues, rhoHat, () => jackknifeSpearman(xOrig, yOrig));
    const perMoa = {};
    for (const key of perMoaKeys) {
        const idxs = moaBuckets.get(key);
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
            rCI: rH != null && rSeries.length >= 2
                ? config.ciMethod === 'bca'
                    ? bcaCI(rSeries, rH, jackknifePearson(xs, ys), config.ciLevel) ??
                        percentileCI(rSeries, config.ciLevel)
                    : percentileCI(rSeries, config.ciLevel)
                : null,
            rhoCI: rhoH != null && rhoSeries.length >= 2
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
export function materializeBand(result, xGrid) {
    if (result.config.curveType === 'none')
        return null;
    const { slopes, intercepts, config } = result;
    const usable = [];
    for (let k = 0; k < slopes.length; k++) {
        if (Number.isFinite(slopes[k]) && Number.isFinite(intercepts[k])) {
            usable.push({ s: slopes[k], i: intercepts[k] });
        }
    }
    if (usable.length < 10)
        return null;
    const alpha = (1 - config.ciLevel) / 2;
    const lower = new Array(xGrid.length);
    const upper = new Array(xGrid.length);
    const column = new Array(usable.length);
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
function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
export function runJackknife(points) {
    const n = points.length;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const rHat = pearson(xs, ys);
    const rhoHat = spearman(xs, ys);
    const fitHat = olsFit(xs, ys);
    const slopeHat = fitHat ? fitHat.slope : null;
    const interceptHat = fitHat ? fitHat.intercept : null;
    const influence = [];
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
    const xk = new Array(n - 1);
    const yk = new Array(n - 1);
    for (let k = 0; k < n; k++) {
        let w = 0;
        for (let i = 0; i < n; i++) {
            if (i === k)
                continue;
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
        if (deltaR != null)
            maxAbsDeltaR = Math.max(maxAbsDeltaR, Math.abs(deltaR));
        if (deltaRho != null)
            maxAbsDeltaRho = Math.max(maxAbsDeltaRho, Math.abs(deltaRho));
        if (deltaSlope != null)
            maxAbsDeltaSlope = Math.max(maxAbsDeltaSlope, Math.abs(deltaSlope));
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
export function runLeaveKOut(points, config) {
    const n = points.length;
    // Must leave at least 3 points behind for Pearson to be defined
    const k = Math.max(1, Math.min(n - 3, Math.floor(config.k)));
    const B = Math.max(1, Math.floor(config.B));
    const rng = makeRng(config.seed);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const rHat = pearson(xs, ys);
    const rhoHat = spearman(xs, ys);
    const rValues = [];
    const rhoValues = [];
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
    const xb = new Array(m);
    const yb = new Array(m);
    for (let b = 0; b < B; b++) {
        for (let i = 0; i < m; i++) {
            const j = i + Math.floor(rng() * (n - i));
            const tmp = pool[i];
            pool[i] = pool[j];
            pool[j] = tmp;
        }
        for (let i = 0; i < m; i++) {
            xb[i] = xs[pool[i]];
            yb[i] = ys[pool[i]];
        }
        const r = pearson(xb, yb);
        const rho = spearman(xb, yb);
        if (r != null && Number.isFinite(r))
            rValues.push(r);
        if (rho != null && Number.isFinite(rho))
            rhoValues.push(rho);
    }
    const rangeOf = (arr) => {
        if (arr.length === 0)
            return null;
        let lo = Infinity, hi = -Infinity;
        for (const v of arr) {
            if (v < lo)
                lo = v;
            if (v > hi)
                hi = v;
        }
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
