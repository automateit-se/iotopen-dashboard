// MQTT widgets ("m:<n>" in the layout file): show what arrives on any topic of the installation, also topics
// without a function in IoT Open. Read only - nothing is ever published from them.
//
//   { type: "mqtt", topic: "sensor/hall/raw", mode: "value" | "json" | "log" | "table", path: "data.temp",
//     unit, decimals, rows, states: [{ value, text, color }], label, icon, color, w, h, order, page }
//
// The topic is given without the client id; the dashboard puts "<client_id>/" in front, so a widget can only
// ever subscribe inside the open installation. The broker in IoT Open decides what the token may read.

export const MQTT_PREFIX = 'm';

export const MQTT_MODES = [
  { id: 'value', label: 'Värde', help: 'Senaste värdet, eller ett fält ur ett JSON-meddelande.' },
  { id: 'json', label: 'JSON', help: 'Hela det senaste meddelandet, formaterat.' },
  { id: 'log', label: 'Logg', help: 'De senaste meddelandena med tid.' },
  { id: 'table', label: 'Tabell', help: 'En rad per topic med senaste värdet - för topics med + eller #.' },
];

export const MAX_TOPIC_LENGTH = 256;
export const MAX_TEXT = 4096; // longer payloads are cut when stored
export const MAX_SHOWN = 500; // longest text shown in a value, log row or table cell
export const MAX_TABLE_ROWS = 50;
export const MAX_LOG_ROWS = 50;
export const LOG_BUFFER = 500; // messages kept for log widgets, all MQTT widgets together

/** A new, unused key for an MQTT widget. */
export const newMqttKey = (layout) => {
  let n = 1;
  while (layout.widgets?.[`${MQTT_PREFIX}:${n}`]) n++;
  return `${MQTT_PREFIX}:${n}`;
};

/**
 * The topic filter as typed, checked: without the client id ("5001/x" -> "x"), no leading or trailing "/",
 * "+" only as a whole level, "#" only as the last level. Returns { topic } or { error }.
 */
export function checkTopic(input) {
  const t = String(input ?? '')
    .trim()
    .replace(/^\d+\//, '');
  if (!t) return { error: 'Ange en topic.' };
  if (t.length > MAX_TOPIC_LENGTH) return { error: `Högst ${MAX_TOPIC_LENGTH} tecken.` };
  if (/[\s\u0000]/.test(t)) return { error: 'En topic får inte innehålla mellanslag.' };
  if (t.startsWith('/') || t.endsWith('/')) return { error: 'Börja och sluta inte med "/".' };
  if (t.startsWith('$')) return { error: 'Systemtopics ($…) kan inte visas.' };
  const levels = t.split('/');
  if (levels.some((l) => l === '')) return { error: 'Två "/" i rad är inte tillåtet.' };
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i];
    if (l.includes('#') && (l !== '#' || i !== levels.length - 1)) return { error: '"#" får bara stå sist, som en egen nivå (t.ex. sensor/#).' };
    if (l.includes('+') && l !== '+') return { error: '"+" måste vara en egen nivå (t.ex. sensor/+/temp).' };
  }
  return { topic: t };
}

