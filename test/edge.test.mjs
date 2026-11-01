import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeUp, nextEdge, edgeStale, widgetEdgeStale } from '../src/lib/edge.js';

test('bridge status 1 / 0, as a bare value or JSON', () => {
  assert.equal(bridgeUp({ value: 1 }), true);
  assert.equal(bridgeUp({ value: '0' }), false);
  assert.equal(bridgeUp({ value: ' 1\n' }), true);
  assert.equal(bridgeUp('0'), false);
  assert.equal(bridgeUp({ value: 'online' }), null);
  assert.equal(bridgeUp(null), null);
});

test('the state changes only when the bridge says something new', () => {
  const down = nextEdge(null, { value: 0 }, 100);
  assert.deepEqual(down, { up: false, since: 100 });
  assert.equal(nextEdge(down, { value: 0 }, 200), down); // repeated 0 keeps the first time
  assert.deepEqual(nextEdge(down, { value: 1 }, 300), { up: true, since: 300 });
  assert.equal(nextEdge(down, { value: 'x' }, 300), down);
});

test('values older than the outage are stale, newer ones are not', () => {
  const edge = { up: false, since: 1000 };
  assert.equal(edgeStale(edge, { value: 1, timestamp: 900 }), true);
  assert.equal(edgeStale(edge, { value: 1, timestamp: 1000 }), true);
  assert.equal(edgeStale(edge, null), true);
  assert.equal(edgeStale(edge, { value: 1, timestamp: 1001 }), false);
  assert.equal(edgeStale({ up: true, since: 1000 }, { timestamp: 1 }), false);
  assert.equal(edgeStale(null, { timestamp: 1 }), false);
});

test('a widget is stale when all its functions are', () => {
  const edge = { up: false, since: 1000 };
  assert.equal(widgetEdgeStale(edge, [{ timestamp: 1 }, null]), true);
  assert.equal(widgetEdgeStale(edge, [{ timestamp: 1 }, { timestamp: 2000 }]), false);
  assert.equal(widgetEdgeStale(edge, []), false); // links, text, MQTT widgets
  assert.equal(widgetEdgeStale({ up: null }, [{ timestamp: 1 }]), false);
});

test('the function showing the bridge status is recognised', async () => {
  const { isBridgeStatus } = await import('../src/lib/edge.js');
  assert.equal(isBridgeStatus({ meta: { topic_read: 'box/event/status' } }), true);
  assert.equal(isBridgeStatus({ meta: { topic_read: '5001/box/event/status' } }), true);
  assert.equal(isBridgeStatus({ meta: { topic_read: 'obj/zwave/1/temp' } }), false);
});
