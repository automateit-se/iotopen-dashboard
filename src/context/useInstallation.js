import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lynx, getToken, normTopic } from '../api/lynx.js';
import { createMqtt, defaultMqttUrl } from '../api/mqtt.js';
import { config } from '../api/config.js';
import { buildWidgets, readLayout, readLogo } from '../lib/dashboard.js';

const POLL_MS = 30000; // REST polling only while MQTT is not live
const STRUCTURE_DEBOUNCE_MS = 1000; // bulk edits emit many evt/*/updated – reload once
// IoT Open publishes "<client_id>/evt/<x>/updated" (payload {}) when something in the installation changes,
// metadata included. Verified against Lynx: functionx, devicex, installation and file.
const STRUCTURE_EVENTS = ['evt/functionx/updated', 'evt/devicex/updated'];
const INSTALLATION_EVENT = 'evt/installation/updated';
const FILE_EVENT = 'evt/file/updated';
const EVENTS = [...STRUCTURE_EVENTS, INSTALLATION_EVENT, FILE_EVENT];

/**
 * Everything for one installation:
 *   REST snapshot (installation incl. meta, devices, functions, latest status, layout file)
 *   + live values over MQTT ("<client_id>/<topic_read>")
 *   + changes over MQTT ("<client_id>/evt/{devicex,functionx,installation,file}/updated") -> re-read only
 *     what changed. Nothing is polled while MQTT is live.
 */
