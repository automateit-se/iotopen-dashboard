// Axis and gauge scales.

/** The smallest "nice" number (1, 2, 2.5 or 5 times a power of ten) that is at least x. */
export function niceCeil(x) {
  if (!(x > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= x * (1 - 1e-9)) return m * mag;
  return 10 * mag;
}

/**
 * Y axis of a chart from the values shown: a little room above and below the curves, never below zero when no value
 * is negative (and never above zero when none is positive), with the bottom and top rounded to a round step of
 * about a tenth of the range. Returns { lo, hi }; the middle is (lo + hi) / 2.
 */
export function chartScale(values) {
  const ys = values.filter(Number.isFinite);
  if (!ys.length) return null;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
  let a = min - pad;
  let b = max + pad;
  if (min >= 0 && a < 0) a = 0;
  if (max <= 0 && b > 0) b = 0;
  const unit = niceCeil((b - a) / 10);
  return { lo: clean(Math.floor(a / unit + 1e-9) * unit), hi: clean(Math.ceil(b / unit - 1e-9) * unit) };
}

const given = (x) => x !== undefined && x !== null && x !== '' && Number.isFinite(Number(x));

/**
 * Range of a gauge. `max` (and `min`) as set on the widget. An empty max is automatic: the function's own range in
 * IoT Open (meta min/max) when it has one, 100 for a percentage, otherwise a round number above the value
 * (911 -> 1000), so a counter that grows still fits.
 * opts: { range: { min, max } | null, percent: boolean }
 */
export function gaugeRange(layout, value, { range = null, percent = false } = {}) {
  const min = given(layout?.min) ? Number(layout.min) : range ? range.min : 0;
  if (given(layout?.max)) return { min, max: Number(layout.max), auto: false };
  if (range && range.max > min) return { min, max: range.max, auto: true };
  if (percent && min < 100) return { min, max: 100, auto: true };
  const v = Number(value);
  const max = Number.isFinite(v) && v > min ? min + niceCeil(v - min) : min + 100;
  return { min, max, auto: true };
}

const clean = (x) => +x.toPrecision(12);
