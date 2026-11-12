// The installation's mode from the Mode edge app (https://github.com/automateit-se/edge-app-mode): a function of
// type "mode" whose metadata mode.states lists the states as value:key:label, e.g.
//   mode.states = 0:home:Hemma,1:away:Borta,2:vacation:Semester
// The value is the state's number; a change is sent to topic_write as that number.

/** [{ value, key, label }] from mode.states, in the order given. */
export function parseModeStates(text) {
  const out = [];
  for (const part of String(text || '').split(',')) {
    const m = part.trim().match(/^(\d+):([a-z0-9_-]+):?(.*)$/i);
    if (m) out.push({ value: Number(m[1]), key: m[2], label: m[3].trim() || m[2] });
  }
  return out;
}

/** A function from the Mode app (type mode, or any function with mode.states). */
export const isMode = (fn) => fn?.type === 'mode' || !!fn?.meta?.['mode.states'];

export const modeStates = (fn) => parseModeStates(fn?.meta?.['mode.states']);

/** The state a value means, or null. */
export function modeState(fn, value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return modeStates(fn).find((s) => s.value === n || s.key === String(value)) || null;
}
