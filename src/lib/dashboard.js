// The dashboard model. Nothing is stored by the dashboard itself – everything lives in IoT Open:
//
//   Installation meta   dashboard.title      title shown above the dashboard (default: installation name)
//                       dashboard.admins     comma separated user ids or e-mails that may edit
//                                            (empty = anyone; IoT Open still rejects writes without permission)
//   Function/device     dashboard.widget     widget type – the object is shown only when this is set
//   meta                dashboard.nickname   display name (default: meta.name)
//                       dashboard.color      any CSS colour
//                       dashboard.icon       icon name, see components/icons.jsx
//                       dashboard.color_<x>  colour for the state state_<x> (value/status widgets, e.g. a banner)
//                       dashboard.press / dashboard.release  values a push button sends (release optional)
//   Installation file   dashboard-layout.json  order, size and technical parameters per widget
//                       dashboard-logo.png     logo in the header instead of IoT Open's (no file = default)
//
// Widget keys are "f:<function id>" and "d:<device id>"; link buttons (www) live only in the layout file as "u:<id>".

import { lynx } from '../api/lynx.js';
import { stateMap, stateFor } from './format.js';

/** A colour from metadata or the layout file, or '' – anything that is not a valid CSS colour is ignored. */
export const safeColor = (v) => {
  const s = String(v ?? '').trim();
  return s && typeof CSS !== 'undefined' && CSS.supports('color', s) ? s : '';
};

// icon names the dashboard can draw (components/icons.jsx); IoT Open's meta "icon" is used when it matches
const ICON_SET = new Set(['bolt', 'thermometer', 'droplet', 'power', 'lightbulb', 'gauge', 'door', 'lift', 'wind', 'home', 'chart', 'alert', 'sun', 'fan', 'lock', 'signal', 'battery', 'device', 'bell', 'link']);

export const INST_META = {
  title: 'dashboard.title',
  admins: 'dashboard.admins',
};

export const OBJ_META = {
  widget: 'dashboard.widget',
  nickname: 'dashboard.nickname',
  color: 'dashboard.color',
  icon: 'dashboard.icon',
  // group widgets: functions with the same name form one widget
  timeline: 'dashboard.timeline', // discrete functions as state bars
  chart: 'dashboard.chart', // analog functions as lines in one graph
  // push button: value sent while pressed, and (optional) when released
  press: 'dashboard.press',
  release: 'dashboard.release',
};

/** Meta key for the colour of state_<x>. */
export const stateColorKey = (key) => `dashboard.color_${key}`;

/** Colour for the function's current value (dashboard.color_<x> of the matching state_<x>), or ''. */
export function stateColor(fn, value) {
  const st = stateFor(fn, value);
  return st ? safeColor(fn.meta?.[stateColorKey(st.key)]) : '';
}

/**
 * Group widgets. Membership = meta on each function, size/hours/colour in the layout file under "<prefix>:<name>".
 */
export const GROUPS = {
  timeline: { metaKey: 'dashboard.timeline', prefix: 't', type: 'timeline', icon: 'chart', label: 'tidslinje' },
  chart: { metaKey: 'dashboard.chart', prefix: 'c', type: 'multichart', icon: 'chart', label: 'graf' },
};

// ---- discrete functions (timeline) --------------------------------------------------------------

/** functionx types that report states rather than measurements. */
export const DISCRETE_TYPES = ['switch', 'door', 'window', 'movement', 'motion', 'presence', 'occupancy', 'boolean_text', 'binary', 'leak', 'water_leak', 'alarm', 'lock', 'contact', 'smoke', 'tamper', 'button'];

/** Default texts for 0/1 per type when the function has no text_on/text_off. */
const STATE_TEXT = {
  door: ['Stängd', 'Öppen'],
  window: ['Stängt', 'Öppet'],
  contact: ['Stängd', 'Öppen'],
  movement: ['Ingen rörelse', 'Rörelse'],
  motion: ['Ingen rörelse', 'Rörelse'],
  presence: ['Borta', 'Närvaro'],
  occupancy: ['Ledigt', 'Upptaget'],
  leak: ['Torrt', 'Läckage'],
  water_leak: ['Torrt', 'Läckage'],
  smoke: ['OK', 'Rök'],
  alarm: ['OK', 'Larm'],
  lock: ['Olåst', 'Låst'],
};

