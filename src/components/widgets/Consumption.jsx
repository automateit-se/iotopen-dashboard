import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { loadBuckets } from '../../lib/history.js';
import { unitOf, fnName, consumptionFunctions, OBJ_META, SERIES_COLORS, SERIES_COLORS_DARK, safeColor } from '../../lib/dashboard.js';
import { bucketsFor, consumptionPer } from '../../lib/periods.js';
import { useSize } from './Tracker.jsx';
import { useDark } from './MultiChart.jsx';

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
// what a viewer can switch between in the widget (not saved; the editor sets the default), longest to the left
export const VIEWS = [
  ['week', 52, '1 år'],
  ['week', 12, '12 v'],
  ['day', 30, '30 d'],
  ['day', 7, '7 d'],
  ['hour', 24, '24 h'],
];
export const fmtNum = (v) => {
  const a = Math.abs(v);
  return v.toLocaleString('sv-SE', { maximumFractionDigits: a >= 100 ? 0 : a >= 10 ? 1 : 2 });
};

/**
 * Bars per hour/day/week/month from a meter reading (or per-value consumption), from aggregated history.
 * With more functions (layout "more") their bars stand side by side per period, e.g. visitors in and out.
 */
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
  const fns = useMemo(() => consumptionFunctions(w.obj, w.layout, ctx.raw), [w.obj, w.layout, ctx.raw]);
  const multi = fns.length > 1;
  const topics = useMemo(() => fns.map((f) => normTopic(f.meta?.topic_read)), [fns]);
  const topicKey = topics.join('|');
  const dark = useDark();
  const palette = dark ? SERIES_COLORS_DARK : SERIES_COLORS;
  // one function: the tile colour; several: own colour (layout "series"), dashboard.color, then the series palette
  const colorOf = (f, i) => (multi ? safeColor(w.layout.series?.[f.id]) || safeColor(f.meta?.[OBJ_META.color]) || palette[i % palette.length] : 'var(--tile-color)');
  // what was read, for which topics: a just-edited widget shows nothing until its new functions are read
  const [loaded, setLoaded] = useState(null); // { key, list: per function { points, aggregated, capped } }
  const data = loaded?.key === topicKey ? loaded.list : null;
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
    if (!topics.every(Boolean)) return;
    let alive = true;
    setLoaded(null);
    setErr('');
    // always hourly values: IoT Open's days follow UTC, so daily values would move the bars' boundaries one or
    // two hours away from local midnight. Three years of hours is about 26 000 values, within the cap.
    const to = Date.now() / 1000;
    // a meter: also the last reading before the first bucket, so the first bucket has a reading to count from
    Promise.all(topics.map((t) => loadBuckets(iid, ctx.inst?.client_id, t, first, to, mode === 'delta' ? 'sum' : 'last', '1h', { before: mode !== 'delta' })))
      .then((d) => alive && setLoaded({ key: topicKey, list: d }))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    const off = ctx.onLive((e) => {
      const v = Number(e.value);
      const i = topics.indexOf(e.topic);
      if (i < 0 || !Number.isFinite(v)) return;
      setLoaded((l) => (l ? { ...l, list: l.list.map((x, j) => (j === i ? { ...x, points: [...x.points, { ts: e.timestamp, value: v }] } : x)) } : l));
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, topicKey, first, mode, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo(() => (data ? data.map((d) => consumptionPer(buckets, d.points, mode)) : []), [data, buckets, mode]);

  const missing = fns.find((f, i) => !topics[i]);
  if (missing) return <div className="muted small">{multi ? `${fnName(missing)} saknar topic_read.` : 'Funktionen saknar topic_read.'}</div>;
  if (err) return <div className="muted small">{err}</div>;
  if (!data) return <div className="muted small">Läser mätarställningar…</div>;

  const all = series.flat().filter((v) => v !== null);
  const max = Math.max(0, ...all);
  const totals = series.map((vals) => vals.reduce((a, v) => a + (v || 0), 0));
  const units = fns.map((f) => (unitOf(f) ? ` ${unitOf(f)}` : ''));
  const shown = hover ?? buckets.length - 1;
  // thin out the labels so they do not overlap: one per ~44 px
  const every = Math.ceil(buckets.length / Math.max(1, Math.floor((width || 400) / 44)));
  const periodText = { hour: 'timme', day: 'dygn', week: 'vecka', month: 'månad' }[period];
  const fmt = (v, k) => (v === null || v === undefined ? '-' : fmtNum(v) + units[k]);
  const when = hover === null ? `Nu, ${buckets[shown].label}` : buckets[shown].label;
  const tip = (b, i) =>
    `${b.label}: ${fns.map((f, k) => `${multi ? `${fnName(f)} ` : ''}${series[k][i] === null ? 'ingen data' : fmt(series[k][i], k)}`).join(', ')}`;
  const known = series[0].filter((v) => v !== null);
  const avg = known.length ? totals[0] / known.length : 0;

  return (
    <div className="cons">
      <div className="cons-top">
        <div className="grow">
          {multi ? (
            <div className="muted small">
              {when}
              {hover === null && buckets.length > 1 && ' · (totalt i perioden)'}
            </div>
          ) : (
            <>
              <div className="mid">{fmt(series[0][shown], 0)}</div>
              <div className="muted small">
                {when}
                {hover === null && buckets.length > 1 && ` · totalt ${fmtNum(totals[0])}${units[0]}, snitt ${fmtNum(avg)}${units[0]} per ${periodText}`}
              </div>
            </>
          )}
        </div>
        <span className="range-pick" role="group" aria-label="Tidsintervall">
          {views.map(([p, n, l]) => (
            <button key={`${p}${n}`} type="button" className={p === period && n === count ? 'on' : ''} onClick={() => setView(p === savedPeriod && n === savedCount ? null : [p, n])}>
              {l}
            </button>
          ))}
        </span>
      </div>
      {multi && (
        <ul className="mchart-legend cons-legend">
          {fns.map((f, k) => (
            <li key={f.id} title={`Totalt ${fmt(totals[k], k)} i perioden`}>
              <span className="swatch-dot" style={{ background: colorOf(f, k) }} />
              <span className="name">{fnName(f)}</span>
              <span className="val">{fmt(series[k][shown], k)}</span>
              {hover === null && buckets.length > 1 && <span className="muted">({fmtNum(totals[k])})</span>}
            </li>
          ))}
        </ul>
      )}
      {!all.length || max === 0 ? (
        <div className="muted small">Ingen förbrukning i perioden.</div>
      ) : (
        <div className="cons-plot" ref={plot} onPointerLeave={() => setHover(null)}>
          <span className="cons-max small muted" title="Högsta stapelns värde, toppen på skalan">
            max {fmtNum(max) + (new Set(units).size === 1 ? units[0] : '')}
          </span>
          <div className="cons-bars">
            {buckets.map((b, i) => (
              <div key={b.from} className={`cons-col ${i === buckets.length - 1 ? 'now' : ''} ${hover === i ? 'on' : ''}`} onPointerEnter={() => setHover(i)} title={tip(b, i)}>
                <div className="cons-group">
                  {series.map((vals, k) => (
                    <div
                      key={fns[k].id}
                      className="cons-bar"
                      style={{ height: `${vals[i] ? Math.max(1.5, (vals[i] / max) * 100) : 0}%`, ...(multi ? { background: colorOf(fns[k], k) } : {}) }}
                    />
                  ))}
                </div>
                <span className="cons-label small muted">{(buckets.length - 1 - i) % every === 0 ? (period === 'day' && buckets.length > 10 ? b.label.replace(/^\S+ /, '') : b.label) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.some((d) => !d.aggregated || d.capped) && (
        <div className="muted small">{data.some((d) => d.capped) ? 'Mycket data, äldre värden kan saknas.' : 'IoT Open saknar sammanställning, läser rådata.'}</div>
      )}
    </div>
  );
}
