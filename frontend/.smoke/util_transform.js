// ─────────────────────────────────────────────────────────────────────────
// Basic stats
// ─────────────────────────────────────────────────────────────────────────
export function pearson(xs, ys) {
	if (xs.length < 2 || xs.length !== ys.length) return null;
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
	const indexed = arr.map((v, i) => ({
		v,
		i
	}));
	indexed.sort((a, b) => a.v - b.v);
	const r = new Array(arr.length);
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
export function spearman(xs, ys) {
	if (xs.length < 2 || xs.length !== ys.length) return null;
	return pearson(rankAvg(xs), rankAvg(ys));
}
export function olsFit(xs, ys) {
	const n = xs.length;
	if (n < 2) return null;
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
	if (sxx === 0) return null;
	const slope = sxy / sxx;
	return {
		slope,
		intercept: my - slope * mx
	};
}
// ─────────────────────────────────────────────────────────────────────────
// RNG (seedable for reproducibility)
// ─────────────────────────────────────────────────────────────────────────
// Mulberry32 — fast, adequate for resampling. Not cryptographic.
export function makeRng(seed) {
	if (seed == null || Number.isNaN(seed)) return Math.random;
	let a = seed | 0;
	return function() {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = a;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
	const t = 1 / (1 + .2316419 * Math.abs(z));
	const d = .3989422804014327 * Math.exp(-.5 * z * z);
	const p = d * t * ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t - .356563782) * t + .31938153);
	return z > 0 ? 1 - p : p;
}
export function qnorm(p) {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const A = [
		-39.69683028665376,
		220.9460984245205,
		-275.9285104469687,
		138.357751867269,
		-30.66479806614716,
		2.506628277459239
	];
	const B = [
		-54.47609879822406,
		161.5858368580409,
		-155.6989798598866,
		66.80131188771972,
		-13.28068155288572
	];
	const C = [
		-.007784894002430293,
		-.3223964580411365,
		-2.400758277161838,
		-2.549732539343734,
		4.374664141464968,
		2.938163982698783
	];
	const D = [
		.007784695709041462,
		.3224671290700398,
		2.445134137142996,
		3.754408661907416
	];
	const pLow = .02425, pHigh = 1 - pLow;
	let q, r;
	if (p < pLow) {
		q = Math.sqrt(-2 * Math.log(p));
		return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
	}
	if (p <= pHigh) {
		q = p - .5;
		r = q * q;
		return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
	}
	q = Math.sqrt(-2 * Math.log(1 - p));
	return -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
}
// ─────────────────────────────────────────────────────────────────────────
// CI constructors
// ─────────────────────────────────────────────────────────────────────────
export function percentileCI(values, ciLevel) {
	const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (sorted.length < 2) return null;
	const alpha = (1 - ciLevel) / 2;
	const loIdx = Math.max(0, Math.floor(alpha * sorted.length));
	const hiIdx = Math.min(sorted.length - 1, Math.ceil((1 - alpha) * sorted.length) - 1);
	return [sorted[loIdx], sorted[hiIdx]];
}
export function bcaCI(values, thetaHat, jackknife, ciLevel) {
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
function jackknifePearson(xs, ys) {
	const out = [];
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
function jackknifeSpearman(xs, ys) {
	const out = [];
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
	const drawY = (p) => p.yDrawFn ? p.yDrawFn() : p.y;
	for (let b = 0; b < B; b++) {
		// Build resampled (x, y) arrays for this iteration
		if (config.scheme === "simulation") {
			for (let i = 0; i < n; i++) {
				xBuf[i] = points[i].x;
				yBuf[i] = drawY(points[i]);
			}
		} else if (config.scheme === "stratified") {
			let w = 0;
			for (const [, indices] of moaBuckets) {
				const k = indices.length;
				for (let j = 0; j < k; j++) {
					const idx = indices[Math.floor(rng() * k)];
					xBuf[w] = points[idx].x;
					yBuf[w] = points[idx].y;
					w++;
				}
			}
		} else {
			// "trial" or "nested"
			const redraw = config.scheme === "nested";
			for (let i = 0; i < n; i++) {
				const idx = Math.floor(rng() * n);
				xBuf[i] = points[idx].x;
				yBuf[i] = redraw ? drawY(points[idx]) : points[idx].y;
			}
		}
		// (Per-MOA CIs are computed in a separate pass below; we don't need
		//  to track which original MOA each resampled slot came from here.)
		const r = pearson(xBuf, yBuf);
		const rho = spearman(xBuf, yBuf);
		const fit = config.curveType === "ols" ? olsFit(xBuf, yBuf) : null;
		rValues.push(r ?? NaN);
		rhoValues.push(rho ?? NaN);
		slopes.push(fit ? fit.slope : NaN);
		intercepts.push(fit ? fit.intercept : NaN);
	}
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
				if (config.scheme === "simulation" || config.scheme === "nested") {
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
	const pick = (arr, hat, jack) => {
		if (hat == null) return null;
		if (config.ciMethod === "bca") {
			const ci = bcaCI(arr, hat, jack(), config.ciLevel);
			if (ci != null) return ci;
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
			rCI: rH != null && rSeries.length >= 2 ? config.ciMethod === "bca" ? bcaCI(rSeries, rH, jackknifePearson(xs, ys), config.ciLevel) ?? percentileCI(rSeries, config.ciLevel) : percentileCI(rSeries, config.ciLevel) : null,
			rhoCI: rhoH != null && rhoSeries.length >= 2 ? config.ciMethod === "bca" ? bcaCI(rhoSeries, rhoH, jackknifeSpearman(xs, ys), config.ciLevel) ?? percentileCI(rhoSeries, config.ciLevel) : percentileCI(rhoSeries, config.ciLevel) : null
		};
	}
	return {
		config,
		nPoints: n,
		rValues,
		rhoValues,
		slopes,
		intercepts,
		rHat,
		rhoHat,
		slopeHat,
		interceptHat,
		rCI,
		rhoCI,
		perMoa
	};
}
// ─────────────────────────────────────────────────────────────────────────
// Band materialization
// ─────────────────────────────────────────────────────────────────────────
/** Compute pointwise CI band for the OLS fit at each x in `xGrid`. */
export function materializeBand(result, xGrid) {
	if (result.config.curveType === "none") return null;
	const { slopes, intercepts, config } = result;
	const usable = [];
	for (let k = 0; k < slopes.length; k++) {
		if (Number.isFinite(slopes[k]) && Number.isFinite(intercepts[k])) {
			usable.push({
				s: slopes[k],
				i: intercepts[k]
			});
		}
	}
	if (usable.length < 10) return null;
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
	return {
		lower,
		upper
	};
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
			rHat,
			rhoHat,
			slopeHat,
			interceptHat,
			influence,
			maxAbsDeltaR,
			maxAbsDeltaRho,
			maxAbsDeltaSlope
		};
	}
	const xk = new Array(n - 1);
	const yk = new Array(n - 1);
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
			deltaR,
			deltaRho,
			deltaSlope,
			deltaIntercept,
			rMinus: rk,
			rhoMinus: rhok
		});
	}
	return {
		n,
		rHat,
		rhoHat,
		slopeHat,
		interceptHat,
		influence,
		maxAbsDeltaR,
		maxAbsDeltaRho,
		maxAbsDeltaSlope
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
			config: {
				...config,
				k
			},
			n,
			rHat,
			rhoHat,
			rValues,
			rhoValues,
			rRange: null,
			rhoRange: null,
			rCI: null,
			rhoCI: null
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
		if (r != null && Number.isFinite(r)) rValues.push(r);
		if (rho != null && Number.isFinite(rho)) rhoValues.push(rho);
	}
	const rangeOf = (arr) => {
		if (arr.length === 0) return null;
		let lo = Infinity, hi = -Infinity;
		for (const v of arr) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		return [lo, hi];
	};
	return {
		config: {
			...config,
			k
		},
		n,
		rHat,
		rhoHat,
		rValues,
		rhoValues,
		rRange: rangeOf(rValues),
		rhoRange: rangeOf(rhoValues),
		rCI: percentileCI(rValues, config.ciLevel),
		rhoCI: percentileCI(rhoValues, config.ciLevel)
	};
}

