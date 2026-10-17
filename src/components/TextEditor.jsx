import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { textClass } from './widgets/Text.jsx';
import { DEFAULT_LAYOUT, WIDTH_OPTIONS, TEXT_SIZES, MAX_NOTE, heightOptions } from '../lib/dashboard.js';

/**
 * Creates or edits a text widget: a note about the dashboard, e.g. what is relevant right now. It has no
 * IoT Open object behind it, so everything is stored in the layout file under "n:<n>".
 */
export function TextEditor({ entry, onSave, onRemove, onClose }) {
  const isNew = !entry;
  const base = { ...DEFAULT_LAYOUT.text, ...(entry || {}) };
  const [text, setText] = useState(base.text || '');
  const [label, setLabel] = useState(base.label || '');
  const [size, setSize] = useState(TEXT_SIZES.some(([s]) => s === base.size) ? base.size : 'm');
  const [bold, setBold] = useState(!!base.bold);
  const [italic, setItalic] = useState(!!base.italic);
  const [color, setColor] = useState(base.color || '');
  const [w, setW] = useState(base.w);
  const [h, setH] = useState(base.h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!text.trim()) throw new Error('Skriv en text.');
      await onSave({ type: 'text', text: text.slice(0, MAX_NOTE), label: label.trim(), size, bold, italic, color: color.trim(), w: Number(w), h: Number(h) });
    });

  return (
    <Modal
      title={isNew ? 'Ny textwidget' : 'Redigera textwidget'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={() => run(onRemove)} disabled={busy}>
              Ta bort textwidgeten
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Avbryt
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Sparar…' : 'Spara'}
          </button>
        </>
      }
    >
      <p className="muted small">En text om dashboarden, t.ex. vad som är aktuellt just nu. Sparas i layoutfilen, inte på någon enhet eller funktion.</p>
      <Field label="Rubrik" help="Tomt = ingen rubrik, bara texten.">
        <input value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Text" help={`Radbrytningar behålls. Högst ${MAX_NOTE} tecken (${text.length}).`}>
        <textarea rows={5} value={text} maxLength={MAX_NOTE} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <Field label="Textstorlek">
        <div className="seg">
          {TEXT_SIZES.map(([s, l]) => (
            <button key={s} type="button" className={size === s ? 'on' : ''} onClick={() => setSize(s)} aria-pressed={size === s}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Stil">
        <div className="seg">
          <button type="button" className={bold ? 'on' : ''} onClick={() => setBold(!bold)} aria-pressed={bold}>
            <b>Fet</b>
          </button>
          <button type="button" className={italic ? 'on' : ''} onClick={() => setItalic(!italic)} aria-pressed={italic}>
            <i>Kursiv</i>
          </button>
        </div>
      </Field>
      {text.trim() && (
        <Field label="Förhandsvisning">
          <div className="text-preview">
            <div className={textClass({ size, bold, italic })}>{text}</div>
          </div>
        </Field>
      )}
      <Field label="Färg" help="Tomt = temats widgetfärg.">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <div className="row gap">
        <Field label="Bredd (av 8)">
          <select value={w} onChange={(e) => setW(e.target.value)}>
            {WIDTH_OPTIONS.map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Höjd (rader)">
          <select value={h} onChange={(e) => setH(e.target.value)}>
            {heightOptions('text').map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
