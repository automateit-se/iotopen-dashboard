import { useEffect, useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { toHex } from './ColorPicker.jsx';
import { INST_META, LAYOUT_FILE, LOGO_FILE, LOGO_MAX_BYTES, THEME_GROUPS, THEME_META, checkLogo, writeInstallationMeta, writeLogo } from '../lib/dashboard.js';

const validColor = (v) => !v || CSS.supports('color', v);

/** Dashboard-wide settings, stored as metadata on the installation. Empty = key removed = default. */
export function InstallationSettings({ inst, user, logo, onSaved, onClose }) {
  const m = inst.meta || {};
  const [title, setTitle] = useState(m[INST_META.title] || '');
  const [admins, setAdmins] = useState(m[INST_META.admins] || '');
  const [colors, setColors] = useState(() => Object.fromEntries(THEME_META.map((t) => [t.key, m[t.key] || ''])));
  // the colour in effect for a key: its own value, else the colour it follows (e.g. title -> primary), else the default
  const effective = (key) => {
    const t = THEME_META.find((x) => x.key === key);
    const own = (colors[key] || '').trim();
    if (own && validColor(own)) return own;
    return t?.follows ? effective(t.follows) : t?.def || '#0d3e53';
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // logo: undefined = unchanged, a File = upload on save, null = remove (back to IoT Open's)
  const [logoFile, setLogoFile] = useState(undefined);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoInfo, setLogoInfo] = useState('');
  useEffect(() => () => logoPreview && URL.revokeObjectURL(logoPreview), [logoPreview]);
  const shownLogo = logoFile === undefined ? logo : logoPreview;

  const pickLogo = async (file) => {
    if (!file) return;
    setError('');
    try {
      const { width, height } = await checkLogo(file);
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      setLogoInfo(`${file.name}: ${width} × ${height} px, ${Math.max(1, Math.round(file.size / 1024))} kB${height < 56 ? '. Lite liten, kan bli suddig på skärmar med hög upplösning.' : ''}`);
    } catch (e) {
      setError(errText(e));
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const list = admins.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      // never lock yourself out by accident
      if (list.length && !list.includes(String(user.id)) && !list.includes(String(user.email || '').toLowerCase())) {
        throw new Error(`Du finns inte själv i listan. Lägg till ${user.email || user.id} så att du kan fortsätta redigera.`);
      }
      const bad = THEME_META.find((t) => !validColor(colors[t.key].trim()));
      if (bad) throw new Error(`${bad.label}: "${colors[bad.key]}" är ingen giltig CSS-färg.`);
      await writeInstallationMeta(inst, { [INST_META.title]: title, [INST_META.admins]: admins, ...colors });
      if (logoFile !== undefined) await writeLogo(inst.id, logoFile);
      await onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Dashboard-inställningar"
      onClose={onClose}
      footer={
        <>
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
        Sparas som metadata på installationen {inst.name} ({inst.id}). Tomt fält tar bort nyckeln och ger standardvärdet. Layouten ligger i filen {LAYOUT_FILE}.
      </p>
      <Field label="Titel" help={`meta ${INST_META.title}. Tomt = installationens namn.`}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={inst.name} />
      </Field>
      <Field label="Administratörer" help={`meta ${INST_META.admins}. Användar-id eller e-post, kommaseparerat. Tomt = alla som har skrivrätt i IoT Open. Du är ${user.email || ''} (id ${user.id}).`}>
        <input value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder={`${user.email || user.id}`} />
      </Field>
      <Field
        label="Logotyp"
        help={`Fil ${LOGO_FILE} på installationen. PNG, max ${LOGO_MAX_BYTES / 1024} kB. Alla storlekar fungerar: loggan skalas till headerns höjd och behåller sina proportioner. Bäst blir en liggande logga med transparent bakgrund, ungefär 120 px hög (t.ex. 480 × 120), som syns mot headerfärgen.`}
      >
        <div className="logo-row">
          <div className="logo-preview" style={{ background: effective('dashboard.color_header') }}>
            {shownLogo ? <img src={shownLogo} alt="Vald logotyp" /> : <img src="branding/iotopen-logo-white.svg" alt="IoT Open (standard)" />}
          </div>
          <label className="btn">
            Välj PNG…
            <input type="file" accept="image/png" hidden onChange={(e) => (pickLogo(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
          {shownLogo && (
            <button type="button" className="btn" onClick={() => (setLogoFile(null), setLogoPreview(null), setLogoInfo('Standardloggan (IoT Open) används efter Spara.'))}>
              Återställ till IoT Open
            </button>
          )}
        </div>
        {logoInfo && <div className="muted small">{logoInfo}</div>}
      </Field>
      {THEME_GROUPS.map((group) => (
        <div key={group}>
          <h3>Färger – {group.toLowerCase()}</h3>
          <div className="color-grid">
        {THEME_META.filter((t) => t.group === group).map((t) => {
          const v = colors[t.key];
          const ok = validColor(v.trim());
          return (
            <Field key={t.key} label={t.label} help={`${t.key} · ${t.help}`}>
              <div className="row gap">
                <input
                  type="color"
                  className="color-swatch"
                  value={toHex(effective(t.key))}
                  onChange={(e) => setColors((c) => ({ ...c, [t.key]: e.target.value }))}
                  aria-label={`Välj ${t.label}`}
                />
                <input value={v} onChange={(e) => setColors((c) => ({ ...c, [t.key]: e.target.value }))} placeholder={`${effective(t.key)} (standard)`} aria-invalid={!ok} />
                {v && (
                  <button type="button" className="icon-btn" onClick={() => setColors((c) => ({ ...c, [t.key]: '' }))} title="Återställ till standard" aria-label={`Återställ ${t.label}`}>
                    ×
                  </button>
                )}
              </div>
            </Field>
          );
        })}
          </div>
        </div>
      ))}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
