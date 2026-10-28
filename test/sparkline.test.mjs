import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkPaths, sparkStats } from '../src/lib/sparkline.js';

const pts = (...pairs) => pairs.map(([ts, value]) => ({ ts, value }));

test('time weighted mean, min and max within the period', () => {
  // 10 for 90 s, then 20 for 10 s: the mean is 11, not 15
  const st = sparkStats(pts([0, 10], [90, 20]), 0, 100);
  assert.deepEqual(st, { min: 10, mean: 11, max: 20 });
  // values outside the window are left out
  assert.deepEqual(sparkStats(pts([-50, 99], [10, 5], [200, 99]), 0, 100), { min: 5, mean: 5, max: 5 });
  assert.equal(sparkStats([], 0, 100), null);
  assert.equal(sparkStats(pts([0, NaN]), 0, 100), null);
});

test('IoT Open min and max per interval widen the range', () => {
  const avg = pts([0, 10], [50, 12]);
  const st = sparkStats(avg, 0, 100, pts([0, 7], [50, 11]), pts([0, 14], [50, 30]));
  assert.equal(st.min, 7);
  assert.equal(st.max, 30);
  assert.equal(st.mean, 11);
});

test('paths span the width and stay inside the box', () => {
  const p = sparkPaths(pts([0, 1], [50, 3], [100, 2]), 0, 100, 100, 30);
  assert.match(p.line, /^M0\.00,[\d.]+ L50\.00,[\d.]+ L100\.00,[\d.]+$/);
  const ys = [...p.line.matchAll(/,([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y > 0 && y < 30));
  assert.ok(p.area.endsWith('L100.00,30 L0.00,30 Z'));
  // a flat series is drawn in the middle
  assert.match(sparkPaths(pts([0, 5], [100, 5]), 0, 100).line, /,15\.00 L100\.00,15\.00$/);
  assert.equal(sparkPaths(pts([0, 5]), 0, 100), null);
});
