import { useEffect, useMemo, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { loadHistory } from '../../lib/history.js';
import { fnName, stateText, stateKind } from '../../lib/dashboard.js';
import { RangePicker, ZoomSurface, useTimeWindow, fmtAxis, fmtWhen } from './RangePicker.jsx';
import { staleOf } from '../../lib/status.js';

const fmtDur = (s) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : s < 3 * 86400 ? `${(s / 3600).toFixed(1)} h` : `${(s / 86400).toFixed(1)} d`);

/** Collapses consecutive equal values into segments [{from, to, value}] within [from, now]. */
function segments(points, from, to) {
  const out = [];
  for (const p of points) {
    if (p.ts > to) break;
    const last = out[out.length - 1];
    if (last && String(last.value) === String(p.value)) continue;
    if (last) last.to = Math.max(from, p.ts);
    out.push({ from: Math.max(from, p.ts), to, value: p.value });
  }
  return out.filter((s) => s.to > s.from);
}

/**
 * Discrete functions as state bars over time. Layout parameters: hours (default window) and
 * min_width (percent of the width an "on" segment is drawn at least, so short events stay visible).
 */
export function TimelineWidget({ w, ctx, iid }) {
  const tw = useTimeWindow(w.layout.hours);
  const minPct = Math.max(0, Number(w.layout.min_width ?? 1) || 0);
  const fns = w.functions;
  const topics = useMemo(() => fns.map((f) => normTopic(f.meta?.topic_read)).filter(Boolean), [fns]);
  const topicKey = topics.join('|');
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!topics.length) return;
    let alive = true;
    setErr('');
    setHist(null);
    const { from, to, live } = tw.win;
    loadHistory(iid, ctx.inst?.client_id, topics, from, to, { mode: 'discrete' })
      .then((h) => alive && setHist(h))
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    if (!live) return () => (alive = false);
    const off = ctx.onLive((e) => {
      if (!topics.includes(e.topic)) return;
      setHist((h) => {
        if (!h) return h;
        const byTopic = new Map(h.byTopic);
        byTopic.set(e.topic, [...(byTopic.get(e.topic) || []), { ts: e.timestamp, value: e.value }]);
        return { ...h, byTopic };
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, topicKey, tw.key, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { from, to, live } = tw.win;
  const span = to - from;
  const pct = (t) => ((t - from) / span) * 100;
  const ticks = Array.from({ length: 5 }, (_, i) => from + ((i + 1) * span) / 6);

  if (!fns.length) return <div className="muted small">Alla funktioner i tidslinjen har visible = "false" i IoT Open.</div>;

  const rows = fns.map((f) => {
    const t = normTopic(f.meta?.topic_read);
    const cur = ctx.valueOf(f);
    let points = hist?.byTopic.get(t) || [];
    // nothing logged in or before the window: the latest status has held since it was reported
    if (live && !points.length && cur && cur.value !== undefined) points = [{ ts: Math.max(from, cur.timestamp || from), value: cur.value }];
    return { f, cur, segs: segments(points, from, to) };
  });

  return (
    <div className="timeline" style={{ '--row-color': w.color || undefined }}>
      <div className="tl-top">
        <RangePicker tw={tw} />
      </div>
      {err ? (
        <div className="muted small">{err}</div>
      ) : !hist ? (
        <div className="muted small">Läser historik…</div>
      ) : (
        <div className="tl-body">
          <div className="tl-labels">
            {rows.map(({ f, cur }) => (
              <div
                className={`tl-label ${staleOf(f, ctx.raw) ? 'stale' : ''}`}
                key={f.id}
                title={staleOf(f, ctx.raw) ? `Tyst: ${staleOf(f, ctx.raw).text}` : `${fnName(f)} (${f.type})`}
              >
                <span className="tl-name">{fnName(f)}</span>
                <span className={`tl-now ${stateKind(f, cur?.value)}`}>{stateText(f, cur?.value)}</span>
              </div>
            ))}
            <div className="tl-axis-pad" />
          </div>
          <div className="tl-right">
            <ZoomSurface className="tl-bars" win={tw.win} onZoom={tw.setZoom} onHover={setHover}>
              {rows.map(({ f, segs }) => (
                <div className="tl-bar" key={f.id}>
                  {!segs.length && <span className="tl-empty small muted">ingen data</span>}
                  {segs.map((s, i) => {
                    const kind = stateKind(f, s.value);
                    const left = pct(s.from);
                    let width = pct(s.to) - left;
                    // short "on" events get a minimum width so they stay visible
                    if (kind !== 'off' && width < minPct) width = Math.min(minPct, 100 - left);
                    return (
                      <span
                        key={i}
                        className={`tl-seg ${kind}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${stateText(f, s.value)}\n${fmtWhen(s.from, span)} – ${fmtWhen(s.to, span)} (${fmtDur(s.to - s.from)})`}
                      />
                    );
                  })}
                </div>
              ))}
              {hover && <span className="tl-hover" style={{ left: `${pct(hover)}%` }} />}
            </ZoomSurface>
            <div className="tl-ticks">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${pct(t)}%` }}>
                  {fmtAxis(t, span)}
                </span>
              ))}
              {hover && (
                <span className="tl-hover-time" style={{ left: `${pct(hover)}%` }}>
                  {fmtWhen(hover, span)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {hist?.truncatedFrom && <div className="data-note">Visar de senaste {(60000).toLocaleString('sv-SE')} händelserna (från {fmtWhen(hist.truncatedFrom, span)}). Zooma in för att se äldre.</div>}
    </div>
  );
}
