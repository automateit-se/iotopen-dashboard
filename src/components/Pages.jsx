import { useEffect, useRef, useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { toHex } from './ColorPicker.jsx';
import { THEME_META } from '../lib/dashboard.js';
import { BG_DEFAULTS, DIM_RANGE, OPACITY_RANGE, backgroundOf, prepareBackground, suggestDim } from '../lib/background.js';

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

/**
 * Creates or edits a page: title, icon, own colours and a background image (stored in the layout file and, for
 * the image, a file on the installation). onSave(values, image): image undefined = unchanged, a Blob = new, null = removed.
 */
export function PageEditor({ page, bgUrl, canRemove, onSave, onRemove, onClose }) {
  const isNew = !page;
  const [title, setTitle] = useState(page?.title || '');
  const [icon, setIcon] = useState(page?.icon || '');
  const [colors, setColors] = useState(() => Object.fromEntries(PAGE_COLORS.map((t) => [t.key, page?.theme?.[t.key] || ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // background: the picked image (undefined = the page's current one, null = none) and how it is shown
  const [image, setImage] = useState(undefined); // { blob, url, luminance, width, height } | null
  const [bg, setBg] = useState(() => backgroundOf(page) || BG_DEFAULTS);
  const [preparing, setPreparing] = useState(false);
  const fileInput = useRef(null);
  const shownUrl = image === undefined ? (backgroundOf(page) ? bgUrl : null) : image?.url || null;
  useEffect(() => () => image?.url && URL.revokeObjectURL(image.url), [image]);

  const pick = async (file) => {
    if (!file) return;
    setPreparing(true);
    setError('');
    try {
      const p = await prepareBackground(file);
      setImage({ ...p, url: URL.createObjectURL(p.blob) });
      // a suggestion from the image's brightness; can be changed with the slider
      setBg((b) => ({ ...b, dim: suggestDim(p.luminance) }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setPreparing(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

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
      const hasImage = image === undefined ? !!backgroundOf(page) : !!image;
      await onSave({ title: title.trim(), ...(icon ? { icon } : { icon: undefined }), theme, background: hasImage ? bg : undefined }, image === undefined ? undefined : image?.blob || null);
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
          <button type="button" className="btn primary" onClick={save} disabled={busy || preparing}>
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
      <h3>Bakgrundsbild</h3>
      <p className="muted small">
        En bild bakom sidans widgets, som då blir halvgenomskinliga. Bilden görs mindre (högst 1920 px bred) och sparas som en fil på installationen. Ingen bild = sidan ser ut som vanligt.
      </p>
      <div className="row gap wrap">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy || preparing}>
          {preparing ? 'Förbereder bilden…' : shownUrl ? 'Byt bild' : 'Välj bild'}
        </button>
        {shownUrl && (
          <button type="button" className="btn danger" onClick={() => setImage(null)} disabled={busy || preparing}>
            Ta bort bilden
          </button>
        )}
        {image && <span className="muted small">{`${image.width} × ${image.height} px, ${Math.round(image.blob.size / 1024)} kB`}</span>}
      </div>
      {shownUrl && (
        <>
          <div
            className={`bg-preview ${bg.glass ? 'frost' : ''}`}
            style={{ backgroundImage: `url("${shownUrl}")`, '--bg-dim': bg.dim / 100, '--glass-alpha': bg.opacity / 100 }}
            aria-label="Förhandsvisning"
          >
            <div className="bg-sample">
              <div className="sum-num">1 234 kWh</div>
              <div className="sum-label">Denna månad</div>
            </div>
          </div>
          <Field label="Mörkläggning" help={image ? 'Föreslagen utifrån bildens ljusstyrka, så att vit text går att läsa.' : 'Ett mörkt lager över bilden så att vit text går att läsa.'}>
            <div className="range-row">
              <input type="range" min={DIM_RANGE[0]} max={DIM_RANGE[1]} step="5" value={bg.dim} onChange={(e) => setBg((b) => ({ ...b, dim: Number(e.target.value) }))} />
              <output>{bg.dim} %</output>
            </div>
          </Field>
          <Field label="Widgetarnas täckning" help="Lägre = mer av bilden syns genom widgetarna.">
            <div className="range-row">
              <input type="range" min={OPACITY_RANGE[0]} max={OPACITY_RANGE[1]} step="5" value={bg.opacity} onChange={(e) => setBg((b) => ({ ...b, opacity: Number(e.target.value) }))} />
              <output>{bg.opacity} %</output>
            </div>
          </Field>
          <label className="check">
            <input type="checkbox" checked={bg.glass} onChange={(e) => setBg((b) => ({ ...b, glass: e.target.checked }))} />
            <span>Glaseffekt: bilden blir suddig bakom widgetarna</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={bg.blur} onChange={(e) => setBg((b) => ({ ...b, blur: e.target.checked }))} />
            <span>Gör hela bilden suddig</span>
          </label>
        </>
      )}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
