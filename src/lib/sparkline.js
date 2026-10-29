// A small graph under a value (the value widget's "Minigraf"): the path and MIN / MEDEL / MAX of a period.
// No imports, so it can be tested without a browser.

export const SPARK_RANGES = [
  [1, '1 timme'],
  [6, '6 timmar'],
  [24, '24 timmar'],
  [168, '7 dygn'],
  [720, '30 dygn'],
];

/**
 * MIN / MEDEL / MAX of points ({ ts, value }, sorted) between from and to. The mean is time weighted: each value
 * counts until the next one (the last until `to`), so a period with frequent readings does not weigh more.
 * `lows` / `highs` (optional): IoT Open's own min / max per interval when the points are averages, so a short peak
 * between two averages is not lost.
 * @returns {{ min:number, mean:number, max:number } | null}
 */
export function sparkStats(points, from, to, lows = null, highs = null) {
  const p = points.filter((x) => x.ts >= from && x.ts <= to && Number.isFinite(x.value));
  if (!p.length) return null;
  let weighted = 0;
  let span = 0;
  p.forEach((x, i) => {
    const next = i + 1 < p.length ? p[i + 1].ts : Math.max(x.ts, to);
    const dt = Math.max(0, next - x.ts);
    weighted += x.value * dt;
    span += dt;
  });
  const mean = span > 0 ? weighted / span : p.reduce((a, x) => a + x.value, 0) / p.length;
  const inWin = (list) => (list || []).filter((x) => x.ts >= from && x.ts <= to && Number.isFinite(x.value)).map((x) => x.value);
  const lo = [...p.map((x) => x.value), ...inWin(lows)];
  const hi = [...p.map((x) => x.value), ...inWin(highs)];
  return { min: Math.min(...lo), mean, max: Math.max(...hi) };
}

/**
 * SVG paths for points in a viewBox of `width` × `height`: the line and the area under it. The y range is
 * `range` ({ lo, hi }, from an axis) or else the points' own min..max with a little room, so small changes show.
 * A flat series is then a line in the middle.
 * @returns {{ line:string, area:string } | null}
 */
export function sparkPaths(points, from, to, width = 100, height = 30, range = null) {
  const p = points.filter((x) => x.ts >= from && x.ts <= to && Number.isFinite(x.value));
  if (p.length < 2 || to <= from) return null;
  let lo;
  let hi;
  if (range) ({ lo, hi } = range); // a y axis decides the range
  else {
    const vals = p.map((x) => x.value);
    lo = Math.min(...vals);
    hi = Math.max(...vals);
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.12;
    lo -= pad;
    hi += pad;
  }
  const X = (t) => (((t - from) / (to - from)) * width).toFixed(2);
  const Y = (v) => (height - ((v - lo) / (hi - lo)) * height).toFixed(2);
  const line = p.map((x, i) => `${i ? 'L' : 'M'}${X(x.ts)},${Y(x.value)}`).join(' ');
  return { line, area: `${line} L${X(p[p.length - 1].ts)},${height} L${X(p[0].ts)},${height} Z` };
}

// ---- axes for the small graphs: three round values up the side and a few round times along the bottom ----

const NICE = [1, 2, 2.5, 5, 10];

/**
 * A y axis of three round values (bottom, middle, top) that holds every value, e.g. 5 · 15 · 25 for 5..22.
 * The step is 1, 2, 2.5 or 5 times a power of ten; the bottom is a whole or half step.
 * @returns {{ lo:number, hi:number, ticks:number[] } | null}
 */
export function niceAxis(values) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return null;
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (max === min) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / 2;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (let k = 0; k < 3; k++) {
    for (const m of NICE) {
      const step = m * mag * 10 ** k;
      if (step < raw * (1 - 1e-9)) continue;
      // the bottom on a whole step, or else on a half step (5 · 15 · 25 rather than 0 · 20 · 40)
      for (const base of [step, step / 2]) {
        const lo = Math.floor(min / base + 1e-9) * base;
        if (lo + 2 * step >= max - 1e-9) {
          const r = (x) => Number(x.toFixed(10));
          return { lo: r(lo), hi: r(lo + 2 * step), ticks: [r(lo), r(lo + step), r(lo + 2 * step)] };
        }
      }
    }
  }
  return { lo: min, hi: max, ticks: [min, (min + max) / 2, max] };
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const TIME_STEPS = [5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR, 6 * HOUR, 8 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];

/**
 * Round times inside from..to for an x axis: at most `max` of them, on whole hours or days in local time
 * (00:00 · 08:00 · 16:00 for a day). Labels: the time within a day, the weekday within a week, else day and month.
 * @returns {{ ts:number, label:string }[]}
 */
export function timeTicks(from, to, max = 4) {
  const span = to - from;
  if (!(span > 0)) return [];
  const step = TIME_STEPS.find((s) => span / s <= max) || TIME_STEPS[TIME_STEPS.length - 1];
  // local midnight before the window, then whole steps from there (keeps hours and days on round values)
  const d = new Date(from * 1000);
  d.setHours(0, 0, 0, 0);
  let t = d.getTime() / 1000;
  const out = [];
  for (; t <= to; t += step) {
    // days step by the calendar so that a summer time change does not shift the ticks off midnight
    if (step >= DAY) {
      const c = new Date(t * 1000);
      c.setHours(0, 0, 0, 0);
      t = c.getTime() / 1000;
    }
    if (t < from + span * 0.04 || t > to - span * 0.04) continue; // too close to an edge to read
    const date = new Date(t * 1000);
    const label =
      span <= 1.5 * DAY
        ? date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
        : span <= 8 * DAY
          ? date.toLocaleDateString('sv-SE', { weekday: 'short' })
          : date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    out.push({ ts: t, label });
  }
  return out;
}
