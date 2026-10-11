// Value formatting using IoT Open conventions on function meta:
//   format (printf style, e.g. "%.1f °C"), unit,
//   state_<x> + text_<x> pairs for discrete values, e.g. state_on/text_on, state_open/text_open,
//   state_closed/text_closed, state_true/text_true, state_movement/text_movement …

// state_<x> names that mean the "active" side (drawn as on in toggles, status dots and timelines)
const ACTIVE_STATES = ['on', 'open', 'true', 'movement', 'motion', 'presence', 'occupied', 'detected', 'leak', 'wet', 'alarm', 'active', 'tamper', 'smoke', 'unlocked'];

/** All state_<x> values of a function: [{ key, value, text, active }]. */
export function stateMap(fn) {
  const m = fn?.meta || {};
  const out = [];
  for (const [k, v] of Object.entries(m)) {
    const mm = /^state_(.+)$/.exec(k);
    if (!mm || v === undefined || v === '') continue;
    const key = mm[1];
    out.push({ key, value: String(v), text: m[`text_${key}`] || '', active: ACTIVE_STATES.includes(key.toLowerCase()) });
  }
  return out;
}

/** The state entry matching a value, or null. */
export const stateFor = (fn, value) => (value === undefined || value === null ? null : stateMap(fn).find((s) => s.value === String(value)) || null);

/** The value to publish for "on"/"off" (state_on/state_off, else the active/inactive pair, else 1/0). */
export function onOffValues(fn) {
  const s = stateMap(fn);
  const on = s.find((x) => x.key === 'on') || s.find((x) => x.active);
  const off = s.find((x) => x.key === 'off') || s.find((x) => !x.active);
  return { on: on ? on.value : 1, off: off ? off.value : 0 };
}

export function isOn(fn, value) {
  const st = stateFor(fn, value);
  if (st) return st.active;
  if (stateMap(fn).length) return false;
  return Number(value) > 0;
}

export function formatValue(fn, value) {
  if (value === undefined || value === null || value === '') return '–';
  const m = fn?.meta || {};
  const st = stateFor(fn, value);
  if (st) return st.text || (st.key === 'on' ? 'På' : st.key === 'off' ? 'Av' : st.key);
  if (m.format) {
    // printf subset: %d %i %s %f %.2f %5.1f, and the common typo %1f (treated as %.1f)
    return m.format
      .replace(/%%/g, '\u0000')
      .replace(/%\d*\.(\d+)f/, (_, d) => Number(value).toFixed(Number(d)))
      .replace(/%(\d)f/, (_, d) => Number(value).toFixed(Number(d)))
      .replace(/%\d*(d|i)/, () => String(Math.round(Number(value))))
      .replace(/%f/, () => String(Number(value)))
      .replace(/%s/, () => String(value))
      .replace(/\u0000/g, '%');
  }
  const n = Number(value);
  const v = Number.isFinite(n) && !Number.isInteger(n) ? n.toFixed(2) : String(value);
  return m.unit ? `${v} ${m.unit}` : v;
}

export function formatAge(ts) {
  if (!ts) return 'inget värde';
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return 'nyss';
  if (s < 3600) return `${Math.round(s / 60)} min sedan`;
  if (s < 86400) return `${Math.round(s / 3600)} h sedan`;
  return new Date(ts * 1000).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}
