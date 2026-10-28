// A thermostat (e.g. a climate entity mirrored from Home Assistant) is one IoT Open device with up to four
// functions, found by the last part of topic_read (<base>/target etc.) or else by a name ending in the role:
//
//   current   Temperatur   temperature, read only
//   target    Börvärde     setpoint with min / max / step, controlled through topic_write
//   mode      Läge         text: off / heat / cool / auto …, controlled through topic_write; meta ha.hvac_modes
//                          lists the modes the thermostat offers, comma separated
//   action    Drift        read only text: heating / cooling / idle / off …
//
// Only the functions the device has are shown; a thermostat without modes simply gets no mode buttons.

import { fnName, isHidden } from './dashboard.js';

export const THERMOSTAT_ROLES = ['current', 'target', 'mode', 'action'];
const NAME_WORDS = {
  current: ['temperatur', 'temperature', 'aktuell temperatur', 'current temperature'],
  target: ['börvärde', 'target temperature', 'setpoint'],
  mode: ['läge', 'mode'],
  action: ['drift', 'action'],
};

const lastPart = (t) =>
  String(t || '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .toLowerCase();
const baseOf = (t) => String(t || '').replace(/\/+$/, '').replace(/\/[^/]*$/, '');

/** The role of a function in a thermostat, or ''. */
export function thermostatRole(f) {
  const part = lastPart(f.meta?.topic_read);
  if (THERMOSTAT_ROLES.includes(part) && (part !== 'current' || f.type === 'temperature' || f.meta?.['ha.part'] === 'current')) return part;
  const name = fnName(f).toLowerCase().trim();
  return THERMOSTAT_ROLES.find((r) => NAME_WORDS[r].some((w) => name === w || name.endsWith(` ${w}`))) || '';
}

/**
 * The thermostat functions of a device: { current, target, mode, action } (missing roles left out). With several
 * thermostats on one device, the functions sharing the topic base of the first Börvärde (or Läge) are used.
 */
export function thermostatFunctions(raw, deviceId) {
  const fns = (raw?.functions || []).filter((f) => String(f.meta?.device_id) === String(deviceId) && !isHidden(f));
  const withRole = fns.map((f) => [thermostatRole(f), f]).filter(([r]) => r);
  const lead = withRole.find(([r]) => r === 'target') || withRole.find(([r]) => r === 'mode');
  if (!lead) return {};
  const base = THERMOSTAT_ROLES.includes(lastPart(lead[1].meta?.topic_read)) ? baseOf(lead[1].meta.topic_read) : '';
  const out = {};
  for (const [r, f] of withRole) {
    if (out[r]) continue;
    if (base && THERMOSTAT_ROLES.includes(lastPart(f.meta?.topic_read)) && baseOf(f.meta.topic_read) !== base) continue;
    out[r] = f;
  }
  return out;
}

/** True when the device looks like a thermostat: a setpoint (Börvärde), or a mode together with a temperature. */
export const isThermostatDevice = (raw, deviceId) => {
  const t = thermostatFunctions(raw, deviceId);
  return !!(t.target || (t.mode && t.current));
};

/** The modes offered (meta ha.hvac_modes or dashboard.modes, comma separated). */
export const thermostatModes = (modeFn) =>
  String(modeFn?.meta?.['dashboard.modes'] || modeFn?.meta?.['ha.hvac_modes'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const MODE_SV = {
  off: 'Av',
  heat: 'Värme',
  cool: 'Kyla',
  heat_cool: 'Värme/kyla',
  auto: 'Auto',
  dry: 'Avfuktning',
  fan_only: 'Fläkt',
};
const ACTION_SV = {
  off: 'Av',
  heating: 'Värmer',
  cooling: 'Kyler',
  drying: 'Avfuktar',
  idle: 'Vilar',
  fan: 'Fläkt',
  preheating: 'Förvärmer',
  defrosting: 'Avfrostar',
  unavailable: 'Ej tillgänglig',
  unknown: 'Okänt',
};

/** Swedish text for a Home Assistant HVAC mode, or the mode itself. */
export const modeText = (s) => MODE_SV[String(s || '').trim().toLowerCase()] || String(s || '').trim();
/** Swedish text for a Home Assistant HVAC action, or the action itself. */
export const actionText = (s) => ACTION_SV[String(s || '').trim().toLowerCase()] || String(s || '').trim();

/**
 * The next setpoint after `steps` presses of − / +: on the step grid from min, kept within min..max.
 * Starting from no value, the first press lands on the middle of the range.
 */
export function stepSetpoint(current, steps, { min, max, step }) {
  const s = step > 0 ? step : 0.5;
  const start = Number.isFinite(current) ? current : Math.round((min + max) / 2 / s) * s;
  const n = Math.round((start - min) / s) + (Number.isFinite(current) ? steps : 0);
  const v = min + n * s;
  const decimals = (String(s).split('.')[1] || '').length;
  return Number(Math.min(max, Math.max(min, v)).toFixed(decimals));
}

// ---- colour zones for the set point (layout "zones") -------------------------------------------------------
// Each zone runs up to (not including) `to`; the last has no `to`. The set point, its line in the Minigraf and the
// dial take the colour of the zone the set point is in.

export const DEFAULT_ZONES = [
  { to: 15, color: '#2b6fd6', text: 'Svalt' },
  { to: 20, color: '#18a058', text: 'Komfort' },
  { to: 22, color: '#ea7a12', text: 'Varmt' },
  { color: '#d43c2f', text: 'Hett' },
];

/** The zones of a widget: its own (layout "zones") when valid, sorted, with an open last zone; else the defaults. */
export function zonesOf(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_ZONES;
  const rows = list
    .filter((z) => z && typeof z.color === 'string' && z.color.trim())
    .map((z) => ({ to: z.to === '' || z.to === null || z.to === undefined ? undefined : Number(z.to), color: z.color.trim(), text: String(z.text || '').trim() }))
    .filter((z) => z.to === undefined || Number.isFinite(z.to));
  if (!rows.length) return DEFAULT_ZONES;
  const bounded = rows.filter((z) => z.to !== undefined).sort((a, b) => a.to - b.to);
  const open = rows.find((z) => z.to === undefined) || { ...bounded.pop(), to: undefined };
  return [...bounded, { ...open, to: undefined }];
}

/** The zone a value is in. */
export const zoneFor = (value, zones = DEFAULT_ZONES) => zones.find((z) => z.to === undefined || value < z.to) || zones[zones.length - 1];

/**
 * The set point's history as a step line split where the zone changes: [{ d, color }] in a box of width × height.
 * `points` are { ts, value } sorted by time; each value holds until the next one, the last until `to`.
 * `lo` / `hi`: the y range (shared with the temperature line).
 */
export function setpointSegments(points, from, to, lo, hi, zones = DEFAULT_ZONES, width = 100, height = 40) {
  const p = points.filter((x) => Number.isFinite(x.value) && x.ts <= to);
  // the value at the start of the window: the last one before it
  const before = p.filter((x) => x.ts < from).pop();
  const inside = p.filter((x) => x.ts >= from);
  const steps = before ? [{ ts: from, value: before.value }, ...inside] : inside;
  if (!steps.length || to <= from || hi <= lo) return [];
  const X = (t) => (((t - from) / (to - from)) * width).toFixed(2);
  const Y = (v) => (height - ((v - lo) / (hi - lo)) * height).toFixed(2);
  const out = [];
  steps.forEach((s, i) => {
    const end = i + 1 < steps.length ? steps[i + 1].ts : to;
    const color = zoneFor(s.value, zones).color;
    const last = out[out.length - 1];
    // one path per run of the same colour; the vertical step belongs to the new value's colour
    if (last && last.color === color) last.d += ` V${Y(s.value)} H${X(end)}`;
    else out.push({ d: `M${X(s.ts)},${Y(i ? steps[i - 1].value : s.value)} V${Y(s.value)} H${X(end)}`, color });
  });
  return out;
}

/**
 * Dial geometry: the value at a point (x, y relative to the centre, y down) on a ring that starts at `start`
 * degrees (0 = right, clockwise) and sweeps `sweep` degrees from min to max, snapped to the step.
 */
export function dialValueAt(x, y, { min, max, step }, start = 135, sweep = 270) {
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  const gap = (360 - sweep) / 2;
  while (deg < start - gap) deg += 360;
  while (deg > start + sweep + gap) deg -= 360;
  const t = Math.max(0, Math.min(1, (deg - start) / sweep));
  const s = step > 0 ? step : 0.5;
  const decimals = (String(s).split('.')[1] || '').length;
  return Number(Math.min(max, Math.max(min, min + Math.round((t * (max - min)) / s) * s)).toFixed(decimals));
}
