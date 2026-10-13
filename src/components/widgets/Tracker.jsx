import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normTopic } from '../../api/lynx.js';
import { config } from '../../api/config.js';
import { loadRecent } from '../../lib/history.js';
import { devName, fnName, safeColor, SERIES_COLORS, SERIES_COLORS_DARK } from '../../lib/dashboard.js';
import { geoRole, pairPositions, geohashPositions, project, unproject, fitZoom, centreOf, TILE } from '../../lib/geo.js';
import { useDark } from './MultiChart.jsx';
import { fmtWhen, RangePicker, useTimeWindow } from './RangePicker.jsx';

export const TRACKER_DEFAULTS = { hours: 24, points: 200, pair: 5, fade: true };
const MAX_ZOOM = 18;

/**
 * Tracks of a tracker widget: its functions grouped per device. A track has a latitude + longitude pair or a
 * geohash function (by function type).
 */
export function tracksOf(fns, raw) {
  const byDev = new Map();
  for (const f of fns) {
    const role = geoRole(f);
    if (!role) continue;
    const key = f.meta?.device_id ? `d${f.meta.device_id}` : `f${f.id}`;
    if (!byDev.has(key)) byDev.set(key, { key, fns: [] });
    byDev.get(key).fns.push({ f, role, topic: normTopic(f.meta?.topic_read) });
  }
  return [...byDev.values()].map((t) => {
    const dev = raw?.devices?.find((d) => `d${d.id}` === t.key);
    const lat = t.fns.find((x) => x.role === 'lat');
    const lon = t.fns.find((x) => x.role === 'lon');
    const gh = t.fns.find((x) => x.role === 'geohash');
    return { key: t.key, name: dev ? devName(dev) : fnName(t.fns[0].f), lat, lon, gh, ok: !!(gh || (lat && lon)), topics: t.fns.map((x) => x.topic).filter(Boolean) };
  });
}

/** Positions of one track from its raw series. */
function positionsOf(track, series, pair) {
  if (track.gh) return geohashPositions(series.get(track.gh.topic) || []);
  if (track.lat && track.lon) return pairPositions(series.get(track.lat.topic) || [], series.get(track.lon.topic) || [], pair);
  return [];
}

