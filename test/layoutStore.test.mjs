import { test } from 'node:test';
import assert from 'node:assert/strict';

// dashboard.js reads the page address through the API client when loaded
globalThis.window ??= { location: { href: 'http://localhost/', hash: '', pathname: '/', search: '' } };
const { createLayoutStore, LayoutConflict, sameLayout, READ_ERROR, CONFLICT_ERROR } = await import('../src/lib/layoutStore.js');
const { readLayout, writeLayout } = await import('../src/lib/dashboard.js');
const { lynx } = await import('../src/api/lynx.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
/** A promise that the test resolves or rejects itself. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

/** An in-memory layout file; reads and writes can be held to set up races. */
function fakeFile(layout = null) {
  const file = { layout, hash: layout ? 'h0' : null, n: 0, writes: [] };
  file.read = async () => ({ layout: file.layout || { version: 2, widgets: {} }, hash: file.hash });
  file.write = async (next, expectHash) => {
    if (expectHash !== file.hash) throw new LayoutConflict();
    file.writes.push(next);
    file.layout = next;
    file.hash = `h${++file.n}`;
    return file.hash;
  };
  return file;
}

const order = (lay) => Object.fromEntries(Object.entries(lay.widgets).map(([k, v]) => [k, v.order]));

test('a failed read keeps the layout and blocks saving', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 } }, pages: [{ id: 'p1', title: 'Hem' }] });
  let shown = null;
  const store = createLayoutStore({ read: () => Promise.reject(new Error('Network down')), write: file.write, onLayout: (l) => (shown = l) });
  assert.equal(await store.refresh(), false);
  assert.equal(store.status().loaded, false);
  assert.equal(store.status().readError.message, 'Network down');
  assert.equal(shown, null); // no empty layout is shown
  await assert.rejects(store.update((l) => ({ ...l, widgets: {} })), { message: READ_ERROR });
  assert.equal(file.writes.length, 0);
});

test('a read error after a good read keeps what is shown', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 } } });
  let fail = false;
  const store = createLayoutStore({ read: () => (fail ? Promise.reject(new Error('403')) : file.read()), write: file.write });
  await store.refresh();
  fail = true;
  await store.refresh();
  assert.deepEqual(store.get().widgets, { a: { order: 0 } });
  assert.equal(store.status().loaded, true); // still editable: writes are checked against the hash
});

test('a missing file is an empty layout that can be saved', async () => {
  const file = fakeFile(null);
  const store = createLayoutStore({ read: file.read, write: file.write });
  await store.refresh();
  await store.update((l) => ({ ...l, widgets: { a: { order: 0 } } }));
  assert.equal(file.writes.length, 1);
});

test('page changes from another client are shown, own echoes are not', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 } }, pages: [{ id: 'p1', title: 'Hem' }] });
  const shown = [];
  const store = createLayoutStore({ read: file.read, write: file.write, onLayout: (l) => shown.push(l) });
  await store.refresh();
  // another client renames the page; the widgets are unchanged
  file.layout = { ...file.layout, pages: [{ id: 'p1', title: 'Start' }], updated: 'x' };
  file.hash = 'other';
  await store.refresh();
  assert.equal(store.get().pages[0].title, 'Start');
  // the same content with a new save stamp is not a change
  const before = shown.length;
  file.layout = { ...file.layout, updated: 'y', version: 2 };
  await store.refresh();
  assert.equal(shown.length, before);
  assert.ok(sameLayout({ widgets: {}, updated: 'a' }, { updated: 'b', widgets: {}, version: 2 }));
  assert.ok(!sameLayout({ widgets: {}, theme: 1 }, { widgets: {} }));
});

test('quick edits are written one at a time, the newest last', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 }, b: { order: 1 }, c: { order: 2 } } });
  const held = [];
  const write = (next, h) => {
    const d = deferred();
    held.push(d);
    return d.promise.then(() => file.write(next, h));
  };
  const store = createLayoutStore({ read: file.read, write });
  await store.refresh();
  const first = store.update((l) => ({ ...l, widgets: { ...l.widgets, a: { order: 1 }, b: { order: 0 } } }));
  const second = store.update((l) => ({ ...l, widgets: { ...l.widgets, c: { order: 0 }, b: { order: 1 }, a: { order: 2 } } }));
  const third = store.update((l) => ({ ...l, widgets: { ...l.widgets, c: { order: 1 }, b: { order: 0 } } }));
  // only one write at a time
  assert.equal(held.length, 1);
  // the second and third edit build on the first, and are written together afterwards
  assert.deepEqual(order(store.get()), { a: 2, b: 0, c: 1 });
  held[0].resolve();
  await first;
  await tick();
  assert.equal(held.length, 2);
  held[1].resolve();
  await Promise.all([second, third]);
  assert.equal(file.writes.length, 2);
  assert.deepEqual(order(file.layout), { a: 2, b: 0, c: 1 });
});

