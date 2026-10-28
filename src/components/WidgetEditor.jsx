import { useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { Icon, ICON_NAMES } from './icons.jsx';
import { RANGE_OPTIONS } from './widgets/RangePicker.jsx';
import { AGGR_METHODS } from '../lib/history.js';
import { STATUS_META, STATUS_TEXT, parseLimits } from '../lib/status.js';
import { FUNCTION_WIDGETS, DEVICE_WIDGETS, DEFAULT_LAYOUT, OBJ_META, WIDTH_OPTIONS, HALF_HEIGHT_TYPES, heightOptions, writeTopic, onOffTopics, controlTopic, topicKeys, isHidden, stateColorKey, widgetTypes, WIDGET_LABEL, SERIES_COLORS, fnName, safeColor, unitOf, isDiscrete } from '../lib/dashboard.js';
import { SPARK_RANGES } from '../lib/sparkline.js';
import { DEFAULT_ZONES, zonesOf } from '../lib/thermostat.js';
import { stateMap } from '../lib/format.js';
import { ColorPicker, SeriesColor } from './ColorPicker.jsx';
import { PERIODS, MODES } from './widgets/Consumption.jsx';
import { SUMMARY_PERIODS, summaryPeriods } from '../lib/periods.js';

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
 * Consumption: more functions whose bars stand next to the widget's own function, e.g. visitors in and out.
 * The order they are ticked in is the order of the bars; each can get its own colour.
 */
function MoreFunctions({ obj, raw, more, setMore, series, setSeries, q, setQ }) {
  const needle = q.trim().toLowerCase();
  const list = raw.functions
    .filter((f) => f.id !== obj.id && f.meta?.topic_read && (!isHidden(f) || more.includes(f.id)))
    .filter((f) => more.includes(f.id) || !needle || [fnName(f), f.type, f.meta?.topic_read].some((s) => String(s || '').toLowerCase().includes(needle)))
    .sort((a, b) => (more.includes(b.id) - more.includes(a.id)) || fnName(a).localeCompare(fnName(b), 'sv'));
  const ids = [obj.id, ...more];
  const fallbackOf = (f) => safeColor(f.meta?.[OBJ_META.color]) || SERIES_COLORS[Math.max(0, ids.indexOf(f.id)) % SERIES_COLORS.length];
  const toggle = (id) => setMore((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const units = [...new Set([obj, ...raw.functions.filter((f) => more.includes(f.id))].map((f) => unitOf(f) || '–'))];
  return (
    <Field
      label="Fler funktioner i samma diagram"
      help="Valfritt. Staplarna för varje period står bredvid varandra, t.ex. besökare in och ut per timme. Alla räknas på samma sätt (mätarställning eller per värde) och delar skala."
    >
      <input className="search" placeholder="Sök funktion, typ eller topic…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="check-list">
        {more.length > 0 && (
          <li className="row gap">
            <SeriesColor value={series[obj.id] || ''} fallback={fallbackOf(obj)} label={fnName(obj)} onChange={(c) => setSeries((s) => ({ ...s, [obj.id]: c }))} />
            <label className="check grow">
              <input type="checkbox" checked disabled />
              <span>
                {fnName(obj)} <span className="muted small">· widgetens egen funktion</span>
              </span>
            </label>
          </li>
        )}
        {list.map((f) => (
          <li key={f.id} className="row gap">
            {more.includes(f.id) && <SeriesColor value={series[f.id] || ''} fallback={fallbackOf(f)} label={fnName(f)} onChange={(c) => setSeries((s) => ({ ...s, [f.id]: c }))} />}
            <label className="check grow">
              <input type="checkbox" checked={more.includes(f.id)} onChange={() => toggle(f.id)} />
              <span>
                {fnName(f)}
                <span className="muted small">
                  {' '}
                  · {f.type}
                  {unitOf(f) ? ` · ${unitOf(f)}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
        {!list.length && <li className="muted small">Inga andra funktioner med topic_read hittades.</li>}
      </ul>
      {more.length > 0 && units.length > 1 && <div className="warn-box">Olika enheter ({units.join(', ')}) delar samma skala.</div>}
    </Field>
  );
}

/**
 * Edits one widget (or creates one from a candidate when `isNew`).
 * Simple settings go to the object's metadata, size and technical parameters to the layout file.
 */
export function WidgetEditor({ kind, obj, raw, widgetType, layoutEntry, isNew, extra = false, onSave, onRemove, onClose }) {
  const m = obj.meta || {};
  const types = kind === 'device' ? DEVICE_WIDGETS : FUNCTION_WIDGETS;
  // types the object's metadata widgets already have; one more of the same type becomes an extra widget
  // (layout file only), so a new widget or an extra one can be any type
  const taken = extra ? widgetTypes(obj) : widgetTypes(obj).filter((t) => isNew || t !== widgetType);
  const free = (t) => isNew || extra || !taken.includes(t);
  const [type, setType] = useState(() => {
    if (!isNew && widgetType) return widgetType;
    const s = layoutEntry?.suggested;
    return s && free(s) ? s : (types.find((t) => free(t.id)) || types[0]).id;
  });
  // with several widgets on the object, the colour is stored per widget (layout file) instead of dashboard.color
  const several = taken.length > 0 || extra;
  // an extra widget: name, icon, colour and control settings are its own (layout file)
  const extraMode = extra || (isNew && taken.includes(type));
  const [nickname, setNickname] = useState(m[OBJ_META.nickname] || '');
  const [color, setColor] = useState(several ? layoutEntry?.color || '' : m[OBJ_META.color] || '');
  const [icon, setIcon] = useState(m[OBJ_META.icon] || '');
  const base = { ...(DEFAULT_LAYOUT[type] || {}), ...(layoutEntry || {}) };
  const [w, setW] = useState(base.w || 1);
  const [h, setH] = useState(base.h || 1);
  const [min, setMin] = useState(base.min ?? 0);
  const [max, setMax] = useState(base.max ?? '');
  const [hours, setHours] = useState(base.hours ?? 24);
  const [aggr, setAggr] = useState(base.aggr || 'avg');
  // value: Minigraf (a small curve with MIN / MEDEL / MAX under the value)
  const [spark, setSpark] = useState(!!base.spark);
  const [sparkStats, setSparkStats] = useState(base.stats !== false);
  const canSpark = kind === 'function' && !isDiscrete(obj);
  // thermostat: buttons or dial, Minigraf (shares spark / hours), the temperature line's colour and the zones
  const [view, setView] = useState(base.view === 'dial' ? 'dial' : 'buttons');
  const [tempColor, setTempColor] = useState(base.tempColor || '');
  const [zoneRows, setZoneRows] = useState(() => zonesOf(base.zones).map((z) => ({ to: z.to === undefined ? '' : String(z.to), text: z.text, color: z.color })));
  const setZone = (i, patch) => setZoneRows((rows) => rows.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  // the least height a thermostat needs: buttons 2 rows, the dial 3, plus 1 for the Minigraf
  const thermoHeight = (v, sp) => (v === 'dial' ? 3 : 2) + (sp ? 1 : 0);
  const fitThermo = (v, sp) => Number(h) < thermoHeight(v, sp) && setH(thermoHeight(v, sp));
  const [period, setPeriod] = useState(base.period || 'day');
  const [count, setCount] = useState(base.count ?? 7);
  const [mode, setMode] = useState(base.mode || 'counter');
  // summary: which periods it shows
  const [sumPeriods, setSumPeriods] = useState(() => summaryPeriods(base.periods).map(([id]) => id));
  // consumption: more functions in the same diagram (layout "more") and a colour per function (layout "series")
  const [more, setMore] = useState(() => (Array.isArray(base.more) ? base.more.map(Number).filter((id) => id !== obj.id) : []));
  const [series, setSeries] = useState(() => ({ ...(base.series || {}) }));
  const [moreQ, setMoreQ] = useState('');
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
  // advanced control (switch/button): msg with the value, and another topic; hidden until "Avancerat" is ticked
  const [msgA, setMsgA] = useState(m[OBJ_META.press_msg] || m[OBJ_META.on_msg] || '');
  const [msgB, setMsgB] = useState(m[OBJ_META.release_msg] || m[OBJ_META.off_msg] || '');
  const [topic, setTopic] = useState(m[OBJ_META.topic] || '');
  const keys = topicKeys(obj);
  const [customTopic, setCustomTopic] = useState(() => !!m[OBJ_META.topic] && !keys.includes(m[OBJ_META.topic]));
  const [advanced, setAdvanced] = useState(() => !!(m[OBJ_META.press_msg] || m[OBJ_META.release_msg] || m[OBJ_META.on_msg] || m[OBJ_META.off_msg] || m[OBJ_META.topic]));
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
      if (type === 'gauge') {
        if (max !== '' && !(Number(max) > Number(min))) throw new Error('Max måste vara större än min, eller tomt för automatiskt.');
        Object.assign(params, { min: Number(min), max: max === '' ? '' : Number(max) });
      }
      if (type === 'chart') Object.assign(params, { hours: Number(hours), aggr });
      if (type === 'thermostat') {
        const rows = zoneRows.map((z, i) => ({ ...z, last: i === zoneRows.length - 1 }));
        const zones = [];
        let prev = -Infinity;
        for (const z of rows) {
          if (!safeColor(z.color)) throw new Error(`Zon "${z.text || zones.length + 1}": "${z.color}" är ingen giltig färg.`);
          if (z.last) {
            zones.push({ color: z.color.trim(), text: z.text.trim() });
            break;
          }
          const to = Number(String(z.to).replace(',', '.'));
          if (String(z.to).trim() === '' || !Number.isFinite(to)) throw new Error(`Zon "${z.text || zones.length + 1}": ange en övre gräns i grader.`);
          if (to <= prev) throw new Error('Zonernas gränser måste öka nedåt i listan.');
          prev = to;
          zones.push({ to, color: z.color.trim(), text: z.text.trim() });
        }
        const tc = tempColor.trim();
        if (tc && !safeColor(tc)) throw new Error(`"${tc}" är ingen giltig färg för temperaturlinjen.`);
        Object.assign(params, { view, spark, hours: Number(hours), tempColor: tc, zones });
      }
      if (type === 'value') Object.assign(params, spark && canSpark ? { spark: true, hours: Number(hours), stats: sparkStats } : { spark: false });
      if (type === 'consumption') {
        const most = PERIODS.find(([p]) => p === period)[2];
        const n = Math.round(Number(count));
        if (!(n >= 1 && n <= most)) throw new Error(`Antal staplar: 1-${most} för vald period.`);
        const ids = [obj.id, ...more];
        const bad = ids.map((id) => series[id]).find((c) => c && !safeColor(c));
        if (bad) throw new Error(`"${bad}" är ingen giltig CSS-färg.`);
        const own = more.length ? Object.fromEntries(ids.filter((id) => series[id]).map((id) => [id, series[id]])) : {};
        Object.assign(params, { period, count: n, mode, more, series: own });
      }
      if (type === 'sum') {
        if (!sumPeriods.length) throw new Error('Välj minst en period.');
        Object.assign(params, { periods: SUMMARY_PERIODS.map(([id]) => id).filter((id) => sumPeriods.includes(id)), mode });
      }
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
      // the advanced fields belong to the type being edited; turning "Avancerat" off clears them
      const on = advanced && kind === 'function';
      const t = on ? topic.trim() : '';
      if (t && !/^topic_/.test(t) && !/^[^\s#+]+$/.test(t)) throw new Error('Topic får inte innehålla mellanslag, # eller +.');
      const adv =
        kind === 'function' && type === 'button'
          ? { press_msg: on ? msgA.trim() : '', release_msg: on ? msgB.trim() : '', topic: t }
          : kind === 'function' && type === 'switch'
            ? { on_msg: on ? msgA.trim() : '', off_msg: on ? msgB.trim() : '', topic: t }
            : {};
      // IoT Open's own "visible" flag: always written as "true"/"false" (never deleted), and only when changed
      const vis = kind === 'function' && visible !== initiallyVisible ? { visible: visible ? 'true' : 'false' } : {};
      if (limitsCheck.error) throw new Error(`Gränsvärden: ${limitsCheck.error}`);
      const lim =
        kind === 'function'
          ? { [STATUS_META.limits]: limits.trim(), [STATUS_META.status]: status, [STATUS_META.text]: status ? statusText.trim() : '' }
          : {};
      await onSave({ widget: type, nickname: nickname.trim(), ...(several ? {} : { color: color.trim() }), icon, ...vis, ...lim, ...st, ...btn, ...adv }, params);
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
      {extraMode ? (
        <p className="muted small">
          {isNew ? `${kind === 'device' ? 'Enheten' : 'Funktionen'} har redan en ${(WIDGET_LABEL[type] || type).toLowerCase()}, så den här blir en egen widget.` : 'Egen widget.'} Namn, ikon, färg och inställningar för styrning gäller bara den här widgeten och sparas i layoutfilen. Gränsvärden, tillstånd och synlighet delas med {kind === 'device' ? 'enheten' : 'funktionen'}.
        </p>
      ) : (
        taken.length > 0 && (
          <p className="muted small">
            Funktionen har {isNew ? 'redan' : 'också'} {taken.map((t) => WIDGET_LABEL[t] || t).join(', ')} på dashboarden. Namn, ikon, gränsvärden och tillstånd delas, storlek och färg är egna per widget.
          </p>
        )
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
      {type === 'thermostat' && (
        <>
          <Field label="Visning">
            <div className="seg">
              {[
                ['buttons', 'Knappar'],
                ['dial', 'Ratt'],
              ].map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? 'on' : ''}
                  onClick={() => {
                    setView(v);
                    fitThermo(v, spark);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={spark}
              onChange={(e) => {
                setSpark(e.target.checked);
                if (e.target.checked) fitThermo(view, true);
              }}
            />
            <span>
              Minigraf
              <small className="muted"> · temperaturen som heldragen linje och börvärdet som streckad linje i zonens färg (en rad till på höjden)</small>
            </span>
          </label>
          {spark && (
            <>
              <Field label="Period">
                <select value={hours} onChange={(e) => setHours(e.target.value)}>
                  {SPARK_RANGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                  {!SPARK_RANGES.some(([v]) => String(v) === String(hours)) && <option value={hours}>{hours} timmar</option>}
                </select>
              </Field>
              <Field label="Temperaturlinjens färg" help="Standard = widgetens färg.">
                <ColorPicker value={tempColor} onChange={setTempColor} />
              </Field>
            </>
          )}
          <Field label="Färgzoner för börvärdet" help="Börvärdet, dess linje i minigrafen och ratten får färgen för zonen som börvärdet ligger i. Varje zon gäller under sin gräns; den sista gäller resten.">
            <div className="state-rows">
              {zoneRows.map((z, i) => (
                <div key={i} className="state-row zone-row">
                  {i < zoneRows.length - 1 ? (
                    <input value={z.to} onChange={(e) => setZone(i, { to: e.target.value })} inputMode="decimal" placeholder="Under °C" aria-label={`Övre gräns för zon ${i + 1}`} />
                  ) : (
                    <span className="muted small">och över</span>
                  )}
                  <input value={z.text} onChange={(e) => setZone(i, { text: e.target.value })} placeholder="Namn" aria-label={`Namn på zon ${i + 1}`} />
                  <SeriesColor value={z.color} fallback="#18a058" onChange={(c) => setZone(i, { color: c || DEFAULT_ZONES[Math.min(i, DEFAULT_ZONES.length - 1)].color })} label={z.text || `zon ${i + 1}`} />
                  <button type="button" className="link-btn small" disabled={zoneRows.length <= 2} onClick={() => setZoneRows((rows) => rows.filter((_, j) => j !== i))} aria-label={`Ta bort zon ${i + 1}`}>
                    Ta bort
                  </button>
                </div>
              ))}
              <div className="row gap">
                <button type="button" className="btn small-btn" onClick={() => setZoneRows((rows) => [...rows.slice(0, -1), { to: '', text: '', color: '#7c3aed' }, rows[rows.length - 1]])}>
                  <Icon name="plus" size={14} /> Lägg till zon
                </button>
                <button type="button" className="link-btn small" onClick={() => setZoneRows(DEFAULT_ZONES.map((z) => ({ to: z.to === undefined ? '' : String(z.to), text: z.text, color: z.color })))}>
                  Återställ standard
                </button>
              </div>
            </div>
          </Field>
        </>
      )}
      {type === 'value' && canSpark && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={spark}
              onChange={(e) => {
                setSpark(e.target.checked);
                // the curve and MIN / MEDEL / MAX need two rows
                if (e.target.checked && Number(h) < 2) setH(2);
              }}
            />
            <span>
              Minigraf
              <small className="muted"> · en liten kurva under värdet, med MIN, MEDEL och MAX för perioden (från höjd 2)</small>
            </span>
          </label>
          {spark && (
            <div className="row gap">
              <Field label="Period">
                <select value={hours} onChange={(e) => setHours(e.target.value)}>
                  {SPARK_RANGES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                  {!SPARK_RANGES.some(([v]) => String(v) === String(hours)) && <option value={hours}>{hours} timmar</option>}
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" checked={sparkStats} onChange={(e) => setSparkStats(e.target.checked)} />
                <span>Visa MIN / MEDEL / MAX</span>
              </label>
            </div>
          )}
        </>
      )}
      {type === 'gauge' && (
        <div className="row gap">
          <Field label="Min">
            <input type="number" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="Max" help="Tomt = automatiskt: funktionens min/max i IoT Open, 100 för procent, annars ett jämnt tal över värdet (911 ger 1000).">
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="automatiskt" />
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
      {type === 'consumption' && (
        <>
          <div className="row gap">
            <Field label="En stapel per">
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Antal staplar" help="T.ex. 7 dygn, 30 dygn, 52 veckor eller 12 månader. Den sista är pågående period.">
              <input type="number" min="1" max={PERIODS.find(([p]) => p === period)?.[2]} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
          </div>
          <Field label="Funktionen visar" help="Mätarställning: skillnaden mellan avläsningarna blir förbrukningen (ett nollställt räkneverk hanteras). IoT Open sammanställer per timme eller dygn, så även lång historik går snabbt.">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          {raw && kind === 'function' && <MoreFunctions obj={obj} raw={raw} more={more} setMore={setMore} series={series} setSeries={setSeries} q={moreQ} setQ={setMoreQ} />}
        </>
      )}
      {type === 'sum' && (
        <>
          <div className="field">
            <span>Perioder</span>
            <div className="period-checks">
              {SUMMARY_PERIODS.map(([id, label]) => (
                <label key={id} className="check">
                  <input type="checkbox" checked={sumPeriods.includes(id)} onChange={(e) => setSumPeriods((l) => (e.target.checked ? [...l, id] : l.filter((x) => x !== id)))} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <small className="muted">Visas bredvid varandra i den här ordningen, äldst till vänster och senast till höger. Pågående period räknas fram till nu.</small>
          </div>
          <Field label="Funktionen visar" help="Mätarställning: skillnaden mellan avläsningarna blir förbrukningen (ett nollställt räkneverk hanteras).">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {kind === 'function' && (type === 'switch' || type === 'button') && (
        <>
          <label className="check visible-check">
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
            <span>Avancerat: meddelande och topic</span>
          </label>
          {advanced && (
            <>
              <div className="row gap">
                <Field label={type === 'button' ? 'Meddelande vid tryck (dashboard.press_msg)' : 'Meddelande vid på (dashboard.on_msg)'} help='Skickas som "msg" tillsammans med värdet. Tomt = inget meddelande.'>
                  <input value={msgA} onChange={(e) => setMsgA(e.target.value)} />
                </Field>
                <Field label={type === 'button' ? 'Meddelande vid släpp (dashboard.release_msg)' : 'Meddelande vid av (dashboard.off_msg)'} help={type === 'button' ? 'Skickas med värdet vid släpp, om ett sådant är satt.' : 'Skickas som "msg" när brytaren slås av.'}>
                  <input value={msgB} onChange={(e) => setMsgB(e.target.value)} />
                </Field>
              </div>
              <Field label="Topic att skicka på (dashboard.topic)" help={`Skickas nu till ${controlTopic({ meta: { ...m, [OBJ_META.topic]: topic } }, type === 'switch' ? onOffTopics(obj).write : writeTopic(obj)) || '(inget topic)'}.`}>
                <select
                  value={customTopic ? '__custom' : topic}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomTopic(v === '__custom');
                    setTopic(v === '__custom' ? '' : v);
                  }}
                >
                  <option value="">Standard ({type === 'switch' && m.topic_write_onoff ? 'topic_write_onoff' : 'topic_write'})</option>
                  {keys
                    .filter((k) => k !== (type === 'switch' && m.topic_write_onoff ? 'topic_write_onoff' : 'topic_write'))
                    .map((k) => (
                      <option key={k} value={k}>
                        {k} · {m[k]}
                      </option>
                    ))}
                  <option value="__custom">Eget topic…</option>
                </select>
              </Field>
              {customTopic && (
                <Field label="Eget topic" help="Utan client id, t.ex. set/obj/grind/1. Skickas till &lt;client id&gt;/topic.">
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="set/obj/…" spellCheck={false} />
                </Field>
              )}
            </>
          )}
        </>
      )}
      {(type === 'switch' || type === 'number' || type === 'button') && !writeTopic(obj) && !(type !== 'number' && advanced && topic.trim()) && <div className="warn-box">Funktionen saknar topic_write, så den kan inte styras härifrån.</div>}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
