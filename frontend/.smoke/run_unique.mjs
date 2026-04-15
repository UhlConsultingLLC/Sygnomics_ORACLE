// Smoke test: verify meanUniqueCount across the four resampling schemes.
//
// Theoretical expectations:
//   - trial / nested:  n * (1 - (1 - 1/n)^n)  → n * (1 - 1/e) ≈ 0.6321 n
//                      for n=30 that's ≈ 18.963
//   - stratified:      same as above summed across buckets (still ≈ 0.632 n
//                      for the whole sample)
//   - simulation:      exactly n (no resampling)

import { runBootstrap, makeRng } from './bootstrap.js';

const N = 30;
const B = 5000;

// Build synthetic points with a mix of MOA labels for the stratified test
const rng = makeRng(1);
const points = [];
for (let i = 0; i < N; i++) {
  points.push({
    x: rng(),
    y: rng(),
    moaKey: i < 10 ? 'A' : i < 20 ? 'B' : 'C',
    label: `p${i}`,
  });
}

// Theoretical expected unique:
//   global case (trial / nested):  n * (1 - (1 - 1/n)^n) → ≈ 0.632 n
//   stratified:                    Σ k_i * (1 - (1 - 1/k_i)^k_i)
//   simulation:                    exactly n
const expectedGlobal = N * (1 - Math.pow(1 - 1 / N, N));
// Bucket sizes for stratified test: 10 + 10 + 10
const bucketSizes = [10, 10, 10];
const expectedStratified = bucketSizes.reduce(
  (acc, k) => acc + k * (1 - Math.pow(1 - 1 / k, k)), 0
);
console.log(`n = ${N}, expected global (0.632 n) ≈ ${expectedGlobal.toFixed(3)}`);
console.log(`expected stratified (buckets ${bucketSizes.join('+')}) ≈ ${expectedStratified.toFixed(3)}`);

for (const scheme of ['trial', 'nested', 'stratified', 'simulation']) {
  const res = runBootstrap(points, {
    B, scheme,
    ciLevel: 0.95,
    ciMethod: 'percentile',
    curveType: 'none',
    seed: 42,
  });
  const avg = res.meanUniqueCount;
  const pct = (avg / res.nPoints) * 100;
  let ok;
  if (scheme === 'simulation') {
    ok = avg === N;
  } else if (scheme === 'stratified') {
    ok = Math.abs(avg - expectedStratified) < 0.2;
  } else {
    ok = Math.abs(avg - expectedGlobal) < 0.2;
  }
  console.log(
    `  ${scheme.padEnd(10)} avg unique = ${avg.toFixed(3)} / ${N}  (${pct.toFixed(1)}%)  ${ok ? '✓' : '✗'}`
  );
}

// Also check that a seeded run is reproducible
const a = runBootstrap(points, { B: 1000, scheme: 'nested', ciLevel: 0.95, ciMethod: 'percentile', curveType: 'none', seed: 777 });
const b = runBootstrap(points, { B: 1000, scheme: 'nested', ciLevel: 0.95, ciMethod: 'percentile', curveType: 'none', seed: 777 });
console.log(`\nseeded reproducibility: avgA = ${a.meanUniqueCount.toFixed(6)}, avgB = ${b.meanUniqueCount.toFixed(6)}  ${a.meanUniqueCount === b.meanUniqueCount ? '✓' : '✗'}`);

// Edge case: n = 5
const small = points.slice(0, 5);
const resSmall = runBootstrap(small, { B: 5000, scheme: 'trial', ciLevel: 0.95, ciMethod: 'percentile', curveType: 'none', seed: 1 });
const expectedSmall = 5 * (1 - Math.pow(1 - 1/5, 5));
console.log(`n=5 trial: avg = ${resSmall.meanUniqueCount.toFixed(3)}, expected ≈ ${expectedSmall.toFixed(3)}  ` +
  `${Math.abs(resSmall.meanUniqueCount - expectedSmall) < 0.05 ? '✓' : '✗'}`);

console.log('\nDone.');