//# sourceMappingURL=data:application/json;base64,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QVE7R0FBRztFQUN4QjtFQUNBO0VBQU07RUFDTjtFQUFTO0VBQ1QsUUFBUSxRQUFRLFFBQVE7RUFDeEIsVUFBVSxRQUFRLFVBQVU7RUFDNUIsS0FBSyxhQUFhLFNBQVMsT0FBTyxRQUFRO0VBQzFDLE9BQU8sYUFBYSxXQUFXLE9BQU8sUUFBUTtFQUMvQyIsIm5hbWVzIjpbXSwic291cmNlcyI6WyJib290c3RyYXAudHMiXSwidmVyc2lvbiI6Mywic291cmNlc0NvbnRlbnQiOlsiLy8gQm9vdHN0cmFwIGhlbHBlcnMgZm9yIHRoZSBNT0EgQ29ycmVsYXRpb24gcGFnZS5cbi8vXG4vLyBBbGwtcHVyZS1UUyBpbXBsZW1lbnRhdGlvbiwgbm8gZGVwcy4gUnVucyBvbiB0aGUgbWFpbiB0aHJlYWQ7IHR5cGljYWwgdXNhZ2Vcbi8vIGlzIEIg4omkIDEwLDAwMCB3aXRoIGEgZmV3IGh1bmRyZWQgcG9pbnRzLCB3aGljaCBmaW5pc2hlcyBjb21mb3J0YWJseSBiZWxvd1xuLy8gb25lIHNlY29uZCBvbiBtb2Rlcm4gaGFyZHdhcmUuIEZvciB2ZXJ5IGxhcmdlIEIgdGhlIGNhbGxlciBzaG91bGQgeWllbGRcbi8vIGNvbnRyb2wgdmlhIHJlcXVlc3RBbmltYXRpb25GcmFtZSBpbnNpZGUgdGhlIHJlc2FtcGxpbmcgbG9vcC5cbi8vXG4vLyBTdXBwb3J0cyBmb3VyIHJlc2FtcGxpbmcgc2NoZW1lczpcbi8vICAgLSBcInRyaWFsXCI6ICAgICAgc3RhbmRhcmQgY2FzZSBib290c3RyYXA7IHJlc2FtcGxlIHRoZSBOIHBvaW50cyB3aXRoXG4vLyAgICAgICAgICAgICAgICAgICByZXBsYWNlbWVudCBhbmQgcmVjb21wdXRlIHN0YXRpc3RpY3Ncbi8vICAgLSBcInNpbXVsYXRpb25cIjogcG9pbnRzIHN0YXkgZml4ZWQ7IHJlZHJhdyBlYWNoIHBvaW50J3MgeSB2aWEgdGhlXG4vLyAgICAgICAgICAgICAgICAgICBwb2ludCdzIG93biBgeURyYXdGbmAgKHByb3BhZ2F0ZXMgcGVyLXRyaWFsIHNpbXVsYXRpb25cbi8vICAgICAgICAgICAgICAgICAgIHVuY2VydGFpbnR5IHdpdGhvdXQgc2FtcGxlLXNpemUgdW5jZXJ0YWludHkpXG4vLyAgIC0gXCJuZXN0ZWRcIjogICAgIGNvbWJpbmVzIHRoZSBhYm92ZSDigJQgcmVzYW1wbGUgcG9pbnRzIEFORCByZWRyYXcgeVxuLy8gICAtIFwic3RyYXRpZmllZFwiOiByZXNhbXBsZSB3aXRoIHJlcGxhY2VtZW50IHdpdGhpbiBlYWNoIE1PQSBidWNrZXQsIHNvXG4vLyAgICAgICAgICAgICAgICAgICBidWNrZXQgc2l6ZXMgYXJlIHByZXNlcnZlZFxuLy9cbi8vIENJIGNvbnN0cnVjdGlvbiBzdXBwb3J0cyBwZXJjZW50aWxlIChkZWZhdWx0KSBhbmQgQkNhIChiaWFzLWNvcnJlY3RlZCBhbmRcbi8vIGFjY2VsZXJhdGVkLCBFZnJvbiAxOTg3KS5cbi8vXG4vLyBDdXJ2ZSBmaXQgZm9yIHRoZSBDSSBiYW5kIGlzIHNpbXBsZSBPTFMgb24gKHgsIHkpOyBpbnRlcmNlcHRzIGFuZCBzbG9wZXNcbi8vIGFyZSBzdG9yZWQgcGVyIGl0ZXJhdGlvbiBzbyB0aGUgYmFuZCBjYW4gYmUgbWF0ZXJpYWxpemVkIGF0IGFueSB4R3JpZC5cblxuZXhwb3J0IHR5cGUgUmVzYW1wbGluZ1NjaGVtZSA9ICd0cmlhbCcgfCAnc2ltdWxhdGlvbicgfCAnbmVzdGVkJyB8ICdzdHJhdGlmaWVkJztcbmV4cG9ydCB0eXBlIENJTWV0aG9kID0gJ3BlcmNlbnRpbGUnIHwgJ2JjYSc7XG5leHBvcnQgdHlwZSBDdXJ2ZVR5cGUgPSAnb2xzJyB8ICdub25lJztcblxuZXhwb3J0IGludGVyZmFjZSBCb290c3RyYXBJbnB1dFBvaW50IHtcbiAgeDogbnVtYmVyO1xuICB5OiBudW1iZXI7ICAgICAgICAgICAgICAgICAvLyBwb2ludCBlc3RpbWF0ZSAoZS5nLiBtZWFuX3ByZWRpY3RlZF9yYXRlKVxuICB5RHJhd0ZuPzogKCkgPT4gbnVtYmVyOyAgICAvLyBmcmVzaCBkcmF3IGZyb20gdGhlIHBvaW50J3MgcHJlZGljdGl2ZSBkaXN0cmlidXRpb25cbiAgbW9hS2V5OiBzdHJpbmc7ICAgICAgICAgICAgLy8gdXNlZCBmb3Igc3RyYXRpZmljYXRpb24gKyBwZXItTU9BIG91dHB1dFxuICBsYWJlbD86IHN0cmluZzsgICAgICAgICAgICAvLyBvcHRpb25hbCBkaXNwbGF5IGxhYmVsIChlLmcuIG5jdF9pZCBvciB0aGVyYXB5IG5hbWUpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQm9vdHN0cmFwQ29uZmlnIHtcbiAgQjogbnVtYmVyO1xuICBzY2hlbWU6IFJlc2FtcGxpbmdTY2hlbWU7XG4gIGNpTGV2ZWw6IG51bWJlcjsgICAgICAgICAgIC8vIGUuZy4gMC45NVxuICBjaU1ldGhvZDogQ0lNZXRob2Q7XG4gIGN1cnZlVHlwZTogQ3VydmVUeXBlO1xuICBzZWVkPzogbnVtYmVyOyAgICAgICAgICAgICAvLyBpZiBwcm92aWRlZCwgcmVzYW1wbGluZyBpcyBkZXRlcm1pbmlzdGljXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTU9BQm9vdFN0YXRzIHtcbiAgbjogbnVtYmVyO1xuICBySGF0OiBudW1iZXIgfCBudWxsO1xuICByQ0k6IFtudW1iZXIsIG51bWJlcl0gfCBudWxsO1xuICByaG9IYXQ6IG51bWJlciB8IG51bGw7XG4gIHJob0NJOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBCb290c3RyYXBSZXN1bHQge1xuICBjb25maWc6IEJvb3RzdHJhcENvbmZpZztcbiAgblBvaW50czogbnVtYmVyO1xuXG4gIC8vIFBlci1pdGVyYXRpb24gcmVjb3JkcyAoa2VwdCBzbyBjYWxsZXJzIGNhbiByZWNvbXB1dGUgYmFuZHMgb24gYW55IHhHcmlkKVxuICByVmFsdWVzOiBudW1iZXJbXTtcbiAgcmhvVmFsdWVzOiBudW1iZXJbXTtcbiAgc2xvcGVzOiBudW1iZXJbXTtcbiAgaW50ZXJjZXB0czogbnVtYmVyW107XG5cbiAgLy8gUG9pbnQgZXN0aW1hdGVzIGNvbXB1dGVkIG9uIHRoZSBvcmlnaW5hbCBkYXRhXG4gIHJIYXQ6IG51bWJlciB8IG51bGw7XG4gIHJob0hhdDogbnVtYmVyIHwgbnVsbDtcbiAgc2xvcGVIYXQ6IG51bWJlciB8IG51bGw7XG4gIGludGVyY2VwdEhhdDogbnVtYmVyIHwgbnVsbDtcblxuICAvLyBDSXNcbiAgckNJOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbDtcbiAgcmhvQ0k6IFtudW1iZXIsIG51bWJlcl0gfCBudWxsO1xuXG4gIC8vIFBlci1NT0Egc3VtbWFyeSAoa2V5ZWQgYnkgbW9hS2V5IGZyb20gdGhlIGlucHV0IHBvaW50cylcbiAgcGVyTW9hOiBSZWNvcmQ8c3RyaW5nLCBNT0FCb290U3RhdHM+O1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEJhc2ljIHN0YXRzXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZXhwb3J0IGZ1bmN0aW9uIHBlYXJzb24oeHM6IG51bWJlcltdLCB5czogbnVtYmVyW10pOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHhzLmxlbmd0aCA8IDIgfHwgeHMubGVuZ3RoICE9PSB5cy5sZW5ndGgpIHJldHVybiBudWxsO1xuICBjb25zdCBuID0geHMubGVuZ3RoO1xuICBsZXQgc3ggPSAwLCBzeSA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IHN4ICs9IHhzW2ldOyBzeSArPSB5c1tpXTsgfVxuICBjb25zdCBteCA9IHN4IC8gbiwgbXkgPSBzeSAvIG47XG4gIGxldCBudW0gPSAwLCBkeCA9IDAsIGR5ID0gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICBjb25zdCB4aSA9IHhzW2ldIC0gbXgsIHlpID0geXNbaV0gLSBteTtcbiAgICBudW0gKz0geGkgKiB5aTtcbiAgICBkeCArPSB4aSAqIHhpO1xuICAgIGR5ICs9IHlpICogeWk7XG4gIH1cbiAgY29uc3QgZGVub20gPSBNYXRoLnNxcnQoZHggKiBkeSk7XG4gIHJldHVybiBkZW5vbSA9PT0gMCA/IG51bGwgOiBudW0gLyBkZW5vbTtcbn1cblxuZnVuY3Rpb24gcmFua0F2ZyhhcnI6IG51bWJlcltdKTogbnVtYmVyW10ge1xuICBjb25zdCBpbmRleGVkID0gYXJyLm1hcCgodiwgaSkgPT4gKHsgdiwgaSB9KSk7XG4gIGluZGV4ZWQuc29ydCgoYSwgYikgPT4gYS52IC0gYi52KTtcbiAgY29uc3QgciA9IG5ldyBBcnJheTxudW1iZXI+KGFyci5sZW5ndGgpO1xuICBsZXQgaSA9IDA7XG4gIHdoaWxlIChpIDwgaW5kZXhlZC5sZW5ndGgpIHtcbiAgICBsZXQgaiA9IGk7XG4gICAgd2hpbGUgKGogKyAxIDwgaW5kZXhlZC5sZW5ndGggJiYgaW5kZXhlZFtqICsgMV0udiA9PT0gaW5kZXhlZFtpXS52KSBqKys7XG4gICAgY29uc3QgYXZnID0gKGkgKyBqKSAvIDIgKyAxO1xuICAgIGZvciAobGV0IGsgPSBpOyBrIDw9IGo7IGsrKykgcltpbmRleGVkW2tdLmldID0gYXZnO1xuICAgIGkgPSBqICsgMTtcbiAgfVxuICByZXR1cm4gcjtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNwZWFybWFuKHhzOiBudW1iZXJbXSwgeXM6IG51bWJlcltdKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh4cy5sZW5ndGggPCAyIHx8IHhzLmxlbmd0aCAhPT0geXMubGVuZ3RoKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHBlYXJzb24ocmFua0F2Zyh4cyksIHJhbmtBdmcoeXMpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG9sc0ZpdChcbiAgeHM6IG51bWJlcltdLFxuICB5czogbnVtYmVyW11cbik6IHsgc2xvcGU6IG51bWJlcjsgaW50ZXJjZXB0OiBudW1iZXIgfSB8IG51bGwge1xuICBjb25zdCBuID0geHMubGVuZ3RoO1xuICBpZiAobiA8IDIpIHJldHVybiBudWxsO1xuICBsZXQgc3ggPSAwLCBzeSA9IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgbjsgaSsrKSB7IHN4ICs9IHhzW2ldOyBzeSArPSB5c1tpXTsgfVxuICBjb25zdCBteCA9IHN4IC8gbiwgbXkgPSBzeSAvIG47XG4gIGxldCBzeHggPSAwLCBzeHkgPSAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgIGNvbnN0IGR4ID0geHNbaV0gLSBteDtcbiAgICBzeHggKz0gZHggKiBkeDtcbiAgICBzeHkgKz0gZHggKiAoeXNbaV0gLSBteSk7XG4gIH1cbiAgaWYgKHN4eCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHNsb3BlID0gc3h5IC8gc3h4O1xuICByZXR1cm4geyBzbG9wZSwgaW50ZXJjZXB0OiBteSAtIHNsb3BlICogbXggfTtcbn1cblxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBSTkcgKHNlZWRhYmxlIGZvciByZXByb2R1Y2liaWxpdHkpXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuLy8gTXVsYmVycnkzMiDigJQgZmFzdCwgYWRlcXVhdGUgZm9yIHJlc2FtcGxpbmcuIE5vdCBjcnlwdG9ncmFwaGljLlxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSbmcoc2VlZD86IG51bWJlcik6ICgpID0+IG51bWJlciB7XG4gIGlmIChzZWVkID09IG51bGwgfHwgTnVtYmVyLmlzTmFOKHNlZWQpKSByZXR1cm4gTWF0aC5yYW5kb207XG4gIGxldCBhID0gc2VlZCB8IDA7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgYSB8PSAwOyBhID0gKGEgKyAweDZEMkI3OUY1KSB8IDA7XG4gICAgbGV0IHQgPSBhO1xuICAgIHQgPSBNYXRoLmltdWwodCBeICh0ID4+PiAxNSksIHQgfCAxKTtcbiAgICB0IF49IHQgKyBNYXRoLmltdWwodCBeICh0ID4+PiA3KSwgdCB8IDYxKTtcbiAgICByZXR1cm4gKCh0IF4gKHQgPj4+IDE0KSkgPj4+IDApIC8gNDI5NDk2NzI5NjtcbiAgfTtcbn1cblxuLy8gQm94LU11bGxlciDigJQgc3RhbmRhcmQgbm9ybWFsIGRyYXcgZnJvbSBhIHVuaWZvcm0gUk5HLlxuZXhwb3J0IGZ1bmN0aW9uIGdhdXNzaWFuKHJuZzogKCkgPT4gbnVtYmVyKTogbnVtYmVyIHtcbiAgY29uc3QgdTEgPSBNYXRoLm1heCgxZS0xMiwgcm5nKCkpO1xuICBjb25zdCB1MiA9IHJuZygpO1xuICByZXR1cm4gTWF0aC5zcXJ0KC0yICogTWF0aC5sb2codTEpKSAqIE1hdGguY29zKDIgKiBNYXRoLlBJICogdTIpO1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIE5vcm1hbCBDREYgLyBxdWFudGlsZSAoQWJyYW1vd2l0ei1TdGVndW4gLyBCZWFzbGV5LVNwcmluZ2VyLU1vcm8pXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZXhwb3J0IGZ1bmN0aW9uIHBub3JtKHo6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHQgPSAxIC8gKDEgKyAwLjIzMTY0MTkgKiBNYXRoLmFicyh6KSk7XG4gIGNvbnN0IGQgPSAwLjM5ODk0MjI4MDQwMTQzMjcgKiBNYXRoLmV4cCgtMC41ICogeiAqIHopO1xuICBjb25zdCBwID0gZCAqIHQgKlxuICAgICgoKCgxLjMzMDI3NDQyOSAqIHQgLSAxLjgyMTI1NTk3OCkgKiB0ICsgMS43ODE0Nzc5MzcpICogdCAtIDAuMzU2NTYzNzgyKSAqIHQgKyAwLjMxOTM4MTUzMCk7XG4gIHJldHVybiB6ID4gMCA/IDEgLSBwIDogcDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHFub3JtKHA6IG51bWJlcik6IG51bWJlciB7XG4gIGlmIChwIDw9IDApIHJldHVybiAtSW5maW5pdHk7XG4gIGlmIChwID49IDEpIHJldHVybiBJbmZpbml0eTtcbiAgY29uc3QgQSA9IFstMy45Njk2ODMwMjg2NjUzNzZlKzEsIDIuMjA5NDYwOTg0MjQ1MjA1ZSsyLCAtMi43NTkyODUxMDQ0Njk2ODdlKzIsXG4gICAgICAgICAgICAgMS4zODM1Nzc1MTg2NzI2OTBlKzIsIC0zLjA2NjQ3OTgwNjYxNDcxNmUrMSwgMi41MDY2MjgyNzc0NTkyMzllKzBdO1xuICBjb25zdCBCID0gWy01LjQ0NzYwOTg3OTgyMjQwNmUrMSwgMS42MTU4NTgzNjg1ODA0MDllKzIsIC0xLjU1Njk4OTc5ODU5ODg2NmUrMixcbiAgICAgICAgICAgICA2LjY4MDEzMTE4ODc3MTk3MmUrMSwgLTEuMzI4MDY4MTU1Mjg4NTcyZSsxXTtcbiAgY29uc3QgQyA9IFstNy43ODQ4OTQwMDI0MzAyOTNlLTMsIC0zLjIyMzk2NDU4MDQxMTM2NWUtMSwgLTIuNDAwNzU4Mjc3MTYxODM4ZSswLFxuICAgICAgICAgICAgIC0yLjU0OTczMjUzOTM0MzczNGUrMCwgNC4zNzQ2NjQxNDE0NjQ5NjhlKzAsIDIuOTM4MTYzOTgyNjk4NzgzZSswXTtcbiAgY29uc3QgRCA9IFs3Ljc4NDY5NTcwOTA0MTQ2MmUtMywgMy4yMjQ2NzEyOTA3MDAzOThlLTEsXG4gICAgICAgICAgICAgMi40NDUxMzQxMzcxNDI5OTZlKzAsIDMuNzU0NDA4NjYxOTA3NDE2ZSswXTtcbiAgY29uc3QgcExvdyA9IDAuMDI0MjUsIHBIaWdoID0gMSAtIHBMb3c7XG4gIGxldCBxOiBudW1iZXIsIHI6IG51bWJlcjtcbiAgaWYgKHAgPCBwTG93KSB7XG4gICAgcSA9IE1hdGguc3FydCgtMiAqIE1hdGgubG9nKHApKTtcbiAgICByZXR1cm4gKCgoKChDWzBdICogcSArIENbMV0pICogcSArIENbMl0pICogcSArIENbM10pICogcSArIENbNF0pICogcSArIENbNV0pIC9cbiAgICAgICAgICAgKCgoKERbMF0gKiBxICsgRFsxXSkgKiBxICsgRFsyXSkgKiBxICsgRFszXSkgKiBxICsgMSk7XG4gIH1cbiAgaWYgKHAgPD0gcEhpZ2gpIHtcbiAgICBxID0gcCAtIDAuNTsgciA9IHEgKiBxO1xuICAgIHJldHVybiAoKCgoKEFbMF0gKiByICsgQVsxXSkgKiByICsgQVsyXSkgKiByICsgQVszXSkgKiByICsgQVs0XSkgKiByICsgQVs1XSkgKiBxIC9cbiAgICAgICAgICAgKCgoKChCWzBdICogciArIEJbMV0pICogciArIEJbMl0pICogciArIEJbM10pICogciArIEJbNF0pICogciArIDEpO1xuICB9XG4gIHEgPSBNYXRoLnNxcnQoLTIgKiBNYXRoLmxvZygxIC0gcCkpO1xuICByZXR1cm4gLSgoKCgoQ1swXSAqIHEgKyBDWzFdKSAqIHEgKyBDWzJdKSAqIHEgKyBDWzNdKSAqIHEgKyBDWzRdKSAqIHEgKyBDWzVdKSAvXG4gICAgICAgICAgKCgoKERbMF0gKiBxICsgRFsxXSkgKiBxICsgRFsyXSkgKiBxICsgRFszXSkgKiBxICsgMSk7XG59XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gQ0kgY29uc3RydWN0b3JzXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZXhwb3J0IGZ1bmN0aW9uIHBlcmNlbnRpbGVDSSh2YWx1ZXM6IG51bWJlcltdLCBjaUxldmVsOiBudW1iZXIpOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbCB7XG4gIGNvbnN0IHNvcnRlZCA9IHZhbHVlcy5maWx0ZXIoKHYpID0+IE51bWJlci5pc0Zpbml0ZSh2KSkuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuICBpZiAoc29ydGVkLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xuICBjb25zdCBhbHBoYSA9ICgxIC0gY2lMZXZlbCkgLyAyO1xuICBjb25zdCBsb0lkeCA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoYWxwaGEgKiBzb3J0ZWQubGVuZ3RoKSk7XG4gIGNvbnN0IGhpSWR4ID0gTWF0aC5taW4oc29ydGVkLmxlbmd0aCAtIDEsIE1hdGguY2VpbCgoMSAtIGFscGhhKSAqIHNvcnRlZC5sZW5ndGgpIC0gMSk7XG4gIHJldHVybiBbc29ydGVkW2xvSWR4XSwgc29ydGVkW2hpSWR4XV07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBiY2FDSShcbiAgdmFsdWVzOiBudW1iZXJbXSxcbiAgdGhldGFIYXQ6IG51bWJlcixcbiAgamFja2tuaWZlOiBudW1iZXJbXSxcbiAgY2lMZXZlbDogbnVtYmVyXG4pOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbCB7XG4gIGNvbnN0IGZpbml0ZSA9IHZhbHVlcy5maWx0ZXIoTnVtYmVyLmlzRmluaXRlKTtcbiAgaWYgKGZpbml0ZS5sZW5ndGggPCAyIHx8ICFOdW1iZXIuaXNGaW5pdGUodGhldGFIYXQpKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qgc29ydGVkID0gWy4uLmZpbml0ZV0uc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuICBjb25zdCBCID0gc29ydGVkLmxlbmd0aDtcblxuICAvLyBCaWFzLWNvcnJlY3Rpb24gejBcbiAgY29uc3QgcHJvcExlc3MgPSBzb3J0ZWQuZmlsdGVyKCh2KSA9PiB2IDwgdGhldGFIYXQpLmxlbmd0aCAvIEI7XG4gIC8vIENsaXAgdG8gYXZvaWQgwrHiiJ5cbiAgY29uc3QgejAgPSBxbm9ybShNYXRoLm1heCgxIC8gKEIgKyAxKSwgTWF0aC5taW4oQiAvIChCICsgMSksIHByb3BMZXNzKSkpO1xuXG4gIC8vIEFjY2VsZXJhdGlvbiBhIHZpYSBqYWNra25pZmVcbiAgbGV0IGEgPSAwO1xuICBpZiAoamFja2tuaWZlLmxlbmd0aCA+PSAyKSB7XG4gICAgY29uc3Qgak1lYW4gPSBqYWNra25pZmUucmVkdWNlKChzLCB2KSA9PiBzICsgdiwgMCkgLyBqYWNra25pZmUubGVuZ3RoO1xuICAgIGxldCBudW0gPSAwLCBkZW4gPSAwO1xuICAgIGZvciAoY29uc3QgaiBvZiBqYWNra25pZmUpIHtcbiAgICAgIGNvbnN0IGQgPSBqTWVhbiAtIGo7XG4gICAgICBudW0gKz0gZCAqIGQgKiBkO1xuICAgICAgZGVuICs9IGQgKiBkO1xuICAgIH1cbiAgICBjb25zdCBkZW5vbSA9IDYgKiBNYXRoLnBvdyhkZW4sIDEuNSk7XG4gICAgYSA9IGRlbm9tID09PSAwID8gMCA6IG51bSAvIGRlbm9tO1xuICB9XG5cbiAgY29uc3QgYWxwaGEgPSAoMSAtIGNpTGV2ZWwpIC8gMjtcbiAgY29uc3QgekxvID0gcW5vcm0oYWxwaGEpLCB6SGkgPSBxbm9ybSgxIC0gYWxwaGEpO1xuICBjb25zdCBwTG8gPSBwbm9ybSh6MCArICh6MCArIHpMbykgLyAoMSAtIGEgKiAoejAgKyB6TG8pKSk7XG4gIGNvbnN0IHBIaSA9IHBub3JtKHowICsgKHowICsgekhpKSAvICgxIC0gYSAqICh6MCArIHpIaSkpKTtcbiAgY29uc3QgbG9JZHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihCIC0gMSwgTWF0aC5mbG9vcihwTG8gKiBCKSkpO1xuICBjb25zdCBoaUlkeCA9IE1hdGgubWF4KDAsIE1hdGgubWluKEIgLSAxLCBNYXRoLmNlaWwocEhpICogQikgLSAxKSk7XG4gIHJldHVybiBbc29ydGVkW2xvSWR4XSwgc29ydGVkW2hpSWR4XV07XG59XG5cbmZ1bmN0aW9uIGphY2trbmlmZVBlYXJzb24oeHM6IG51bWJlcltdLCB5czogbnVtYmVyW10pOiBudW1iZXJbXSB7XG4gIGNvbnN0IG91dDogbnVtYmVyW10gPSBbXTtcbiAgY29uc3QgbiA9IHhzLmxlbmd0aDtcbiAgaWYgKG4gPCAzKSByZXR1cm4gb3V0O1xuICBmb3IgKGxldCBrID0gMDsgayA8IG47IGsrKykge1xuICAgIGNvbnN0IHN4ID0geHMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBrKTtcbiAgICBjb25zdCBzeSA9IHlzLmZpbHRlcigoXywgaSkgPT4gaSAhPT0gayk7XG4gICAgY29uc3QgdiA9IHBlYXJzb24oc3gsIHN5KTtcbiAgICBpZiAodiAhPSBudWxsKSBvdXQucHVzaCh2KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBqYWNra25pZmVTcGVhcm1hbih4czogbnVtYmVyW10sIHlzOiBudW1iZXJbXSk6IG51bWJlcltdIHtcbiAgY29uc3Qgb3V0OiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCBuID0geHMubGVuZ3RoO1xuICBpZiAobiA8IDMpIHJldHVybiBvdXQ7XG4gIGZvciAobGV0IGsgPSAwOyBrIDwgbjsgaysrKSB7XG4gICAgY29uc3Qgc3ggPSB4cy5maWx0ZXIoKF8sIGkpID0+IGkgIT09IGspO1xuICAgIGNvbnN0IHN5ID0geXMuZmlsdGVyKChfLCBpKSA9PiBpICE9PSBrKTtcbiAgICBjb25zdCB2ID0gc3BlYXJtYW4oc3gsIHN5KTtcbiAgICBpZiAodiAhPSBudWxsKSBvdXQucHVzaCh2KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIE1haW4gYm9vdHN0cmFwIGVudHJ5cG9pbnRcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG4vKiogUnVuIHRoZSBib290c3RyYXAuIFN5bmNocm9ub3VzOiBleHBlY3QgPDFzIGZvciBC4omkMjAwMCwgbuKJpH4zMDAuICovXG5leHBvcnQgZnVuY3Rpb24gcnVuQm9vdHN0cmFwKFxuICBwb2ludHM6IEJvb3RzdHJhcElucHV0UG9pbnRbXSxcbiAgY29uZmlnOiBCb290c3RyYXBDb25maWdcbik6IEJvb3RzdHJhcFJlc3VsdCB7XG4gIGNvbnN0IHJuZyA9IG1ha2VSbmcoY29uZmlnLnNlZWQpO1xuICBjb25zdCBCID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihjb25maWcuQikpO1xuICBjb25zdCBuID0gcG9pbnRzLmxlbmd0aDtcblxuICBjb25zdCByVmFsdWVzOiBudW1iZXJbXSA9IFtdO1xuICBjb25zdCByaG9WYWx1ZXM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IHNsb3BlczogbnVtYmVyW10gPSBbXTtcbiAgY29uc3QgaW50ZXJjZXB0czogbnVtYmVyW10gPSBbXTtcblxuICAvLyBQcmUtY29tcHV0ZSBNT0EgYnVja2V0IGluZGljZXMgZm9yIHN0cmF0aWZpZWQgc2NoZW1lICsgcGVyLU1PQSBzdGF0c1xuICBjb25zdCBtb2FCdWNrZXRzOiBNYXA8c3RyaW5nLCBudW1iZXJbXT4gPSBuZXcgTWFwKCk7XG4gIHBvaW50cy5mb3JFYWNoKChwLCBpKSA9PiB7XG4gICAgY29uc3QgbGlzdCA9IG1vYUJ1Y2tldHMuZ2V0KHAubW9hS2V5KSB8fCBbXTtcbiAgICBsaXN0LnB1c2goaSk7XG4gICAgbW9hQnVja2V0cy5zZXQocC5tb2FLZXksIGxpc3QpO1xuICB9KTtcbiAgY29uc3QgcGVyTW9hS2V5cyA9IEFycmF5LmZyb20obW9hQnVja2V0cy5rZXlzKCkpO1xuICBjb25zdCBwZXJNb2FSU2VyaWVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT4gPSB7fTtcbiAgY29uc3QgcGVyTW9hUmhvU2VyaWVzOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXJbXT4gPSB7fTtcbiAgZm9yIChjb25zdCBrIG9mIHBlck1vYUtleXMpIHtcbiAgICBwZXJNb2FSU2VyaWVzW2tdID0gW107XG4gICAgcGVyTW9hUmhvU2VyaWVzW2tdID0gW107XG4gIH1cblxuICAvLyBSZXVzYWJsZSB3b3JrIGJ1ZmZlcnNcbiAgY29uc3QgeEJ1ZiA9IG5ldyBBcnJheTxudW1iZXI+KG4pO1xuICBjb25zdCB5QnVmID0gbmV3IEFycmF5PG51bWJlcj4obik7XG5cbiAgY29uc3QgZHJhd1kgPSAocDogQm9vdHN0cmFwSW5wdXRQb2ludCk6IG51bWJlciA9PlxuICAgIHAueURyYXdGbiA/IHAueURyYXdGbigpIDogcC55O1xuXG4gIGZvciAobGV0IGIgPSAwOyBiIDwgQjsgYisrKSB7XG4gICAgLy8gQnVpbGQgcmVzYW1wbGVkICh4LCB5KSBhcnJheXMgZm9yIHRoaXMgaXRlcmF0aW9uXG4gICAgaWYgKGNvbmZpZy5zY2hlbWUgPT09ICdzaW11bGF0aW9uJykge1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHtcbiAgICAgICAgeEJ1ZltpXSA9IHBvaW50c1tpXS54O1xuICAgICAgICB5QnVmW2ldID0gZHJhd1kocG9pbnRzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGNvbmZpZy5zY2hlbWUgPT09ICdzdHJhdGlmaWVkJykge1xuICAgICAgbGV0IHcgPSAwO1xuICAgICAgZm9yIChjb25zdCBbLCBpbmRpY2VzXSBvZiBtb2FCdWNrZXRzKSB7XG4gICAgICAgIGNvbnN0IGsgPSBpbmRpY2VzLmxlbmd0aDtcbiAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBrOyBqKyspIHtcbiAgICAgICAgICBjb25zdCBpZHggPSBpbmRpY2VzW01hdGguZmxvb3Iocm5nKCkgKiBrKV07XG4gICAgICAgICAgeEJ1Zlt3XSA9IHBvaW50c1tpZHhdLng7XG4gICAgICAgICAgeUJ1Zlt3XSA9IHBvaW50c1tpZHhdLnk7ICAvLyBzaW11bGF0aW9uIG92ZXJsYXkgbm90IGFwcGxpZWQgdW5kZXIgc3RyYXRpZmllZFxuICAgICAgICAgIHcrKztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBcInRyaWFsXCIgb3IgXCJuZXN0ZWRcIlxuICAgICAgY29uc3QgcmVkcmF3ID0gY29uZmlnLnNjaGVtZSA9PT0gJ25lc3RlZCc7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgICAgICBjb25zdCBpZHggPSBNYXRoLmZsb29yKHJuZygpICogbik7XG4gICAgICAgIHhCdWZbaV0gPSBwb2ludHNbaWR4XS54O1xuICAgICAgICB5QnVmW2ldID0gcmVkcmF3ID8gZHJhd1kocG9pbnRzW2lkeF0pIDogcG9pbnRzW2lkeF0ueTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyAoUGVyLU1PQSBDSXMgYXJlIGNvbXB1dGVkIGluIGEgc2VwYXJhdGUgcGFzcyBiZWxvdzsgd2UgZG9uJ3QgbmVlZFxuICAgIC8vICB0byB0cmFjayB3aGljaCBvcmlnaW5hbCBNT0EgZWFjaCByZXNhbXBsZWQgc2xvdCBjYW1lIGZyb20gaGVyZS4pXG5cbiAgICBjb25zdCByID0gcGVhcnNvbih4QnVmLCB5QnVmKTtcbiAgICBjb25zdCByaG8gPSBzcGVhcm1hbih4QnVmLCB5QnVmKTtcbiAgICBjb25zdCBmaXQgPSBjb25maWcuY3VydmVUeXBlID09PSAnb2xzJyA/IG9sc0ZpdCh4QnVmLCB5QnVmKSA6IG51bGw7XG4gICAgclZhbHVlcy5wdXNoKHIgPz8gTmFOKTtcbiAgICByaG9WYWx1ZXMucHVzaChyaG8gPz8gTmFOKTtcbiAgICBzbG9wZXMucHVzaChmaXQgPyBmaXQuc2xvcGUgOiBOYU4pO1xuICAgIGludGVyY2VwdHMucHVzaChmaXQgPyBmaXQuaW50ZXJjZXB0IDogTmFOKTtcbiAgfVxuXG4gIC8vIFBlci1NT0Egc3RhdHMg4oCUIGNsZWFuZXIgc2Vjb25kIHBhc3MgdXNpbmcgcGVyLWJ1Y2tldCB0cmlhbCByZXNhbXBsaW5nLlxuICAvLyBXZSBkbyBhIGZyZXNoIHBlci1NT0EgYm9vdHN0cmFwIGhlcmUgd2l0aCB0aGUgc2FtZSBCIHNvIHRoZSBDSXMgYXJlIGhvbmVzdFxuICAvLyByZWdhcmRsZXNzIG9mIHRoZSBvdXRlciBzY2hlbWUgY2hvaWNlLiBTY2hlbWUgc3BlY2lmaWMgc2VtYW50aWNzIGZvclxuICAvLyBwZXItTU9BIHRlbmQgdG8gcmVkdWNlIHRvIHRyaWFsLXJlc2FtcGxlLXdpdGhpbi1idWNrZXQsIHdoaWNoIGlzIHdoYXRcbiAgLy8gYSB1c2VyIHR5cGljYWxseSB3YW50cyB0byBzZWUgbmV4dCB0byBlYWNoIHJvdy5cbiAgZm9yIChjb25zdCBrZXkgb2YgcGVyTW9hS2V5cykge1xuICAgIGNvbnN0IGlkeHMgPSBtb2FCdWNrZXRzLmdldChrZXkpITtcbiAgICBjb25zdCBrID0gaWR4cy5sZW5ndGg7XG4gICAgaWYgKGsgPCAzKSB7XG4gICAgICBwZXJNb2FSU2VyaWVzW2tleV0gPSBbXTtcbiAgICAgIHBlck1vYVJob1Nlcmllc1trZXldID0gW107XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeHMgPSBpZHhzLm1hcCgoaSkgPT4gcG9pbnRzW2ldLngpO1xuICAgIGNvbnN0IHlzQmFzZSA9IGlkeHMubWFwKChpKSA9PiBwb2ludHNbaV0ueSk7XG4gICAgY29uc3QgcG1SbmcgPSBtYWtlUm5nKFxuICAgICAgY29uZmlnLnNlZWQgIT0gbnVsbCA/IChjb25maWcuc2VlZCBeIGhhc2hTdHIoa2V5KSkgPj4+IDAgOiB1bmRlZmluZWRcbiAgICApO1xuICAgIGNvbnN0IHhCID0gbmV3IEFycmF5PG51bWJlcj4oayk7XG4gICAgY29uc3QgeUIgPSBuZXcgQXJyYXk8bnVtYmVyPihrKTtcbiAgICBmb3IgKGxldCBiID0gMDsgYiA8IEI7IGIrKykge1xuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBrOyBqKyspIHtcbiAgICAgICAgY29uc3QgZHJhdyA9IE1hdGguZmxvb3IocG1SbmcoKSAqIGspO1xuICAgICAgICB4QltqXSA9IHhzW2RyYXddO1xuICAgICAgICBpZiAoY29uZmlnLnNjaGVtZSA9PT0gJ3NpbXVsYXRpb24nIHx8IGNvbmZpZy5zY2hlbWUgPT09ICduZXN0ZWQnKSB7XG4gICAgICAgICAgY29uc3Qgb3JpZ2luYWwgPSBwb2ludHNbaWR4c1tkcmF3XV07XG4gICAgICAgICAgeUJbal0gPSBvcmlnaW5hbC55RHJhd0ZuID8gb3JpZ2luYWwueURyYXdGbigpIDogeXNCYXNlW2RyYXddO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHlCW2pdID0geXNCYXNlW2RyYXddO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCByID0gcGVhcnNvbih4QiwgeUIpO1xuICAgICAgY29uc3QgcmhvID0gc3BlYXJtYW4oeEIsIHlCKTtcbiAgICAgIHBlck1vYVJTZXJpZXNba2V5XS5wdXNoKHIgPz8gTmFOKTtcbiAgICAgIHBlck1vYVJob1Nlcmllc1trZXldLnB1c2gocmhvID8/IE5hTik7XG4gICAgfVxuICB9XG5cbiAgLy8gUG9pbnQgZXN0aW1hdGVzIG9uIHRoZSBvcmlnaW5hbCBkYXRhXG4gIGNvbnN0IHhPcmlnID0gcG9pbnRzLm1hcCgocCkgPT4gcC54KTtcbiAgY29uc3QgeU9yaWcgPSBwb2ludHMubWFwKChwKSA9PiBwLnkpO1xuICBjb25zdCBySGF0ID0gcGVhcnNvbih4T3JpZywgeU9yaWcpO1xuICBjb25zdCByaG9IYXQgPSBzcGVhcm1hbih4T3JpZywgeU9yaWcpO1xuICBjb25zdCBmaXQgPSBvbHNGaXQoeE9yaWcsIHlPcmlnKTtcbiAgY29uc3Qgc2xvcGVIYXQgPSBmaXQgPyBmaXQuc2xvcGUgOiBudWxsO1xuICBjb25zdCBpbnRlcmNlcHRIYXQgPSBmaXQgPyBmaXQuaW50ZXJjZXB0IDogbnVsbDtcblxuICAvLyBDSXNcbiAgY29uc3QgcGljayA9IChcbiAgICBhcnI6IG51bWJlcltdLFxuICAgIGhhdDogbnVtYmVyIHwgbnVsbCxcbiAgICBqYWNrOiAoKSA9PiBudW1iZXJbXVxuICApOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbCA9PiB7XG4gICAgaWYgKGhhdCA9PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgICBpZiAoY29uZmlnLmNpTWV0aG9kID09PSAnYmNhJykge1xuICAgICAgY29uc3QgY2kgPSBiY2FDSShhcnIsIGhhdCwgamFjaygpLCBjb25maWcuY2lMZXZlbCk7XG4gICAgICBpZiAoY2kgIT0gbnVsbCkgcmV0dXJuIGNpO1xuICAgIH1cbiAgICByZXR1cm4gcGVyY2VudGlsZUNJKGFyciwgY29uZmlnLmNpTGV2ZWwpO1xuICB9O1xuXG4gIGNvbnN0IHJDSSA9IHBpY2soclZhbHVlcywgckhhdCwgKCkgPT4gamFja2tuaWZlUGVhcnNvbih4T3JpZywgeU9yaWcpKTtcbiAgY29uc3QgcmhvQ0kgPSBwaWNrKHJob1ZhbHVlcywgcmhvSGF0LCAoKSA9PiBqYWNra25pZmVTcGVhcm1hbih4T3JpZywgeU9yaWcpKTtcblxuICBjb25zdCBwZXJNb2E6IFJlY29yZDxzdHJpbmcsIE1PQUJvb3RTdGF0cz4gPSB7fTtcbiAgZm9yIChjb25zdCBrZXkgb2YgcGVyTW9hS2V5cykge1xuICAgIGNvbnN0IGlkeHMgPSBtb2FCdWNrZXRzLmdldChrZXkpITtcbiAgICBjb25zdCB4cyA9IGlkeHMubWFwKChpKSA9PiBwb2ludHNbaV0ueCk7XG4gICAgY29uc3QgeXMgPSBpZHhzLm1hcCgoaSkgPT4gcG9pbnRzW2ldLnkpO1xuICAgIGNvbnN0IHJIID0gcGVhcnNvbih4cywgeXMpO1xuICAgIGNvbnN0IHJob0ggPSBzcGVhcm1hbih4cywgeXMpO1xuICAgIGNvbnN0IHJTZXJpZXMgPSBwZXJNb2FSU2VyaWVzW2tleV07XG4gICAgY29uc3QgcmhvU2VyaWVzID0gcGVyTW9hUmhvU2VyaWVzW2tleV07XG4gICAgcGVyTW9hW2tleV0gPSB7XG4gICAgICBuOiBpZHhzLmxlbmd0aCxcbiAgICAgIHJIYXQ6IHJILFxuICAgICAgcmhvSGF0OiByaG9ILFxuICAgICAgckNJOlxuICAgICAgICBySCAhPSBudWxsICYmIHJTZXJpZXMubGVuZ3RoID49IDJcbiAgICAgICAgICA/IGNvbmZpZy5jaU1ldGhvZCA9PT0gJ2JjYSdcbiAgICAgICAgICAgID8gYmNhQ0koclNlcmllcywgckgsIGphY2trbmlmZVBlYXJzb24oeHMsIHlzKSwgY29uZmlnLmNpTGV2ZWwpID8/XG4gICAgICAgICAgICAgIHBlcmNlbnRpbGVDSShyU2VyaWVzLCBjb25maWcuY2lMZXZlbClcbiAgICAgICAgICAgIDogcGVyY2VudGlsZUNJKHJTZXJpZXMsIGNvbmZpZy5jaUxldmVsKVxuICAgICAgICAgIDogbnVsbCxcbiAgICAgIHJob0NJOlxuICAgICAgICByaG9IICE9IG51bGwgJiYgcmhvU2VyaWVzLmxlbmd0aCA+PSAyXG4gICAgICAgICAgPyBjb25maWcuY2lNZXRob2QgPT09ICdiY2EnXG4gICAgICAgICAgICA/IGJjYUNJKHJob1NlcmllcywgcmhvSCwgamFja2tuaWZlU3BlYXJtYW4oeHMsIHlzKSwgY29uZmlnLmNpTGV2ZWwpID8/XG4gICAgICAgICAgICAgIHBlcmNlbnRpbGVDSShyaG9TZXJpZXMsIGNvbmZpZy5jaUxldmVsKVxuICAgICAgICAgICAgOiBwZXJjZW50aWxlQ0kocmhvU2VyaWVzLCBjb25maWcuY2lMZXZlbClcbiAgICAgICAgICA6IG51bGwsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgY29uZmlnLFxuICAgIG5Qb2ludHM6IG4sXG4gICAgclZhbHVlcywgcmhvVmFsdWVzLCBzbG9wZXMsIGludGVyY2VwdHMsXG4gICAgckhhdCwgcmhvSGF0LCBzbG9wZUhhdCwgaW50ZXJjZXB0SGF0LFxuICAgIHJDSSwgcmhvQ0ksXG4gICAgcGVyTW9hLFxuICB9O1xufVxuXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbi8vIEJhbmQgbWF0ZXJpYWxpemF0aW9uXG4vLyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuLyoqIENvbXB1dGUgcG9pbnR3aXNlIENJIGJhbmQgZm9yIHRoZSBPTFMgZml0IGF0IGVhY2ggeCBpbiBgeEdyaWRgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGVyaWFsaXplQmFuZChcbiAgcmVzdWx0OiBCb290c3RyYXBSZXN1bHQsXG4gIHhHcmlkOiBudW1iZXJbXVxuKTogeyBsb3dlcjogbnVtYmVyW107IHVwcGVyOiBudW1iZXJbXSB9IHwgbnVsbCB7XG4gIGlmIChyZXN1bHQuY29uZmlnLmN1cnZlVHlwZSA9PT0gJ25vbmUnKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBzbG9wZXMsIGludGVyY2VwdHMsIGNvbmZpZyB9ID0gcmVzdWx0O1xuICBjb25zdCB1c2FibGU6IEFycmF5PHsgczogbnVtYmVyOyBpOiBudW1iZXIgfT4gPSBbXTtcbiAgZm9yIChsZXQgayA9IDA7IGsgPCBzbG9wZXMubGVuZ3RoOyBrKyspIHtcbiAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHNsb3Blc1trXSkgJiYgTnVtYmVyLmlzRmluaXRlKGludGVyY2VwdHNba10pKSB7XG4gICAgICB1c2FibGUucHVzaCh7IHM6IHNsb3Blc1trXSwgaTogaW50ZXJjZXB0c1trXSB9KTtcbiAgICB9XG4gIH1cbiAgaWYgKHVzYWJsZS5sZW5ndGggPCAxMCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFscGhhID0gKDEgLSBjb25maWcuY2lMZXZlbCkgLyAyO1xuICBjb25zdCBsb3dlcjogbnVtYmVyW10gPSBuZXcgQXJyYXkoeEdyaWQubGVuZ3RoKTtcbiAgY29uc3QgdXBwZXI6IG51bWJlcltdID0gbmV3IEFycmF5KHhHcmlkLmxlbmd0aCk7XG4gIGNvbnN0IGNvbHVtbiA9IG5ldyBBcnJheTxudW1iZXI+KHVzYWJsZS5sZW5ndGgpO1xuICBmb3IgKGxldCBnID0gMDsgZyA8IHhHcmlkLmxlbmd0aDsgZysrKSB7XG4gICAgY29uc3QgeDAgPSB4R3JpZFtnXTtcbiAgICBmb3IgKGxldCBrID0gMDsgayA8IHVzYWJsZS5sZW5ndGg7IGsrKykge1xuICAgICAgY29sdW1uW2tdID0gdXNhYmxlW2tdLmkgKyB1c2FibGVba10ucyAqIHgwO1xuICAgIH1cbiAgICBjb2x1bW4uc29ydCgoYSwgYikgPT4gYSAtIGIpO1xuICAgIGNvbnN0IGxvSWR4ID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihhbHBoYSAqIGNvbHVtbi5sZW5ndGgpKTtcbiAgICBjb25zdCBoaUlkeCA9IE1hdGgubWluKGNvbHVtbi5sZW5ndGggLSAxLCBNYXRoLmNlaWwoKDEgLSBhbHBoYSkgKiBjb2x1bW4ubGVuZ3RoKSAtIDEpO1xuICAgIGxvd2VyW2ddID0gY29sdW1uW2xvSWR4XTtcbiAgICB1cHBlcltnXSA9IGNvbHVtbltoaUlkeF07XG4gIH1cbiAgcmV0dXJuIHsgbG93ZXIsIHVwcGVyIH07XG59XG5cbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gSGVscGVyc1xuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmZ1bmN0aW9uIGhhc2hTdHIoczogc3RyaW5nKTogbnVtYmVyIHtcbiAgbGV0IGggPSAyMTY2MTM2MjYxID4+PiAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHMubGVuZ3RoOyBpKyspIHtcbiAgICBoIF49IHMuY2hhckNvZGVBdChpKTtcbiAgICBoID0gTWF0aC5pbXVsKGgsIDE2Nzc3NjE5KSA+Pj4gMDtcbiAgfVxuICByZXR1cm4gaCA+Pj4gMDtcbn1cblxuLy8g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBSb2J1c3RuZXNzOiBqYWNra25pZmUgKGxlYXZlLW9uZS1vdXQpICsgbGVhdmUtay1vdXQgc3Vic2FtcGxpbmdcbi8vIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy9cbi8vIFRoZXNlIGFyZSAqc2Vuc2l0aXZpdHkqIGFuYWx5c2VzLCBub3QgY29uZmlkZW5jZSBpbnRlcnZhbHMgZm9yIHRoZSBmdWxsXG4vLyBzYW1wbGUg4oCUIHRoZXkgYW5zd2VyIFwiaG93IG11Y2ggZG9lcyBteSByZXN1bHQgZGVwZW5kIG9uIGluZGl2aWR1YWxcbi8vIHRyaWFscyAvIG9uIGFueSBwYXJ0aWN1bGFyIHN1YnNldCBvZiBrIHRyaWFscz9cIi5cbi8vXG4vLyAgIC0gSmFja2tuaWZlOiBkcm9wIGVhY2ggcG9pbnQgaW4gdHVybiwgcmVjb3JkIGhvdyByL8+BL3Nsb3BlIHNoaWZ0LlxuLy8gICAgIE91dHB1dCBwZXItcG9pbnQgaW5mbHVlbmNlIHZhbHVlcyBzdWl0YWJsZSBmb3IgYSBiYXIgY2hhcnQuXG4vL1xuLy8gICAtIExlYXZlLWstb3V0OiByYW5kb21seSBkcm9wIGsgcG9pbnRzLCByZWNvcmQgdGhlIHJlc3VsdGluZyByL8+BLlxuLy8gICAgIFJlcGVhdCBCIHRpbWVzLiBSZXBvcnRzIHRoZSBtaW4vbWF4IHJhbmdlIGFuZCBhIHBlcmNlbnRpbGUgYmFuZC5cbi8vXG4vLyBTZW1hbnRpY3Mgbm90ZTogd2UgZGVmaW5lIM6UID0gKHN0YXRpc3RpYyB3aXRoIHBvaW50IHJlbW92ZWQpIOKIkiAoc3RhdGlzdGljXG4vLyBvbiBmdWxsIHNhbXBsZSkuIFNvIM6UciA+IDAgbWVhbnMgXCJyZW1vdmluZyB0aGlzIHBvaW50IGluY3JlYXNlcyByXCJcbi8vIChpLmUuIHRoZSBwb2ludCB3YXMgcHVsbGluZyByIGRvd24pOyDOlHIgPCAwIG1lYW5zIHRoZSBwb2ludCB3YXNcbi8vIHN1cHBvcnRpbmcgdGhlIGNvcnJlbGF0aW9uLlxuXG5leHBvcnQgaW50ZXJmYWNlIEluZmx1ZW5jZVBvaW50IHtcbiAgaW5kZXg6IG51bWJlcjsgICAgICAgICAgICAvLyBvcmlnaW5hbCBpbmRleCBpbiBwb2ludHMgYXJyYXlcbiAgbGFiZWw6IHN0cmluZzsgICAgICAgICAgICAvLyBkaXNwbGF5IGxhYmVsIChmYWxscyBiYWNrIHRvIGAjPGluZGV4PmApXG4gIG1vYUtleTogc3RyaW5nO1xuICB4OiBudW1iZXI7XG4gIHk6IG51bWJlcjtcbiAgZGVsdGFSOiBudW1iZXIgfCBudWxsOyAgICAgICAgLy8gcl9taW51cyDiiJIgckhhdFxuICBkZWx0YVJobzogbnVtYmVyIHwgbnVsbDtcbiAgZGVsdGFTbG9wZTogbnVtYmVyIHwgbnVsbDtcbiAgZGVsdGFJbnRlcmNlcHQ6IG51bWJlciB8IG51bGw7XG4gIHJNaW51czogbnVtYmVyIHwgbnVsbDsgICAgICAgIC8vIHIgY29tcHV0ZWQgd2l0aG91dCB0aGlzIHBvaW50XG4gIHJob01pbnVzOiBudW1iZXIgfCBudWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEphY2trbmlmZVJlc3VsdCB7XG4gIG46IG51bWJlcjtcbiAgckhhdDogbnVtYmVyIHwgbnVsbDtcbiAgcmhvSGF0OiBudW1iZXIgfCBudWxsO1xuICBzbG9wZUhhdDogbnVtYmVyIHwgbnVsbDtcbiAgaW50ZXJjZXB0SGF0OiBudW1iZXIgfCBudWxsO1xuICBpbmZsdWVuY2U6IEluZmx1ZW5jZVBvaW50W107XG4gIG1heEFic0RlbHRhUjogbnVtYmVyO1xuICBtYXhBYnNEZWx0YVJobzogbnVtYmVyO1xuICBtYXhBYnNEZWx0YVNsb3BlOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGVhdmVLT3V0Q29uZmlnIHtcbiAgazogbnVtYmVyO1xuICBCOiBudW1iZXI7XG4gIGNpTGV2ZWw6IG51bWJlcjtcbiAgc2VlZD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMZWF2ZUtPdXRSZXN1bHQge1xuICBjb25maWc6IExlYXZlS091dENvbmZpZzsgICAgIC8vIGsgbWF5IGRpZmZlciBmcm9tIHJlcXVlc3QgaWYgY2xhbXBlZFxuICBuOiBudW1iZXI7XG4gIHJIYXQ6IG51bWJlciB8IG51bGw7XG4gIHJob0hhdDogbnVtYmVyIHwgbnVsbDtcbiAgclZhbHVlczogbnVtYmVyW107XG4gIHJob1ZhbHVlczogbnVtYmVyW107XG4gIHJSYW5nZTogW251bWJlciwgbnVtYmVyXSB8IG51bGw7XG4gIHJob1JhbmdlOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbDtcbiAgckNJOiBbbnVtYmVyLCBudW1iZXJdIHwgbnVsbDtcbiAgcmhvQ0k6IFtudW1iZXIsIG51bWJlcl0gfCBudWxsO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcnVuSmFja2tuaWZlKHBvaW50czogQm9vdHN0cmFwSW5wdXRQb2ludFtdKTogSmFja2tuaWZlUmVzdWx0IHtcbiAgY29uc3QgbiA9IHBvaW50cy5sZW5ndGg7XG4gIGNvbnN0IHhzID0gcG9pbnRzLm1hcCgocCkgPT4gcC54KTtcbiAgY29uc3QgeXMgPSBwb2ludHMubWFwKChwKSA9PiBwLnkpO1xuICBjb25zdCBySGF0ID0gcGVhcnNvbih4cywgeXMpO1xuICBjb25zdCByaG9IYXQgPSBzcGVhcm1hbih4cywgeXMpO1xuICBjb25zdCBmaXRIYXQgPSBvbHNGaXQoeHMsIHlzKTtcbiAgY29uc3Qgc2xvcGVIYXQgPSBmaXRIYXQgPyBmaXRIYXQuc2xvcGUgOiBudWxsO1xuICBjb25zdCBpbnRlcmNlcHRIYXQgPSBmaXRIYXQgPyBmaXRIYXQuaW50ZXJjZXB0IDogbnVsbDtcblxuICBjb25zdCBpbmZsdWVuY2U6IEluZmx1ZW5jZVBvaW50W10gPSBbXTtcbiAgbGV0IG1heEFic0RlbHRhUiA9IDA7XG4gIGxldCBtYXhBYnNEZWx0YVJobyA9IDA7XG4gIGxldCBtYXhBYnNEZWx0YVNsb3BlID0gMDtcblxuICBpZiAobiA8IDMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbixcbiAgICAgIHJIYXQsIHJob0hhdCwgc2xvcGVIYXQsIGludGVyY2VwdEhhdCxcbiAgICAgIGluZmx1ZW5jZSwgbWF4QWJzRGVsdGFSLCBtYXhBYnNEZWx0YVJobywgbWF4QWJzRGVsdGFTbG9wZSxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgeGsgPSBuZXcgQXJyYXk8bnVtYmVyPihuIC0gMSk7XG4gIGNvbnN0IHlrID0gbmV3IEFycmF5PG51bWJlcj4obiAtIDEpO1xuICBmb3IgKGxldCBrID0gMDsgayA8IG47IGsrKykge1xuICAgIGxldCB3ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG47IGkrKykge1xuICAgICAgaWYgKGkgPT09IGspIGNvbnRpbnVlO1xuICAgICAgeGtbd10gPSB4c1tpXTtcbiAgICAgIHlrW3ddID0geXNbaV07XG4gICAgICB3Kys7XG4gICAgfVxuICAgIGNvbnN0IHJrID0gcGVhcnNvbih4aywgeWspO1xuICAgIGNvbnN0IHJob2sgPSBzcGVhcm1hbih4aywgeWspO1xuICAgIGNvbnN0IGZrID0gb2xzRml0KHhrLCB5ayk7XG4gICAgY29uc3QgZGVsdGFSID0gckhhdCAhPSBudWxsICYmIHJrICE9IG51bGwgPyByayAtIHJIYXQgOiBudWxsO1xuICAgIGNvbnN0IGRlbHRhUmhvID0gcmhvSGF0ICE9IG51bGwgJiYgcmhvayAhPSBudWxsID8gcmhvayAtIHJob0hhdCA6IG51bGw7XG4gICAgY29uc3QgZGVsdGFTbG9wZSA9IHNsb3BlSGF0ICE9IG51bGwgJiYgZmsgIT0gbnVsbCA/IGZrLnNsb3BlIC0gc2xvcGVIYXQgOiBudWxsO1xuICAgIGNvbnN0IGRlbHRhSW50ZXJjZXB0ID0gaW50ZXJjZXB0SGF0ICE9IG51bGwgJiYgZmsgIT0gbnVsbCA/IGZrLmludGVyY2VwdCAtIGludGVyY2VwdEhhdCA6IG51bGw7XG4gICAgaWYgKGRlbHRhUiAhPSBudWxsKSBtYXhBYnNEZWx0YVIgPSBNYXRoLm1heChtYXhBYnNEZWx0YVIsIE1hdGguYWJzKGRlbHRhUikpO1xuICAgIGlmIChkZWx0YVJobyAhPSBudWxsKSBtYXhBYnNEZWx0YVJobyA9IE1hdGgubWF4KG1heEFic0RlbHRhUmhvLCBNYXRoLmFicyhkZWx0YVJobykpO1xuICAgIGlmIChkZWx0YVNsb3BlICE9IG51bGwpIG1heEFic0RlbHRhU2xvcGUgPSBNYXRoLm1heChtYXhBYnNEZWx0YVNsb3BlLCBNYXRoLmFicyhkZWx0YVNsb3BlKSk7XG4gICAgaW5mbHVlbmNlLnB1c2goe1xuICAgICAgaW5kZXg6IGssXG4gICAgICBsYWJlbDogcG9pbnRzW2tdLmxhYmVsID8/IGAjJHtrfWAsXG4gICAgICBtb2FLZXk6IHBvaW50c1trXS5tb2FLZXksXG4gICAgICB4OiBwb2ludHNba10ueCxcbiAgICAgIHk6IHBvaW50c1trXS55LFxuICAgICAgZGVsdGFSLCBkZWx0YVJobywgZGVsdGFTbG9wZSwgZGVsdGFJbnRlcmNlcHQsXG4gICAgICByTWludXM6IHJrLCByaG9NaW51czogcmhvayxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbixcbiAgICBySGF0LCByaG9IYXQsIHNsb3BlSGF0LCBpbnRlcmNlcHRIYXQsXG4gICAgaW5mbHVlbmNlLCBtYXhBYnNEZWx0YVIsIG1heEFic0RlbHRhUmhvLCBtYXhBYnNEZWx0YVNsb3BlLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcnVuTGVhdmVLT3V0KFxuICBwb2ludHM6IEJvb3RzdHJhcElucHV0UG9pbnRbXSxcbiAgY29uZmlnOiBMZWF2ZUtPdXRDb25maWdcbik6IExlYXZlS091dFJlc3VsdCB7XG4gIGNvbnN0IG4gPSBwb2ludHMubGVuZ3RoO1xuICAvLyBNdXN0IGxlYXZlIGF0IGxlYXN0IDMgcG9pbnRzIGJlaGluZCBmb3IgUGVhcnNvbiB0byBiZSBkZWZpbmVkXG4gIGNvbnN0IGsgPSBNYXRoLm1heCgxLCBNYXRoLm1pbihuIC0gMywgTWF0aC5mbG9vcihjb25maWcuaykpKTtcbiAgY29uc3QgQiA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoY29uZmlnLkIpKTtcbiAgY29uc3Qgcm5nID0gbWFrZVJuZyhjb25maWcuc2VlZCk7XG4gIGNvbnN0IHhzID0gcG9pbnRzLm1hcCgocCkgPT4gcC54KTtcbiAgY29uc3QgeXMgPSBwb2ludHMubWFwKChwKSA9PiBwLnkpO1xuICBjb25zdCBySGF0ID0gcGVhcnNvbih4cywgeXMpO1xuICBjb25zdCByaG9IYXQgPSBzcGVhcm1hbih4cywgeXMpO1xuXG4gIGNvbnN0IHJWYWx1ZXM6IG51bWJlcltdID0gW107XG4gIGNvbnN0IHJob1ZhbHVlczogbnVtYmVyW10gPSBbXTtcblxuICBpZiAobiAtIGsgPCAzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbmZpZzogeyAuLi5jb25maWcsIGsgfSxcbiAgICAgIG4sXG4gICAgICBySGF0LCByaG9IYXQsXG4gICAgICByVmFsdWVzLCByaG9WYWx1ZXMsXG4gICAgICByUmFuZ2U6IG51bGwsIHJob1JhbmdlOiBudWxsLFxuICAgICAgckNJOiBudWxsLCByaG9DSTogbnVsbCxcbiAgICB9O1xuICB9XG5cbiAgLy8gRmlzaGVyLVlhdGVzIHBhcnRpYWwgc2h1ZmZsZSB0byBwaWNrIG4tayBpbmRpY2VzIHdpdGhvdXQgcmVwbGFjZW1lbnQuXG4gIC8vIFBvb2wgaXMgbXV0YXRlZCBpbiBwbGFjZTsgd2Ugb25seSBuZWVkIHRoZSBmaXJzdCAobi1rKSBzbG90cyBlYWNoIGl0ZXIuXG4gIGNvbnN0IHBvb2wgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiBpKTtcbiAgY29uc3QgbSA9IG4gLSBrO1xuICBjb25zdCB4YiA9IG5ldyBBcnJheTxudW1iZXI+KG0pO1xuICBjb25zdCB5YiA9IG5ldyBBcnJheTxudW1iZXI+KG0pO1xuICBmb3IgKGxldCBiID0gMDsgYiA8IEI7IGIrKykge1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbTsgaSsrKSB7XG4gICAgICBjb25zdCBqID0gaSArIE1hdGguZmxvb3Iocm5nKCkgKiAobiAtIGkpKTtcbiAgICAgIGNvbnN0IHRtcCA9IHBvb2xbaV07IHBvb2xbaV0gPSBwb29sW2pdOyBwb29sW2pdID0gdG1wO1xuICAgIH1cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG07IGkrKykge1xuICAgICAgeGJbaV0gPSB4c1twb29sW2ldXTtcbiAgICAgIHliW2ldID0geXNbcG9vbFtpXV07XG4gICAgfVxuICAgIGNvbnN0IHIgPSBwZWFyc29uKHhiLCB5Yik7XG4gICAgY29uc3QgcmhvID0gc3BlYXJtYW4oeGIsIHliKTtcbiAgICBpZiAociAhPSBudWxsICYmIE51bWJlci5pc0Zpbml0ZShyKSkgclZhbHVlcy5wdXNoKHIpO1xuICAgIGlmIChyaG8gIT0gbnVsbCAmJiBOdW1iZXIuaXNGaW5pdGUocmhvKSkgcmhvVmFsdWVzLnB1c2gocmhvKTtcbiAgfVxuXG4gIGNvbnN0IHJhbmdlT2YgPSAoYXJyOiBudW1iZXJbXSk6IFtudW1iZXIsIG51bWJlcl0gfCBudWxsID0+IHtcbiAgICBpZiAoYXJyLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gICAgbGV0IGxvID0gSW5maW5pdHksIGhpID0gLUluZmluaXR5O1xuICAgIGZvciAoY29uc3QgdiBvZiBhcnIpIHsgaWYgKHYgPCBsbykgbG8gPSB2OyBpZiAodiA+IGhpKSBoaSA9IHY7IH1cbiAgICByZXR1cm4gW2xvLCBoaV07XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBjb25maWc6IHsgLi4uY29uZmlnLCBrIH0sXG4gICAgbixcbiAgICBySGF0LCByaG9IYXQsXG4gICAgclZhbHVlcywgcmhvVmFsdWVzLFxuICAgIHJSYW5nZTogcmFuZ2VPZihyVmFsdWVzKSxcbiAgICByaG9SYW5nZTogcmFuZ2VPZihyaG9WYWx1ZXMpLFxuICAgIHJDSTogcGVyY2VudGlsZUNJKHJWYWx1ZXMsIGNvbmZpZy5jaUxldmVsKSxcbiAgICByaG9DSTogcGVyY2VudGlsZUNJKHJob1ZhbHVlcywgY29uZmlnLmNpTGV2ZWwpLFxuICB9O1xufVxuIl19