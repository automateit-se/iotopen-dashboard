// History from IoT Open's log API (GET /api/v3beta/log/{iid}), shared by graphs and timelines.
//
// Graphs (numeric): IoT Open aggregates server side with aggr_method (avg, min, max, median, last, sum …)
// and aggr_interval (10m, 1h, 1d …). The interval is chosen from the window so a series has a few hundred
// points at most: 24 h -> 5 min, 7 d -> 30 min, 30 d -> 3 h, 1 year -> 1 day. Short windows (≤ 6 h) and
// zoomed-in short ranges are read raw. If aggregation is not available, raw values are read up to a cap.
//
// Timelines (discrete): read raw – averaging on/off states would hide events. Capped at the newest events.

import { lynx } from '../api/lynx.js';

const PAGE = 2000;
const CAP = { numeric: 30000, discrete: 60000 };
const PARALLEL = 6;
const DAY = 86400;
const RAW_MAX_SPAN = 6 * 3600;
const TARGET_POINTS = 400;
const INTERVALS = [
  [60, '1m'],
  [300, '5m'],
  [600, '10m'],
  [1800, '30m'],
  [3600, '1h'],
  [3 * 3600, '3h'],
  [6 * 3600, '6h'],
  [12 * 3600, '12h'],
  [DAY, '1d'],
  [7 * DAY, '7d'],
];

export const AGGR_METHODS = [
  ['avg', 'Medelvärde'],
  ['median', 'Median'],
  ['min', 'Minimum'],
  ['max', 'Maximum'],
  ['last', 'Senaste värdet'],
  ['sum', 'Summa'],
];
const INTERVAL_TEXT = { '1m': 'minut', '5m': '5 min', '10m': '10 min', '30m': '30 min', '1h': 'timme', '3h': '3 h', '6h': '6 h', '12h': '12 h', '1d': 'dygn', '7d': 'vecka' };
export const aggrLabel = (method, interval) => `${(AGGR_METHODS.find(([m]) => m === method)?.[1] || method).toLowerCase()} per ${INTERVAL_TEXT[interval] || interval}`;

/** Aggregation interval for a window, or null for raw data. */
export function intervalFor(span) {
  if (span <= RAW_MAX_SPAN) return null;
  const want = span / TARGET_POINTS;
  return (INTERVALS.find(([s]) => s >= want) || INTERVALS[INTERVALS.length - 1])[1];
}

async function inBatches(tasks, n) {
  const out = [];
  for (let i = 0; i < tasks.length; i += n) out.push(...(await Promise.all(tasks.slice(i, i + n).map((t) => t()))));
  return out;
}

/** Reads every page of a query (up to cap). */
async function readAll(iid, q, cap) {
  const first = await lynx.log(iid, { ...q, limit: PAGE, offset: 0, order: 'asc' });
  const total = Number(first?.total ?? first?.data?.length ?? 0);
  const data = [...(first?.data || [])];
  const pages = [];
  for (let offset = PAGE; offset < Math.min(total, cap); offset += PAGE) pages.push(() => lynx.log(iid, { ...q, limit: PAGE, offset, order: 'asc' }));
  (await inBatches(pages, PARALLEL)).forEach((r) => data.push(...(r?.data || [])));
  return { data, total, capped: total > cap };
}

/**
 * @returns {Promise<{ byTopic: Map<string, {ts:number, value:any}[]>, aggr: {method, interval}|null,
 *                     capped: boolean, truncatedFrom: number|null, total: number }>}
 */
export async function loadHistory(iid, clientId, topics, from, to, { mode = 'numeric', method = 'avg' } = {}) {
  const full = topics.map((t) => (clientId ? `${clientId}/${t}` : t));
  const byTopic = new Map(topics.map((t) => [t, []]));
  const push = (e) => {
    if (mode === 'numeric' && !Number.isFinite(Number(e.value))) return;
    byTopic.get(e.topic)?.push({ ts: e.timestamp, value: mode === 'numeric' ? Number(e.value) : e.value });
  };
  from = Math.floor(from);
  to = Math.ceil(to);
  const base = { from, to, topics: full };
  let aggr = null;
  let capped = false;
  let truncatedFrom = null;
  let total = 0;

  if (mode === 'numeric') {
    const interval = intervalFor(to - from);
    let res = null;
    if (interval) {
      try {
        res = await readAll(iid, { ...base, aggr_method: method, aggr_interval: interval }, CAP.numeric);
        aggr = { method, interval };
      } catch {
        res = null; // older IoT Open without aggregation: fall back to raw values
      }
    }
    if (!res) res = await readAll(iid, base, CAP.numeric);
    res.data.forEach(push);
    capped = res.capped;
    total = res.total;
  } else {
    const first = await lynx.log(iid, { ...base, limit: PAGE, offset: 0, order: 'asc' });
    total = Number(first?.total ?? first?.data?.length ?? 0);
    if (total <= CAP.discrete) {
      (first?.data || []).forEach(push);
      const pages = [];
      for (let offset = PAGE; offset < total; offset += PAGE) pages.push(() => lynx.log(iid, { ...base, limit: PAGE, offset, order: 'asc' }));
      (await inBatches(pages, PARALLEL)).forEach((r) => (r?.data || []).forEach(push));
    } else {
      const pages = [];
      for (let offset = 0; offset < CAP.discrete; offset += PAGE) pages.push(() => lynx.log(iid, { ...base, limit: PAGE, offset, order: 'desc' }));
      const all = (await inBatches(pages, PARALLEL)).flatMap((r) => r?.data || []).reverse();
      all.forEach(push);
      truncatedFrom = all[0]?.timestamp ?? null;
    }
    // the state at the start of the window = the last logged value before it (up to 30 days back)
    const start = truncatedFrom ?? from;
    const before = await inBatches(
      full.map((t) => () =>
        lynx
          .log(iid, { from: start - 30 * DAY, to: start - 1, topics: [t], limit: 1, order: 'desc' })
          .then((r) => r?.data?.[0] || null)
          .catch(() => null),
      ),
      PARALLEL,
    );
    before.forEach((e) => e && byTopic.get(e.topic)?.unshift({ ts: start, value: e.value }));
  }
  for (const list of byTopic.values()) list.sort((a, b) => a.ts - b.ts);
  return { byTopic, aggr, capped, truncatedFrom, total };
}
