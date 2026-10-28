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
 * SVG paths for points in a viewBox of `width` × `height`: the line and the area under it. The y range is the
 * points' own min..max with a little room, so small changes show (no axis is drawn). A flat series is a line in
 * the middle.
 * @returns {{ line:string, area:string } | null}
 */
export function sparkPaths(points, from, to, width = 100, height = 30) {
  const p = points.filter((x) => x.ts >= from && x.ts <= to && Number.isFinite(x.value));
  if (p.length < 2 || to <= from) return null;
  const vals = p.map((x) => x.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const X = (t) => (((t - from) / (to - from)) * width).toFixed(2);
  const Y = (v) => (height - ((v - lo) / (hi - lo)) * height).toFixed(2);
  const line = p.map((x, i) => `${i ? 'L' : 'M'}${X(x.ts)},${Y(x.value)}`).join(' ');
  return { line, area: `${line} L${X(p[p.length - 1].ts)},${height} L${X(p[0].ts)},${height} Z` };
}
