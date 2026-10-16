import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { ColorPicker, SeriesColor } from './ColorPicker.jsx';
import { DEFAULT_LAYOUT, WIDTH_OPTIONS, heightOptions } from '../lib/dashboard.js';
import { normTopic } from '../api/lynx.js';
import { MQTT_MODES, MAX_LOG_ROWS, checkTopic, isWildcard, prettyPayload } from '../lib/mqttWidget.js';

// a log or a table needs room: the size a new widget gets when that mode is picked
const MODE_SIZE = { value: { w: 2, h: 1 }, json: { w: 4, h: 2 }, log: { w: 4, h: 2 }, table: { w: 4, h: 2 } };

/**
 * Creates or edits an MQTT widget: shows what arrives on a topic of the installation, also topics that have no
 * function in IoT Open. Read only. Stored in the layout file under "m:<n>".
 */
export function MqttEditor({ entry, raw, mqtt, onSave, onRemove, onClose }) {
  const isNew = !entry;
  const base = { ...DEFAULT_LAYOUT.mqtt, ...(entry || {}) };
  const [topic, setTopic] = useState(base.topic || '');
  const [mode, setMode] = useState(base.mode || 'value');
  const [path, setPath] = useState(base.path || '');
  const [unit, setUnit] = useState(base.unit || '');
  const [decimals, setDecimals] = useState(base.decimals ?? '');
  const [rows, setRows] = useState(base.rows || 10);
  const [states, setStates] = useState(Array.isArray(base.states) ? base.states.map((s) => ({ value: String(s.value ?? ''), text: String(s.text ?? ''), color: String(s.color ?? '') })) : []);
  const [label, setLabel] = useState(base.label || '');
  const [color, setColor] = useState(base.color || '');
  const [icon, setIcon] = useState(base.icon || 'signal');
  const [w, setW] = useState(base.w);
  const [h, setH] = useState(base.h);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const checked = checkTopic(topic);
  const latest = checked.topic ? mqtt.newest(checked.topic) : null;
  // the installation's own topics as suggestions
  const known = [...new Set((raw?.functions || []).map((f) => normTopic(f.meta?.topic_read)).filter(Boolean))].sort();
  const setState = (i, patch) => setStates((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pickMode = (m) => {
    setMode(m);
    if (isNew) {
      setW(MODE_SIZE[m].w);
      setH(MODE_SIZE[m].h);
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (!checked.topic) throw new Error(checked.error);
      const d = String(decimals).trim();
      if (d !== '' && !(Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 6)) throw new Error('Decimaler ska vara ett heltal 0-6.');
      const keep = states.map((s) => ({ value: s.value.trim(), text: s.text.trim(), color: s.color.trim() })).filter((s) => s.value);
      await onSave({
        type: 'mqtt',
        topic: checked.topic,
        mode,
        path: path.trim(),
        unit: unit.trim(),
        decimals: d === '' ? '' : Number(d),
        rows: mode === 'log' ? Math.min(MAX_LOG_ROWS, Math.max(1, Number(rows) || 10)) : '',
        states: keep.length && mode !== 'json' ? keep : '',
        label: label.trim(),
        color: color.trim(),
        icon: icon === 'signal' ? '' : icon,
        w: Number(w),
        h: Number(h),
      });
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onRemove();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Ny MQTT-widget' : 'Redigera MQTT-widget'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>
              Ta bort widgeten
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
        Visar det som kommer på en topic i installationen, även topics som inte har någon funktion i IoT Open. Widgeten bara läser, den skickar aldrig något. Den sparas i layoutfilen och IoT Open avgör vad inloggningen får läsa.
      </p>
      <Field label="Topic" help={topic && !checked.topic ? checked.error : 'Utan client id, t.ex. obj/zwave/12/temp. + matchar en nivå och # allt under, t.ex. sensor/+/temp eller sensor/#.'}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="sensor/hall/temp" spellCheck={false} autoFocus aria-invalid={!!topic && !checked.topic} list="mqtt-known-topics" />
        <datalist id="mqtt-known-topics">
          {known.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      {latest && (
        <div className="mqtt-preview">
          <div className="muted small">Senaste meddelandet{isWildcard(checked.topic) ? ` (${latest.topic})` : ''}:</div>
          <pre>{prettyPayload(latest)}</pre>
        </div>
      )}
      <Field label="Visa som" help={MQTT_MODES.find((m) => m.id === mode)?.help}>
        <div className="seg">
          {MQTT_MODES.map((m) => (
            <button key={m.id} type="button" className={mode === m.id ? 'on' : ''} onClick={() => pickMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      {mode !== 'json' && (
        <>
          <Field label="Fält i JSON-meddelandet" help='Tomt = "value" när meddelandet är JSON med value, annars hela meddelandet. Punkt för nivåer och index, t.ex. data.temp eller values.0.'>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="value" spellCheck={false} />
          </Field>
          <div className="row gap">
            <Field label="Enhet">
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="t.ex. °C" />
            </Field>
            <Field label="Decimaler" help="Tomt = som i meddelandet.">
              <input value={decimals} onChange={(e) => setDecimals(e.target.value)} inputMode="numeric" placeholder="t.ex. 1" />
            </Field>
            {mode === 'log' && (
              <Field label="Rader" help={`1-${MAX_LOG_ROWS}`}>
                <input value={rows} onChange={(e) => setRows(e.target.value)} inputMode="numeric" />
              </Field>
            )}
          </div>
          <Field label="Tillstånd: text och färg" help={`Visar en text och färg beroende på värdet, t.ex. running = I drift (grön).${mode === 'value' ? ' Färgen fyller hela widgeten - med höjd 0,5 blir den en banner.' : ' Färgen används på värdet.'}`}>
            <div className="state-rows">
              {states.map((r, i) => (
                <div key={i} className="state-row">
                  <input value={r.value} onChange={(e) => setState(i, { value: e.target.value })} placeholder="Värde" aria-label="Värde" />
                  <input value={r.text} onChange={(e) => setState(i, { text: e.target.value })} placeholder="Text" aria-label="Text" />
                  <SeriesColor value={r.color} fallback="#0d3e53" onChange={(c) => setState(i, { color: c })} label={r.text || r.value || 'tillståndet'} />
                  <button type="button" className="link-btn small" onClick={() => setStates((list) => list.filter((_, j) => j !== i))} aria-label="Ta bort tillståndet">
                    Ta bort
                  </button>
                </div>
              ))}
              <button type="button" className="btn small-btn" onClick={() => setStates((list) => [...list, { value: '', text: '', color: '' }])}>
                <Icon name="plus" size={14} /> Lägg till tillstånd
              </button>
            </div>
          </Field>
        </>
      )}
      <Field label="Namn" help="Tomt = topic.">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={checked.topic || ''} />
      </Field>
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
            {heightOptions(mode === 'value' ? 'mqtt' : 'chart').map(([n, l]) => (
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