test('a re-read while saving waits, so an older echo does not come back', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 } } });
  const held = [];
  const write = (next, h) => {
    const d = deferred();
    held.push(d);
    return d.promise.then(() => file.write(next, h));
  };
  const shown = [];
  const store = createLayoutStore({ read: file.read, write, onLayout: (l) => shown.push(l) });
  await store.refresh();
  const one = store.update((l) => ({ ...l, widgets: { a: { order: 0, w: 2 } } }));
  held[0].resolve();
  await one;
  const two = store.update((l) => ({ ...l, widgets: { a: { order: 0, w: 4 } } }));
  // the file event of the first save arrives while the second is under way
  assert.equal(await store.refresh(), false);
  assert.equal(store.get().widgets.a.w, 4);
  held[1].resolve();
  await two;
  await tick();
  assert.equal(store.get().widgets.a.w, 4);
  assert.ok(!shown.some((l, i) => i > 1 && l.widgets.a.w === 2));
});

test('a change by someone else in between stops the save and shows theirs', async () => {
  const file = fakeFile({ version: 2, widgets: { a: { order: 0 } } });
  let status = null;
  const store = createLayoutStore({ read: file.read, write: file.write, onStatus: (s) => (status = s) });
  await store.refresh();
  file.layout = { version: 2, widgets: { a: { order: 0 }, x: { order: 1 } } };
  file.hash = 'theirs';
  await assert.rejects(store.update((l) => ({ ...l, widgets: { ...l.widgets, a: { order: 5 } } })), { message: CONFLICT_ERROR });
  await tick();
  assert.equal(file.writes.length, 0);
  assert.deepEqual(Object.keys(store.get().widgets), ['a', 'x']);
  assert.equal(store.get().widgets.a.order, 0);
  assert.equal(status.saveError, CONFLICT_ERROR);
  // and the next edit is written on top of theirs
  await store.update((l) => ({ ...l, widgets: { ...l.widgets, a: { order: 2 } } }));
  assert.deepEqual(Object.keys(file.layout.widgets), ['a', 'x']);
});

test('readLayout: a missing file is empty, a failed read throws', async () => {
  const saved = { ...lynx };
  try {
    lynx.files = async () => [{ id: 1, name: 'other.json', hash: 'x' }];
    assert.deepEqual(await readLayout(1), { layout: { version: 2, widgets: {} }, hash: null });
    lynx.files = async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    };
    await assert.rejects(readLayout(1), { message: 'Forbidden' });
    lynx.files = async () => [{ id: 2, name: 'dashboard-layout.json', hash: 'abc', updated: 1 }];
    lynx.downloadFile = async () => {
      throw new Error('Download failed');
    };
    await assert.rejects(readLayout(1), { message: 'Download failed' });
    lynx.downloadFile = async () => ({ text: async () => '{"widgets": {"a": {' });
    await assert.rejects(readLayout(1));
    lynx.downloadFile = async () => ({ text: async () => '{"version": 2, "widgets": {"a": {"order": 0}}}' });
    assert.deepEqual(await readLayout(1), { layout: { version: 2, widgets: { a: { order: 0 } } }, hash: 'abc' });
  } finally {
    Object.assign(lynx, saved);
  }
});

test('writeLayout: stops when the file is not the expected one', async () => {
  const saved = { ...lynx };
  try {
    const calls = [];
    lynx.files = async () => [{ id: 2, name: 'dashboard-layout.json', hash: 'abc', updated: 1 }];
    lynx.replaceFile = async (...a) => (calls.push(a), { id: 2, hash: 'def' });
    await assert.rejects(writeLayout(1, { widgets: {} }, 'old'), LayoutConflict);
    await assert.rejects(writeLayout(1, { widgets: {} }, null), LayoutConflict);
    assert.equal(calls.length, 0);
    assert.equal(await writeLayout(1, { widgets: {} }, 'abc'), 'def');
    assert.equal(calls.length, 1);
  } finally {
    Object.assign(lynx, saved);
  }
});
