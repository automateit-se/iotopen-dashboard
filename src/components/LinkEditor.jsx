import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { DEFAULT_LAYOUT, WIDTH_OPTIONS, heightOptions, safeUrl } from '../lib/dashboard.js';

/**
 * Creates or edits a link button (www): a button that takes the viewer to another web page, or to another page
 * of this dashboard. It has no IoT Open object behind it, so everything is stored in the layout file under "u:<n>".
 */
export function LinkEditor({ entry, pages = [], onSave, onRemove, onClose }) {
  const isNew = !entry;
  const base = { ...DEFAULT_LAYOUT.www, ...(entry || {}) };
  const [url, setUrl] = useState(base.url || '');
  // where it goes: a web address, or a page of the dashboard (only offered when there are several)
  const [toPage, setToPage] = useState(!!base.target_page);
  const [target, setTarget] = useState(base.target_page || pages[1]?.id || pages[0]?.id || '');
  const [label, setLabel] = useState(base.label || '');
  const [newTab, setNewTab] = useState(base.newTab !== false);
  const [color, setColor] = useState(base.color || '');
  const [icon, setIcon] = useState(base.icon || (base.target_page ? 'home' : 'link'));
  const [w, setW] = useState(base.w);
  const [h, setH] = useState(base.h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checked = safeUrl(url);

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
      const common = { label: label.trim(), color: color.trim(), w: Number(w), h: Number(h) };
      if (toPage) {
        if (!pages.some((p) => p.id === target)) throw new Error('Välj en sida.');
        return onSave({ ...common, target_page: target, url: '', newTab: false, icon: icon === 'home' ? '' : icon });
      }
      if (!checked) throw new Error('Ange en webbadress som börjar med http:// eller https://');
      await onSave({ ...common, url: checked, target_page: '', newTab, icon: icon === 'link' ? '' : icon });
    });

  return (
    <Modal
      title={isNew ? 'Ny länkknapp (www)' : 'Redigera länkknapp'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={() => run(onRemove)} disabled={busy}>
              Ta bort länkknappen
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
      <p className="muted small">En knapp som tar användaren vidare till en annan webbsida eller till en annan sida i dashboarden. Sparas i layoutfilen, inte på någon enhet eller funktion.</p>
      {pages.length > 1 && (
        <Field label="Knappen går till">
          <div className="seg">
            <button type="button" className={!toPage ? 'on' : ''} onClick={() => (setToPage(false), icon === 'home' && setIcon('link'))}>
              Webbadress
            </button>
            <button type="button" className={toPage ? 'on' : ''} onClick={() => (setToPage(true), icon === 'link' && setIcon('home'))}>
              Sida i dashboarden
            </button>
          </div>
        </Field>
      )}
      {toPage && pages.length > 1 ? (
        <Field label="Sida">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Webbadress" help={url && !checked ? 'Bara http:// och https:// fungerar.' : 'T.ex. https://www.smhi.se'}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" spellCheck={false} aria-invalid={!!url && !checked} autoFocus />
        </Field>
      )}
      <Field label="Text på knappen" help={`Tomt = ${toPage ? 'sidans namn' : checked ? new URL(checked).host : 'webbadressens domän'}`}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={toPage ? pages.find((p) => p.id === target)?.title || '' : checked ? new URL(checked).host : ''} />
      </Field>
      {!toPage && (
        <label className="check visible-check">
          <input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} />
          <span>Öppna i en ny flik</span>
        </label>
      )}
      <Field label="Färg" help="Tomt = temats widgetfärg.">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Field label="Ikon">
        <div className="icon-pick">
          {ICON_NAMES.map((n) => (
            <button key={n} type="button" className={icon === n ? 'on' : ''} onClick={() => setIcon(n)} title={n}>
              <Icon name={n} size={18} />
            </button>
          ))}
        </div>
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
            {heightOptions('www').map(([n, l]) => (
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
