import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { formatValue } from '../../lib/format.js';
import { loadHistory } from '../../lib/history.js';
import { sparkPaths, sparkStats } from '../../lib/sparkline.js';

/**
 * Minigraf: the last `hours` of a function as a small curve, with MIN / MEDEL / MAX under it (`stats`).
 * Live values are added as they come. For longer periods IoT Open's averages draw the curve and its own min / max
 * per interval give MIN and MAX, so a short peak is not averaged away.
 */
export function Sparkline({ fn, ctx, iid, hours = 24, stats = true }) {
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
  const paths = useMemo(() => sparkPaths(points, from, now, 100, 30), [points, from, now]);
  const st = useMemo(() => (data ? sparkStats(data.points, from, now, data.lows, data.highs) : null), [data, from, now]);

  if (err) return <div className="spark muted small">{err}</div>;
  return (
    <div className="spark">
      <svg className="spark-svg" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        {paths && (
          <>
            <path d={paths.area} className="spark-area" />
            <path d={paths.line} className="spark-line" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
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
