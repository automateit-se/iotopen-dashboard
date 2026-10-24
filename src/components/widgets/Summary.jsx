import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { loadBuckets } from '../../lib/history.js';
import { unitOf } from '../../lib/dashboard.js';
import { SUMMARY_DEFAULTS, summaryRanges, summaryTotals } from '../../lib/periods.js';
import { Icon } from '../icons.jsx';
import { fmtNum } from './Consumption.jsx';

/**
 * "Summa per period": the consumption today, this week, this month … as big numbers side by side, from a meter
 * reading (counter) or per-value consumption (delta). Same hourly history as the consumption bars.
 */
export function SummaryWidget({ w, ctx, iid }) {
  const s = { ...SUMMARY_DEFAULTS, ...w.layout };
  const mode = s.mode === 'delta' ? 'delta' : 'counter';
  const topic = normTopic(w.obj?.meta?.topic_read);
  // new periods at midnight; the minute tick keeps "now" fresh enough for that
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  const periodKey = (Array.isArray(s.periods) ? s.periods : []).join(',');
  const ranges = useMemo(() => summaryRanges(periodKey ? periodKey.split(',') : [], now), [periodKey, now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = Math.min(...ranges.map((r) => r.from));
  const [loaded, setLoaded] = useState(null); // { key, points }
  const key = `${topic}|${first}|${mode}`;
  const points = loaded?.key === key ? loaded.points : null;
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!topic) return;
    let alive = true;
    setErr('');
    // hourly values, as for the consumption bars: IoT Open's days follow UTC, not local midnight
    loadBuckets(iid, ctx.inst?.client_id, topic, first, Date.now() / 1000, mode === 'delta' ? 'sum' : 'last', '1h', { before: mode !== 'delta' })
      .then((d) => alive && setLoaded({ key, points: d.points }))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    const off = ctx.onLive((e) => {
      const v = Number(e.value);
      if (e.topic !== topic || !Number.isFinite(v)) return;
      setLoaded((l) => (l?.key === key ? { ...l, points: [...l.points, { ts: e.timestamp, value: v }] } : l));
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, key, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => (points ? summaryTotals(ranges, points, mode) : null), [points, ranges, mode]);

  if (!topic) return <div className="muted small">Funktionen saknar topic_read.</div>;
  if (err) return <div className="muted small">{err}</div>;
  const unit = unitOf(w.obj);
  return (
    <div className="w-sum" style={{ '--sum-cols': ranges.length }}>
      {ranges.map((r, i) => (
        <div key={r.id} className="sum-cell">
          <div className="sum-value">
            {w.icon && <Icon name={w.icon} size={20} className="sum-icon" />}
            <span className="sum-num">{!totals ? '…' : totals[i] === null ? '-' : fmtNum(totals[i])}</span>
            {unit && <span className="sum-unit">{unit}</span>}
          </div>
          <div className="sum-label">{r.label}</div>
        </div>
      ))}
    </div>
  );
}
