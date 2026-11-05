import { test } from 'node:test';
import assert from 'node:assert/strict';

// the hook's module reads the page address through the API client when loaded
globalThis.window ??= { location: { href: 'http://localhost/', hash: '', pathname: '/', search: '' } };
const { presenceFrom } = await import('../src/lib/edgePresence.js');

test('bridge messages give online / offline per client id', () => {
  let s = {};
  s = presenceFrom(s, '2305/box/event/status', { value: 1 });
  s = presenceFrom(s, '2675/box/event/status', 0);
  assert.deepEqual(s, { 2305: 'online', 2675: 'offline' });
  // changes follow, the same state keeps the object (no re-render)
  assert.equal(presenceFrom(s, '2305/box/event/status', '1'), s);
  assert.equal(presenceFrom(s, '2305/box/event/status', 0)[2305], 'offline');
  // anything else is ignored
  assert.equal(presenceFrom(s, '2305/obj/x', 1), s);
  assert.equal(presenceFrom(s, '2305/box/event/status', 'hello'), s);
});
