import { TEXT_SIZES } from '../../lib/dashboard.js';

/** Style of a text widget's text from its layout entry: size, bold and italic. */
export function textClass(l) {
  const size = TEXT_SIZES.some(([s]) => s === l.size) ? l.size : 'm';
  return `w-text size-${size} ${l.bold ? 'bold' : ''} ${l.italic ? 'italic' : ''}`;
}

/** A note about the dashboard. Plain text with its line breaks, never HTML. */
export function TextWidget({ w }) {
  const text = String(w.layout.text ?? '');
  if (!text.trim()) return <div className="muted small">Ingen text ännu.</div>;
  return <div className={textClass(w.layout)}>{text}</div>;
}