/** Map with live position and fading trail ("snail trail") per device. */
export function TrackerWidget({ w, ctx, iid }) {
  const s = { ...TRACKER_DEFAULTS, ...w.layout };
  // the viewer can switch the history (1 h … 1 år) like in the graphs; the editor sets the default
  const tw = useTimeWindow(s.hours);
  const hours = tw.hours;
  const maxPoints = Math.max(1, Number(s.points) || 200);
  const pair = Math.max(0, Number(s.pair) || 0);
  const tracks = useMemo(() => tracksOf(w.functions, ctx.raw), [w.functions, ctx.raw]);
  const topics = useMemo(() => [...new Set(tracks.flatMap((t) => t.topics))], [tracks]);
  const topicKey = topics.join('|');
  const [series, setSeries] = useState(null); // Map topic -> [{ts, value}]
  const [err, setErr] = useState('');
  const dark = useDark();
  const palette = dark ? SERIES_COLORS_DARK : SERIES_COLORS;

  useEffect(() => {
    if (!topics.length) return;
    let alive = true;
    setSeries(null);
    setErr('');
    const now = Date.now() / 1000;
    // per track, so a busy tracker does not crowd out a quiet one; a position is up to two values (lat + lon),
    // plus some extra for values that do not pair
    Promise.all(tracks.filter((t) => t.topics.length).map((t) => loadRecent(iid, ctx.inst?.client_id, t.topics, now - hours * 3600, now, Math.min(20000, maxPoints * t.topics.length + 50))))
      .then((parts) => {
        const m = new Map(parts.flatMap((p) => [...p]));
        if (!alive) return;
        // the latest known value of each topic (status API), also older than the window, so the current
        // position is shown even when nothing moved lately
        for (const t of topics) {
          const v = ctx.valueOfTopic(t);
          const list = m.get(t) || [];
          if (v && v.timestamp && !list.some((p) => p.ts === v.timestamp)) list.push({ ts: v.timestamp, value: v.value });
          list.sort((a, b) => a.ts - b.ts);
          m.set(t, list);
        }
        setSeries(m);
      })
      .catch((e) => alive && setErr(e.status === 403 ? 'Saknar behörighet till loggen' : e.message));
    const off = ctx.onLive((e) => {
      if (!topics.includes(e.topic)) return;
      setSeries((m) => {
        if (!m) return m;
        const next = new Map(m);
        next.set(e.topic, [...(m.get(e.topic) || []), { ts: e.timestamp, value: e.value }]);
        return next;
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [iid, topicKey, hours, maxPoints, ctx.onLive, ctx.inst?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawn = useMemo(() => {
    if (!series) return [];
    const cut = Date.now() / 1000 - hours * 3600;
    return tracks
      .filter((t) => t.ok)
      .map((t, i) => {
        const all = positionsOf(t, series, pair);
        // the window and the number of positions both limit the trail; the newest position is always kept
        const inWin = all.filter((p) => p.ts >= cut);
        const pts = (inWin.length ? inWin : all.slice(-1)).slice(-maxPoints);
        return { ...t, color: safeColor(w.layout.series?.[(t.gh || t.lat || t.lon).f.id]) || palette[i % palette.length], points: pts };
      })
      .filter((t) => t.points.length);
  }, [series, tracks, pair, hours, maxPoints, palette, w.layout.series]);

  const top = (
    <div className="tracker-top">
      <RangePicker tw={tw} />
    </div>
  );
  if (!tracks.some((t) => t.ok))
    return <div className="muted small">Kartan behöver per enhet en funktion av typen latitude + longitude, eller en geohash.</div>;
  const note = (text) => (
    <div className="tracker">
      {top}
      <div className="muted small">{text}</div>
    </div>
  );
  if (err) return note(err);
  if (!series) return note('Läser positioner…');
  if (!drawn.length) return note('Inga positioner ännu.');

  const newest = Math.max(...drawn.map((t) => t.points[t.points.length - 1].ts));
  return (
    <div className="tracker">
      {top}
      <MapView tracks={drawn} fade={s.fade !== false} />
      <div className="tracker-legend small">
        {drawn.length > 1 &&
          drawn.map((t) => (
            <span key={t.key} className="row gap">
              <span className="swatch-dot" style={{ background: t.color }} /> {t.name}
            </span>
          ))}
        <span className="muted grow tracker-last">
          Senast {fmtWhen(newest, Date.now() / 1000 - newest + 1)} · {drawn.reduce((n, t) => n + t.points.length, 0)} positioner
        </span>
      </div>
    </div>
  );
}

/** Size of an element, kept up to date: returns [ref callback, { width, height }]. */
export function useSize() {
  const [el, setEl] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}

const tileUrl = (z, x, y) => String(config.mapTiles || '').replace('{z}', z).replace('{x}', x).replace('{y}', y);

/**
 * A small slippy map: map tiles (config.mapTiles) with the tracks on top as SVG. Fits all positions until
 * the viewer drags or zooms; "Visa allt" goes back to that.
 */
function MapView({ tracks, fade }) {
  const box = useRef(null);
  const [sizeRef, { width, height }] = useSize();
  const mapRef = useCallback(
    (el) => {
      box.current = el;
      sizeRef(el);
    },
    [sizeRef],
  );
  const [view, setView] = useState(null); // { z, cx, cy } in world pixels; null = fit all positions
  const drag = useRef(null);
  const all = tracks.flatMap((t) => t.points);

  const auto = useMemo(() => {
    if (!width || !height) return null;
    const z = fitZoom(all, width, height, 17);
    const c = centreOf(all);
    const p = project(c.lat, c.lon, z);
    return { z, cx: p.x, cy: p.y };
  }, [width, height, all.length, all[all.length - 1]?.ts]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = view || auto;

  const zoomBy = (d) => {
    if (!v) return;
    const z = Math.max(1, Math.min(MAX_ZOOM, v.z + d));
    const f = 2 ** (z - v.z);
    setView({ z, cx: v.cx * f, cy: v.cy * f });
  };

  const tiles = [];
  if (v && config.mapTiles) {
    const n = 2 ** v.z;
    const x0 = Math.floor((v.cx - width / 2) / TILE);
    const x1 = Math.floor((v.cx + width / 2) / TILE);
    const y0 = Math.max(0, Math.floor((v.cy - height / 2) / TILE));
    const y1 = Math.min(n - 1, Math.floor((v.cy + height / 2) / TILE));
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        tiles.push({ key: `${v.z}/${x}/${y}`, src: tileUrl(v.z, ((x % n) + n) % n, y), left: x * TILE - v.cx + width / 2, top: y * TILE - v.cy + height / 2 });
  }
  const xy = (p) => {
    const w = project(p.lat, p.lon, v.z);
    return [w.x - v.cx + width / 2, w.y - v.cy + height / 2];
  };

  return (
    <div
      ref={mapRef}
      className="map"
      onPointerDown={(e) => {
        if (!v || e.target.closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, v };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setView({ ...d.v, cx: d.v.cx - (e.clientX - d.x), cy: d.v.cy - (e.clientY - d.y) });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        if (!v || e.target.closest('button')) return;
        const r = box.current.getBoundingClientRect();
        const c = unproject(v.cx + e.clientX - r.left - width / 2, v.cy + e.clientY - r.top - height / 2, v.z);
        const z = Math.min(MAX_ZOOM, v.z + 1);
        const p = project(c.lat, c.lon, z);
        setView({ z, cx: p.x, cy: p.y });
      }}
    >
      {tiles.map((t) => (
        <img key={t.key} src={t.src} alt="" className="map-tile" style={{ left: t.left, top: t.top }} draggable={false} />
      ))}
      {v && (
        <svg className="map-overlay" width={width} height={height}>
          {tracks.map((t) => {
            const pts = t.points.map(xy);
            const n = pts.length;
            return (
              <g key={t.key}>
                {/* one segment per step, older segments fainter (the newest end is fully opaque) */}
                {pts.slice(1).map((p, i) => (
                  <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} stroke={t.color} strokeWidth="3" strokeLinecap={fade ? 'butt' : 'round'} opacity={fade ? 0.12 + 0.88 * ((i + 1) / (n - 1)) : 0.9} />
                ))}
                {n > 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="3" fill={t.color} opacity={fade ? 0.3 : 0.9} />}
                <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="7" fill={t.color} stroke="#fff" strokeWidth="2.5">
                  <title>{`${t.name}: ${fmtWhen(t.points[n - 1].ts, 3600)} (${t.points[n - 1].lat.toFixed(5)}, ${t.points[n - 1].lon.toFixed(5)})`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
      )}
      <div className="map-ctl">
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zooma in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zooma ut">
          −
        </button>
        {view && (
          <button type="button" className="map-fit" onClick={() => setView(null)} title="Visa alla positioner och följ nya">
            Visa allt
          </button>
        )}
      </div>
      {config.mapTiles && config.mapAttribution && <span className="map-attr">{config.mapAttribution}</span>}
    </div>
  );
}
