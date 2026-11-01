// The edge client's connection to IoT Open. Its MQTT bridge publishes "<client id>/box/event/status": 1 when it is
// connected, 0 when it is not (the broker's last will when the connection drops). The message is retained, so the
// dashboard knows the state as soon as it subscribes.
//
// While the edge client is offline, values that came through it are no longer fresh, and commands to it are lost.
// Which functions come through the edge client is not stored anywhere, so the dashboard goes by time: a value that
// has arrived since the edge client went offline came from somewhere else (an integration, the API) and is still
// live; everything older is marked stale.

export const BRIDGE_STATUS = 'box/event/status';

export const EDGE_OFFLINE_TEXT = 'Edge client offline';
export const EDGE_NOT_SENT = 'Edge clienten är offline - kommandot skickades inte';

/** true (1), false (0) or null for anything else, from the bridge's payload ({ value } after parsing). */
export function bridgeUp(payload) {
  const v = String(payload && typeof payload === 'object' ? payload.value : payload).trim();
  return v === '1' ? true : v === '0' ? false : null;
}

/**
 * Next edge state from a bridge message. { up: true|false|null, since: seconds } - since is when the dashboard
 * learned of the current state; a retained message has no time of its own, so it is the time it was received.
 */
export function nextEdge(cur, payload, now = Date.now() / 1000) {
  const up = bridgeUp(payload);
  if (up === null) return cur;
  if (cur && cur.up === up) return cur;
  return { up, since: now };
}

/** true when the edge client is offline and the value has not been updated since it went offline. */
export function edgeStale(edge, value) {
  if (!edge || edge.up !== false) return false;
  return !((Number(value?.timestamp) || 0) > edge.since);
}

/** true when every function has a value older than the edge client's outage (or none). */
export function widgetEdgeStale(edge, values) {
  return !!edge && edge.up === false && values.length > 0 && values.every((v) => edgeStale(edge, v));
}

/** The function showing the edge client's own status (topic_read box/event/status) is never stale for it. */
export const isBridgeStatus = (fn) => String(fn?.meta?.topic_read || '').replace(/^\d+\//, '') === BRIDGE_STATUS;

/** Clock time of the outage for tooltips, "14:05". */
export const sinceText = (edge) => (edge?.since ? new Date(edge.since * 1000).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '');
