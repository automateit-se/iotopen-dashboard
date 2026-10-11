import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { formatValue } from '../../lib/format.js';
import { loadHistory, aggrLabel } from '../../lib/history.js';
import { fnName, OBJ_META, SERIES_COLORS, SERIES_COLORS_DARK, safeColor } from '../../lib/dashboard.js';
import { RangePicker, ZoomSurface, useTimeWindow, fmtAxis, fmtWhen } from './RangePicker.jsx';
import { statusOf, staleProps } from '../../lib/status.js';

const stClass = (fn, value) => {
  const s = statusOf(fn, value);
  return s && s.level > 0 ? `st-${s.level}` : '';
};

/** Index of the last point at or before t (binary search). */
function at(points, t) {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0 || points[0].ts > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].ts <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function useDark() {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const on = (e) => setDark(e.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return dark;
}

/**
 * One or more analog functions as lines in one graph with a shared y-axis.
 * `single` = the classic one-function chart: big current value on top, no legend.
 */
export function MultiChartWidget({ w, ctx, iid, single = false }) {
  const tw = useTimeWindow(w.layout.hours);
  const fns = useMemo(() => (single ? [w.obj] : w.functions), [single, w.obj, w.functions]);
  const topics = useMemo(() => fns.map((f) => normTopic(f.meta?.topic_read)).filter(Boolean), [fns]);
  const topicKey = topics.join('|');
  const [hist, setHist] = useState(null); // { byTopic, sampled }
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null);
  const dark = useDark();
  const palette = dark ? SERIES_COLORS_DARK : SERIES_COLORS;
  const colorOf = (f, i) => (single ? 'var(--tile-color)' : safeColor(f.meta?.[OBJ_META.color]) || palette[i % palette.length]);

  useEffect(() => {
    if (!topics.length) return;
    let alive = true;
    setHist(null);
    setErr('');
    const { from, to, live } = tw.win;
    loadHistory(iid, ctx.inst?.client_id, topics, from, to, { mode: 'numeric', method: w.layout.aggr || 'avg' })
      .then((h) => alive && setHist(h))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    if (!live) return () => (alive = false);
    const off = ctx.onLive((e) => {
      if (!topics.includes(e.topic) || !Number.isFinite(Number(e.value))) return;
      setHist((h) => {
        if (!h) return h;
        const byTopic = new Map(h.byTopic);
        const cut = Date.now() / 1000 - tw.hours * 3600;
        // aggregated series: keep one trailing live point instead of piling raw values onto the buckets
        const prev = (byTopic.get(e.topic) || []).filter((p) => p.ts >= cut && !(h.aggr && p.live));
        byTopic.set(e.topic, [...prev, { ts: e.timestamp, value: Number(e.value), live: !!h.aggr }]);
        return { ...h, byTopic };
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, topicKey, tw.key, w.layout.aggr, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { from: t0, to: t1 } = tw.win;
  const span = t1 - t0;
  const scale = useMemo(() => {
    if (!hist) return null;
    const ys = [...hist.byTopic.values()].flatMap((p) => p.filter((x) => x.ts >= t0 && x.ts <= t1).map((x) => x.value));
    if (!ys.length) return null;
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    const pad = (hi - lo) * 0.08 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }, [hist, t0, t1]);

  const X = (t) => ((t - t0) / span) * 300;
  const Y = (y) => 100 - ((y - scale.lo) / (scale.hi - scale.lo)) * 100;
  const ticks = Array.from({ length: 4 }, (_, i) => t0 + ((i + 1) * span) / 5);
  const ref = fns[0];
  const current = single ? ctx.valueOf(w.obj) : null;

  if (!fns.length) return <div className="muted small">Alla funktioner i grafen har visible = "false" i IoT Open.</div>;

  return (
    <div className="mchart">
      <div className="mchart-top">
        {single && <div className={`mid ${stClass(w.obj, current?.value)}`}>{formatValue(w.obj, current?.value)}</div>}
        <RangePicker tw={tw} />
      </div>
      {err ? (
        <div className="muted small">{err}</div>
      ) : !hist ? (
        <div className="muted small">Läser historik…</div>
      ) : !scale ? (
        <div className="muted small">Ingen historik i tidsfönstret.</div>
      ) : (
        <div className="mchart-plot">
          <div className="mchart-y small muted">
            <span>{formatValue(ref, +scale.hi.toFixed(1))}</span>
            <span>{formatValue(ref, +((scale.hi + scale.lo) / 2).toFixed(1))}</span>
            <span>{formatValue(ref, +scale.lo.toFixed(1))}</span>
          </div>
          <ZoomSurface className="mchart-box" win={tw.win} onZoom={tw.setZoom} onHover={setHover}>
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="chart">
              {[25, 50, 75].map((y) => (
                <line key={y} x1="0" x2="300" y1={y} y2={y} className="grid-line" vectorEffect="non-scaling-stroke" />
              ))}
              {fns.map((f, i) => {
                const p = (hist.byTopic.get(normTopic(f.meta?.topic_read)) || []).filter((x) => x.ts >= t0 - span * 0.02 && x.ts <= t1);
                if (p.length < 2) return null;
                const d = p.map((x, j) => `${j ? 'L' : 'M'}${X(x.ts).toFixed(2)},${Y(x.value).toFixed(2)}`).join(' ');
                return (
                  <g key={f.id}>
                    {single && <path d={`${d} L${X(p[p.length - 1].ts).toFixed(2)},100 L${X(p[0].ts).toFixed(2)},100 Z`} fill={colorOf(f, i)} opacity="0.12" />}
                    <path d={d} fill="none" stroke={colorOf(f, i)} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
              {hover && <line x1={X(hover)} x2={X(hover)} y1="0" y2="100" className="hover-line" vectorEffect="non-scaling-stroke" />}
            </svg>
            {hover && <span className="mchart-hover-time small">{fmtWhen(hover, span)}</span>}
          </ZoomSurface>
          <span />
          <div className="mchart-x small muted">
            {ticks.map((t) => (
              <span key={t} style={{ left: `${((t - t0) / span) * 100}%` }}>
                {fmtAxis(t, span)}
              </span>
            ))}
          </div>
        </div>
      )}
      {hist?.aggr && <div className="data-note">Visar {aggrLabel(hist.aggr.method, hist.aggr.interval)}. Zooma in för fler detaljer.</div>}
      {hist?.capped && <div className="data-note">Visar de första {(30000).toLocaleString('sv-SE')} av {hist.total.toLocaleString('sv-SE')} värden.</div>}
      {(!single || hover) && (
        <ul className="mchart-legend">
          {fns.map((f, i) => {
            const p = hist?.byTopic.get(normTopic(f.meta?.topic_read)) || [];
            const idx = hover ? at(p, hover) : -1;
            const v = hover ? (idx >= 0 ? p[idx].value : undefined) : ctx.valueOf(f)?.value;
            return (
              <li key={f.id} {...staleProps(f, ctx.raw)}>
                <span className="swatch-dot" style={{ background: colorOf(f, i) }} />
                {!single && <span className="name">{fnName(f)}</span>}
                <span className={`val ${stClass(f, v)}`}>{formatValue(f, v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
