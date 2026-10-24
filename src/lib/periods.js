// Periods in local time and consumption per period, shared by the consumption and the summary widget.

const DAY = 86400;
const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Start (local time) of the period (hour, day, week, month, year) that contains date d, moved `step` periods. */
export function periodStart(period, d, step = 0) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  if (period === 'hour') x.setHours(x.getHours() + step);
  else {
    x.setHours(0);
    if (period === 'day') x.setDate(x.getDate() + step);
    else if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + 7 * step);
    else if (period === 'year') {
      x.setDate(1);
      x.setMonth(0);
      x.setFullYear(x.getFullYear() + step);
    } else {
      x.setDate(1);
      x.setMonth(x.getMonth() + step);
    }
  }
  return x;
}

/** ISO week number. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY / 1000 + 1) / 7);
}

function labelOf(period, d) {
  if (period === 'hour') return String(d.getHours()).padStart(2, '0');
  if (period === 'day') return `${WEEKDAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  if (period === 'week') return `v${isoWeek(d)}`;
  return MONTHS[d.getMonth()] + (d.getMonth() === 0 ? ` ${d.getFullYear()}` : '');
}

/** The buckets of the consumption widget: `count` periods ending with the current one. */
export function bucketsFor(period, count, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const start = periodStart(period, now, i - count + 1);
    const end = periodStart(period, start, 1);
    return { from: start.getTime() / 1000, to: end.getTime() / 1000, label: labelOf(period, start), date: start };
  });
}

/**
 * Consumption per bucket (buckets in time order, not overlapping). counter: the difference between consecutive
 * meter readings, booked on the bucket of the later reading (a reading lower than the previous one = the meter
 * was reset or replaced, and the new reading is counted from zero). delta: the values are summed.
 */
export function consumptionPer(buckets, points, mode) {
  const sums = buckets.map(() => 0);
  const has = buckets.map(() => false);
  const idx = (ts) => {
    for (let i = buckets.length - 1; i >= 0; i--) if (ts >= buckets[i].from) return ts < buckets[i].to ? i : -1;
    return -1;
  };
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const i = idx(p.ts);
    let d;
    if (mode === 'delta') d = p.value;
    else {
      if (k === 0) continue;
      const diff = p.value - points[k - 1].value;
      d = diff >= 0 ? diff : p.value;
    }
    if (i < 0) continue;
    sums[i] += d;
    has[i] = true;
  }
  return sums.map((v, i) => (has[i] ? v : null));
}

// ---- summary widget ("Summa per period") -------------------------------------------------------------
// id: [label in the widget, period, step from the current one]
export const SUMMARY_PERIODS = [
  ['today', 'Idag', 'day', 0],
  ['yesterday', 'Igår', 'day', -1],
  ['week', 'Denna vecka', 'week', 0],
  ['last_week', 'Förra veckan', 'week', -1],
  ['month', 'Denna månad', 'month', 0],
  ['last_month', 'Förra månaden', 'month', -1],
  ['year', 'I år', 'year', 0],
];
export const SUMMARY_DEFAULTS = { periods: ['today', 'week', 'month'], mode: 'counter' };

/** The chosen periods (known ids, in the order of SUMMARY_PERIODS), or the default ones. */
export function summaryPeriods(ids) {
  const want = new Set(Array.isArray(ids) ? ids : []);
  const list = SUMMARY_PERIODS.filter(([id]) => want.has(id));
  return list.length ? list : SUMMARY_PERIODS.filter(([id]) => SUMMARY_DEFAULTS.periods.includes(id));
}

/** { id, label, from, to } (seconds) per chosen period, relative to now. */
export function summaryRanges(ids, now = new Date()) {
  return summaryPeriods(ids).map(([id, label, period, step]) => {
    const start = periodStart(period, now, step);
    return { id, label, from: start.getTime() / 1000, to: periodStart(period, start, 1).getTime() / 1000 };
  });
}

/** Total per range (null = no values in it). The ranges may overlap, e.g. today within this week. */
export const summaryTotals = (ranges, points, mode) => ranges.map((r) => consumptionPer([r], points, mode)[0]);
