import { useEffect, useRef, useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { lynx } from '../api/lynx.js';
import { prepareBackground } from '../lib/background.js';
import { DEFAULT_LAYOUT, WIDTH_OPTIONS, heightOptions } from '../lib/dashboard.js';
import { LOCAL_PREFIX, displayName, findImage, imageFiles, imageUrl, uploadName } from '../lib/images.js';

const kb = (n) => (Number(n) > 0 ? `${Math.max(1, Math.round(Number(n) / 1024))} kB` : '');

/**
 * Creates or edits an image widget: one of the installation's image files (or a new one uploaded here), shown
 * within the widget. Stored in the layout file under "b:<n>": the file's name (so replacing the file in IoT Open
 * keeps the widget), its id as a fallback, a label and how the image fits.
 */
export function ImageEditor({ iid, entry, onSave, onRemove, onClose }) {
  const isNew = !entry;
  const base = { ...DEFAULT_LAYOUT.image, ...(entry || {}) };
  const [files, setFiles] = useState(null);
  const [selected, setSelected] = useState(null); // a file
  const [preview, setPreview] = useState(null);
  const [label, setLabel] = useState(base.label || '');
  const [fit, setFit] = useState(base.fit === 'cover' ? 'cover' : 'contain');
  const [w, setW] = useState(base.w);
  const [h, setH] = useState(base.h);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const load = () =>
    lynx.files(iid).then((all) => {
      const list = imageFiles(all || []);
      setFiles(list);
      setSelected((cur) => cur || findImage(list, entry) || null);
      return list;
    });
  useEffect(() => {
    load().catch((e) => setError(e.status === 403 ? 'Ditt konto får inte läsa installationens filer.' : errText(e)));
  }, [iid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selected) return setPreview(null);
    let alive = true;
    imageUrl(selected)
      .then((u) => alive && setPreview(u))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [selected]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = (file) =>
    run(async () => {
      if (!file) return;
      // made smaller and saved as JPEG, like a background image; "dashboard-image-*" is kept by the local dashboard
      const { blob } = await prepareBackground(file);
      const name = uploadName(file.name);
      const same = (files || []).find((f) => f.name === name);
      if (same) await lynx.replaceFile(iid, same.id, blob, name);
      else await lynx.uploadFile(iid, blob, name);
      const list = await load();
      // the uploaded image is the one to show
      setSelected(list.find((f) => f.name === name) || null);
      if (input.current) input.current.value = '';
    });
  const save = () =>
    run(async () => {
      if (!selected) throw new Error('Välj en bild.');
      await onSave({ type: 'image', file: selected.name, fileId: selected.id, label: label.trim(), fit, w: Number(w), h: Number(h) });
    });

  const needle = q.trim().toLowerCase();
  const shown = (files || []).filter((f) => !needle || String(f.name).toLowerCase().includes(needle));

  return (
    <Modal
      title={isNew ? 'Ny bildwidget' : 'Redigera bildwidget'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={() => run(onRemove)} disabled={busy}>
              Ta bort bildwidgeten
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Avbryt
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy || !selected}>
            {busy ? 'Sparar…' : 'Spara'}
          </button>
        </>
      }
    >
      {/* a group of controls, not one labelled field (a <label> around buttons would forward clicks) */}
      <div className="field" role="group" aria-labelledby="image-pick-label">
        <span id="image-pick-label">Bild</span>
        {files === null ? (
          <div className="muted small">Läser installationens filer…</div>
        ) : (
          <>
            {files.length > 6 && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök bild…" aria-label="Sök bild" />}
            <ul className="image-pick" role="listbox" aria-label="Bilder">
              {shown.map((f) => (
                <li key={f.id}>
                  <button type="button" role="option" aria-selected={selected?.id === f.id} className={selected?.id === f.id ? 'on' : ''} onClick={() => setSelected(f)}>
                    <span className="grow">{displayName(f.name)}</span>
                    <span className="muted small">{kb(f.size)}</span>
                  </button>
                </li>
              ))}
              {!shown.length && <li className="muted small">{files.length ? 'Ingen bild matchar sökningen.' : 'Installationen har inga bilder ännu.'}</li>}
            </ul>
          </>
        )}
        <div className="row gap">
          <button type="button" className="btn small-btn" onClick={() => input.current?.click()} disabled={busy}>
            Ladda upp bild…
          </button>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        <small className="muted">Installationens bildfiler i IoT Open. En bild som laddas upp här sparas som {LOCAL_PREFIX}…, och sådana visas även i lokal dashboard utan internet.</small>
      </div>
      {preview && (
        <div className={`image-preview fit-${fit}`}>
          <img src={preview} alt={displayName(selected?.name)} />
        </div>
      )}
      <Field label="Rubrik" help="Tomt = ingen rubrik, bara bilden.">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={selected ? displayName(selected.name) : ''} />
      </Field>
      <Field label="Visning">
        <div className="seg">
          {[
            ['contain', 'Hela bilden'],
            ['cover', 'Fyll widgeten'],
          ].map(([v, l]) => (
            <button key={v} type="button" className={fit === v ? 'on' : ''} onClick={() => setFit(v)} title={v === 'contain' ? 'Hela bilden syns, med tom yta runt om den inte har samma form som widgeten' : 'Bilden fyller widgeten och beskärs i kanterna'}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      <div className="row gap">
        <Field label="Bredd">
          <select value={w} onChange={(e) => setW(e.target.value)}>
            {WIDTH_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Höjd">
          <select value={h} onChange={(e) => setH(e.target.value)}>
            {heightOptions('image').map(([v, l]) => (
              <option key={v} value={v}>
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