export function useInstallation(iid) {
  const [inst, setInst] = useState(null);
  const [raw, setRaw] = useState(null); // { devices, functions }
  const [layout, setLayout] = useState({ version: 2, widgets: {} });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveState, setLiveState] = useState('off');
  const [tick, setTick] = useState(0); // bumps when values change (throttled)
  const [logo, setLogo] = useState(null); // object URL of dashboard-logo.png, null = IoT Open default

  const byTopic = useRef(new Map());
  const listeners = useRef(new Set());
  const mqttRef = useRef(null);
  const instRef = useRef(null);
  const rawRef = useRef(null);

  const bump = useRef(null);
  const scheduleTick = useCallback(() => {
    if (bump.current) return;
    bump.current = setTimeout(() => {
      bump.current = null;
      setTick((t) => t + 1);
    }, 150);
  }, []);

  const updateSubscriptions = useCallback(() => {
    const i = instRef.current;
    const r = rawRef.current;
    if (!i || !r || !mqttRef.current) return;
    const topics = r.functions
      .flatMap((f) => [f.meta?.topic_read, f.meta?.topic_read_onoff])
      .filter(Boolean)
      .map((t) => `${i.client_id}/${normTopic(t)}`);
    mqttRef.current.setSubscriptions([...topics, ...EVENTS.map((e) => `${i.client_id}/${e}`)]);
  }, []);

  /** Reads structure + values (+ layout unless skipped). Newer live values are kept. */
  const load = useCallback(
    async ({ withLayout = true, quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      try {
        const [installation, devices, functions, statuses, lay] = await Promise.all([
          lynx.installation(iid),
          lynx.devices(iid),
          lynx.functions(iid),
          lynx.status(iid).catch(() => []),
          withLayout ? readLayout(iid) : null,
        ]);
        for (const s of statuses || []) {
          const old = byTopic.current.get(s.topic);
          if (!old || (old.timestamp || 0) <= (s.timestamp || 0)) byTopic.current.set(s.topic, s);
        }
        // installationinfo carries client_id; the single installation endpoint should too, but be safe
        const merged = { ...(instRef.current || {}), ...installation };
        if (!merged.client_id) {
          const info = ((await lynx.installations()) || []).find((x) => x.id === Number(iid));
          if (info) merged.client_id = info.client_id;
        }
        instRef.current = merged;
        rawRef.current = { devices: devices || [], functions: functions || [] };
        setInst(merged);
        setRaw(rawRef.current);
        if (lay) setLayout(lay);
        setError(null);
        updateSubscriptions();
        setTick((t) => t + 1);
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [iid, updateSubscriptions],
  );

  /** Installation metadata only (title, colours, admins). */
  const reloadInstallation = useCallback(async () => {
    try {
      const installation = await lynx.installation(iid);
      instRef.current = { ...instRef.current, ...installation };
      setInst(instRef.current);
    } catch {
      /* next event or reconnect retries */
    }
  }, [iid]);

  /** Layout file only; skipped when the content did not change (e.g. our own save). */
  const reloadLayout = useCallback(async () => {
    try {
      const lay = await readLayout(iid);
      setLayout((cur) => (JSON.stringify(cur.widgets) === JSON.stringify(lay.widgets) ? cur : lay));
    } catch {
      /* ignore */
    }
  }, [iid]);

  /** Logo file; downloaded only when its hash changed. */
  const logoRef = useRef({ hash: null, url: null });
  const reloadLogo = useCallback(async () => {
    let next;
    try {
      next = await readLogo(iid, logoRef.current.hash);
    } catch {
      return; /* keep what is shown */
    }
    if (next && !next.blob) return;
    if (logoRef.current.url) URL.revokeObjectURL(logoRef.current.url);
    logoRef.current = next ? { hash: next.hash, url: URL.createObjectURL(next.blob) } : { hash: null, url: null };
    setLogo(logoRef.current.url);
  }, [iid]);
  useEffect(() => {
    reloadLogo();
    return () => {
      if (logoRef.current.url) URL.revokeObjectURL(logoRef.current.url);
      logoRef.current = { hash: null, url: null };
      setLogo(null);
    };
  }, [reloadLogo]);

  const timers = useRef({});
  const debounce = (name, fn) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, STRUCTURE_DEBOUNCE_MS);
  };

  const onMessage = useCallback(
    (fullTopic, payload, { retained = false } = {}) => {
      const m = /^(\d+)\/(.*)$/.exec(fullTopic);
      if (!m || String(instRef.current?.client_id) !== m[1]) return;
      if (STRUCTURE_EVENTS.includes(m[2])) return debounce('structure', () => load({ withLayout: false, quiet: true }));
      if (m[2] === INSTALLATION_EVENT) return debounce('installation', reloadInstallation);
      if (m[2] === FILE_EVENT) return debounce('file', () => (reloadLayout(), reloadLogo()));
      const entry = {
        topic: m[2],
        value: payload?.value,
        msg: payload?.msg || '',
        // a retained message without its own time (e.g. a bare "1") is not new: keep the time the status API
        // gave for the topic, so the widget does not claim it just happened
        timestamp: Number(payload?.timestamp) || (retained && byTopic.current.get(m[2])?.timestamp) || Date.now() / 1000,
      };
      byTopic.current.set(m[2], entry);
      listeners.current.forEach((fn) => fn(entry));
      scheduleTick();
    },
    [load, reloadInstallation, reloadLayout, reloadLogo, scheduleTick], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // initial load
  useEffect(() => {
    byTopic.current = new Map();
    instRef.current = null;
    rawRef.current = null;
    setInst(null);
    setRaw(null);
    load();
  }, [load]);

  // MQTT connection while this installation is open
  useEffect(() => {
    if (!config.liveUpdates) return;
    const client = createMqtt({ url: defaultMqttUrl(), token: getToken(), onMessage, onState: setLiveState });
    mqttRef.current = client;
    updateSubscriptions();
    return () => {
      client.close();
      mqttRef.current = null;
      Object.values(timers.current).forEach(clearTimeout);
      setLiveState('off');
    };
  }, [onMessage, updateSubscriptions]);

  // REST polling only while MQTT is not live; after a reconnect, re-read so nothing is missed
  const liveRef = useRef(liveState);
  useEffect(() => {
    // (re)connected: anything that changed while offline – values, structure, meta, layout – is read once
    if (liveState === 'live' && liveRef.current !== 'live' && rawRef.current) load({ quiet: true });
    liveRef.current = liveState;
  }, [liveState, load]);
  useEffect(() => {
    const t = setInterval(() => {
      if (liveRef.current !== 'live') load({ quiet: true });
      else setTick((x) => x + 1); // refresh "x min ago"
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const onLive = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  /** Publishes a value to "<client_id>/<topic_write>". Returns false when MQTT is not connected. */
  const publish = useCallback((topicWrite, value) => {
    const i = instRef.current;
    if (!i || !mqttRef.current) return false;
    return mqttRef.current.publish(`${i.client_id}/${normTopic(topicWrite)}`, { value: Number.isFinite(Number(value)) ? Number(value) : value, timestamp: Math.floor(Date.now() / 1000) });
  }, []);

  const valueOfTopic = useCallback((topic) => (topic ? byTopic.current.get(normTopic(topic)) || null : null), []);
  const valueOf = useCallback((fn) => valueOfTopic(fn?.meta?.topic_read), [valueOfTopic]);

  const widgets = useMemo(() => (raw ? buildWidgets(raw, layout) : []), [raw, layout]);

  return { inst, raw, layout, setLayout, widgets, logo, reloadLogo, error, loading, liveState, tick, valueOf, valueOfTopic, onLive, publish, reload: load };
}