export const isDiscrete = (fn) => isBinary(fn) || DISCRETE_TYPES.includes(String(fn?.type || '').toLowerCase());

/**
 * Text for a discrete value: the matching state_<x>/text_<x> pair (e.g. state_closed=0, text_closed=Closed),
 * else a per-type default for 0/1, else the raw value.
 */
export function stateText(fn, value) {
  if (value === undefined || value === null || value === '') return 'Okänt';
  const st = stateFor(fn, value);
  if (st?.text) return st.text;
  const t = STATE_TEXT[String(fn?.type || '').toLowerCase()] || ['Av', 'På'];
  if (st) return st.active ? t[1] : t[0];
  if (stateMap(fn).length) return String(value);
  if (Number(value) === 1) return t[1];
  if (Number(value) === 0) return t[0];
  return String(value);
}

/** 'on' | 'off' | 'other' | 'none' for colouring. */
export function stateKind(fn, value) {
  if (value === undefined || value === null || value === '') return 'none';
  const st = stateFor(fn, value);
  if (st) return st.active ? 'on' : 'off';
  if (stateMap(fn).length) return 'other';
  const n = Number(value);
  return n === 0 ? 'off' : n === 1 ? 'on' : 'other';
}

export const LAYOUT_FILE = 'dashboard-layout.json';
export const LOGO_FILE = 'dashboard-logo.png';
export const LOGO_MAX_BYTES = 1024 * 1024;

export const FUNCTION_WIDGETS = [
  { id: 'value', label: 'Värde', help: 'Senaste värdet, formaterat enligt funktionens format/unit.' },
  { id: 'chart', label: 'Graf', help: 'Kurva över historiken (antal timmar sätts i layouten).' },
  { id: 'gauge', label: 'Mätare', help: 'Halvcirkel mellan min och max.' },
  { id: 'switch', label: 'Brytare', help: 'Skickar state_on/state_off till topic_write (eller topic_write_onoff) via MQTT.' },
  { id: 'status', label: 'Status', help: 'Av/på-indikator med text_on/text_off.' },
  { id: 'number', label: 'Börvärde / nivå', help: 'Skickar ett tal till topic_write via MQTT. Med min/max i meta blir det ett reglage (t.ex. dimmer).' },
  { id: 'button', label: 'Tryckknapp', help: 'Fjädrande knapp, t.ex. dörrklocka: skickar ett värde när den trycks ned och (valfritt) ett när den släpps.' },
];
export const DEVICE_WIDGETS = [{ id: 'card', label: 'Enhetskort', help: 'Alla funktioner som hör till enheten i ett kort.' }];
export const WIDGET_LABEL = { ...Object.fromEntries([...FUNCTION_WIDGETS, ...DEVICE_WIDGETS].map((w) => [w.id, w.label])), timeline: 'Tidslinje', multichart: 'Graf (flera)', www: 'Länkknapp (www)' };

/** Widget types that can be half a row high, e.g. a banner across the top of the dashboard. */
export const HALF_HEIGHT_TYPES = ['value', 'status', 'switch', 'button', 'www'];
export const heightOptions = (type) => [...(HALF_HEIGHT_TYPES.includes(type) ? [[0.5, '0,5 (banner)']] : []), [1, '1'], [2, '2'], [3, '3'], [4, '4']];

/**
 * Which functions/devices fit a widget type – used by the miniatures in "Lägg till widget" to narrow the list.
 * Value, graph, gauge and status take any function.
 */
export function fitsType(type, kind, obj) {
  if (type === 'card') return kind === 'device';
  if (kind !== 'function') return false;
  if (type === 'switch') return !!writeTopic(obj) && isBinary(obj);
  if (type === 'number' || type === 'button') return !!writeTopic(obj);
  if (type === 'status') return isDiscrete(obj);
  return true;
}

/** Default size and parameters per widget type (columns × rows in the grid). */
// Grid: 8 columns on wide screens, 6 / 4 / 2 on smaller ones (layout version 2). w is in those columns,
// so w = 1 is a half of the old column – e.g. two switches side by side on a phone.
export const GRID_COLUMNS = 8;
export const WIDTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, n === 1 ? '1 (halv)' : n === 8 ? '8 (hela bredden)' : String(n)]);
export const DEFAULT_LAYOUT = {
  value: { w: 2, h: 1 },
  status: { w: 2, h: 1 },
  switch: { w: 2, h: 1 },
  number: { w: 2, h: 1 },
  button: { w: 2, h: 1 },
  www: { w: 2, h: 1 },
  gauge: { w: 2, h: 2, min: 0, max: 100 },
  chart: { w: 4, h: 2, hours: 24 },
  card: { w: 4, h: 2 },
  timeline: { w: 8, h: 2, hours: 24 },
  multichart: { w: 4, h: 2, hours: 24 },
};

