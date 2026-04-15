// Smoke test for the robustness additions to bootstrap.ts.
// Generates a synthetic (x, y) set with a known strong correlation, plants
// one outlier, and checks:
//   - jackknife flags the outlier as the most influential point
//   - leave-k-out range widens with k
//   - seeded runs are reproducible

import { runJackknife, runLeaveKOut, pearson, makeRng } from './bootstrap.js';

function makeSyntheticData(n, slope, intercept, noiseSD, seed) {
  const rng = makeRng(seed);
  // Box-Muller
  const g = () => {
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = rng();
    const y = intercept + slope * x + noiseSD * g();
    points.push({
      x,
      y,
      moaKey: i < n / 2 ? 'A' : 'B',
      label: `p${i}`,
    });
  }
  return points;
}

// Test 1: jackknife finds planted outlier
console.log('── Test 1: jackknife flags the outlier ──');
const pts = makeSyntheticData(30, 0.8, 0.1, 0.04, 42);
// Plant an outlier: large x, large opposite-y
pts.push({ x: 0.9, y: 0.0, moaKey: 'A', label: 'OUTLIER' });
const jk = runJackknife(pts);
console.log(`n = ${jk.n}, rHat = ${jk.rHat?.toFixed(4)}, max|Δr| = ${jk.maxAbsDeltaR.toFixed(4)}`);
const sorted = [...jk.influence].sort((a, b) => Math.abs(b.deltaR ?? 0) - Math.abs(a.deltaR ?? 0));
console.log('top-5 by |Δr|:');
for (const p of sorted.slice(0, 5)) {
  console.log(`  ${p.label.padEnd(10)} Δr = ${(p.deltaR ?? 0).toFixed(4)}  (r_minus = ${p.rMinus?.toFixed(3)})`);
}
const topLabel = sorted[0].label;
console.log(`  → most influential point: ${topLabel}  ${topLabel === 'OUTLIER' ? '✓' : '✗ (expected OUTLIER)'}`);

// Test 2: leave-k-out widens with k
console.log('\n── Test 2: leave-k-out widens with k ──');
for (const k of [1, 3, 5, 8]) {
  const lko = runLeaveKOut(pts, { k, B: 500, ciLevel: 0.95, seed: 7 });
  const rng = lko.rRange;
  const ci = lko.rCI;
  console.log(
    `  k=${k} B=${lko.config.B}: r range = [${rng?.[0].toFixed(3)}, ${rng?.[1].toFixed(3)}]  ` +
    `95% band = [${ci?.[0].toFixed(3)}, ${ci?.[1].toFixed(3)}]`
  );
}

// Test 3: seeded reproducibility
console.log('\n── Test 3: seeded reproducibility ──');
const a = runLeaveKOut(pts, { k: 3, B: 500, ciLevel: 0.95, seed: 1234 });
const b = runLeaveKOut(pts, { k: 3, B: 500, ciLevel: 0.95, seed: 1234 });
const sameR = a.rValues.length === b.rValues.length &&
  a.rValues.every((v, i) => Math.abs(v - b.rValues[i]) < 1e-12);
console.log(`  identical r series across seeded runs: ${sameR ? '✓' : '✗'}`);

// Test 4: degenerate cases
console.log('\n── Test 4: degenerate cases ──');
const tiny = pts.slice(0, 4);
const jkTiny = runJackknife(tiny);
console.log(`  jackknife on n=4: influence.length = ${jkTiny.influence.length} (expect 4)  ${jkTiny.influence.length === 4 ? '✓' : '✗'}`);
const lkoClamped = runLeaveKOut(tiny, { k: 10, B: 50, ciLevel: 0.95, seed: 1 });
console.log(`  leave-k-out k=10 on n=4: clamped k = ${lkoClamped.config.k} (expect ≤ 1)  ${lkoClamped.config.k <= 1 ? '✓' : '✗'}`);

// Test 5: sanity — on clean data, max|Δr| should be small
console.log('\n── Test 5: sanity on clean data ──');
const clean = makeSyntheticData(40, 0.8, 0.1, 0.03, 99);
const jkClean = runJackknife(clean);
console.log(`  clean: rHat = ${jkClean.rHat?.toFixed(4)}, max|Δr| = ${jkClean.maxAbsDeltaR.toFixed(4)}  ` +
  `${jkClean.maxAbsDeltaR < 0.05 ? '✓ (small, as expected)' : '⚠ (unexpectedly large)'}`);

// Quick perf timing
console.log('\n── Test 6: timing ──');
const big = makeSyntheticData(100, 0.7, 0.1, 0.1, 5);
let t0 = Date.now();
const jkBig = runJackknife(big);
console.log(`  jackknife n=100: ${Date.now() - t0} ms  (max|Δr| = ${jkBig.maxAbsDeltaR.toFixed(3)})`);
t0 = Date.now();
const lkoBig = runLeaveKOut(big, { k: 10, B: 5000, ciLevel: 0.95, seed: 1 });
console.log(`  leave-k-out n=100, k=10, B=5000: ${Date.now() - t0} ms  (band = [${lkoBig.rCI?.[0].toFixed(3)}, ${lkoBig.rCI?.[1].toFixed(3)}])`);

console.log('\nDone.');
