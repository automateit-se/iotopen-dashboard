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
