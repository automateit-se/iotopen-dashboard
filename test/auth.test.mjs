import { test } from 'node:test';
import assert from 'node:assert/strict';

// a browser just enough for the API client: address, history and the two storages
class Store {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
globalThis.window ??= {};
Object.assign(globalThis.window, { location: { href: 'https://dash.example.com/', hash: '', pathname: '/', search: '' }, history: { replaceState: (_s, _t, url) => (window.location.hash = url.slice(url.indexOf('#'))) } });
const { config } = await import('../src/api/config.js');
config.lynxServer = 'https://lynx.example.com';
const server = await import('../src/api/server.js');
const { createMqttStore, MAX_TOPICS } = await import('../src/lib/mqttWidget.js');

let n = 0;
/** A fresh page load: new storages (or the given ones), an address, and a new instance of the API client. */
async function load({ hash = '', session = new Store(), local = new Store(), saved = null } = {}) {
  window.sessionStorage = session;
  window.localStorage = local;
  globalThis.localStorage = local;
  if (saved) local.setItem('dash.server', saved);
  window.location.hash = hash;
  server.setServer(saved ? server.normalizeServer(saved) : null);
  const lynx = await import(`../src/api/lynx.js?load=${++n}`);
  return { lynx, session, local };
}
const rec = (store) => JSON.parse(store.getItem('dash.auth') || 'null');

test('a direct link without a server goes to this container, not a saved custom server', async () => {
  const { lynx, session } = await load({ hash: '#/i/7?token=KEY1', saved: 'https://other.example.org' });
  assert.equal(lynx.getToken(), 'KEY1');
  assert.equal(server.getServer(), null); // the container's own server
  assert.equal(window.location.hash, '#/i/7');
  assert.deepEqual(rec(session), { token: 'KEY1', kind: 'apikey', server: '', link: true });
  assert.equal(lynx.pendingLink(), null);
});

test('a token is only sent to the server it belongs to', async () => {
  const local = new Store();
  local.setItem('dash.auth', JSON.stringify({ token: 'T1', kind: 'session', server: 'https://a.example.org' }));
  const { lynx } = await load({ local, saved: 'https://b.example.org' });
  assert.equal(lynx.getToken(), 'T1');
  assert.equal(server.getServer(), 'https://a.example.org'); // the record decides the server
  server.setServer('https://b.example.org'); // e.g. typed on the sign-in page
  assert.equal(lynx.getToken(), null);
});

test('a token for a custom server is not used when custom servers are off', async () => {
  const local = new Store();
  local.setItem('dash.auth', JSON.stringify({ token: 'T1', kind: 'session', server: 'https://a.example.org' }));
  config.customServers = false;
  try {
    const { lynx } = await load({ local });
    assert.equal(lynx.getToken(), null);
  } finally {
    delete config.customServers;
  }
});

test('a token from before 0.18.2 stays bound to the server saved then', async () => {
  const local = new Store();
  local.setItem('dash.token', 'OLD');
  local.setItem('dash.tokenKind', 'apikey');
  const { lynx } = await load({ local, saved: 'https://a.example.org' });
  assert.equal(lynx.getToken(), 'OLD');
  assert.equal(server.getServer(), 'https://a.example.org');
  assert.equal(lynx.getTokenKind(), 'apikey');
});

test('a sign-in is kept only when saved, with its server', async () => {
  const { lynx, session, local } = await load();
  server.setServer('https://a.example.org');
  lynx.holdToken('NEW', 'session');
  assert.equal(lynx.getToken(), 'NEW');
  assert.equal(rec(session), null);
  assert.equal(rec(local), null);
  // a failed check: nothing was written, so a reload sends nothing anywhere
  lynx.holdToken(null);
  assert.equal(lynx.getToken(), null);
  lynx.holdToken('NEW', 'session');
  lynx.saveToken(true);
  assert.deepEqual(rec(local), { token: 'NEW', kind: 'session', server: 'https://a.example.org' });
});

test('a link does not replace a sign-in without asking', async () => {
  const local = new Store();
  local.setItem('dash.auth', JSON.stringify({ token: 'MINE', kind: 'session', server: '' }));
  const { lynx } = await load({ hash: '#token=THEIRS', local });
  assert.equal(lynx.getToken(), 'MINE');
  assert.deepEqual(lynx.pendingLink(), { token: 'THEIRS', server: '', error: undefined });
  assert.equal(window.location.hash, '#/');
  lynx.dropLink();
  assert.equal(lynx.pendingLink(), null);
  assert.equal(lynx.getToken(), 'MINE');
  assert.equal(rec(local).token, 'MINE');
});

test('an accepted link applies to the tab only; signing out there brings the remembered sign-in back', async () => {
  const local = new Store();
  local.setItem('dash.auth', JSON.stringify({ token: 'MINE', kind: 'session', server: '' }));
  const { lynx, session } = await load({ hash: '#token=THEIRS', local });
  lynx.acceptLink();
  assert.equal(lynx.getToken(), 'THEIRS');
  assert.equal(rec(local).token, 'MINE'); // untouched
  assert.equal(rec(session).token, 'THEIRS');
  assert.equal(lynx.clearToken(), true);
  assert.equal(lynx.getToken(), 'MINE');
  assert.equal(rec(session), null);
});

test('a link for another server always asks, and a bad one is refused', async () => {
  let { lynx } = await load({ hash: '#token=K&server=evil.example.net' });
  assert.equal(lynx.getToken(), null);
  assert.deepEqual(lynx.pendingLink(), { token: 'K', server: 'https://evil.example.net', error: undefined });
  ({ lynx } = await load({ hash: '#token=K&server=http://evil.example.net' }));
  assert.match(lynx.pendingLink().error, /https/);
  config.customServers = false;
  try {
    ({ lynx } = await load({ hash: '#token=K&server=evil.example.net' }));
    assert.match(lynx.pendingLink().error, /avstängda/);
    // the container's own server named in full is no other server
    ({ lynx } = await load({ hash: '#token=K&server=lynx.example.com' }));
    assert.equal(lynx.getToken(), 'K');
  } finally {
    delete config.customServers;
  }
});

test('linkDecision', async () => {
  const { lynx } = await load();
  assert.equal(lynx.linkDecision({ token: null }, { token: 'a', server: '' }), 'use');
  assert.equal(lynx.linkDecision({ token: null }, { token: 'a', server: 'https://x.org' }), 'ask');
  assert.equal(lynx.linkDecision({ token: 'a', server: '' }, { token: 'a', server: '' }), 'same');
  assert.equal(lynx.linkDecision({ token: 'a', server: '' }, { token: 'b', server: '' }), 'ask');
  assert.equal(lynx.linkDecision({ token: null }, { token: 'a', server: '', error: 'x' }), 'ask');
});

test('the MQTT store keeps only watched topics, and at most MAX_TOPICS of them', () => {
  const store = createMqttStore();
  const filters = ['sensor/#'];
  for (let i = 0; i < 10000; i++) store.add(`sensor/${i}`, String(i), { filters });
  for (let i = 0; i < 100; i++) store.add(`other/${i}`, 'x', { filters });
  assert.equal(store.size, MAX_TOPICS);
  // the newest are kept
  assert.equal(store.latest('sensor/9999')[0].text, '9999');
  assert.deepEqual(store.latest('sensor/0'), []);
  assert.deepEqual(store.latest('other/1'), []);
  assert.equal(store.log('sensor/#', 1000).length, 500);
  // a topic updated again counts as new
  store.add('sensor/9000', 'again', { filters });
  for (let i = 0; i < 999; i++) store.add(`sensor/x${i}`, 'y', { filters });
  assert.equal(store.latest('sensor/9000')[0].text, 'again');
  // when no widget listens any more, it is dropped
  store.prune(['sensor/9000']);
  assert.equal(store.size, 1);
  assert.equal(store.log('#', 1000).length, 0); // its message had already left the 500 newest
});
