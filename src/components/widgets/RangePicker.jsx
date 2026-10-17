import { useEffect, useRef, useState } from 'react';

// the buttons, longest range to the left
export const RANGES = [
  [8760, '1 år'],
  [720, '30 d'],
  [168, '7 d'],
  [24, '24 h'],
  [1, '1 h'],
];
export const RANGE_OPTIONS = [
  [1, '1 timme'],
  [24, '24 timmar'],
  [168, '7 dygn'],
  [720, '30 dygn'],
  [8760, '1 år'],
];

const fmt = (ts, span) =>
  new Date(ts * 1000).toLocaleString(
    'sv-SE',
    span > 2 * 86400 ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : span > 86400 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' },
  );
export const fmtAxis = (ts, span) =>
  new Date(ts * 1000).toLocaleString(
    'sv-SE',
    span > 60 * 86400 ? { month: 'short', year: '2-digit' } : span > 2 * 86400 ? { day: 'numeric', month: 'short' } : span > 86400 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' },
  );
export const fmtWhen = fmt;

/**
 * Time window for a history widget. Starts at the saved length (layout "hours"); any viewer can change it
 * and zoom without saving anything. While not zoomed the window ends "now" and follows live values.
 */
export function useTimeWindow(saved) {
  const [hours, setHoursState] = useState(Number(saved) || 24);
  const [zoom, setZoom] = useState(null); // { from, to } in seconds
  useEffect(() => {
    setHoursState(Number(saved) || 24);
    setZoom(null);
  }, [saved]);
  const setHours = (h) => {
    setHoursState(h);
    setZoom(null);
  };
  const now = Date.now() / 1000;
  const win = zoom ? { ...zoom, live: false } : { from: now - hours * 3600, to: now, live: true };
  // stable key for data loading: the live window only changes when the length changes
  const key = zoom ? `z:${Math.round(zoom.from)}-${Math.round(zoom.to)}` : `h:${hours}`;
  return { hours, setHours, zoom, setZoom, win, key };
}

/** Range buttons, plus the zoomed interval with a reset link. */
export function RangePicker({ tw }) {
  const { hours, setHours, zoom, setZoom } = tw;
  return (
    <span className="range-row">
      {zoom && (
        <span className="zoom-info small">
          {fmt(zoom.from, zoom.to - zoom.from)} – {fmt(zoom.to, zoom.to - zoom.from)}
          <button type="button" className="link-btn" onClick={() => setZoom(null)}>
            Återställ
          </button>
        </span>
      )}
      <span className="range-pick" role="group" aria-label="Tidsfönster">
        {RANGES.map(([h, label]) => (
          <button key={h} type="button" className={!zoom && hours === h ? 'on' : ''} onClick={() => setHours(h)} aria-pressed={!zoom && hours === h}>
            {label}
          </button>
        ))}
        {!RANGES.some(([h]) => h === hours) && (
          <button type="button" className={!zoom ? 'on' : ''} onClick={() => setZoom(null)}>
            {hours} h
          </button>
        )}
      </span>
    </span>
  );
}

/**
 * Wraps a plot. Drag across it to zoom into that part of the window; reports the hovered time.
 * Selections narrower than 1 % of the width are ignored (a click).
 */
export function ZoomSurface({ win, onZoom, onHover, className = '', children }) {
  const ref = useRef(null);
  const [sel, setSel] = useState(null); // { a, b } as fractions 0..1
  const frac = (e) => {
    const r = ref.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const tsAt = (f) => win.from + f * (win.to - win.from);
  return (
    <div
      ref={ref}
      className={`zoom-surface ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const f = frac(e);
        setSel({ a: f, b: f });
      }}
      onPointerMove={(e) => {
        const f = frac(e);
        onHover?.(tsAt(f));
        if (sel) setSel((s) => ({ ...s, b: f }));
      }}
      onPointerUp={() => {
        if (sel && Math.abs(sel.b - sel.a) > 0.01) {
          const a = Math.min(sel.a, sel.b);
          const b = Math.max(sel.a, sel.b);
          onZoom({ from: tsAt(a), to: tsAt(b) });
        }
        setSel(null);
      }}
      onPointerLeave={() => !sel && onHover?.(null)}
      title="Dra över ett intervall för att zooma"
    >
      {children}
      {sel && <span className="zoom-sel" style={{ left: `${Math.min(sel.a, sel.b) * 100}%`, width: `${Math.abs(sel.b - sel.a) * 100}%` }} />}
    </div>
  );
}