/** True when the filter has + or #, i.e. can match several topics. */
export const isWildcard = (filter) => /(^|\/)[+#](\/|$)/.test(String(filter || ''));

/** MQTT topic matching: "+" = one level, "#" = this level and everything below. */
export function topicMatches(filter, topic) {
  const f = String(filter).split('/');
  const t = String(topic).split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** The checked topic filters of all MQTT widgets in a layout. */
export function mqttFilters(layout) {
  const out = new Set();
  for (const [key, l] of Object.entries(layout?.widgets || {})) {
    if (!key.startsWith(`${MQTT_PREFIX}:`)) continue;
    const { topic } = checkTopic(l?.topic);
    if (topic) out.add(topic);
  }
  return [...out];
}

/** The payload text as JSON when it is JSON, else the trimmed text. */
export function parsePayload(text) {
  const s = String(text ?? '');
  try {
    return JSON.parse(s);
  } catch {
    return s.trim();
  }
}

/** "data.temp", "values.0" -> the field, or undefined. */
export function pickPath(payload, path) {
  const p = String(path || '').trim();
  if (!p) return payload;
  let cur = payload;
  for (const part of p.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * What a widget shows of a message: the field at `path`, or with no path the "value" of an IoT Open style
 * object ({ value, msg, timestamp }), else the whole payload.
 */
export function valueOfMessage(m, path) {
  if (!m) return undefined;
  const p = String(path || '').trim();
  if (p) return pickPath(m.payload, p);
  const pl = m.payload;
  if (pl && typeof pl === 'object' && !Array.isArray(pl) && 'value' in pl) return pl.value;
  return pl;
}

const cut = (s, n = MAX_SHOWN) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A value as text: a number with decimals and unit, a text as it is, an object as compact JSON. Always plain text. */
export function formatMqttValue(v, { unit = '', decimals = '' } = {}) {
  if (v === undefined) return '–';
  if (v === null) return 'null';
  if (typeof v === 'object') return cut(JSON.stringify(v));
  const d = decimals === '' || decimals === undefined || decimals === null ? NaN : Number(decimals);
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN;
  let s;
  if (Number.isFinite(n) && Number.isInteger(d) && d >= 0 && d <= 6) s = n.toFixed(d);
  else s = String(v);
  s = cut(s);
  const u = String(unit || '').trim();
  return u ? `${s} ${u}` : s;
}

/** The whole payload, indented when it is JSON. */
export function prettyPayload(m) {
  if (!m) return '';
  const p = m.payload;
  const s = p !== null && typeof p === 'object' ? JSON.stringify(p, null, 2) : String(m.text ?? '');
  return cut(s, 2000);
}

/** The state entry ({ value, text, color }) whose value equals the shown value, or null. */
export function mqttState(states, v) {
  if (!Array.isArray(states) || v === undefined || v === null || typeof v === 'object') return null;
  return states.find((s) => String(s?.value ?? '').trim() !== '' && String(s.value).trim() === String(v).trim()) || null;
}

/** "5001/sensor/a/temp" -> "sensor/a/temp". */
export const shortTopic = (full) => String(full || '').replace(/^\d+\//, '');

/**
 * The store behind the MQTT widgets: the latest message per topic (all topics), and a shared log of recent
 * messages on topics that some MQTT widget listens to.
 */
export function createMqttStore() {
  const latest = new Map(); // topic (no client id) -> message
  let log = [];
  return {
    /** Stores one message; returns it. */
    add(topic, text, { retained = false, filters = [] } = {}) {
      const s = String(text ?? '');
      const body = s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
      const payload = parsePayload(body);
      const ts = Number(payload && typeof payload === 'object' ? payload.timestamp : NaN);
      const m = { topic, text: body, payload, retained, truncated: s.length > MAX_TEXT, timestamp: Number.isFinite(ts) && ts > 0 ? ts : retained ? null : Date.now() / 1000, received: Date.now() };
      // a broker sends retained messages again for every new subscription: the same text is not a new event
      const prev = latest.get(topic);
      if (retained && prev && prev.text === body) return prev;
      latest.set(topic, m);
      if (filters.some((f) => topicMatches(f, topic))) {
        log.push(m);
        if (log.length > LOG_BUFFER) log = log.slice(-LOG_BUFFER);
      }
      return m;
    },
    /** Latest message per matching topic, sorted by topic. */
    latest(filter) {
      if (!isWildcard(filter)) return latest.has(filter) ? [latest.get(filter)] : [];
      return [...latest.values()].filter((m) => topicMatches(filter, m.topic)).sort((a, b) => a.topic.localeCompare(b.topic, 'sv'));
    },
    /** The newest message on a matching topic, or null. */
    newest(filter) {
      let best = null;
      for (const m of this.latest(filter)) if (!best || m.received > best.received) best = m;
      return best;
    },
    /** The last `n` logged messages on matching topics, newest first. */
    log(filter, n) {
      const out = [];
      for (let i = log.length - 1; i >= 0 && out.length < n; i--) if (topicMatches(filter, log[i].topic)) out.push(log[i]);
      return out;
    },
    clear() {
      latest.clear();
      log = [];
    },
  };
}
