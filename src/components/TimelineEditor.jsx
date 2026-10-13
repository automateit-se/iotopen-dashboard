import { useMemo, useState } from 'react';
import { Modal, Field, errText } from './Modal.jsx';
import { DEFAULT_LAYOUT, GROUPS, OBJ_META, SERIES_COLORS, WIDTH_OPTIONS, fnName, isDiscrete, isHidden, safeColor, unitOf } from '../lib/dashboard.js';
import { ColorPicker, SeriesColor } from './ColorPicker.jsx';
import { RANGE_OPTIONS } from './widgets/RangePicker.jsx';
import { AGGR_METHODS } from '../lib/history.js';
import { isGeo, geoRole } from '../lib/geo.js';

const TEXT = {
  timeline: {
    newTitle: 'Ny tidslinje',
    editTitle: 'Redigera tidslinje',
    defaultName: 'Händelser',
    intro: 'Visar på/av, öppet/stängt, rörelse, läckage och andra diskreta lägen över tid.',
    showOther: 'Visa även analoga',
    none: 'Inga diskreta funktioner hittades. Kryssa i "Visa även analoga" för att välja bland alla.',
    remove: 'Ta bort tidslinjen',
  },
  chart: {
    newTitle: 'Ny graf med flera värden',
    editTitle: 'Redigera graf',
    defaultName: 'Temperaturer',
    intro: 'Flera analoga värden som linjer i samma graf, med gemensam y-axel. Välj gärna värden av samma typ och enhet.',
    showOther: 'Visa även diskreta',
    none: 'Inga analoga funktioner hittades.',
    remove: 'Ta bort grafen',
  },
  tracker: {
    newTitle: 'Ny karta (Tracker)',
    editTitle: 'Redigera karta',
    defaultName: 'Positioner',
    intro: 'Visar nuvarande position och ett spår av tidigare positioner. Välj per enhet en funktion av typen latitude och en av typen longitude, eller en geohash. Funktioner på samma enhet blir ett spår.',
    showOther: 'Visa alla funktioner',
    none: 'Inga funktioner av typen latitude, longitude eller geohash hittades.',
    remove: 'Ta bort kartan',
  },
};

/**
 * Creates or edits a group widget (timeline or multi-line graph). Membership is metadata on each
 * function (dashboard.timeline / dashboard.chart = name); size, hours and colour live in the layout file.
 */