/** Series colours for multi-line graphs: profile colours first, then distinct hues. */
export const SERIES_COLORS = ['#0d3e53', '#1bb2bc', '#f6a53e', '#7c3aed', '#dc2626', '#16a34a', '#db2777', '#2563eb', '#ca8a04', '#475569'];
export const SERIES_COLORS_DARK = ['#b4dbea', '#1bb2bc', '#f6a53e', '#a78bfa', '#f87171', '#4ade80', '#f472b6', '#60a5fa', '#facc15', '#94a3b8'];

/** Unit of a function (meta.unit, or what follows the number in meta.format). */
export function unitOf(fn) {
  const m = fn?.meta || {};
  if (m.unit) return String(m.unit).trim();
  const f = String(m.format || '').replace(/%%/g, '%');
  const u = f.replace(/%[\d.]*[dfis]/, '').trim();
  return u;
}

export const keyOf = (kind, id) => `${kind === 'device' ? 'd' : 'f'}:${id}`;

// ---- control conventions in IoT Open function meta --------------------------------------------
//   topic_write        "set/obj/…" – where values are published to control the function
//   topic_write_onoff  + topic_read_onoff – separate on/off channel (e.g. dimmers)
//   min / max (/ step) – a level (dimmer 0–100) rather than an on/off state

/** Topic to publish control values to (topic_set is accepted as a legacy alias). */
export const writeTopic = (fn) => fn?.meta?.topic_write || fn?.meta?.topic_set || '';

