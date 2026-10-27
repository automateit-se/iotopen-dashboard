import { useEffect, useRef, useState } from 'react';
import { formatAge, formatValue } from '../../lib/format.js';
import { fnName, rangeOf, writeTopic } from '../../lib/dashboard.js';
import { actionText, modeText, stepSetpoint, thermostatFunctions, thermostatModes } from '../../lib/thermostat.js';
import { Icon } from '../icons.jsx';

const SEND_DELAY = 800; // ms after the last − / + press, so a few presses give one command
const PENDING_TIMEOUT = 8000; // back to the reported setpoint if the thermostat does not answer

/** A text value (mode, action): the value when it is text, else the msg. IoT Open's status API can return 0 for text. */
const textOf = (v) => {
  if (!v) return '';
  const s = typeof v.value === 'string' && !Number.isFinite(Number(v.value)) ? v.value : v.msg;
  return String(s || '').trim();
};

const num = (v) => (v && v.value !== '' && v.value !== null && Number.isFinite(Number(v.value)) ? Number(v.value) : NaN);

/**
 * Thermostat: current temperature, setpoint with − / +, mode buttons and what it is doing (heating, idle …).
 * Only the parts whose functions the device has are shown.
 */
export function ThermostatWidget({ w, ctx }) {
  const t = thermostatFunctions(ctx.raw, w.obj.id);
  const curV = t.current ? ctx.valueOf(t.current) : null;
  const tgtV = t.target ? ctx.valueOf(t.target) : null;
  const modeV = t.mode ? ctx.valueOf(t.mode) : null;
  const actV = t.action ? ctx.valueOf(t.action) : null;
  // without min/max 5-30, without step 0.5 (rangeOf defaults the step to 1, too coarse for a thermostat)
  const r = t.target && rangeOf(t.target);
  const range = r ? { ...r, step: Number(t.target.meta?.step) > 0 ? r.step : 0.5 } : { min: 5, max: 30, step: 0.5 };
  const tgtWrite = t.target ? writeTopic(t.target) : '';
  const modeWrite = t.mode ? writeTopic(t.mode) : '';
  const [draft, setDraft] = useState(null); // setpoint shown while pressing / waiting for the thermostat
  const [pendingMode, setPendingMode] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const reported = num(tgtV);

  useEffect(() => setDraft(null), [tgtV?.timestamp, tgtV?.value]);
  useEffect(() => setPendingMode(null), [modeV?.timestamp, modeV?.value, modeV?.msg]);
  useEffect(() => {
    if (pendingMode === null) return;
    const id = setTimeout(() => setPendingMode(null), PENDING_TIMEOUT);
    return () => clearTimeout(id);
  }, [pendingMode]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!t.target && !t.mode) return <div className="muted small">Enheten har ingen funktion för börvärde eller läge (topic …/target eller …/mode).</div>;

  const mode = pendingMode ?? textOf(modeV);
  const off = mode.toLowerCase() === 'off';
  const modes = thermostatModes(t.mode);
  if (mode && !modes.includes(mode.toLowerCase()) && !modes.includes(mode)) modes.push(mode);
  const action = textOf(actV);
  const shown = draft ?? reported;
  const unitFn = t.target || t.current;
  const lastTs = Math.max(curV?.timestamp || 0, tgtV?.timestamp || 0, modeV?.timestamp || 0);

  const press = (steps) => {
    if (!tgtWrite) return setErr('Börvärdet saknar topic_write');
    const next = stepSetpoint(Number.isFinite(shown) ? shown : NaN, steps, range);
    setDraft(next);
    setErr('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!ctx.publish(tgtWrite, next)) {
        setErr('Ingen MQTT-anslutning');
        setDraft(null);
        return;
      }
      // waiting for the thermostat; the reported value replaces the draft, or the timeout does
      timer.current = setTimeout(() => setDraft(null), PENDING_TIMEOUT);
    }, SEND_DELAY);
  };
  const setMode = (m) => {
    if (!modeWrite) return setErr('Läget saknar topic_write');
    if (!ctx.publish(modeWrite, m)) return setErr('Ingen MQTT-anslutning');
    setErr('');
    setPendingMode(m);
  };
  const fmt = (fn, v) => (Number.isFinite(v) ? formatValue(fn, v) : '–');

  return (
    <div className={`thermo ${off ? 'is-off' : ''} ${action ? `act-${action.toLowerCase()}` : ''}`}>
      <div className="thermo-main">
        {t.current && (
          <div className="thermo-cur">
            <span className="thermo-cur-val">{fmt(t.current, num(curV))}</span>
            <span className="muted small">Nu</span>
          </div>
        )}
        {t.target && (
          <div className="thermo-set">
            <button type="button" className="media-btn" aria-label="Sänk börvärdet" disabled={!tgtWrite || off} onClick={() => press(-1)}>
              <Icon name="minus" size={18} />
            </button>
            <div className={`thermo-set-val ${draft !== null ? 'pending' : ''}`} title={fnName(t.target)}>
              <span>{off ? 'Av' : fmt(unitFn, shown)}</span>
              <span className="muted small">Börvärde</span>
            </div>
            <button type="button" className="media-btn" aria-label="Höj börvärdet" disabled={!tgtWrite || off} onClick={() => press(1)}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}
      </div>
      {t.mode && modes.length > 0 && (
        <div className="thermo-modes seg" role="group" aria-label="Läge">
          {modes.map((m) => (
            <button key={m} type="button" className={m.toLowerCase() === mode.toLowerCase() ? 'on' : ''} aria-pressed={m.toLowerCase() === mode.toLowerCase()} disabled={!modeWrite} onClick={() => setMode(m)}>
              {modeText(m)}
            </button>
          ))}
        </div>
      )}
      <div className="muted small thermo-status">
        {[t.mode && !modes.length && mode ? modeText(mode) : '', action ? actionText(action) : '', lastTs ? formatAge(lastTs) : ''].filter(Boolean).join(' · ')}
      </div>
      {err && <div className="err small">{err}</div>}
    </div>
  );
}
