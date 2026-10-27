import { useEffect, useState } from 'react';
import { appUrl, config } from '../api/config.js';
import { getToken, setToken } from '../api/lynx.js';
import { useApp } from '../context/AppContext.jsx';
import { Modal, Field } from './Modal.jsx';
import { Icon } from './icons.jsx';

// /local/status of the edge app, read every 30 s while anything shows it (header, footer, live badge): one
// request for all of them.
const STATUS_MS = 30000;
const statusStore = { value: null, listeners: new Set(), timer: null };

function readStatus() {
  fetch(appUrl('local/status'), { headers: getToken() ? { 'X-API-Key': getToken() } : {}, cache: 'no-store' })
    .then((r) => r.json())
    .catch(() => ({ ...(statusStore.value || {}), app: false }))
    .then((s) => {
      statusStore.value = s;
      statusStore.listeners.forEach((fn) => fn(s));
    });
}

/** { cloud, session, app, … } of the local edge app; null until read, and outside local mode. */
export function useLocalStatus() {
  const [status, setStatus] = useState(statusStore.value);
  useEffect(() => {
    if (!config.local) return;
    statusStore.listeners.add(setStatus);
    if (!statusStore.timer) {
      readStatus();
      statusStore.timer = setInterval(readStatus, STATUS_MS);
    }
    return () => {
      statusStore.listeners.delete(setStatus);
      if (!statusStore.listeners.size) {
        clearInterval(statusStore.timer);
        statusStore.timer = null;
      }
    };
  }, []);
  return status;
}

/** Local mode, PIN for control: unlock with the app's PIN, lock again. */
export function PinButton({ status }) {
  const { signInLocal } = useApp();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (config.local?.access !== 'pin' || !config.local?.control) return null;
  const unlocked = !!status?.session;
  if (unlocked) {
    return (
      <button
        type="button"
        className="icon-btn"
        title="Styrning upplåst - klicka för att låsa"
        aria-label="Lås styrningen"
        onClick={() => {
          setToken(null);
          window.location.reload();
        }}
      >
        <Icon name="lock" size={18} />
      </button>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInLocal(pin);
    } catch (err) {
      setError(err.status === 401 ? 'Fel PIN-kod.' : err.message);
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="btn small-btn topbar-btn" onClick={() => setOpen(true)} title="Ange PIN-kod för att kunna styra">
        <Icon name="lock" size={14} /> Lås upp
      </button>
      {open && (
        <Modal title="Lås upp styrning" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="PIN-kod" help="PIN-koden som är satt på appen Lokal dashboard. Styrningen är sedan upplåst i den här webbläsaren i 12 timmar.">
              <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus required />
            </Field>
            {error && <div className="error-box">{error}</div>}
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Kontrollerar…' : 'Lås upp'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

/** One line about the connection to IoT Open, in the footer. */
export function CloudState({ status }) {
  if (!status) return null;
  if (status.app === false) return <span className="local-state warn">Den lokala appen svarar inte</span>;
  if (status.cloud === false) return <span className="local-state warn">IoT Open nås inte - visar sparad data</span>;
  return <span className="local-state">Lokal · IoT Open ansluten</span>;
}
