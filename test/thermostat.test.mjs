import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/dashboard.js (names, visibility) reads the page address when loaded
globalThis.window ??= { location: { href: 'http://localhost/', hash: '', pathname: '/', search: '' } };
const { isThermostatDevice, stepSetpoint, thermostatFunctions, thermostatModes, thermostatRole, modeText, actionText } = await import('../src/lib/thermostat.js');

const fn = (id, device, type, name, topic, meta = {}) => ({ id, type, meta: { device_id: String(device), name, topic_read: topic, ...meta } });
const base = 'obj/ha/climate/hall';
const raw = {
  functions: [
    fn(1, 10, 'temperature', 'Hall Temperatur', `${base}/current`),
    fn(2, 10, 'setpoint', 'Hall Börvärde', `${base}/target`, { topic_write: `set/${base}/target`, min: '5', max: '30', step: '0.5' }),
    fn(3, 10, 'text', 'Hall Läge', `${base}/mode`, { topic_write: `set/${base}/mode`, 'ha.hvac_modes': 'off, heat,auto' }),
    fn(4, 10, 'text', 'Hall Drift', `${base}/action`),
    // a second thermostat on the same device: not mixed in
    fn(5, 10, 'temperature', 'Kök Temperatur', 'obj/ha/climate/kok/current'),
    // an electricity meter's current is no thermostat temperature
    fn(6, 20, 'current', 'Ström', 'obj/meter/1/current'),
    fn(7, 20, 'text', 'Mätare läge', 'obj/meter/1/mode'),
    // a thermostat found by names only
    fn(8, 30, 'setpoint', 'Golvvärme Börvärde', 'obj/zwave/12/sp', { topic_write: 'set/obj/zwave/12/sp' }),
    fn(9, 30, 'temperature', 'Golvvärme Temperatur', 'obj/zwave/12/temp'),
  ],
};

test('thermostat functions by topic, one thermostat per device', () => {
  const t = thermostatFunctions(raw, 10);
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k, f]) => [k, f.id])), { current: 1, target: 2, mode: 3, action: 4 });
  assert.equal(isThermostatDevice(raw, 10), true);
  assert.equal(thermostatRole(raw.functions[5]), '');
  assert.equal(isThermostatDevice(raw, 20), false);
  const z = thermostatFunctions(raw, 30);
  assert.deepEqual([z.target?.id, z.current?.id], [8, 9]);
  assert.equal(isThermostatDevice(raw, 99), false);
});

test('modes and Swedish texts', () => {
  assert.deepEqual(thermostatModes(raw.functions[2]), ['off', 'heat', 'auto']);
  assert.deepEqual(thermostatModes({ meta: { 'dashboard.modes': 'heat,off', 'ha.hvac_modes': 'x' } }), ['heat', 'off']);
  assert.deepEqual(thermostatModes(undefined), []);
  assert.equal(modeText('heat'), 'Värme');
  assert.equal(modeText('eco'), 'eco');
  assert.equal(actionText('HEATING'), 'Värmer');
});

test('setpoint steps stay on the grid and in range', () => {
  const r = { min: 5, max: 30, step: 0.5 };
  assert.equal(stepSetpoint(21, 1, r), 21.5);
  assert.equal(stepSetpoint(21, -3, r), 19.5);
  assert.equal(stepSetpoint(21.3, 1, r), 22); // 21.3 rounds to 21.5 on the grid
  assert.equal(stepSetpoint(29.8, 2, r), 30);
  assert.equal(stepSetpoint(5, -1, r), 5);
  assert.equal(stepSetpoint(NaN, 1, r), 17.5); // no value yet: the middle of the range
  assert.equal(stepSetpoint(20, 1, { min: 7, max: 35, step: 0.1 }), 20.1);
});

const { DEFAULT_ZONES, zoneFor, zonesOf, setpointSegments, dialValueAt } = await import('../src/lib/thermostat.js');

test('default zones: under 15, 15-20, 20-22, 22 and over', () => {
  assert.deepEqual([5, 14.9, 15, 19.5, 20, 21.9, 22, 30].map((v) => zoneFor(v).text), ['Svalt', 'Svalt', 'Komfort', 'Komfort', 'Varmt', 'Varmt', 'Hett', 'Hett']);
  assert.equal(DEFAULT_ZONES.length, 4);
});

test('own zones are sorted and end with an open zone', () => {
  const z = zonesOf([{ color: '#f00', text: 'Varmt' }, { to: 18, color: '#00f', text: 'Kallt' }, { to: 'x', color: '#0f0' }, { to: 20 }]);
  assert.deepEqual(z, [{ to: 18, color: '#00f', text: 'Kallt' }, { to: undefined, color: '#f00', text: 'Varmt' }]);
  // without an open zone the highest becomes open
  assert.equal(zonesOf([{ to: 10, color: '#00f' }, { to: 20, color: '#f00' }])[1].to, undefined);
  assert.equal(zonesOf(null), DEFAULT_ZONES);
  assert.equal(zonesOf([{ to: 5 }]), DEFAULT_ZONES);
});

test('set point step line, one path per zone run', () => {
  const pts = [
    { ts: -10, value: 19 },
    { ts: 40, value: 19.5 },
    { ts: 60, value: 21 },
    { ts: 80, value: 23 },
  ];
  const segs = setpointSegments(pts, 0, 100, 15, 25, DEFAULT_ZONES, 100, 40);
  assert.deepEqual(segs.map((s) => s.color), ['#18a058', '#ea7a12', '#d43c2f']);
  // the value before the window starts the line at the left edge, and 19 -> 19.5 stays in one comfort path
  assert.match(segs[0].d, /^M0\.00,24\.00 V24\.00 H40\.00 V22\.00 H60\.00$/);
  // a new zone starts with the vertical step from the previous value
  assert.match(segs[1].d, /^M60\.00,22\.00 V16\.00 H80\.00$/);
  assert.equal(setpointSegments([], 0, 100, 15, 25).length, 0);
});

test('dial: angle to value on a 270° ring', () => {
  const r = { min: 5, max: 30, step: 0.5 };
  assert.equal(dialValueAt(-1, 1, r), 5); // lower left = start
  assert.equal(dialValueAt(0, -1, r), 17.5); // top = middle
  assert.equal(dialValueAt(1, 1, r), 30); // lower right = end
  assert.equal(dialValueAt(1, 0, r), 26); // right: 225° of 270°, 25.83 on the 0.5 grid
});
