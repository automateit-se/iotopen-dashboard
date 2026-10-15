import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { toHex } from './ColorPicker.jsx';
import { THEME_META } from '../lib/dashboard.js';

// the colours a page can have of its own; the rest always follow the installation
const PAGE_COLORS = THEME_META.filter((t) => t.group === 'Grundfärger');
const validColor = (v) => !v || (typeof CSS !== 'undefined' && CSS.supports('color', v));

/** Tabs for the dashboard's pages; in edit mode also new page, edit and move the current one. */
export function PageTabs({ iid, pages, current, editing, onAdd, onEdit, onMove }) {
  const i = pages.findIndex((p) => p.id === current);
  return (
    <nav className="page-tabs" aria-label="Sidor">
      <div className="page-tab-list">
        {pages.map((p, n) => (
          <a key={p.id} href={n === 0 ? `#/i/${iid}` : `#/i/${iid}/p/${encodeURIComponent(p.id)}`} className={`page-tab ${p.id === current ? 'on' : ''}`} aria-current={p.id === current ? 'page' : undefined}>
            {p.icon && <Icon name={p.icon} size={15} />}
            <span>{p.title}</span>
          </a>
        ))}
      </div>
      {editing && (
        <div className="page-tab-tools">
          {pages.length > 1 && (
            <>
              <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={i <= 0} aria-label="Flytta sidan åt vänster" title="Flytta sidan åt vänster">
                <Icon name="back" size={16} />
              </button>
              <button type="button" className="icon-btn flip" onClick={() => onMove(1)} disabled={i >= pages.length - 1} aria-label="Flytta sidan åt höger" title="Flytta sidan åt höger">
                <Icon name="back" size={16} />
              </button>
            </>
          )}
          <button type="button" className="icon-btn" onClick={onEdit} aria-label="Redigera sidan" title="Namn, ikon och färger för sidan">
            <Icon name="settings" size={16} />
          </button>
          <button type="button" className="btn small-btn" onClick={onAdd}>
            <Icon name="plus" size={14} /> Ny sida
          </button>
        </div>
      )}
    </nav>
  );
}

/** Creates or edits a page: title, icon and own colours (stored in the layout file). */
export function PageEditor({ page, canRemove, onSave, onRemove, onClose }) {
  const isNew = !page;
  const [title, setTitle] = useState(page?.title || '');
  const [icon, setIcon] = useState(page?.icon || '');
  const [colors, setColors] = useState(() => Object.fromEntries(PAGE_COLORS.map((t) => [t.key, page?.theme?.[t.key] || ''])));
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
      if (!title.trim()) throw new Error('Ge sidan ett namn.');
      const bad = PAGE_COLORS.find((t) => !validColor(colors[t.key].trim()));
      if (bad) throw new Error(`${bad.label}: ogiltig färg.`);
      const theme = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await onSave({ title: title.trim(), ...(icon ? { icon } : { icon: undefined }), theme });
    });

  return (
    <Modal
      title={isNew ? 'Ny sida' : 'Redigera sida'}
      onClose={onClose}
      footer={
        <>
          {!isNew && canRemove && (
            <button type="button" className="btn danger" onClick={() => run(onRemove)} disabled={busy}>
              Ta bort sidan
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
      <p className="muted small">
        En sida är en egen vy av dashboarden, t.ex. Energi eller Omsorg, med egna widgets och färger. Sidorna visas som flikar och sparas i layoutfilen.
        {!isNew && canRemove && ' Tar du bort sidan flyttas dess widgets till den första sidan.'}
      </p>
      <Field label="Namn">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Energi" autoFocus />
      </Field>
      <Field label="Ikon">
        <div className="icon-pick">
          <button type="button" className={!icon ? 'on' : ''} onClick={() => setIcon('')} title="Ingen">
            –
          </button>
          {ICON_NAMES.map((n) => (
            <button key={n} type="button" className={icon === n ? 'on' : ''} onClick={() => setIcon(n)} title={n}>
              <Icon name={n} size={18} />
            </button>
          ))}
        </div>
      </Field>
      <h3>Egna färger</h3>
      <p className="muted small">Tomt = installationens färg (Inställningar).</p>
      <div className="color-grid">
        {PAGE_COLORS.map((t) => {
          const v = colors[t.key];
          return (
            <Field key={t.key} label={t.label} help={t.help}>
              <div className="row gap">
                <input type="color" className="color-swatch" value={toHex(v || t.def)} onChange={(e) => setColors((c) => ({ ...c, [t.key]: e.target.value }))} aria-label={`Välj ${t.label}`} />
                <input value={v} onChange={(e) => setColors((c) => ({ ...c, [t.key]: e.target.value }))} placeholder="installationens" aria-invalid={!validColor(v.trim())} />
                {v && (
                  <button type="button" className="icon-btn" onClick={() => setColors((c) => ({ ...c, [t.key]: '' }))} title="Tillbaka till installationens färg" aria-label={`Återställ ${t.label}`}>
                    ×
                  </button>
                )}
              </div>
            </Field>
          );
        })}
      </div>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