/** Range for level-type functions, or null. */
export function rangeOf(fn) {
  const m = fn?.meta || {};
  const min = Number(m.min);
  const max = Number(m.max);
  if (m.min === undefined || m.max === undefined || m.min === '' || m.max === '' || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const step = Number(m.step);
  return { min, max, step: Number.isFinite(step) && step > 0 ? step : 1 };
}

/** On/off = state_on defined and not a level (dimmers also carry state_on/off for their on/off channel). */
export const isBinary = (fn) => stateMap(fn).length >= 2 && !rangeOf(fn);

/** Topics for the on/off channel: the dedicated *_onoff pair when present, otherwise the main topics. */
export function onOffTopics(fn) {
  const m = fn?.meta || {};
  if (m.topic_write_onoff) return { read: m.topic_read_onoff || m.topic_read, write: m.topic_write_onoff };
  return { read: m.topic_read, write: writeTopic(fn) };
}

/** Suggested widget type for an object that has none yet. */
export function suggestType(kind, obj) {
  if (kind === 'device') return 'card';
  if (writeTopic(obj)) return isBinary(obj) ? 'switch' : 'number';
  if (isBinary(obj)) return 'status';
  return 'value';
}

export const fnName = (f) => f.meta?.[OBJ_META.nickname] || f.meta?.name || f.type || `Funktion ${f.id}`;
export const devName = (d) => d.meta?.[OBJ_META.nickname] || d.meta?.name || d.type || `Enhet ${d.id}`;

/** Builds the list of widgets from the raw installation snapshot and the layout file. */
export function buildWidgets(raw, layout) {
  const out = [];
  const add = (kind, obj) => {
    const type = obj.meta?.[OBJ_META.widget];
    if (!type || type === 'none') return;
    const key = keyOf(kind, obj.id);
    const l = { ...(DEFAULT_LAYOUT[type] || { w: 1, h: 1 }), ...(layout.widgets?.[key] || {}) };
    out.push({
      key,
      kind,
      obj,
      type,
      name: kind === 'device' ? devName(obj) : fnName(obj),
      color: safeColor(obj.meta?.[OBJ_META.color]),
      // dashboard.icon, else IoT Open's standard meta "icon" when it is a name we can draw
      icon: obj.meta?.[OBJ_META.icon] || (ICON_SET.has(obj.meta?.icon) ? obj.meta.icon : ''),
      layout: l,
      // IoT Open is master: visible = "false" hides the widget (still listed, dimmed, in edit mode)
      hidden: isHidden(obj),
    });
  };
  raw.devices.forEach((d) => add('device', d));
  raw.functions.forEach((f) => add('function', f));
  // group widgets: functions sharing the same dashboard.timeline / dashboard.chart name form one widget
  for (const [kind, g] of Object.entries(GROUPS)) {
    const groups = new Map();
    for (const f of raw.functions) {
      const name = String(f.meta?.[g.metaKey] || '').trim();
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(f);
    }
    for (const [name, fns] of groups) {
      const key = `${g.prefix}:${name}`;
      out.push({
        key,
        kind,
        type: g.type,
        name,
        functions: fns.filter((f) => !isHidden(f)),
        hiddenFunctions: fns.filter(isHidden),
        color: safeColor(layout.widgets?.[key]?.color),
        icon: g.icon,
        layout: { ...DEFAULT_LAYOUT[g.type], ...(layout.widgets?.[key] || {}) },
        hidden: fns.every(isHidden),
      });
    }
  }
  // link buttons (www): only in the layout file, no IoT Open object behind them
  for (const [key, l] of Object.entries(layout.widgets || {})) {
    if (!key.startsWith(`${LINK_PREFIX}:`)) continue;
    out.push({
      key,
      kind: 'link',
      type: 'www',
      name: String(l.label || '').trim() || hostOf(l.url) || 'Länk',
      color: safeColor(l.color),
      icon: ICON_SET.has(l.icon) ? l.icon : 'link',
      layout: { ...DEFAULT_LAYOUT.www, ...l },
      hidden: false,
    });
  }
  // explicit order from the layout file first, then the rest by name
  return out.sort((a, b) => (a.layout.order ?? 1e9) - (b.layout.order ?? 1e9) || a.name.localeCompare(b.name, 'sv'));
}

// ---- link buttons (www) ---------------------------------------------------------------------------
export const LINK_PREFIX = 'u';

/** The URL when it is a plain http(s) address, else '' – nothing else (javascript: etc.) is ever opened. */
export function safeUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

const hostOf = (v) => {
  const u = safeUrl(v);
  return u ? new URL(u).host : '';
};

/** A new, unused key for a link button. */
export const newLinkKey = (layout) => {
  let n = 1;
  while (layout.widgets?.[`${LINK_PREFIX}:${n}`]) n++;
  return `${LINK_PREFIX}:${n}`;
};

/** The functions a widget shows (for status): its own function, a device's functions, or a group's members. */
export function widgetFunctions(w, raw) {
  if (w.functions) return w.functions;
  if (w.kind === 'link') return [];
  if (w.kind === 'device') return (raw?.functions || []).filter((f) => String(f.meta?.device_id) === String(w.obj.id) && !isHidden(f));
  return w.obj ? [w.obj] : [];
}

/** IoT Open meta "visible" = "false" hides an object everywhere in the dashboard (missing or "true" = shown). */
// IoT Open documents visible = "0"/"1" (tech/docs/platform/devxfuncx/meta-keys); "false"/"true" is also in use.
export const isHidden = (o) => ['0', 'false', 'no'].includes(String(o?.meta?.visible ?? '').trim().toLowerCase());

/** Objects that could become widgets but are not shown yet. */
export function candidates(raw) {
  const free = (o) => !o.meta?.[OBJ_META.widget] || o.meta[OBJ_META.widget] === 'none';
  return [
    ...raw.devices.filter(free).map((o) => ({ kind: 'device', obj: o, name: devName(o) })),
    ...raw.functions.filter(free).map((o) => ({ kind: 'function', obj: o, name: fnName(o) })),
  ];
}

/** Admin = listed in dashboard.admins (id or e-mail). No list = anyone (IoT Open still decides on writes). */
export function isAdmin(user, installation) {
  const list = String(installation?.meta?.[INST_META.admins] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(String(user?.id)) || list.includes(String(user?.email || '').toLowerCase());
}

// ---- layout file (File API) -------------------------------------------------------------

async function findFile(iid, name) {
  const files = (await lynx.files(iid)) || [];
  return files.filter((f) => f.name === name).sort((a, b) => (b.updated || b.created) - (a.updated || a.created))[0];
}

/** Version 1 files used a 4-column grid; their widths are doubled for the 8-column grid of version 2. */
function upgradeLayout(data) {
  if (Number(data.version) >= 2) return data;
  const widgets = Object.fromEntries(Object.entries(data.widgets || {}).map(([k, v]) => [k, v.w ? { ...v, w: Math.min(GRID_COLUMNS, v.w * 2) } : v]));
  return { ...data, version: 2, widgets };
}

export async function readLayout(iid) {
  const empty = { version: 2, widgets: {} };
  const f = await findFile(iid, LAYOUT_FILE).catch(() => null);
  if (!f) return empty;
  try {
    const data = JSON.parse(await (await lynx.downloadFile(f.hash)).text());
    return upgradeLayout({ ...empty, ...data, widgets: data.widgets || {} });
  } catch {
    return empty;
  }
}

export async function writeLayout(iid, layout) {
  const body = { ...layout, version: 2, updated: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
  const f = await findFile(iid, LAYOUT_FILE);
  return f ? lynx.replaceFile(iid, f.id, blob, LAYOUT_FILE) : lynx.uploadFile(iid, blob, LAYOUT_FILE);
}

// ---- logo file (File API) -------------------------------------------------------------
// Any size works: the header scales it to a fixed height with the aspect ratio kept.

/** { hash, blob } of the installation's logo, or null when it has none (= IoT Open default). */
export async function readLogo(iid, knownHash) {
  const f = await findFile(iid, LOGO_FILE).catch(() => null);
  if (!f) return null;
  if (f.hash === knownHash) return { hash: f.hash, blob: null }; // unchanged – keep the one already shown
  const blob = await (await lynx.downloadFile(f.hash)).blob();
  return { hash: f.hash, blob: new Blob([blob], { type: 'image/png' }) };
}

/** Uploads (or replaces) the logo; a null file removes it so the default logo is shown again. */
export async function writeLogo(iid, file) {
  const f = await findFile(iid, LOGO_FILE);
  if (!file) return f ? lynx.deleteFile(iid, f.id) : null;
  const blob = new Blob([file], { type: 'image/png' });
  return f ? lynx.replaceFile(iid, f.id, blob, LOGO_FILE) : lynx.uploadFile(iid, blob, LOGO_FILE);
}

/** Checks that a picked file is a PNG within the size limit; resolves to its pixel size. */
export async function checkLogo(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  if (!png) throw new Error('Filen är ingen PNG-bild.');
  if (file.size > LOGO_MAX_BYTES) throw new Error(`Filen är ${Math.round(file.size / 1024)} kB, max är ${LOGO_MAX_BYTES / 1024} kB.`);
  const bmp = await createImageBitmap(file);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** Writes widget metadata on a function or device. Only changed keys are written; an empty value deletes the key. */
export async function writeObjectMeta(iid, kind, obj, values) {
  const put = kind === 'device' ? lynx.putDeviceMeta : lynx.putFunctionMeta;
  const del = kind === 'device' ? lynx.deleteDeviceMeta : lynx.deleteFunctionMeta;
  for (const [k, v] of Object.entries(values)) {
    const key = OBJ_META[k] || k;
    const next = String(v ?? '').trim();
    if (String(obj.meta?.[key] ?? '') === next) continue;
    if (next) await put(iid, obj.id, key, next);
    else if (obj.meta && key in obj.meta) await del(iid, obj.id, key);
  }
}

/** Same rule for installation metadata. */
export async function writeInstallationMeta(inst, values) {
  for (const [key, v] of Object.entries(values)) {
    const next = String(v ?? '').trim();
    if (String(inst.meta?.[key] ?? '') === next) continue;
    if (next) await lynx.putInstallationMeta(inst.id, key, next);
    else if (inst.meta && key in inst.meta) await lynx.deleteInstallationMeta(inst.id, key);
  }
}

// ---- colours (installation metadata) -------------------------------------------------------------
// Each key overrides one CSS variable while the installation's dashboard is open. Empty = graphic profile default.
export const THEME_GROUPS = ['Grundfärger', 'Status', 'Informationsruta', 'Tidsintervall'];
export const THEME_META = [
  { group: 'Grundfärger', key: 'dashboard.color_primary', css: '--brand-primary', label: 'Primärfärg', help: 'Header, rubriker och valda knappar', def: '#0d3e53' },
  { group: 'Grundfärger', key: 'dashboard.color_widget', css: '--data', label: 'Widgetfärg', help: 'Standardfärg för widgets och på-läge i tidslinjer. Standard = primärfärgen', def: '#0d3e53', follows: 'dashboard.color_primary' },
  { group: 'Grundfärger', key: 'dashboard.color_accent', css: '--cta', label: 'Accentfärg', help: 'Primärknappar (Spara, Klar, Logga in)', def: '#f6a53e' },
  { group: 'Grundfärger', key: 'dashboard.color_header', css: '--topbar', label: 'Headerfärg', help: 'Bakgrund i headern. Standard = primärfärgen', def: '#0d3e53', follows: 'dashboard.color_primary' },
  { group: 'Grundfärger', key: 'dashboard.color_title', css: '--title-color', label: 'Titel', help: 'Installationens namn överst på dashboarden (bara i ljust läge). Standard = primärfärgen', def: '#0d3e53', follows: 'dashboard.color_primary', lightOnly: true },
  { group: 'Grundfärger', key: 'dashboard.color_background', css: '--bg', label: 'Bakgrund', help: 'Sidans bakgrund (bara i ljust läge)', def: '#edf6fa', lightOnly: true },
  { group: 'Status', key: 'dashboard.color_warning', css: '--status-warn', label: 'Warning', help: 'Widgetens färg vid status 1 (Warning)', def: '#f6a53e' },
  { group: 'Status', key: 'dashboard.color_critical', css: '--status-crit', label: 'Critical', help: 'Widgetens färg vid status 2 (Critical)', def: '#d32f2f' },
  // the info box, e.g. "Redigeringsläge. Dra i en widget …"
  { group: 'Informationsruta', key: 'dashboard.color_info_background', css: '--info-bg', label: 'Bakgrund', help: 'Rutan "Redigeringsläge …" (bara i ljust läge)', def: '#edf6fa', lightOnly: true },
  { group: 'Informationsruta', key: 'dashboard.color_info_text', css: '--info-text', label: 'Text', help: 'Text i rutan (bara i ljust läge). Standard = primärfärgen', def: '#0d3e53', follows: 'dashboard.color_primary', lightOnly: true },
  // the 1 h / 24 h / 7 d / 30 d / 1 år buttons in graphs and timelines
  { group: 'Tidsintervall', key: 'dashboard.color_range_background', css: '--range-bg', label: 'Bakgrund', help: 'Ramen runt knapparna 1 h, 24 h …', def: '#e2eff5', lightOnly: true },
  { group: 'Tidsintervall', key: 'dashboard.color_range_text', css: '--range-text', label: 'Text', help: 'Knappar som inte är valda', def: '#4f6b78', lightOnly: true },
  { group: 'Tidsintervall', key: 'dashboard.color_range_selected', css: '--range-on-bg', label: 'Valt intervall', help: 'Bakgrund på det valda intervallet', def: '#ffffff', lightOnly: true },
  { group: 'Tidsintervall', key: 'dashboard.color_range_selected_text', css: '--range-on-text', label: 'Valt intervall, text', help: 'Text på det valda intervallet', def: '#0d2e3d', lightOnly: true },
];

/** Applies the installation's colours to the page; returns a function that restores the defaults. */
export function applyTheme(inst) {
  const root = document.documentElement;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const set = [];
  const put = (prop, v) => (root.style.setProperty(prop, v), set.push(prop));
  for (const t of THEME_META) {
    const v = String(inst?.meta?.[t.key] || '').trim();
    if (!v || (t.lightOnly && dark) || !CSS.supports('color', v)) continue;
    put(t.css, v);
  }
  // text on the header and on primary buttons follows their background: dark on light colours, white on dark
  const header = root.style.getPropertyValue('--topbar') || (set.includes('--brand-primary') ? root.style.getPropertyValue('--brand-primary') : '');
  if (header && isLight(header)) {
    put('--topbar-text', '#0d2e3d');
    put('--topbar-muted', 'rgba(13, 46, 61, 0.7)');
    put('--topbar-line', 'rgba(13, 46, 61, 0.2)');
    put('--topbar-hover', 'rgba(13, 46, 61, 0.08)');
    put('--topbar-shadow', '0 1px 0 rgba(13, 46, 61, 0.12)');
  }
  const cta = root.style.getPropertyValue('--cta');
  if (cta) put('--cta-text', isLight(cta) ? '#0d2e3d' : '#ffffff');
  return () => set.forEach((p) => root.style.removeProperty(p));
}

/** True for colours where dark text reads better than white (relative luminance above ~0.45). */
export function isLight(color) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.45;
}
