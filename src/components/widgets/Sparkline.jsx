import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { formatValue } from '../../lib/format.js';
import { unitOf } from '../../lib/dashboard.js';
import { loadHistory } from '../../lib/history.js';
import { niceAxis, sparkPaths, sparkStats, timeTicks } from '../../lib/sparkline.js';

/** A y axis label: the value as the function's format gives it, without the unit (the widget shows that). */
export const axisLabel = (fn, v) => {
  const s = formatValue(fn, v);
  const u = unitOf(fn);
  return (u && s.endsWith(u) ? s.slice(0, -u.length) : s).trim();
};

/** Short period text for a legend: 6 h, 24 h, 7 d. */
export const periodText = (hours) => (hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`);

/**
 * The frame of a small graph: three round values up the left side with faint lines across, a few round times
 * along the bottom, and the plot (`children`, drawn in a viewBox 100 × `height` on the axis's scale).
 */
export function MiniChart({ axis, from, to, fmtY, height = 40, children }) {
  const xt = timeTicks(from, to);
  const pct = (v) => ((axis.hi - v) / (axis.hi - axis.lo)) * 100;
  const labels = axis.ticks.map(fmtY);
  const width = Math.max(...labels.map((l) => l.length));
  return (
    <div className="mini">
      <div className="mini-y small muted" style={{ width: `${width * 0.6 + 0.3}em` }} aria-hidden="true">
        {axis.ticks.map((v, i) => (
          <span key={v} style={{ top: `${pct(v)}%` }}>
            {labels[i]}
          </span>
        ))}
      </div>
      <svg className="mini-plot" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {axis.ticks.map((v) => (
          <line key={v} x1="0" x2="100" y1={(pct(v) * height) / 100} y2={(pct(v) * height) / 100} className="mini-grid" vectorEffect="non-scaling-stroke" />
        ))}
        {children}
      </svg>
      <div className="mini-x small muted" aria-hidden="true">
        {xt.map((t) => (
          <span key={t.ts} style={{ left: `${((t.ts - from) / (to - from)) * 100}%` }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Minigraf: the last `hours` of a function as a small curve, with MIN / MEDEL / MAX under it (`stats`).
 * Live values are added as they come. For longer periods IoT Open's averages draw the curve and its own min / max
 * per interval give MIN and MAX, so a short peak is not averaged away.
 */
export function Sparkline({ fn, ctx, iid, hours = 24, stats = true, axes = false }) {
  const topic = normTopic(fn.meta?.topic_read);
  const [data, setData] = useState(null); // { points, lows, highs }
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!topic) return;
    let alive = true;
    setData(null);
    setErr('');
    const to = Date.now() / 1000;
    const from = to - hours * 3600;
    const load = (method) => loadHistory(iid, ctx.inst?.client_id, [topic], from, to, { mode: 'numeric', method });
    load('avg')
      .then(async (avg) => {
        const points = avg.byTopic.get(topic) || [];
        // averages: also IoT Open's min and max per interval (same interval, so a few hundred values each)
        const [lo, hi] = avg.aggr ? await Promise.all([load('min'), load('max')]).catch(() => [null, null]) : [null, null];
        if (alive) setData({ points, lows: lo?.byTopic.get(topic) || null, highs: hi?.byTopic.get(topic) || null });
      })
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : 'Kunde inte läsa historiken'));
    const off = ctx.onLive((e) => {
      if (e.topic !== topic || !Number.isFinite(Number(e.value))) return;
      setNow(Date.now() / 1000);
      const cut = Date.now() / 1000 - hours * 3600;
      setData((d) => (d ? { ...d, points: [...d.points.filter((x) => x.ts >= cut), { ts: e.timestamp, value: Number(e.value) }] } : d));
    });
    // the window moves on even without new values
    const tick = setInterval(() => setNow(Date.now() / 1000), 60000);
    return () => {
      alive = false;
      off();
      clearInterval(tick);
    };
  }, [iid, topic, hours, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = now - hours * 3600;
  // the curve runs to now: the latest value holds until the next one
  const points = useMemo(() => {
    if (!data?.points.length) return [];
    const p = data.points.filter((x) => x.ts >= from - 1);
    const last = data.points[data.points.length - 1];
    return last.ts < now ? [...p, { ts: now, value: last.value }] : p;
  }, [data, from, now]);
  // with axes the scale is round values that hold the curve (and IoT Open's min / max per interval)
  const axis = useMemo(
    () => (axes && points.length >= 2 ? niceAxis([...points, ...(data?.lows || []), ...(data?.highs || [])].filter((x) => x.ts >= from).map((x) => x.value)) : null),
    [axes, points, data, from],
  );
  const paths = useMemo(() => sparkPaths(points, from, now, 100, axis ? 40 : 30, axis), [points, from, now, axis]);
  const st = useMemo(() => (data ? sparkStats(data.points, from, now, data.lows, data.highs) : null), [data, from, now]);

  if (err) return <div className="spark muted small">{err}</div>;
  return (
    <div className="spark">
      {axis ? (
        <MiniChart axis={axis} from={from} to={now} fmtY={(v) => axisLabel(fn, v)}>
          {paths && (
            <>
              <path d={paths.area} className="spark-area" />
              <path d={paths.line} className="spark-line" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </MiniChart>
      ) : (
        <svg className="spark-svg" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          {paths && (
            <>
              <path d={paths.area} className="spark-area" />
              <path d={paths.line} className="spark-line" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>
      )}
      {stats && (
        <div className="spark-stats">
          {[
            ['MIN', st?.min],
            ['MEDEL', st?.mean],
            ['MAX', st?.max],
          ].map(([label, v]) => (
            <div key={label}>
              <span className="spark-label">{label}</span>
              <span className="spark-val">{st ? formatValue(fn, Number(v.toFixed(3))) : '–'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
