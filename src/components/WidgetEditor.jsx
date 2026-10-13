import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { RANGE_OPTIONS } from './widgets/RangePicker.jsx';
import { AGGR_METHODS } from '../lib/history.js';
import { STATUS_META, STATUS_TEXT, parseLimits } from '../lib/status.js';
import { FUNCTION_WIDGETS, DEVICE_WIDGETS, DEFAULT_LAYOUT, OBJ_META, WIDTH_OPTIONS, HALF_HEIGHT_TYPES, heightOptions, writeTopic, isHidden, stateColorKey, widgetTypes, WIDGET_LABEL } from '../lib/dashboard.js';
import { stateMap } from '../lib/format.js';
import { ColorPicker, SeriesColor } from './ColorPicker.jsx';

/** state_<key> name for a new row: from the text (a-z, 0-9, _), else the value; unique among the rows. */
function newStateKey(row, rows) {
  const base =
    String(row.text || row.value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'state';
  let key = base;
  for (let n = 2; rows.some((r) => r !== row && r.key === key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * Edits one widget (or creates one from a candidate when `isNew`).
 * Simple settings go to the object's metadata, size and technical parameters to the layout file.
 */
export function WidgetEditor({ kind, obj, widgetType, layoutEntry, isNew, onSave, onRemove, onClose }) {
  const m = obj.meta || {};
  const types = kind === 'device' ? DEVICE_WIDGETS : FUNCTION_WIDGETS;
  // types the object's other widgets already have (one widget per type)
  const taken = widgetTypes(obj).filter((t) => isNew || t !== widgetType);
  const free = (t) => !taken.includes(t);
  const [type, setType] = useState(() => {
    if (!isNew && widgetType) return widgetType;
    const s = layoutEntry?.suggested;
    return s && free(s) ? s : (types.find((t) => free(t.id)) || types[0]).id;
  });
  // with several widgets on the object, the colour is stored per widget (layout file) instead of dashboard.color
  const several = taken.length > 0;
  const [nickname, setNickname] = useState(m[OBJ_META.nickname] || '');
  const [color, setColor] = useState(several ? layoutEntry?.color || '' : m[OBJ_META.color] || '');
  const [icon, setIcon] = useState(m[OBJ_META.icon] || '');
  const base = { ...(DEFAULT_LAYOUT[type] || {}), ...(layoutEntry || {}) };
  const [w, setW] = useState(base.w || 1);
  const [h, setH] = useState(base.h || 1);
  const [min, setMin] = useState(base.min ?? 0);
  const [max, setMax] = useState(base.max ?? 100);
  const [hours, setHours] = useState(base.hours ?? 24);
  const [aggr, setAggr] = useState(base.aggr || 'avg');
  const [limits, setLimits] = useState(m[STATUS_META.limits] || '');
  const limitsCheck = parseLimits(limits);
  // manual status: '' = none (key removed, limits decide), '0'/'1'/'2' = OK/Warning/Critical – can then be changed in IoT Open
  const [status, setStatus] = useState(() => {
    const v = m[STATUS_META.status];
    return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? String(Math.max(0, Math.min(2, Math.round(Number(v))))) : '';
  });
  const [statusText, setStatusText] = useState(m[STATUS_META.text] || '');
  // states: value -> text (state_<x>/text_<x>, IoT Open's convention) + colour (dashboard.color_<x>)
  const initialStates = stateMap(obj).map((st) => ({ key: st.key, value: st.value, text: st.text, color: m[stateColorKey(st.key)] || '' }));
  const [states, setStates] = useState(initialStates);
  const setState = (i, patch) => setStates((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [press, setPress] = useState(m[OBJ_META.press] || '');
  const [release, setRelease] = useState(m[OBJ_META.release] || '');
  const initiallyVisible = !isHidden(obj);
  const [visible, setVisible] = useState(initiallyVisible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changeType = (t) => {
    setType(t);
    const d = DEFAULT_LAYOUT[t] || {};
    if (isNew) {
      setW(d.w || 1);
      setH(d.h || 1);
    } else if (Number(h) < 1 && !HALF_HEIGHT_TYPES.includes(t)) setH(1);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (!free(type)) throw new Error(`Funktionen har redan en widget av typen ${WIDGET_LABEL[type] || type}.`);
      const params = { w: Number(w), h: Number(h), color: several ? color.trim() : '' };
      if (type === 'gauge') Object.assign(params, { min: Number(min), max: Number(max) });
      if (type === 'chart') Object.assign(params, { hours: Number(hours), aggr });
      // states: only for value/status; rows removed in the editor delete their three keys
      let st = {};
      if (kind === 'function' && (type === 'value' || type === 'status')) {
        const rows = states.filter((r) => String(r.value).trim() !== '' || r.key);
        if (rows.some((r) => String(r.value).trim() === '')) throw new Error('Varje tillstånd behöver ett värde.');
        const vals = rows.map((r) => String(r.value).trim());
        if (new Set(vals).size !== vals.length) throw new Error('Två tillstånd har samma värde.');
        const keyed = [];
        for (const r of rows) keyed.push(r.key ? r : { ...r, key: newStateKey(r, [...rows, ...keyed]) });
        for (const r of initialStates) if (!keyed.some((k) => k.key === r.key)) Object.assign(st, { [`state_${r.key}`]: '', [`text_${r.key}`]: '', [stateColorKey(r.key)]: '' });
        for (const r of keyed) Object.assign(st, { [`state_${r.key}`]: String(r.value).trim(), [`text_${r.key}`]: r.text.trim(), [stateColorKey(r.key)]: r.color.trim() });
      }
      const btn = kind === 'function' && type === 'button' ? { press: press.trim(), release: release.trim() } : {};
      // IoT Open's own "visible" flag: always written as "true"/"false" (never deleted), and only when changed
      const vis = kind === 'function' && visible !== initiallyVisible ? { visible: visible ? 'true' : 'false' } : {};
      if (limitsCheck.error) throw new Error(`Gränsvärden: ${limitsCheck.error}`);
      const lim =
        kind === 'function'
          ? { [STATUS_META.limits]: limits.trim(), [STATUS_META.status]: status, [STATUS_META.text]: status ? statusText.trim() : '' }
          : {};
      await onSave({ widget: type, nickname: nickname.trim(), ...(several ? {} : { color: color.trim() }), icon, ...vis, ...lim, ...st, ...btn }, params);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await onRemove();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const objLabel = kind === 'device' ? `Enhet ${obj.id} (${obj.type || 'okänd typ'})` : `Funktion ${obj.id} (${obj.type || 'okänd typ'})`;

  return (
    <Modal
      title={isNew ? 'Lägg till widget' : 'Redigera widget'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>
              Ta bort från dashboarden
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
        {objLabel} · {m.name || '–'}
        {m.topic_read ? ` · ${m.topic_read}` : ''}
      </p>
      {taken.length > 0 && (
        <p className="muted small">
          Funktionen har {isNew ? 'redan' : 'också'} {taken.map((t) => WIDGET_LABEL[t] || t).join(', ')} på dashboarden. Namn, ikon, gränsvärden och tillstånd delas, storlek och färg är egna per widget.
        </p>
      )}
      <Field label="Typ">
        <div className="seg">
          {types.map((t) => (
            <button key={t.id} type="button" className={type === t.id ? 'on' : ''} onClick={() => changeType(t.id)} title={free(t.id) ? t.help : 'Finns redan som widget för funktionen'} disabled={!free(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </Field>
      {kind === 'function' && (
        <label className="check visible-check">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          <span>
            Synlig (visible)
            <small className="muted">
              {' '}
              · IoT Opens egen flagga, sparas som "{visible ? 'true' : 'false'}". Avbockad döljer funktionen i hela dashboarden.
              {m.visible === undefined ? ' Saknas i dag (= synlig).' : ''}
            </small>
          </span>
        </label>
      )}
      <Field label="Namn (nickname)" help={`Tomt = ${m.name || 'objektets namn'}`}>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={m.name || ''} />
      </Field>
      {kind === 'function' && (
        <Field
          label="Gränsvärden (dashboard.limits)"
          help={
            limitsCheck.error || 'Ger status OK / Warning / Critical. -w = varning, -c = kritisk, villkor kommaseparerade, t.ex. -w<18,>21 -c<16,>22. Tomt = ingen status.'
          }
        >
          <input value={limits} onChange={(e) => setLimits(e.target.value)} placeholder="-w<18,>21 -c<16,>22" aria-invalid={!!limitsCheck.error} spellCheck={false} />
        </Field>
      )}
      {kind === 'function' && (
        <Field
          label="Status (dashboard.status)"
          help={
            status
              ? `Fast status som går före gränsvärdena. Ändra värdet 0 / 1 / 2 i IoT Open (eller här) för att byta läge. Ingen = nyckeln tas bort.`
              : 'Ingen = bara gränsvärdena ger status. Välj ett läge för att skapa nyckeln, så kan den sedan ändras från IoT Open.'
          }
        >
          <div className="seg">
            {[['', 'Ingen'], ...STATUS_TEXT.map((t, i) => [String(i), t])].map(([v, l]) => (
              <button key={v || 'none'} type="button" className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>
                {l}
              </button>
            ))}
          </div>
        </Field>
      )}
      {kind === 'function' && status && (
        <Field label="Statustext (dashboard.status_text)" help={`Visas i märket på widgeten. Tomt = ${STATUS_TEXT[Number(status)]}.`}>
          <input value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder={STATUS_TEXT[Number(status)]} />
        </Field>
      )}
      <Field
        label="Färg"
        help={several ? `Gäller bara den här widgeten (funktionen har flera). Tomt = ${m[OBJ_META.color] ? `dashboard.color (${m[OBJ_META.color]})` : 'temats widgetfärg'}.` : 'Tomt = temats widgetfärg.'}
      >
        <ColorPicker value={color} onChange={setColor} />
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
      <div className="row gap">
        <Field label="Bredd (av 8)">
          <select value={w} onChange={(e) => setW(e.target.value)}>
            {WIDTH_OPTIONS.map(([n, l]) => (<option key={n} value={n}>{l}</option>))}
          </select>
        </Field>
        <Field label="Höjd (rader)">
          <select value={h} onChange={(e) => setH(e.target.value)}>
            {heightOptions(type).map(([n, l]) => (
              <option key={n} value={n}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {kind === 'function' && (type === 'value' || type === 'status') && (
        <Field
          label="Tillstånd: text och färg"
          help={`Visar en text och färg beroende på värdet, t.ex. 1 = Larmat (röd) och 0 = Avlarmat (grön). Sparas som state_<namn>, text_<namn> och dashboard.color_<namn>.${type === 'value' ? ' Färgen fyller hela widgeten - med höjd 0,5 blir den en banner.' : ' Färgen används på pricken.'}`}
        >
          <div className="state-rows">
            {states.map((r, i) => (
              <div key={r.key || `new${i}`} className="state-row">
                <input value={r.value} onChange={(e) => setState(i, { value: e.target.value })} placeholder="Värde" aria-label="Värde" title={r.key ? `state_${r.key}` : 'Nytt tillstånd'} />
                <input value={r.text} onChange={(e) => setState(i, { text: e.target.value })} placeholder="Text" aria-label="Text" />
                <SeriesColor value={r.color} fallback="#0d3e53" onChange={(c) => setState(i, { color: c })} label={r.text || r.value || 'tillståndet'} />
                <button type="button" className="link-btn small" onClick={() => setStates((rows) => rows.filter((_, j) => j !== i))} aria-label="Ta bort tillståndet">
                  Ta bort
                </button>
              </div>
            ))}
            <button type="button" className="btn small-btn" onClick={() => setStates((rows) => [...rows, { key: '', value: '', text: '', color: '' }])}>
              <Icon name="plus" size={14} /> Lägg till tillstånd
            </button>
          </div>
        </Field>
      )}
      {type === 'button' && (
        <div className="row gap">
          <Field label="Värde vid tryck (dashboard.press)" help="Skickas till topic_write när knappen trycks ned. Tomt = 1.">
            <input value={press} onChange={(e) => setPress(e.target.value)} placeholder="1" />
          </Field>
          <Field label="Värde vid släpp (dashboard.release)" help="Valfritt. Skickas när knappen släpps. Tomt = inget skickas.">
            <input value={release} onChange={(e) => setRelease(e.target.value)} placeholder="t.ex. 0" />
          </Field>
        </div>
      )}
      {type === 'gauge' && (
        <div className="row gap">
          <Field label="Min">
            <input type="number" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Max">
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} />
          </Field>
        </div>
      )}
      {type === 'chart' && (
        <Field label="Standardintervall" help="Tittaren kan byta intervall och zooma i grafen utan att något sparas.">
          <select value={hours} onChange={(e) => setHours(e.target.value)}>
            {RANGE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
            {!RANGE_OPTIONS.some(([v]) => String(v) === String(hours)) && <option value={hours}>{hours} timmar</option>}
          </select>
        </Field>
      )}
      {type === 'chart' && (
        <Field label="Sammanställning för längre intervall" help="För fönster längre än 6 h räknar IoT Open fram ett värde per tidsintervall (5 min vid 24 h, 30 min vid 7 d, 3 h vid 30 d, 1 dygn vid 1 år) med vald metod. För mätarställningar passar Senaste värdet eller Maximum.">
          <select value={aggr} onChange={(e) => setAggr(e.target.value)}>
            {AGGR_METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(type === 'switch' || type === 'number' || type === 'button') && !writeTopic(obj) && <div className="warn-box">Funktionen saknar topic_write, så den kan inte styras härifrån.</div>}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
