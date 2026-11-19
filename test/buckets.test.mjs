import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandPath, bucketAt, gapLinks, intervalSeconds, intervalText, linePath, midOf, runs, withBand } from '../src/lib/buckets.js';

const H = 3600;
const iv = 3 * H;
const X = (t) => t / H; // one unit per hour
const Y = (v) => v;
// three intervals, then a long silence (09:00 to the next day), then one more; a live reading at the end
const pts = [
  { ts: 0, value: 10, min: 9, max: 11 },
  { ts: 3 * H, value: 30, min: 12, max: 40 },
  { ts: 6 * H, value: 12, min: 11, max: 13 },
  { ts: 24 * H, value: 14, min: 13, max: 15 },
  { ts: 26 * H, value: 15, live: true },
];

test('interval lengths', () => {
  assert.equal(intervalSeconds('3h'), iv);
  assert.equal(intervalSeconds('30m'), 1800);
  assert.equal(intervalSeconds('1d'), 86400);
  assert.equal(intervalSeconds('x'), 0);
});

test('the pointer is on a whole interval, and a missing one has no value', () => {
  assert.deepEqual(bucketAt(pts, 4 * H, iv), { start: 3 * H, end: 6 * H, point: pts[1] });
  assert.deepEqual(bucketAt(pts, 6 * H, iv), { start: 6 * H, end: 9 * H, point: pts[2] });
  // 10:00 is in the silence
  assert.deepEqual(bucketAt(pts, 10 * H, iv), { start: 9 * H, end: 12 * H, point: null });
  assert.equal(bucketAt([], 5, iv).point, null);
});

test('runs break where intervals are missing, a live value joins the last run', () => {
  const rs = runs(pts, iv);
  assert.deepEqual(rs.map((r) => r.map((p) => p.ts / H)), [[0, 3, 6], [24, 26]]);
  // the gap gets a dashed connector from the last value before it to the first after
  assert.deepEqual(gapLinks(rs, iv, X, Y), [{ x1: 7.5, y1: 12, x2: 25.5, y2: 14 }]);
});

test('points are drawn in the middle of their interval, a live value at its own time', () => {
  assert.equal(midOf(pts[0], iv), 1.5 * H);
  assert.equal(midOf(pts[4], iv), 26 * H);
  assert.equal(linePath(runs(pts, iv)[0], iv, X, Y), 'M1.50,10.00 L4.50,30.00 L7.50,12.00');
});

test('the band is one flat step per interval, along max and back along min', () => {
  const d = bandPath(runs(pts, iv)[0], iv, X, Y);
  assert.equal(d, 'M0.00,11.00 H3.00 L3.00,40.00 H6.00 L6.00,13.00 H9.00 L9.00,11.00 H6.00 L6.00,12.00 H3.00 L3.00,9.00 H0.00 Z');
  // the live value has no band
  assert.equal(bandPath([pts[4]], iv, X, Y), '');
});

test('min and max are joined to the averages by interval start', () => {
  const avg = [{ ts: 0, value: 10 }, { ts: iv, value: 20 }];
  const out = withBand(avg, [{ ts: 0, value: 8 }], [{ ts: 0, value: 12 }, { ts: iv, value: 25 }]);
  assert.deepEqual(out, [{ ts: 0, value: 10, min: 8, max: 12 }, { ts: iv, value: 20 }]);
  assert.equal(withBand(avg, null, null), avg);
});

test('interval texts', () => {
  const t = Date.UTC(2026, 10, 12, 5, 0) / 1000; // 06:00 in Stockholm
  process.env.TZ = 'Europe/Stockholm';
  assert.match(intervalText(t, iv), /^12 nov\.? 06:00–09:00$/);
  assert.equal(intervalText(t, iv, true), '06:00–09:00');
  assert.match(intervalText(t, 86400), /^12 nov\.?$/);
  assert.match(intervalText(t, 7 * 86400), /^12 nov\.?–19 nov\.?$/);
});

test('a sensor that reports less often than the interval is not a gap', async () => {
  const { gapLimit } = await import('../src/lib/buckets.js');
  const five = 300;
  // a value every 15 minutes in 5-minute intervals for two hours, then nothing for 3 hours, then again
  const pts = [];
  for (let t = 0; t <= 2 * H; t += 900) pts.push({ ts: t, value: 20 });
  for (let t = 5 * H; t <= 6 * H; t += 900) pts.push({ ts: t, value: 21 });
  assert.equal(gapLimit(pts, five), 2250);
  const rs = runs(pts, five);
  assert.equal(rs.length, 2); // only the 3-hour silence breaks the line
  // an empty 5-minute interval between two values snaps to the nearer one, with that one's interval
  assert.deepEqual(bucketAt(pts, 400, five), { start: 0, end: 300, point: pts[0] });
  assert.deepEqual(bucketAt(pts, 800, five), { start: 900, end: 1200, point: pts[1] });
  // inside the silence: no value
  assert.equal(bucketAt(pts, 3.5 * H, five).point, null);
});
