import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodStart, bucketsFor, consumptionPer, summaryPeriods, summaryRanges, summaryTotals } from '../src/lib/periods.js';

const at = (s) => new Date(s).getTime() / 1000;

test('period starts in local time', () => {
  const d = new Date(2026, 9, 21, 15, 40); // Wednesday 21 October
  assert.deepEqual(periodStart('day', d), new Date(2026, 9, 21));
  assert.deepEqual(periodStart('week', d), new Date(2026, 9, 19)); // Monday
  assert.deepEqual(periodStart('month', d, -1), new Date(2026, 8, 1));
  assert.deepEqual(periodStart('year', d), new Date(2026, 0, 1));
  assert.deepEqual(periodStart('year', d, 1), new Date(2027, 0, 1));
});

test('buckets end with the current period', () => {
  const b = bucketsFor('day', 3, new Date(2026, 9, 21, 12));
  assert.equal(b.length, 3);
  assert.equal(b[2].from, at(new Date(2026, 9, 21)));
  assert.equal(b[0].to, b[1].from);
});

test('meter readings: difference per bucket, a reset counts from zero', () => {
  const buckets = [
    { from: 0, to: 10 },
    { from: 10, to: 20 },
  ];
  const points = [
    { ts: -5, value: 100 },
    { ts: 5, value: 110 },
    { ts: 12, value: 125 },
    { ts: 15, value: 3 }, // meter replaced
  ];
  assert.deepEqual(consumptionPer(buckets, points, 'counter'), [10, 18]);
  assert.deepEqual(consumptionPer(buckets, [{ ts: 2, value: 1.5 }, { ts: 4, value: 2 }], 'delta'), [3.5, null]);
});

test('summary periods: known ids in a fixed order, defaults when none', () => {
  assert.deepEqual(summaryPeriods(['today', 'month', 'nonsense']).map(([id]) => id), ['month', 'today']);
  assert.deepEqual(summaryPeriods([]).map(([id]) => id), ['month', 'week', 'today']);
  assert.deepEqual(summaryPeriods(undefined).map(([id]) => id), ['month', 'week', 'today']);
});

test('summary totals for overlapping periods', () => {
  const now = new Date(2026, 9, 21, 12); // Wednesday
  const ranges = summaryRanges(['today', 'yesterday', 'week', 'month', 'year'], now);
  assert.deepEqual(ranges.map((r) => r.label), ['I år', 'Denna månad', 'Denna vecka', 'Igår', 'Idag']);
  // a meter read every few hours: 1000 at the end of September, +10 per reading
  const points = [
    { ts: at(new Date(2026, 8, 30, 23)), value: 1000 },
    { ts: at(new Date(2026, 9, 5, 8)), value: 1010 },
    { ts: at(new Date(2026, 9, 19, 8)), value: 1020 }, // Monday
    { ts: at(new Date(2026, 9, 20, 8)), value: 1030 }, // yesterday
    { ts: at(new Date(2026, 9, 21, 6)), value: 1040 }, // today
    { ts: at(new Date(2026, 9, 21, 11)), value: 1050 },
  ];
  assert.deepEqual(summaryTotals(ranges, points, 'counter'), [50, 50, 40, 10, 20]);
  assert.deepEqual(summaryTotals(summaryRanges(['last_week'], now), points, 'counter'), [null]);
});
