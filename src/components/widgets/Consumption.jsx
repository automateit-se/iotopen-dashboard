import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { loadBuckets } from '../../lib/history.js';
import { unitOf } from '../../lib/dashboard.js';
import { useSize } from './Tracker.jsx';

export const CONSUMPTION_DEFAULTS = { period: 'day', count: 7, mode: 'counter' };
export const PERIODS = [
  ['hour', 'Timme', 168],
  ['day', 'Dygn', 366],
  ['week', 'Vecka', 104],
  ['month', 'Månad', 36],
];
export const MODES = [
  ['counter', 'Mätarställning (räkneverk)'],
  ['delta', 'Förbrukning per värde (summeras)'],
];
// what a viewer can switch between in the widget (not saved; the editor sets the default)
export const VIEWS = [
  ['hour', 24, '24 h'],
  ['day', 7, '7 d'],
  ['day', 30, '30 d'],
  ['week', 12, '12 v'],
  ['week', 52, '1 år'],
  ['month', 12, '12 mån'],
];
const DAY = 86400;
const WEEKDAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Start (local time) of the period that contains date d, moved `step` periods. */
function periodStart(period, d, step = 0) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  if (period === 'hour') x.setHours(x.getHours() + step);
  else {
    x.setHours(0);
    if (period === 'day') x.setDate(x.getDate() + step);
    else if (period === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + 7 * step);
    else {
      x.setDate(1);
      x.setMonth(x.getMonth() + step);
    }
  }
  return x;
}

/** ISO week number. */
function isoWeek(d) {
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

/** The buckets of the widget: `count` periods ending with the current one. */
export function bucketsFor(period, count, now = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const start = periodStart(period, now, i - count + 1);
    const end = periodStart(period, start, 1);
    return { from: start.getTime() / 1000, to: end.getTime() / 1000, label: labelOf(period, start), date: start };
  });
}

/**
 * Consumption per bucket. counter: the difference between consecutive meter readings, booked on the bucket
 * of the later reading (a reading lower than the previous one = the meter was reset or replaced, and the new
 * reading is counted from zero). delta: the values are summed.
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

const fmtNum = (v) => {
  const a = Math.abs(v);
  return v.toLocaleString('sv-SE', { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 });
};

/** Bars per hour/day/week/month from a meter reading (or per-value consumption), from aggregated history. */
export function ConsumptionWidget({ w, ctx, iid }) {
  const s = { ...CONSUMPTION_DEFAULTS, ...w.layout };
  const savedPeriod = PERIODS.some(([p]) => p === s.period) ? s.period : 'day';
  const savedCount = Math.max(1, Math.min(PERIODS.find(([p]) => p === savedPeriod)[2], Number(s.count) || 7));
  // the viewer's choice of interval, back to the saved one when the widget is edited
  const [view, setView] = useState(null);
  useEffect(() => setView(null), [savedPeriod, savedCount]);
  const period = view ? view[0] : savedPeriod;
  const count = view ? view[1] : savedCount;
  const views = VIEWS.some(([p, n]) => p === savedPeriod && n === savedCount) ? VIEWS : [[savedPeriod, savedCount, 'Standard'], ...VIEWS];
  const mode = s.mode === 'delta' ? 'delta' : 'counter';
  const topic = normTopic(w.obj?.meta?.topic_read);
  const unit = unitOf(w.obj);
  const [data, setData] = useState(null); // { points, aggregated, capped }
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null);
  const [plot, { width }] = useSize();
  // new buckets at the turn of the hour; the minute tick keeps "now" fresh enough for that
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const buckets = useMemo(() => bucketsFor(period, count, now), [period, count, now.getHours(), now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = buckets[0].from;

  useEffect(() => {
    if (!topic) return;
    let alive = true;
    setData(null);
    setErr('');
    // hourly values for up to two months, daily beyond that, so even years of readings are a few hundred points
    const to = Date.now() / 1000;
    const interval = to - first <= 62 * DAY ? '1h' : '1d';
    const step = interval === '1h' ? 3600 : DAY;
    // one interval before the first bucket, so the first bucket has a reading to count from
    loadBuckets(iid, ctx.inst?.client_id, topic, first - step, to, mode === 'delta' ? 'sum' : 'last', interval)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    const off = ctx.onLive((e) => {
      const v = Number(e.value);
      if (e.topic !== topic || !Number.isFinite(v)) return;
      setData((d) => (d ? { ...d, points: [...d.points, { ts: e.timestamp, value: v }] } : d));
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, topic, first, mode, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const values = useMemo(() => (data ? consumptionPer(buckets, data.points, mode) : []), [data, buckets, mode]);

  if (!topic) return <div className="muted small">Funktionen saknar topic_read.</div>;
  if (err) return <div className="muted small">{err}</div>;
  if (!data) return <div className="muted small">Läser mätarställningar…</div>;

  const max = Math.max(0, ...values.filter((v) => v !== null));
  const total = values.reduce((a, v) => a + (v || 0), 0);
  const known = values.filter((v) => v !== null);
  const avg = known.length ? total / known.length : 0;
  const u = unit ? ` ${unit}` : '';
  const shown = hover ?? buckets.length - 1;
  // thin out the labels so they do not overlap: one per ~44 px
  const every = Math.ceil(buckets.length / Math.max(1, Math.floor((width || 400) / 44)));
  const periodText = { hour: 'timme', day: 'dygn', week: 'vecka', month: 'månad' }[period];

  return (
    <div className="cons">
      <div className="cons-top">
        <div className="grow">
          <div className="mid">{values[shown] === null ? '-' : fmtNum(values[shown]) + u}</div>
          <div className="muted small">
            {hover === null ? `Nu, ${buckets[shown].label}` : buckets[shown].label}
            {hover === null && buckets.length > 1 && ` · totalt ${fmtNum(total)}${u}, snitt ${fmtNum(avg)}${u} per ${periodText}`}
          </div>
        </div>
        <span className="range-pick" role="group" aria-label="Tidsintervall">
          {views.map(([p, n, l]) => (
            <button key={`${p}${n}`} type="button" className={p === period && n === count ? 'on' : ''} onClick={() => setView(p === savedPeriod && n === savedCount ? null : [p, n])}>
              {l}
            </button>
          ))}
        </span>
      </div>
      {!known.length || max === 0 ? (
        <div className="muted small">Ingen förbrukning i perioden.</div>
      ) : (
        <div className="cons-plot" ref={plot} onPointerLeave={() => setHover(null)}>
          <span className="cons-max small muted" title="Högsta stapelns värde, toppen på skalan">max {fmtNum(max) + u}</span>
          <div className="cons-bars">
            {buckets.map((b, i) => (
              <div
                key={b.from}
                className={`cons-col ${i === buckets.length - 1 ? 'now' : ''} ${hover === i ? 'on' : ''}`}
                onPointerEnter={() => setHover(i)}
                title={`${b.label}: ${values[i] === null ? 'ingen data' : fmtNum(values[i]) + u}`}
              >
                <div className="cons-bar" style={{ height: `${values[i] ? Math.max(1.5, (values[i] / max) * 100) : 0}%` }} />
                <span className="cons-label small muted">{(buckets.length - 1 - i) % every === 0 ? (period === 'day' && buckets.length > 10 ? b.label.replace(/^\S+ /, '') : b.label) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(!data.aggregated || data.capped) && <div className="muted small">{data.capped ? 'Mycket data, äldre värden kan saknas.' : 'IoT Open saknar sammanställning, läser rådata.'}</div>}
    </div>
  );
}
