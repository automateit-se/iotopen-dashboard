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

import { niceAxis, timeTicks } from '../src/lib/sparkline.js';

test('y axis: three round values that hold the data', () => {
  assert.deepEqual(niceAxis([5, 18.4, 22]).ticks, [5, 15, 25]);
  assert.deepEqual(niceAxis([17.9, 23]).ticks, [15, 20, 25]);
  assert.deepEqual(niceAxis([18.1, 20.3]).ticks, [18, 20, 22]);
  assert.deepEqual(niceAxis([0.2, 0.9]).ticks, [0, 0.5, 1]);
  assert.deepEqual(niceAxis([5, 5]).ticks, [4, 5, 6]);
  for (const v of [[5, 22], [804, 1514], [-3.2, 7.9], [0.01, 0.04]]) {
    const a = niceAxis(v);
    assert.ok(a.lo <= Math.min(...v) && a.hi >= Math.max(...v), JSON.stringify(v));
    assert.equal(+(a.ticks[1] - a.ticks[0]).toFixed(9), +(a.ticks[2] - a.ticks[1]).toFixed(9));
  }
  assert.equal(niceAxis([]), null);
});

test('x axis: round local times, at most four, not at the edges', () => {
  const d = new Date(2026, 9, 28, 22, 37);
  const to = d.getTime() / 1000;
  const day = timeTicks(to - 86400, to);
  assert.ok(day.length >= 2 && day.length <= 4);
  for (const t of day) assert.equal(new Date(t.ts * 1000).getMinutes(), 0);
  assert.ok(day.every((t) => /^\d\d:\d\d$/.test(t.label)));
  const hour = timeTicks(to - 3600, to);
  assert.ok(hour.length >= 2 && hour.every((t) => new Date(t.ts * 1000).getMinutes() % 15 === 0));
  const week = timeTicks(to - 7 * 86400, to);
  assert.ok(week.length >= 2 && week.length <= 4 && week.every((t) => new Date(t.ts * 1000).getHours() === 0));
  assert.equal(timeTicks(to, to).length, 0);
});
