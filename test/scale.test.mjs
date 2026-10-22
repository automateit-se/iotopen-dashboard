import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartScale, gaugeRange, niceCeil } from '../src/lib/scale.js';

test('nice numbers', () => {
  assert.equal(niceCeil(911), 1000);
  assert.equal(niceCeil(450), 500);
  assert.equal(niceCeil(201), 250);
  assert.equal(niceCeil(0.42), 0.5);
  assert.equal(niceCeil(100), 100);
  assert.equal(niceCeil(0), 1);
});

test('a counter starting near zero gets an axis from 0, not below', () => {
  // the visitor counter: 5-minute averages from about 4.5 to 908
  assert.deepEqual(chartScale([4.5, 300, 908]), { lo: 0, hi: 1000 });
  assert.deepEqual(chartScale([0, 12]), { lo: 0, hi: 14 });
  // temperatures: close around the curves, not 0-40
  assert.deepEqual(chartScale([6.3, 22.1]), { lo: 4, hi: 24 });
});

test('values that cross zero, and only negative values', () => {
  const s = chartScale([-3, 7]);
  assert.ok(s.lo <= -3 && s.hi >= 7 && s.lo < 0);
  const n = chartScale([-50, -10]);
  assert.ok(n.lo <= -50 && n.hi >= -10 && n.hi <= 0);
  // only negative values close to zero: the axis stops at 0, not above
  assert.equal(chartScale([-50, -1]).hi, 0);
});

test('a narrow range keeps room around the curve on round numbers', () => {
  const s = chartScale([20.1, 20.9]);
  assert.ok(s.lo < 20.1 && s.hi > 20.9 && s.lo >= 19 && s.hi <= 22);
  assert.equal(chartScale([21, 21]).lo < 21, true);
  assert.equal(chartScale([]), null);
});

test('gauge range: as set, or automatic above the value', () => {
  assert.deepEqual(gaugeRange({ min: 0, max: 100 }, 42), { min: 0, max: 100, auto: false });
  assert.deepEqual(gaugeRange({ min: 0, max: '' }, 911), { min: 0, max: 1000, auto: true });
  assert.deepEqual(gaugeRange({}, 911), { min: 0, max: 1000, auto: true });
  assert.deepEqual(gaugeRange({ min: 0, max: null }, null), { min: 0, max: 100, auto: true });
  assert.deepEqual(gaugeRange({ min: -20, max: '' }, 15), { min: -20, max: 30, auto: true });
  // automatic, from the function: its own range in IoT Open, or 100 for a percentage
  assert.deepEqual(gaugeRange({ min: 0, max: '' }, 45, { range: { min: 0, max: 60 } }), { min: 0, max: 60, auto: true });
  assert.deepEqual(gaugeRange({ max: '' }, 21, { range: { min: 10, max: 30 } }), { min: 10, max: 30, auto: true });
  assert.deepEqual(gaugeRange({ min: 0, max: '' }, 45, { percent: true }), { min: 0, max: 100, auto: true });
  // a max set on the widget always wins
  assert.deepEqual(gaugeRange({ min: 0, max: 500 }, 911, { range: { min: 0, max: 60 } }), { min: 0, max: 500, auto: false });
});
