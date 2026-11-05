import { useEffect, useState } from 'react';
import { createMqtt, defaultMqttUrl } from '../api/mqtt.js';
import { getToken } from '../api/lynx.js';
import { BRIDGE_STATUS, bridgeUp } from './edge.js';

// Edge client status for the list of installations, the same way App Management shows it: an edge client's MQTT
// bridge publishes "<client id>/box/event/status" retained (1 connected, 0 not), so one MQTT connection that
// subscribes to the topic for every installation learns which ones have an edge client and whether it is online,
// and follows the changes while the list is open. An installation that has never had an edge client sends
// nothing and gets no badge.

/** client id -> 'online' | 'offline' from bridge messages ("<client id>/box/event/status"). */
export function presenceFrom(state, topic, payload) {
  const m = /^(\d+)\/box\/event\/status$/.exec(String(topic || ''));
  if (!m) return state;
  const up = bridgeUp(payload);
  if (up === null) return state;
  const next = up ? 'online' : 'offline';
  return state[m[1]] === next ? state : { ...state, [m[1]]: next };
}

/** { [client id]: 'online' | 'offline' } for the installations, live while the component is shown. */
export function useEdgePresence(installations) {
  const [state, setState] = useState({});
  const key = installations
    .map((i) => i.client_id)
    .filter((c) => c != null)
    .join(',');
  useEffect(() => {
    if (!key) return undefined;
    const topics = key.split(',').map((c) => `${c}/${BRIDGE_STATUS}`);
    const client = createMqtt({
      url: defaultMqttUrl(),
      token: getToken(),
      onMessage: (topic, payload) => setState((s) => presenceFrom(s, topic, payload)),
    });
    // kept by the client and subscribed again after a reconnect
    client.setSubscriptions(topics);
    return () => client.close();
  }, [key]);
  return state;
}
