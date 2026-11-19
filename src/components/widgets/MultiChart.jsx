import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { formatValue } from '../../lib/format.js';
import { loadHistory, aggrLabel } from '../../lib/history.js';
import { fnName, OBJ_META, SERIES_COLORS, SERIES_COLORS_DARK, safeColor } from '../../lib/dashboard.js';
import { RangePicker, ZoomSurface, useTimeWindow, fmtAxis, fmtWhen } from './RangePicker.jsx';
import { statusOf, staleProps } from '../../lib/status.js';
import { chartScale } from '../../lib/scale.js';
import { bandPath, bucketAt, gapLinks, intervalText, linePath, midOf, runs } from '../../lib/buckets.js';

// the value an aggregated point holds, for the pointer's text
const METHOD_WORD = { avg: 'medel', median: 'median', min: 'min', max: 'max', last: 'senast', sum: 'summa' };

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
  // own colour per line (layout "series") first, then the function's dashboard.color, then the series palette
  const colorOf = (f, i) => (single ? 'var(--tile-color)' : safeColor(w.layout.series?.[f.id]) || safeColor(f.meta?.[OBJ_META.color]) || palette[i % palette.length]);

  useEffect(() => {
    if (!topics.length) return;
    let alive = true;
    setHist(null);
    setErr('');
    const { from, to, live } = tw.win;
    // one function: IoT Open's min and max per interval too, drawn as a band behind the averages
    loadHistory(iid, ctx.inst?.client_id, topics, from, to, { mode: 'numeric', method: w.layout.aggr || 'avg', band: single })
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
    const iv = hist.aggr?.seconds || 0;
    // an interval counts when any part of it is in the window; the band's min and max must fit too
    const ys = [...hist.byTopic.values()].flatMap((p) =>
      p.filter((x) => x.ts + (x.live ? 0 : iv) >= t0 && x.ts <= t1).flatMap((x) => [x.value, ...(Number.isFinite(x.min) ? [x.min, x.max] : [])]),
    );
    // round numbers, and not below zero for values that never are (a counter)
    return chartScale(ys);
  }, [hist, t0, t1]);

  const X = (t) => ((t - t0) / span) * 300;
  const Y = (y) => 100 - ((y - scale.lo) / (scale.hi - scale.lo)) * 100;
  const ticks = Array.from({ length: 4 }, (_, i) => t0 + ((i + 1) * span) / 5);
  const ref = fns[0];
  const current = single ? ctx.valueOf(w.obj) : null;
  const iv = hist?.aggr?.seconds || 0;
  // aggregated: the pointer is on a whole interval, never a moment the data does not have
  const hoverBucket = hover && iv && hist ? bucketAt(hist.byTopic.get(topics[0]) || [], hover, iv) : null;
  /** The point under the pointer: the interval's value, or (raw) the last reading at or before it. */
  const hoverValue = (f) => {
    const p = hist?.byTopic.get(normTopic(f.meta?.topic_read)) || [];
    // each line's own interval under the pointer (lines may report at different paces)
    if (iv) return bucketAt(p, hover, iv).point;
    const idx = at(p, hover);
    return idx >= 0 ? p[idx] : null;
  };
  /** "medel 9,1 °C (8,9–9,4)", "inga värden", or (raw) "9,1 °C (mätt 06:12)". */
  const hoverText = (f) => {
    const p = hoverValue(f);
    if (!p) return iv ? 'inga värden' : formatValue(f, undefined);
    if (iv && !p.live) {
      const range = Number.isFinite(p.min) && p.min !== p.max ? ` (${formatValue(f, p.min)}–${formatValue(f, p.max)})` : '';
      return `${METHOD_WORD[hist.aggr.method] || hist.aggr.method} ${formatValue(f, p.value)}${range}`;
    }
    return `${formatValue(f, p.value)} (mätt ${fmtWhen(p.ts, span)})`;
  };

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
                const all = hist.byTopic.get(normTopic(f.meta?.topic_read)) || [];
                const color = colorOf(f, i);
                if (iv) {
                  // averages per interval: a line through the middle of each interval, broken (dashed) where
                  // intervals have no value, and with one function the min-max band behind it
                  const p = all.filter((x) => x.ts + (x.live ? 0 : iv) >= t0 && x.ts <= t1);
                  if (!p.length) return null;
                  const rs = runs(p, iv);
                  return (
                    <g key={f.id}>
                      {single && hist.aggr.band && rs.map((r, k) => <path key={`b${k}`} d={bandPath(r, iv, X, Y)} fill={color} opacity="0.2" />)}
                      {single &&
                        !hist.aggr.band &&
                        rs.map((r, k) =>
                          r.length > 1 ? (
                            <path key={`a${k}`} d={`${linePath(r, iv, X, Y)} L${X(midOf(r[r.length - 1], iv)).toFixed(2)},100 L${X(midOf(r[0], iv)).toFixed(2)},100 Z`} fill={color} opacity="0.12" />
                          ) : null,
                        )}
                      {gapLinks(rs, iv, X, Y).map((g, k) => (
                        <line key={`g${k}`} {...g} stroke={color} strokeWidth="1" strokeDasharray="2 4" opacity="0.6" vectorEffect="non-scaling-stroke" />
                      ))}
                      {!single && rs.map((r, k) => (r.length > 1 ? <path key={`h${k}`} d={linePath(r, iv, X, Y)} className="line-halo" vectorEffect="non-scaling-stroke" /> : null))}
                      {rs.map((r, k) =>
                        r.length > 1 ? (
                          <path key={`l${k}`} d={linePath(r, iv, X, Y)} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        ) : (
                          // a lone interval: a short flat mark across it
                          <line key={`l${k}`} x1={X(r[0].ts)} x2={X(r[0].ts + (r[0].live ? 0 : iv))} y1={Y(r[0].value)} y2={Y(r[0].value)} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        ),
                      )}
                    </g>
                  );
                }
                const p = all.filter((x) => x.ts >= t0 - span * 0.02 && x.ts <= t1);
                if (p.length < 2) return null;
                const d = p.map((x, j) => `${j ? 'L' : 'M'}${X(x.ts).toFixed(2)},${Y(x.value).toFixed(2)}`).join(' ');
                return (
                  <g key={f.id}>
                    {single && <path d={`${d} L${X(p[p.length - 1].ts).toFixed(2)},100 L${X(p[0].ts).toFixed(2)},100 Z`} fill={color} opacity="0.12" />}
                    {!single && <path d={d} className="line-halo" vectorEffect="non-scaling-stroke" />}
                    <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
              {hover && hoverBucket && <rect x={X(hoverBucket.start)} width={Math.max(0.6, X(hoverBucket.end) - X(hoverBucket.start))} y="0" height="100" className="hover-band" />}
              {hover && !hoverBucket && <line x1={X(hover)} x2={X(hover)} y1="0" y2="100" className="hover-line" vectorEffect="non-scaling-stroke" />}
            </svg>
            {hover && (
              // floats over the graph (follows the pointer) so nothing below it moves
              <span className="mchart-hover-time small" style={{ left: `${Math.min(88, Math.max(12, ((hover - t0) / span) * 100))}%` }}>
                {hoverBucket ? intervalText(hoverBucket.start, iv, span <= 86400) : fmtWhen(hover, span)}
                {single && <strong className={stClass(w.obj, hoverValue(w.obj)?.value)}> · {hoverText(w.obj)}</strong>}
              </span>
            )}
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
      {hist?.aggr && (
        <div className="data-note">
          {hist.aggr.band && single ? `Linjen visar ${aggrLabel(hist.aggr.method, hist.aggr.interval)}, fältet lägsta och högsta värde.` : `Visar ${aggrLabel(hist.aggr.method, hist.aggr.interval)}.`} Zooma in för fler detaljer.
        </div>
      )}
      {hist?.capped && <div className="data-note">Visar de första {(30000).toLocaleString('sv-SE')} av {hist.total.toLocaleString('sv-SE')} värden.</div>}
      {!single && (
        <ul className="mchart-legend">
          {fns.map((f, i) => {
            const v = hover ? hoverValue(f)?.value : ctx.valueOf(f)?.value;
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
