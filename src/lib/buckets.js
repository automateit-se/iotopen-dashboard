// Aggregated history (IoT Open's aggr_interval): each value stands for a whole interval, not a moment. These helpers
// draw and describe it as such: the line through the middle of each interval, a min-max band as one step per
// interval, a gap where intervals are missing, and the pointer on a whole interval ("06:00-09:00").
// IoT Open stamps an aggregated value with the start of its interval.

const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/** "3h" -> 10800, "30m" -> 1800; 0 when unknown. */
export function intervalSeconds(interval) {
  const m = /^(\d+)([smhd])$/.exec(String(interval || ''));
  return m ? Number(m[1]) * UNITS[m[2]] : 0;
}

/**
 * How far apart two values may be and still belong together: two and a half times the series' usual spacing, and at least
 * one and a half intervals. A sensor that reports every 15 minutes leaves two of three 5-minute intervals empty
 * without anything missing; only a clearly longer silence (an edge client offline, a sensor down) is a gap.
 */
export function gapLimit(points, iv) {
  const d = [];
  for (let i = 1; i < points.length; i++) if (!points[i].live) d.push(points[i].ts - points[i - 1].ts);
  d.sort((a, b) => a - b);
  const usual = d.length ? d[Math.floor(d.length / 2)] : iv;
  return Math.max(iv * 1.5, usual * 2.5);
}

/**
 * The interval under the pointer: { start, end, point }. Inside an interval with a value, that one. In an empty
 * interval between two values that belong together (see gapLimit), the nearer of them, with its own interval, so
 * the pointer never shows a value for a time it does not cover. In a real gap or outside the data: point null.
 * Points are { ts (interval start), ... }, sorted.
 */
export function bucketAt(points, t, iv, limit = gapLimit(points, iv)) {
  const start = Math.floor(t / iv) * iv;
  // intervals follow IoT Open's own boundaries; find the point whose interval holds t
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const p = found >= 0 ? points[found] : null;
  if (p && !p.live && t < p.ts + iv) return { start: p.ts, end: p.ts + iv, point: p };
  const next = points[found + 1];
  if (p && next && !next.live && next.ts - p.ts <= limit) {
    const q = t - (p.ts + iv) <= next.ts - t ? p : next;
    if (!q.live) return { start: q.ts, end: q.ts + iv, point: q };
  }
  return { start, end: start + iv, point: null };
}

/**
 * Runs of values that belong together: [[point, ...], ...]. A new run starts after a gap (see gapLimit). A trailing
 * live value (not an interval) ends the last run.
 */
export function runs(points, iv, limit = gapLimit(points, iv)) {
  const out = [];
  let cur = [];
  for (const p of points) {
    const prev = cur[cur.length - 1];
    if (prev && !p.live && p.ts - prev.ts > limit) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Where a point is drawn: the middle of its interval (a live value at its own time). */
export const midOf = (p, iv) => (p.live ? p.ts : p.ts + iv / 2);

/** SVG path of the line through one run. */
export function linePath(run, iv, X, Y) {
  return run.map((p, i) => `${i ? 'L' : 'M'}${X(midOf(p, iv)).toFixed(2)},${Y(p.value).toFixed(2)}`).join(' ');
}

/** Dashed connectors over the gaps between runs: [{ x1, y1, x2, y2 }], so a gap reads as "no values". */
export function gapLinks(rs, iv, X, Y) {
  const out = [];
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1][rs[i - 1].length - 1];
    const b = rs[i][0];
    out.push({ x1: X(midOf(a, iv)), y1: Y(a.value), x2: X(midOf(b, iv)), y2: Y(b.value) });
  }
  return out;
}

/** SVG path of the min-max band of one run: one flat step per interval, along the max and back along the min. */
export function bandPath(run, iv, X, Y) {
  const ps = run.filter((p) => !p.live && Number.isFinite(p.min) && Number.isFinite(p.max));
  if (!ps.length) return '';
  const top = ps.map((p, i) => `${i ? 'L' : 'M'}${X(p.ts).toFixed(2)},${Y(p.max).toFixed(2)} H${X(p.ts + iv).toFixed(2)}`).join(' ');
  const bottom = [...ps].reverse().map((p) => `L${X(p.ts + iv).toFixed(2)},${Y(p.min).toFixed(2)} H${X(p.ts).toFixed(2)}`).join(' ');
  return `${top} ${bottom} Z`;
}

/** Points with IoT Open's min and max per interval added (lows / highs: the same intervals, by start time). */
export function withBand(points, lows, highs) {
  if (!lows || !highs) return points;
  const lo = new Map(lows.map((p) => [p.ts, p.value]));
  const hi = new Map(highs.map((p) => [p.ts, p.value]));
  return points.map((p) => (lo.has(p.ts) && hi.has(p.ts) ? { ...p, min: lo.get(p.ts), max: hi.get(p.ts) } : p));
}

const dayFmt = { day: 'numeric', month: 'short' };
const timeFmt = { hour: '2-digit', minute: '2-digit' };
const fmtDate = (t, o) => new Date(t * 1000).toLocaleString('sv-SE', o);

/** "12 nov. 06:00–09:00", "12 nov.", "12–18 nov." or "06:00–06:30" (same day as the window) for an interval. */
export function intervalText(start, iv, sameDay = false) {
  const end = start + iv;
  if (iv >= 7 * 86400) return `${fmtDate(start, dayFmt)}–${fmtDate(end - 1, dayFmt)}`;
  if (iv >= 86400) return fmtDate(start, dayFmt);
  const day = sameDay ? '' : `${fmtDate(start, dayFmt)} `;
  return `${day}${fmtDate(start, timeFmt)}–${fmtDate(end, timeFmt)}`;
}
