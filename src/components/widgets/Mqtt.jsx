import { config } from '../../api/config.js';
import { formatAge } from '../../lib/format.js';
import { safeColor } from '../../lib/dashboard.js';
import { checkTopic, isWildcard, valueOfMessage, formatMqttValue, prettyPayload, mqttState, MAX_LOG_ROWS, MAX_TABLE_ROWS } from '../../lib/mqttWidget.js';

/** Time of a message: its own timestamp, else when it arrived. */
const timeOf = (m) => new Date((m.timestamp || m.received / 1000) * 1000).toLocaleTimeString('sv-SE');

/** "sensor/+/temp" + "sensor/hall/temp" -> "hall/temp": the fixed levels before the first wildcard are left out. */
function relTopic(filter, topic) {
  const fixed = [];
  for (const l of filter.split('/')) {
    if (l === '+' || l === '#') break;
    fixed.push(l);
  }
  const prefix = fixed.join('/');
  return prefix && topic.startsWith(`${prefix}/`) ? topic.slice(prefix.length + 1) : topic;
}

/** Why nothing is shown yet. */
function waitText(liveState) {
  if (!config.liveUpdates) return 'MQTT är avstängt i den här dashboarden.';
  if (liveState !== 'live') return 'Ingen MQTT-anslutning just nu.';
  return 'Väntar på data…';
}

/** The value a value-mode MQTT widget shows, and its state colour - also used by the dashboard to fill the tile. */
export function mqttShown(w, ctx) {
  const { topic } = checkTopic(w.layout.topic);
  if (!topic) return null;
  const m = ctx.mqtt.newest(topic);
  const path = w.layout.path;
  // a topic that is also a function's topic_read has a value from the status API before any message arrives
  const fallback = !m && !isWildcard(topic) && !String(path || '').trim() ? ctx.valueOfTopic(topic) : null;
  const value = m ? valueOfMessage(m, path) : fallback ? fallback.value : undefined;
  const state = mqttState(w.layout.states, value);
  const timestamp = m ? m.timestamp || (m.retained ? ctx.valueOfTopic(m.topic)?.timestamp : null) : fallback?.timestamp;
  return { m, value, state, color: safeColor(state?.color), timestamp, has: !!m || !!fallback };
}

/**
 * Shows what arrives on a topic filter of the installation: the latest value, the whole message, a log or a
 * table per topic. Read only. Everything is rendered as text.
 */
export function MqttWidget({ w, ctx }) {
  const l = w.layout;
  const { topic, error } = checkTopic(l.topic);
  if (!topic) return <div className="muted small">Ogiltig topic: {error}</div>;
  const wild = isWildcard(topic);
  const mode = l.mode || 'value';
  const fmt = { unit: l.unit, decimals: l.decimals };

  if (mode === 'log') {
    const rows = Math.min(MAX_LOG_ROWS, Math.max(1, Number(l.rows) || 10));
    const list = ctx.mqtt.log(topic, rows);
    if (!list.length) return <div className="muted small">{waitText(ctx.liveState)}</div>;
    return (
      <ul className="w-mqtt-log">
        {list.map((m, i) => (
          <li key={`${m.received}-${m.topic}-${i}`}>
            <span className="t muted">{timeOf(m)}</span>
            {wild && <span className="topic muted">{relTopic(topic, m.topic)}</span>}
            <span className="val">{formatMqttValue(valueOfMessage(m, l.path), fmt)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (mode === 'table') {
    const all = ctx.mqtt.latest(topic);
    if (!all.length) return <div className="muted small">{waitText(ctx.liveState)}</div>;
    const list = all.slice(0, MAX_TABLE_ROWS);
    return (
      <div className="w-mqtt-table">
        <ul className="w-card">
          {list.map((m) => {
            const v = valueOfMessage(m, l.path);
            const st = mqttState(l.states, v);
            return (
              <li key={m.topic} title={`${m.topic} · ${formatAge(m.timestamp || ctx.valueOfTopic(m.topic)?.timestamp)}`}>
                <span className="name">{relTopic(topic, m.topic)}</span>
                <span className="val" style={safeColor(st?.color) ? { color: safeColor(st.color) } : undefined}>
                  {st?.text || formatMqttValue(v, fmt)}
                </span>
              </li>
            );
          })}
        </ul>
        {all.length > list.length && <div className="muted small">+ {all.length - list.length} till som inte visas</div>}
      </div>
    );
  }

  if (mode === 'json') {
    const m = ctx.mqtt.newest(topic);
    if (!m) return <div className="muted small">{waitText(ctx.liveState)}</div>;
    return (
      <div className="w-mqtt-json">
        <pre>{prettyPayload(m)}</pre>
        <div className="muted small">
          {wild ? `${m.topic} · ` : ''}
          {formatAge(m.timestamp || ctx.valueOfTopic(m.topic)?.timestamp)}
        </div>
      </div>
    );
  }

  const s = mqttShown(w, ctx);
  if (!s.has) return <div className="muted small">{waitText(ctx.liveState)}</div>;
  return (
    <div className="w-value">
      <div className="big">{s.state?.text || formatMqttValue(s.value, fmt)}</div>
      <div className="muted small">
        {wild && s.m ? `${relTopic(topic, s.m.topic)} · ` : ''}
        {s.timestamp ? formatAge(s.timestamp) : 'sparat värde (retained)'}
      </div>
    </div>
  );
}
