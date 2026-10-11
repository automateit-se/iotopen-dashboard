// first the graphic profile (turquoise, dark blue, warm yellow, light blue), then clear status colours
export const PALETTE = ['', '#1bb2bc', '#0d3e53', '#f6a53e', '#b4dbea', '#2563eb', '#7c3aed', '#dc2626', '#16a34a', '#475569'];

/** Any CSS colour -> "#rrggbb" for <input type="color"> (which only accepts that form). */
export function toHex(color) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color; // invalid colours leave the previous value
  const v = ctx.fillStyle; // "#rrggbb" or "rgba(…)"
  if (v.startsWith('#')) return v;
  const m = v.match(/\d+(\.\d+)?/g) || [0, 0, 0];
  return '#' + m.slice(0, 3).map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
}

/** Palette swatches + free colour picker + text field. '' = standard (the theme's widget colour). */
export function ColorPicker({ value, onChange }) {
  return (
    <div className="row wrap gap">
      {PALETTE.map((c) => (
        <button key={c || 'none'} type="button" className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c || 'var(--surface-2)' }} onClick={() => onChange(c)} aria-label={c || 'Standard'} title={c || 'Standard (temats widgetfärg)'}>
          {!c && '–'}
        </button>
      ))}
      <input type="color" className="color-swatch" value={toHex(value || '#0d3e53')} onChange={(e) => onChange(e.target.value)} aria-label="Välj valfri färg" title="Valfri färg" />
      <input className="color-text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="standard" />
    </div>
  );
}

/** Small colour dot for one row/line inside a group widget. Empty = follows the widget/palette. */
export function SeriesColor({ value, fallback, onChange, label }) {
  return (
    <span className="series-color">
      <input type="color" value={toHex(value || fallback)} onChange={(e) => onChange(e.target.value)} aria-label={`Färg för ${label}`} title={value ? `Egen färg ${value}` : 'Standardfärg – klicka för att välja'} className={value ? 'set' : ''} />
      {value && (
        <button type="button" className="icon-btn" onClick={() => onChange('')} title="Tillbaka till standardfärgen" aria-label={`Återställ färg för ${label}`}>
          ×
        </button>
      )}
    </span>
  );
}