export function TimelineEditor({ group = 'timeline', raw, name: oldName, layoutEntry, existingNames, onSave, onRemove, onClose }) {
  const g = GROUPS[group];
  const tx = TEXT[group];
  const matches = (f) => (group === 'tracker' ? isGeo(f) : group === 'timeline' ? isDiscrete(f) : !isDiscrete(f));
  const isNew = !oldName;
  const [name, setName] = useState(oldName || tx.defaultName);
  const base = { ...DEFAULT_LAYOUT[g.type], ...(layoutEntry || {}) };
  const [hours, setHours] = useState(base.hours);
  const [w, setW] = useState(base.w);
  const [h, setH] = useState(base.h);
  const [color, setColor] = useState(base.color || '');
  // own colour per row (timeline) or line (graph), keyed by function id; empty = follows the widget / series palette
  const [series, setSeries] = useState(() => ({ ...(base.series || {}) }));
  const [minWidth, setMinWidth] = useState(base.min_width ?? 1);
  const [aggr, setAggr] = useState(base.aggr || 'avg');
  const [points, setPoints] = useState(base.points ?? 200);
  const [pair, setPair] = useState(base.pair ?? 5);
  const [fade, setFade] = useState(base.fade !== false);
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(() => new Set(raw.functions.filter((f) => oldName && f.meta?.[g.metaKey] === oldName).map((f) => f.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const devName = useMemo(() => Object.fromEntries(raw.devices.map((d) => [String(d.id), d.meta?.name || d.type || `Enhet ${d.id}`])), [raw]);
  const needle = q.trim().toLowerCase();
  const hiddenCount = raw.functions.filter((f) => isHidden(f) && !selected.has(f.id) && (showAll || matches(f))).length;
  const units = [...new Set(raw.functions.filter((f) => selected.has(f.id)).map((f) => unitOf(f) || '–'))];
  const list = raw.functions
    .filter((f) => showAll || matches(f) || selected.has(f.id))
    .filter((f) => showHidden || !isHidden(f) || selected.has(f.id))
    .filter((f) => !needle || [fnName(f), f.type, devName[String(f.meta?.device_id)]].some((s) => String(s || '').toLowerCase().includes(needle)))
    .sort((a, b) => fnName(a).localeCompare(fnName(b), 'sv'));

  // what a row/line looks like without its own colour (same rules as the widgets)
  const themeWidget = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue('--data').trim() || '#0d3e53', []);
  const order = raw.functions.filter((f) => selected.has(f.id) && !isHidden(f)).map((f) => f.id);
  const fallbackOf = (f) =>
    group === 'tracker'
      ? SERIES_COLORS[Math.max(0, order.filter((id) => ['lat', 'geohash'].includes(geoRole(raw.functions.find((x) => x.id === id)))).indexOf(f.id)) % SERIES_COLORS.length]
      : group === 'timeline'
      ? safeColor(color) || themeWidget
      : safeColor(f.meta?.[OBJ_META.color]) || SERIES_COLORS[Math.max(0, order.indexOf(f.id)) % SERIES_COLORS.length];

  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const save = async () => {
    const clean = name.trim();
    setError('');
    if (!clean) return setError('Ge den ett namn.');
    if (clean !== oldName && existingNames.includes(clean)) return setError(`Det finns redan en ${g.label} som heter "${clean}".`);
    if (!selected.size) return setError('Välj minst en funktion.');
    setBusy(true);
    try {
      const bad = [color, ...Object.values(series)].find((c) => c && !safeColor(c));
      if (bad) throw new Error(`"${bad}" är ingen giltig CSS-färg.`);
      const own = Object.fromEntries(Object.entries(series).filter(([id, c]) => c && selected.has(Number(id))));
      await onSave(clean, [...selected], { hours: Number(hours), w: Number(w), h: Number(h), ...(group === 'timeline' ? { min_width: Math.max(0, Number(minWidth) || 0) } : group === 'tracker' ? { points: Math.max(1, Math.round(Number(points)) || 200), pair: Math.max(0, Number(pair) || 0), fade } : { aggr }), ...(color ? { color } : {}), series: own });
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
      title={isNew ? tx.newTitle : tx.editTitle}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>
              {tx.remove}
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Avbryt
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Sparar…' : `Spara (${selected.size})`}
          </button>
        </>
      }
    >
      <p className="muted small">{tx.intro} Varje vald funktion får metadata {g.metaKey} = namnet.</p>
      <Field label="Namn">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="row gap">
        <Field label="Historik">
          <select value={hours} onChange={(e) => setHours(e.target.value)}>
            {RANGE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bredd (av 8)">
          <select value={w} onChange={(e) => setW(e.target.value)}>
            {WIDTH_OPTIONS.map(([n, l]) => (<option key={n} value={n}>{l}</option>))}
          </select>
        </Field>
        <Field label="Höjd">
          <select value={h} onChange={(e) => setH(e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>
      {group === 'tracker' && (
        <>
          <div className="row gap">
            <Field label="Max antal positioner" help="Det nyaste spåret visas, inom historiken ovan.">
              <input type="number" min="1" max="5000" step="1" value={points} onChange={(e) => setPoints(e.target.value)} />
            </Field>
            <Field label="Vänta på syskonvärdet (s)" help="Latitud och longitud som kommer in inom så här många sekunder blir en position. 0 = para alltid med det senaste.">
              <input type="number" min="0" max="600" step="1" value={pair} onChange={(e) => setPair(e.target.value)} />
            </Field>
          </div>
          <label className="check visible-check">
            <input type="checkbox" checked={fade} onChange={(e) => setFade(e.target.checked)} />
            <span>Tona ut äldre delar av spåret</span>
          </label>
        </>
      )}
      <Field
        label="Färg"
        help={
          group === 'tracker'
            ? 'Färg på widgetens kant och ikon. Varje spår får en egen färg automatiskt, eller en egen färg i listan nedan.'
            : group === 'timeline'
            ? 'Färg på alla rader i tidslinjen. Tomt = temats widgetfärg. En enskild rad kan få egen färg i listan nedan.'
            : 'Färg på widgetens kant och ikon. Linjerna får var sin färg automatiskt, eller en egen färg i listan nedan.'
        }
      >
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      {group === 'chart' && (
        <Field label="Sammanställning för längre intervall" help="För fönster längre än 6 h räknar IoT Open fram ett värde per tidsintervall (5 min vid 24 h, 30 min vid 7 d, 3 h vid 30 d, 1 dygn vid 1 år) med vald metod.">
          <select value={aggr} onChange={(e) => setAggr(e.target.value)}>
            {AGGR_METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      )}
      {group === 'timeline' && (
        <Field label="Minsta bredd för en händelse (%)" help="Korta händelser ritas minst så här breda, så att de syns även över långa tidsfönster. 0 = exakt längd.">
          <input type="number" min="0" max="10" step="0.5" value={minWidth} onChange={(e) => setMinWidth(e.target.value)} />
        </Field>
      )}
      <div className="row gap wrap">
        <input className="search grow" placeholder="Sök funktion, typ eller enhet…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check small">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {tx.showOther}
        </label>
        {(hiddenCount > 0 || showHidden) && (
          <label className="check small" title='Funktioner med meta visible = "false"'>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Visa dolda ({hiddenCount})
          </label>
        )}
      </div>
      <ul className="check-list">
        {list.map((f) => (
          <li key={f.id} className="row gap">
            {selected.has(f.id) && (group !== 'tracker' || ['lat', 'geohash'].includes(geoRole(f))) && (
              <SeriesColor value={series[f.id] || ''} fallback={fallbackOf(f)} label={fnName(f)} onChange={(c) => setSeries((s) => ({ ...s, [f.id]: c }))} />
            )}
            <label className="check grow">
              <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
              <span>
                {fnName(f)}
                <span className="muted small">
                  {' '}
                  · {f.type}
                  {f.meta?.device_id && devName[String(f.meta.device_id)] && devName[String(f.meta.device_id)] !== fnName(f) ? ` · ${devName[String(f.meta.device_id)]}` : ''}
                  {group === 'chart' && unitOf(f) ? ` · ${unitOf(f)}` : ''}
                  {f.meta?.[g.metaKey] && f.meta[g.metaKey] !== oldName ? ` · i "${f.meta[g.metaKey]}"` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
        {!list.length && <li className="muted small">{tx.none}</li>}
      </ul>
      {group === 'chart' && units.length > 1 && <div className="warn-box">Olika enheter ({units.join(', ')}) delar samma y-axel.</div>}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  );
}
