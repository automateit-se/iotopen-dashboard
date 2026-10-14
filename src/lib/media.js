// A media player (e.g. a Sonos speaker mirrored from Home Assistant) is one IoT Open device with up to five
// functions, found by the last part of topic_read (<base>/playing etc.) or else by a name ending in the role:
//
//   playing   Uppspelning   switch, 1 = playing; msg = "Artist – Titel" of the current track
//   volume    Volym         dimmer 0–100 %
//   mute      Mute          switch
//   state     Status        read only text: playing / paused / idle / off / unavailable …
//   power     På/av         switch
//
// Only the functions the device has are shown; a player without volume support simply gets no slider.

import { fnName, isHidden } from './dashboard.js';

export const MEDIA_ROLES = ['playing', 'volume', 'mute', 'state', 'power'];
const NAME_WORDS = {
  playing: ['uppspelning', 'playing', 'play'],
  volume: ['volym', 'volume'],
  mute: ['mute', 'ljud av', 'tyst'],
  state: ['status', 'state'],
  power: ['på/av', 'power', 'ström'],
};

const lastPart = (t) =>
  String(t || '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .toLowerCase();
const baseOf = (t) => String(t || '').replace(/\/+$/, '').replace(/\/[^/]*$/, '');

/** The role of a function in a media player, or ''. */
export function mediaRole(f) {
  const part = lastPart(f.meta?.topic_read);
  if (MEDIA_ROLES.includes(part)) return part;
  const name = fnName(f).toLowerCase().trim();
  return MEDIA_ROLES.find((r) => NAME_WORDS[r].some((w) => name === w || name.endsWith(` ${w}`))) || '';
}

/**
 * The media functions of a device: { playing, volume, mute, state, power } (missing roles left out). With several
 * players on one device, the functions sharing the topic base of the first "Uppspelning" (or Status) are used.
 */
export function mediaFunctions(raw, deviceId) {
  const fns = (raw?.functions || []).filter((f) => String(f.meta?.device_id) === String(deviceId) && !isHidden(f));
  const withRole = fns.map((f) => [mediaRole(f), f]).filter(([r]) => r);
  const lead = withRole.find(([r]) => r === 'playing') || withRole.find(([r]) => r === 'state') || withRole[0];
  if (!lead) return {};
  const base = MEDIA_ROLES.includes(lastPart(lead[1].meta?.topic_read)) ? baseOf(lead[1].meta.topic_read) : '';
  const out = {};
  for (const [r, f] of withRole) {
    if (out[r]) continue;
    if (base && MEDIA_ROLES.includes(lastPart(f.meta?.topic_read)) && baseOf(f.meta.topic_read) !== base) continue;
    out[r] = f;
  }
  return out;
}

/**
 * True when the device looks like a media player: it has a playing function, or a state function together with
 * volume or mute (many other devices also report on …/state or …/power).
 */
export const isMediaDevice = (raw, deviceId) => {
  const m = mediaFunctions(raw, deviceId);
  return !!(m.playing || (m.state && (m.volume || m.mute)));
};

const STATE_SV = {
  playing: 'Spelar',
  paused: 'Pausad',
  idle: 'Inaktiv',
  off: 'Avstängd',
  on: 'På',
  standby: 'Viloläge',
  buffering: 'Buffrar',
  unavailable: 'Ej tillgänglig',
  unknown: 'Okänt',
};

/** Swedish text for a Home Assistant media state, or the state itself. */
export const mediaStateText = (s) => STATE_SV[String(s || '').trim().toLowerCase()] || String(s || '').trim();
