import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModeStates, isMode, modeState } from '../src/lib/mode.js';
import { formatValue } from '../src/lib/format.js';

const MODE = { id: 1, type: 'mode', meta: { name: 'Läge', topic_read: 'obj/mode/default', topic_write: 'set/obj/mode/default', 'mode.states': '0:home:Hemma,1:away:Borta,2:vacation:Semester' } };

test('mode.states is parsed as value:key:label', () => {
  assert.deepEqual(parseModeStates('0:home:Hemma, 1:away:Borta,3:armed'), [
    { value: 0, key: 'home', label: 'Hemma' },
    { value: 1, key: 'away', label: 'Borta' },
    { value: 3, key: 'armed', label: 'armed' },
  ]);
  assert.deepEqual(parseModeStates('nonsense,,x:y'), []);
});

test('a mode value is shown with its label', () => {
  assert.equal(formatValue(MODE, 1), 'Borta');
  assert.equal(formatValue(MODE, '2'), 'Semester');
  assert.equal(modeState(MODE, 'home').value, 0);
  assert.equal(formatValue(MODE, 7), '7');
});

test('mode functions are recognised by type or by mode.states', () => {
  assert.equal(isMode(MODE), true);
  assert.equal(isMode({ type: 'text', meta: { 'mode.states': '0:a:A' } }), true);
  assert.equal(isMode({ type: 'switch', meta: {} }), false);
});
