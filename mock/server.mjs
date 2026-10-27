// Tiny in-memory mock of the parts of the IoT Open (Lynx) API the dashboard uses, incl. MQTT over WebSocket.
// No dependencies – run with `node mock/server.mjs`. Login: demo@example.com / demo, API key: demo-api-key,
// 2FA: twofa@example.com / demo + code 123456
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const now = () => Math.floor(Date.now() / 1000);
let nextId = 100;

// ---------------- seed data ----------------
const users = [
  { id: 1, email: 'demo@example.com', password: 'demo', first_name: 'Demo', last_name: 'Användare', organisations: [1], meta: {}, protected_meta: {} },
  { id: 2, email: 'twofa@example.com', password: 'demo', twofa: true, first_name: 'Två', last_name: 'Faktor', organisations: [1], meta: {}, protected_meta: {} },
];
const tokens = new Map();
const pending2fa = new Map();
// a fixed API key for the demo user (API keys never expire and are sent as X-API-Key like tokens)
tokens.set('demo-api-key', users[0]);
const installations = [
  { id: 1001, name: 'Kontoret', client_id: 5001, organization_id: 1 },
  { id: 1002, name: 'Lagret', client_id: 5002, organization_id: 1 },
].map((i) => ({ capabilities: [], assigned: true, users: [1], notes: '', meta: {}, protected_meta: {}, ...i }));

const devices = [];
const functions = [];
const statuses = new Map(); // `${iid}|${topic}` -> entry
const logs = [];
// retained messages, sent (with the retain flag) right after a client subscribes - like a real broker.
// Some devices publish a bare value ("1") instead of JSON; IoT Open treats it as { value: 1 }.
const retained = new Map(); // full topic -> raw payload text
const setStatus = (e) => statuses.set(`${e.installation_id}|${e.topic}`, e);
// simulated thermostats: base topic -> { iid, client }
const thermostats = new Map();
// simulated media players: base topic -> { iid, client, track }; invented track names
const media = new Map();
const TRACKS = ['Exempelbandet – Första låten', 'Testkören – Sång om ingenting', 'Demoduon – Långsam vals', 'Påhittad artist – Ett längre låtnamn som inte får plats på en rad i widgeten'];

function dev(iid, type, name, meta = {}) {
  const d = { id: nextId++, installation_id: iid, type, created: now(), updated: now(), meta: { name, ...meta }, protected_meta: {} };
  devices.push(d);
  return d;
}
function fn(iid, device, type, name, topic, meta = {}) {
  const f = { id: nextId++, installation_id: iid, type, created: now(), updated: now(), meta: { name, topic_read: topic, ...(device ? { device_id: String(device.id) } : {}), ...meta }, protected_meta: {} };
  functions.push(f);
  return f;
}

// simulated signals: topic -> generator(t) ; run every 15 min for 48 h of history, then live
const signals = [];
function signal(iid, topic, gen) {
  signals.push({ iid, topic, gen });
}

// Kontoret – partly configured already, so the demo shows widgets right away
{
  const iid = 1001;
  const t = dev(iid, 'thermostat', 'Termostat vardagsrum', { [`dashboard.widget`]: 'card', 'dashboard.icon': 'home' });
  const temp = fn(iid, t, 'temperature', 'Temperatur', 'obj/zwave/12/temp', { format: '%.1f °C', 'dashboard.widget': 'chart', 'dashboard.color': '#ea580c', 'dashboard.icon': 'thermometer', 'dashboard.chart': 'Temperaturer', 'dashboard.limits': '-w<20,>22 -c<19,>23' });
  fn(iid, t, 'humidity', 'Luftfuktighet', 'obj/zwave/12/humidity', { format: '%d %%', 'dashboard.widget': 'gauge', 'dashboard.icon': 'droplet', 'dashboard.color': '#2563eb' });
  fn(iid, t, 'setpoint', 'Börvärde', 'obj/zwave/12/setpoint', { format: '%.1f °C', topic_write: 'set/obj/zwave/12/setpoint' });
  const meter = dev(iid, 'energy_meter', 'Elmätare');
  fn(iid, meter, 'power', 'Effekt', 'obj/meter/1/power', { unit: 'W', format: '%d W', 'dashboard.widget': 'value', 'dashboard.icon': 'bolt', 'dashboard.color': '#ca8a04' });
  fn(iid, meter, 'energy', 'Energi', 'obj/meter/1/energy', { format: '%.2f kWh' });
  const lamp = dev(iid, 'switch', 'Lampa entré');
  fn(iid, lamp, 'switch', 'Lampa entré', 'obj/zwave/20/state', { topic_write: 'set/obj/zwave/20/state', state_on: '1', state_off: '0', text_on: 'Tänd', text_off: 'Släckt', 'dashboard.widget': 'switch', 'dashboard.icon': 'lightbulb' });
  // dimmer like the real HA bridge: level 0–100 on topic_read/topic_write, on/off on the *_onoff pair
  const dim = dev(iid, 'light', 'Fasadbelysning');
  fn(iid, dim, 'dimmer', 'Fasadbelysning', 'obj/ha/light/facade', {
    min: '0', max: '100', unit: '%', state_on: '1', state_off: '0',
    topic_write: 'set/obj/ha/light/facade', topic_read_onoff: 'obj/ha/light/facade/onoff', topic_write_onoff: 'set/obj/ha/light/facade/onoff',
    'dashboard.widget': 'number', 'dashboard.icon': 'lightbulb', 'dashboard.color': '#ca8a04',
  });
  setStatus({ client_id: 5001, installation_id: iid, topic: 'obj/ha/light/facade', value: 30, msg: '', timestamp: now() - 900 });
  setStatus({ client_id: 5001, installation_id: iid, topic: 'obj/ha/light/facade/onoff', value: 1, msg: '', timestamp: now() - 900 });
  const door = dev(iid, 'door_sensor', 'Ytterdörr');
  fn(iid, door, 'door', 'Ytterdörr', 'obj/zwave/30/door', { state_on: '1', state_off: '0', text_on: 'Öppen', text_off: 'Stängd', 'dashboard.widget': 'status', 'dashboard.icon': 'door', 'dashboard.color': '#dc2626', 'dashboard.timeline': 'Händelser' });
  const fan = dev(iid, 'fan', 'Ventilation');
  fn(iid, fan, 'switch', 'Fläkt', 'obj/vent/1/state', { topic_write: 'set/obj/vent/1/state', state_on: '1', state_off: '0', text_on: 'På', text_off: 'Av' });
  fn(iid, fan, 'co2', 'CO₂', 'obj/vent/1/co2', { format: '%d ppm' });
  // a sensor that metric-monitor has flagged as silent (shown greyed out with its name struck through)
  const old = dev(iid, 'sensor', 'Givare förråd');
  fn(iid, old, 'temperature', 'Temperatur förråd', 'obj/zwave/50/temp', {
    format: '%.1f °C', 'dashboard.widget': 'value', 'dashboard.chart': 'Temperaturer', 'dashboard.icon': 'thermometer',
    'metric_monitor.max_silent_time': '6h', 'metric_monitor.status': '2', 'metric_monitor.status_text': 'Inget värde på 9 dagar',
  });
  setStatus({ client_id: 5001, installation_id: iid, topic: 'obj/zwave/50/temp', value: 14.2, msg: '', timestamp: now() - 9 * 86400 });
  fn(iid, null, 'outdoor_temperature', 'Utetemperatur', 'obj/smhi/temp', { format: '%.1f °C', 'dashboard.chart': 'Temperaturer' });
  const pir = dev(iid, 'motion_sensor', 'Rörelsevakt hall');
  fn(iid, pir, 'movement', 'Rörelse hall', 'obj/zwave/40/motion', { 'dashboard.timeline': 'Händelser' });
  fn(iid, pir, 'boolean_text', 'Sabotage hall', 'obj/zwave/40/tamper', { visible: 'false' });
  const leak = dev(iid, 'leak_sensor', 'Läckagevakt kök');
  fn(iid, leak, 'leak', 'Läckage kök', 'obj/zwave/41/leak', { 'dashboard.timeline': 'Händelser' });
  // alarm panel: a value widget used as a banner, text and colour per state
  const alarm = dev(iid, 'alarm_panel', 'Larmcentral');
  fn(iid, alarm, 'alarm', 'Larm', 'obj/alarm/1/state', {
    topic_write: 'set/obj/alarm/1/state', state_disarmed: '0', text_disarmed: 'Avlarmat', state_armed_home: '1', text_armed_home: 'Skalskydd', state_armed: '2', text_armed: 'Larmat',
    'dashboard.color_disarmed': '#16a34a', 'dashboard.color_armed_home': '#f6a53e', 'dashboard.color_armed': '#dc2626', 'dashboard.widget': 'value', 'dashboard.icon': 'lock',
  });
  setStatus({ client_id: 5001, installation_id: iid, topic: 'obj/alarm/1/state', value: 2, msg: '', timestamp: now() - 300 });
  // door bell: a push button that sends 1 while held and 0 when released
  const bell = dev(iid, 'doorbell', 'Dörrklocka');
  fn(iid, bell, 'button', 'Ringklocka', 'obj/bell/1/state', { topic_write: 'set/obj/bell/1/state', topic_write_chime: 'set/obj/bell/1/chime', 'dashboard.press': '1', 'dashboard.release': '0' });
  signal(iid, 'obj/zwave/40/motion', (ts) => (new Date(ts * 1000).getHours() >= 7 && new Date(ts * 1000).getHours() <= 18 && Math.random() < 0.45 ? 1 : 0));
  signal(iid, 'obj/zwave/40/tamper', () => 0);
  signal(iid, 'obj/zwave/41/leak', (ts) => (ts % 86400 > 30000 && ts % 86400 < 33000 ? 1 : 0));

  signal(iid, temp.meta.topic_read, (ts) => 21 + 1.5 * Math.sin(ts / 7200) + Math.random() * 0.3);
  signal(iid, 'obj/zwave/12/humidity', (ts) => Math.round(42 + 8 * Math.sin(ts / 20000) + Math.random() * 2));
  signal(iid, 'obj/zwave/12/setpoint', () => null);
  signal(iid, 'obj/meter/1/power', (ts) => Math.round(800 + 600 * Math.max(0, Math.sin(ts / 10000)) + Math.random() * 150));
  signal(iid, 'obj/meter/1/energy', (ts) => +(1200 + (ts % 1e6) / 3600).toFixed(2));
  signal(iid, 'obj/zwave/30/door', () => (Math.random() < 0.15 ? 1 : 0));
  signal(iid, 'obj/vent/1/co2', (ts) => Math.round(550 + 250 * Math.max(0, Math.sin(ts / 9000)) + Math.random() * 40));
  signal(iid, 'obj/smhi/temp', (ts) => 8 + 4 * Math.sin(ts / 30000) + Math.random() * 0.4);
  // edge client: online state published as a bare, retained "1" (no JSON, no timestamp)
  const edge = dev(iid, 'edge_client', 'Edge Client');
  fn(iid, edge, 'boolean_text', 'online', 'box/event/status', { state_true: '1', state_false: '0', text_true: 'up', text_false: 'down', 'dashboard.widget': 'status', 'dashboard.icon': 'bolt' });
  setStatus({ client_id: 5001, installation_id: iid, topic: 'box/event/status', value: 1, msg: '', timestamp: now() - 7 * 3600 });
  retained.set('5001/box/event/status', '1');
  // tracker: a vehicle reporting latitude and longitude as two values up to 2 s apart, and a boat sending a geohash
  const car = dev(iid, 'vehicle', 'Servicebil');
  fn(iid, car, 'latitude', 'Servicebil latitud', 'obj/gps/1/lat', { format: '%.5f', 'dashboard.tracker': 'Fordon' });
  fn(iid, car, 'longitude', 'Servicebil longitud', 'obj/gps/1/lon', { format: '%.5f', 'dashboard.tracker': 'Fordon' });
  const boat = dev(iid, 'boat', 'Arbetsbåt');
  fn(iid, boat, 'geohash', 'Arbetsbåt position', 'obj/gps/2/geohash', { 'dashboard.tracker': 'Fordon' });
  // a machine with two position sources: the editor lets you pick which latitude + longitude to use
  const digger = dev(iid, 'tracker', 'Grävmaskin');
  fn(iid, digger, 'latitude', 'Latitude', 'obj/gps/3/lat', { format: '%.5f' });
  fn(iid, digger, 'longitude', 'Longitude', 'obj/gps/3/lon', { format: '%.5f' });
  fn(iid, digger, 'latitude', 'Latitude GPS2', 'obj/gps/3/lat2', { format: '%.5f' });
  fn(iid, digger, 'longitude', 'Longitude GPS2', 'obj/gps/3/lon2', { format: '%.5f' });
  for (const [topic, v] of [['obj/gps/3/lat', 59.341], ['obj/gps/3/lon', 18.031], ['obj/gps/3/lat2', 59.3412], ['obj/gps/3/lon2', 18.0313]]) setStatus({ client_id: 5001, installation_id: iid, topic, value: v, msg: '', timestamp: now() - 1800 });
  // water meter: a counter in litres, logged every hour for more than a year
  const water = dev(iid, 'water_meter', 'Vattenmätare');
  fn(iid, water, 'water_meter', 'Vatten', 'obj/water/1/total', { format: '%.0f l', unit: 'l', 'dashboard.widget': 'consumption', 'dashboard.icon': 'droplet', 'dashboard.color': '#2563eb' });
  // people counter at an entrance (camera line counters): one counter per direction, a new value per passage
  const people = dev(iid, 'people_counter', 'Personräknare entré');
  fn(iid, people, 'counter', 'In', 'obj/people/1/in', { format: '%d', 'dashboard.widget': 'consumption', 'dashboard.icon': 'chart' });
  fn(iid, people, 'counter', 'Ut', 'obj/people/1/out', { format: '%d' });
  // media players mirrored from Home Assistant: one device, one function per feature (playing, volume, mute, state, power)
  const sonos = dev(iid, 'media_player', 'Sonos Vardagsrum', { 'dashboard.widget': 'media' });
  const mp = 'obj/ha/media_player/vardagsrum';
  fn(iid, sonos, 'switch', 'Sonos Vardagsrum Uppspelning', `${mp}/playing`, { topic_write: `set/${mp}/playing`, state_on: '1', state_off: '0' });
  fn(iid, sonos, 'dimmer', 'Sonos Vardagsrum Volym', `${mp}/volume`, { topic_write: `set/${mp}/volume`, min: '0', max: '100', unit: '%' });
  fn(iid, sonos, 'switch', 'Sonos Vardagsrum Mute', `${mp}/mute`, { topic_write: `set/${mp}/mute`, state_on: '1', state_off: '0' });
  fn(iid, sonos, 'text', 'Sonos Vardagsrum Status', `${mp}/state`);
  fn(iid, sonos, 'switch', 'Sonos Vardagsrum På/av', `${mp}/power`, { topic_write: `set/${mp}/power`, state_on: '1', state_off: '0' });
  media.set(mp, { iid, client: 5001, track: 0 });
  // a simpler player without mute and power support; its state comes as 0 from the status API, like a text
  // value can in IoT Open, until the next live message
  const radio = dev(iid, 'media_player', 'Radio kök');
  const rp = 'obj/ha/media_player/kok';
  fn(iid, radio, 'switch', 'Radio kök Uppspelning', `${rp}/playing`, { topic_write: `set/${rp}/playing`, state_on: '1', state_off: '0' });
  fn(iid, radio, 'dimmer', 'Radio kök Volym', `${rp}/volume`, { topic_write: `set/${rp}/volume`, min: '0', max: '100', unit: '%' });
  fn(iid, radio, 'text', 'Radio kök Status', `${rp}/state`);
  for (const [topic, value, msg] of [
    [`${mp}/playing`, 1, TRACKS[0]], [`${mp}/volume`, 35, ''], [`${mp}/mute`, 0, ''], [`${mp}/state`, 'playing', ''], [`${mp}/power`, 1, ''],
    [`${rp}/playing`, 0, 'P1 – Morgonpasset'], [`${rp}/volume`, 20, ''], [`${rp}/state`, 0, ''],
  ]) setStatus({ client_id: 5001, installation_id: iid, topic, value, msg, timestamp: now() - 120 });
  // a thermostat mirrored from Home Assistant: current, target (setpoint), mode and action on one device
  const hall = dev(iid, 'climate', 'Termostat hall', { 'dashboard.widget': 'thermostat' });
  const tp = 'obj/ha/climate/hall';
  fn(iid, hall, 'temperature', 'Termostat hall Temperatur', `${tp}/current`, { format: '%.1f °C', unit: '°C', 'ha.part': 'current' });
  fn(iid, hall, 'setpoint', 'Termostat hall Börvärde', `${tp}/target`, { topic_write: `set/${tp}/target`, format: '%.1f °C', unit: '°C', min: '5', max: '30', step: '0.5', 'ha.part': 'target' });
  fn(iid, hall, 'text', 'Termostat hall Läge', `${tp}/mode`, { topic_write: `set/${tp}/mode`, 'ha.hvac_modes': 'off,heat,auto', 'ha.part': 'mode' });
  fn(iid, hall, 'text', 'Termostat hall Drift', `${tp}/action`, { 'ha.part': 'action' });
  thermostats.set(tp, { iid, client: 5001 });
  for (const [topic, value, msg] of [[`${tp}/current`, 20.6, ''], [`${tp}/target`, 21, ''], [`${tp}/mode`, 'heat', 'heat'], [`${tp}/action`, 'heating', 'heating']]) setStatus({ client_id: 5001, installation_id: iid, topic, value, msg, timestamp: now() - 300 });
  for (const [topic, v] of [['obj/zwave/12/setpoint', 21.5], ['obj/zwave/20/state', 0], ['obj/vent/1/state', 1]]) setStatus({ client_id: 5001, installation_id: iid, topic, value: v, msg: '', timestamp: now() - 600 });
}
// Lagret – nothing configured: shows the empty state and the "add widget" flow
{
  const iid = 1002;
  const s = dev(iid, 'sensor', 'Klimatgivare lager');
  fn(iid, s, 'temperature', 'Temperatur lager', 'obj/lager/1/temp', { format: '%.1f °C' });
  fn(iid, s, 'humidity', 'Fukt lager', 'obj/lager/1/humidity', { format: '%d %%' });
  const port = dev(iid, 'door_sensor', 'Lastport');
  fn(iid, port, 'door', 'Lastport', 'obj/lager/2/door', { state_on: '1', state_off: '0', text_on: 'Öppen', text_off: 'Stängd' });
  const kitchen = dev(iid, 'light', 'Kökslampa');
  fn(iid, kitchen, 'switch', 'Kökslampa', 'obj/lager/3/state', { topic_write: 'set/obj/lager/3/state', state_on: '1', state_off: '0' });
  fn(iid, kitchen, 'dimmer', 'Kökslampa nivå', 'obj/lager/3/level', { topic_write: 'set/obj/lager/3/level', min: '0', max: '100', unit: '%' });
  fn(iid, kitchen, 'power', 'Kökslampa effekt', 'obj/lager/3/power', { format: '%d W' });
  const plug = dev(iid, 'plug', 'Uttag kontor');
  fn(iid, plug, 'switch', 'Uttag kontor', 'obj/lager/4/state', { topic_write: 'set/obj/lager/4/state', state_on: '1', state_off: '0' });
  const gate = dev(iid, 'gate', 'Grind');
  fn(iid, gate, 'button', 'Öppna grind', 'obj/lager/5/open', { topic_write: 'set/obj/lager/5/open' });
  for (const [topic, v] of [['obj/lager/3/state', 1], ['obj/lager/3/level', 60], ['obj/lager/3/power', 9], ['obj/lager/4/state', 0]]) setStatus({ client_id: 5002, installation_id: iid, topic, value: v, msg: '', timestamp: now() - 600 });
  signal(iid, 'obj/lager/1/temp', (ts) => 12 + 2 * Math.sin(ts / 15000));
  signal(iid, 'obj/lager/1/humidity', (ts) => Math.round(60 + 5 * Math.sin(ts / 25000)));
  signal(iid, 'obj/lager/2/door', () => (Math.random() < 0.3 ? 1 : 0));
}

const clientOf = (iid) => installations.find((i) => i.id === iid).client_id;
for (const s of signals) {
  for (let ts = now() - 48 * 3600; ts <= now() - 60; ts += 900) {
    const v = s.gen(ts);
    if (v === null) continue;
    const e = { client_id: clientOf(s.iid), installation_id: s.iid, timestamp: ts, topic: s.topic, value: +(+v).toFixed(2), msg: '' };
    logs.push(e);
    setStatus(e);
  }
}
// made-up routes: a loop for the vehicle, a slower loop on the water for the boat
const carAt = (ts) => {
  const t = (ts / 1800) * Math.PI;
  return { lat: 59.3326 + 0.012 * Math.sin(t) + 0.003 * Math.sin(3 * t), lon: 18.0649 + 0.024 * Math.cos(t) };
};
const boatAt = (ts) => {
  const t = (ts / 5400) * Math.PI;
  return { lat: 59.318 + 0.006 * Math.sin(t), lon: 18.105 + 0.02 * Math.cos(t) };
};
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lon, len = 9) {
  const r = { lat: [-90, 90], lon: [-180, 180] };
  let even = true, bit = 0, ch = 0, out = '';
  while (out.length < len) {
    const k = even ? 'lon' : 'lat';
    const v = even ? lon : lat;
    const mid = (r[k][0] + r[k][1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[k][0] = mid; } else { ch <<= 1; r[k][1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}
const record = (iid, topic, ts, value, live) => {
  const e = { client_id: clientOf(iid), installation_id: iid, timestamp: ts, topic, value, msg: '' };
  logs.push(e);
  setStatus(e);
  if (live) mqttBroadcast(e);
};
// the vehicle: latitude first, longitude 0-2 s later (as some trackers do)
const carFix = (ts, live) => {
  const p = carAt(ts);
  const lag = Math.round(Math.random() * 2);
  record(1001, 'obj/gps/1/lat', ts, +p.lat.toFixed(6), live);
  if (live) setTimeout(() => record(1001, 'obj/gps/1/lon', ts + lag, +p.lon.toFixed(6), true), lag * 1000);
  else record(1001, 'obj/gps/1/lon', ts + lag, +p.lon.toFixed(6), false);
};
const boatFix = (ts, live) => {
  const p = boatAt(ts);
  record(1001, 'obj/gps/2/geohash', ts, geohash(p.lat, p.lon), live);
};
for (let ts = now() - 12 * 3600; ts <= now() - 30; ts += 30) carFix(ts, false);
for (let ts = now() - 12 * 3600; ts <= now() - 120; ts += 120) boatFix(ts, false);
// water: more at mornings and evenings, more at weekends
let water = 184000;
const waterPerHour = (ts) => {
  const d = new Date(ts * 1000);
  const h = d.getHours();
  const base = h >= 6 && h <= 8 ? 40 : h >= 17 && h <= 21 ? 30 : h >= 23 || h <= 5 ? 1 : 8;
  return base * ([0, 6].includes(d.getDay()) ? 1.4 : 1) * (0.6 + Math.random() * 0.8);
};
for (let ts = Math.floor((now() - 400 * 86400) / 3600) * 3600; ts <= now() - 60; ts += 3600) {
  water += waterPerHour(ts);
  record(1001, 'obj/water/1/total', ts, Math.round(water), false);
}
// people counter: open 08:40-17:00, most arrive in the morning and leave in the afternoon; the camera's counters
// start from 0 every morning (a restart), which the consumption widget treats as a reset meter
const people = { in: 0, out: 0 };
const peopleRate = (dir, h) =>
  dir === 'in' ? (h >= 9 && h < 11 ? 90 : h >= 11 && h < 14 ? 50 : h >= 14 && h < 16 ? 25 : h === 8 ? 40 : h === 16 ? 8 : 2)
    : h >= 15 && h < 17 ? 110 : h >= 12 && h < 15 ? 35 : h >= 9 && h < 12 ? 12 : h === 17 ? 30 : 2;
for (let day = 6; day >= 0; day--) {
  const d = new Date();
  d.setDate(d.getDate() - day);
  d.setHours(8, 40, 0, 0);
  people.in = people.out = 0;
  for (let ts = d.getTime() / 1000; ts < Math.min(d.getTime() / 1000 + 9 * 3600, now() - 60); ts += 60) {
    const h = new Date(ts * 1000).getHours();
    for (const dir of ['in', 'out']) {
      const n = Math.round((peopleRate(dir, h) / 60) * (0.4 + Math.random() * 1.2));
      for (let k = 0; k < n; k++) record(1001, `obj/people/1/${dir}`, ts + k, ++people[dir], false);
    }
  }
}
setInterval(() => {
  const h = new Date().getHours();
  for (const dir of ['in', 'out']) if (Math.random() < Math.max(0.3, peopleRate(dir, h) / 120)) record(1001, `obj/people/1/${dir}`, now(), ++people[dir], true);
}, 15000);
setInterval(() => {
  carFix(now(), true);
  boatFix(now(), true);
  water += waterPerHour(now()) / 360 * 2;
  record(1001, 'obj/water/1/total', now(), Math.round(water), true);
}, 20000);

// live values every 10 s
setInterval(() => {
  for (const s of signals) {
    const v = s.gen(now());
    if (v === null) continue;
    const e = { client_id: clientOf(s.iid), installation_id: s.iid, timestamp: now(), topic: s.topic, value: +(+v).toFixed(2), msg: '' };
    logs.push(e);
    setStatus(e);
    mqttBroadcast(e);
  }
}, 10000);

const files = [];
const blobs = new Map();
function addFile(iid, name, mime, buf) {
  const hash = crypto.createHash('sha256').update(buf).update(String(Math.random())).digest('hex');
  blobs.set(hash, { buf, mime });
  const f = { id: nextId++, installation_id: iid, name, mime, hash, created: now(), updated: now() };
  files.push(f);
  return f;
}

// ---------------- http helpers ----------------
const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isBuf ? headers['Content-Type'] || 'application/octet-stream' : 'application/json', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
function parseMultipart(buf, ctype) {
  const boundary = '--' + /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype).slice(1).find(Boolean);
  const parts = [];
  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const next = buf.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(idx + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, sep).toString();
    parts.push({ filename: /filename="([^"]*)"/.exec(head)?.[1], type: /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1], data: part.subarray(sep + 4) });
    idx = next;
  }
  return parts.find((p) => p.filename);
}
const auth = (req) => tokens.get(req.headers['x-api-key']);
const strip = ({ password, ...u }) => u;

// ---------------- routes ----------------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const seg = p.split('/').filter(Boolean);

  if (p === '/api/v2/auth' && m === 'POST') {
    const [u, pw] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
    const user = users.find((x) => x.email === u && x.password === pw);
    if (!user) return send(res, 401, { message: 'Invalid credentials', status: 401 });
    const token = crypto.randomBytes(24).toString('hex');
    // 2FA demo user: first step returns a temporary token + next_step, the code is 123456
    if (user.twofa) {
      pending2fa.set(token, user);
      return send(res, 200, { token, next_step: 'totp' });
    }
    tokens.set(token, user);
    return send(res, 200, { token });
  }
  if (p === '/api/v2/auth' && m === 'PUT') {
    const user = pending2fa.get(req.headers['x-api-key']);
    const { challenge } = JSON.parse((await readBody(req)).toString() || '{}');
    if (!user || challenge !== '123456') return send(res, 401, { message: 'Invalid challenge', status: 401 });
    pending2fa.delete(req.headers['x-api-key']);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, user);
    return send(res, 200, { token });
  }
  // an edge client's own credentials (Basic <client_id>:<mqtt password>) - like real IoT Open they may read
  // functions, devices and the latest values of their installation, not its files, metadata or log
  if (/^Basic /.test(req.headers.authorization || '') && !req.headers['x-api-key']) {
    const [cid] = Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':');
    const inst = installations.find((i) => String(i.client_id) === cid);
    if (!inst) return send(res, 401, { message: 'Unauthorized', status: 401 });
    if (m !== 'GET' || !['functionx', 'devicex', 'status'].includes(seg[2]) || Number(seg[3]) !== inst.id) return send(res, 403, { message: 'Forbidden', status: 403 });
  }
  const me = auth(req) || (/^Basic /.test(req.headers.authorization || '') ? users[0] : null);
  if (!me) return send(res, 401, { message: 'Unauthorized', status: 401 });
  if (p === '/api/v2/auth' && m === 'DELETE') { tokens.delete(req.headers['x-api-key']); return send(res, 200, { message: 'ok' }); }

  const body = ['POST', 'PUT'].includes(m) ? await readBody(req) : null;
  const json = () => JSON.parse(body.toString() || '{}');
  const log = (what) => console.log(`[write] ${m} ${p} ${what || ''}`);

  if (p === '/api/v2/user/me') return send(res, 200, strip(me));
  if (p === '/api/v2/installationinfo') return send(res, 200, installations.map(({ id, name, client_id, organization_id, capabilities, assigned, notes }) => ({ id, name, client_id, organization_id, capabilities, assigned, notes })));
  if (seg[2] === 'installation') {
    const i = installations.find((x) => x.id === Number(seg[3]));
    if (!i) return send(res, 404, { message: 'Not found' });
    if (m !== 'GET') res.once('finish', () => res.statusCode < 300 && mqttPublish(`${i.client_id}/evt/installation/updated`, {}));
    if (seg[4] === 'meta' && m === 'PUT') { const k = decodeURIComponent(seg[5]); const v = json().value; if (!v) return send(res, 400, { message: "Key: 'MetaX.Value' Error:Field validation for 'Value' failed on the 'min' tag" }); i.meta[k] = v; log(`${k}=${v}`); return send(res, 200, { value: v, protected: false }); }
    if (seg[4] === 'meta' && m === 'DELETE') { const k = decodeURIComponent(seg[5]); delete i.meta[k]; log(`${k} deleted`); return send(res, 200, { message: 'Deleted' }); }
    return send(res, 200, i);
  }

  if (seg[2] === 'devicex' || seg[2] === 'functionx') {
    const list = seg[2] === 'devicex' ? devices : functions;
    const iid = Number(seg[3]);
    const id = seg[4] ? Number(seg[4]) : null;
    // like real Lynx: every change publishes "<client_id>/evt/<devicex|functionx>/updated" with payload {}
    if (m !== 'GET') {
      const inst = installations.find((i) => i.id === iid);
      if (inst) res.once('finish', () => res.statusCode < 300 && mqttPublish(`${inst.client_id}/evt/${seg[2]}/updated`, {}));
    }
    if (!id && m === 'GET') return send(res, 200, list.filter((o) => o.installation_id === iid));
    const o = list.find((x) => x.id === id && x.installation_id === iid);
    if (!o) return send(res, 404, { message: 'Not found' });
    // like real Lynx: empty values are rejected, clearing a key is a DELETE
    if (seg[5] === 'meta' && m === 'PUT') { const k = decodeURIComponent(seg[6]); const v = json().value; if (!v) return send(res, 400, { message: "Key: 'MetaX.Value' Error:Field validation for 'Value' failed on the 'min' tag" }); o.meta[k] = v; o.updated = now(); log(`${k}=${v}`); return send(res, 200, { value: v, protected: false }); }
    if (seg[5] === 'meta' && m === 'DELETE') { const k = decodeURIComponent(seg[6]); delete o.meta[k]; o.updated = now(); log(`${k} deleted`); return send(res, 200, { message: 'Deleted' }); }
    if (m === 'GET') return send(res, 200, o);
  }

  if (seg[2] === 'status') return send(res, 200, [...statuses.values()].filter((st) => st.installation_id === Number(seg[3])));
  if (seg[1] === 'v3beta' && seg[2] === 'log') {
    const q = url.searchParams;
    const topics = q.getAll('topics').map((t) => t.replace(/^\d+\//, ''));
    const from = Number(q.get('from') || 0), to = Number(q.get('to') || now());
    let data = logs.filter((l) => l.installation_id === Number(seg[3]) && l.timestamp >= from && l.timestamp <= to && (!topics.length || topics.includes(l.topic)));
    // like real Lynx: aggr_method + aggr_interval downsample per topic into buckets (timestamp = bucket start)
    const am = q.get('aggr_method');
    const ai = /^(\d+)([smhd])$/.exec(q.get('aggr_interval') || '');
    if (am && ai) {
      const sec = Number(ai[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[ai[2]];
      const buckets = new Map();
      for (const l of data) {
        const k = `${l.topic}|${Math.floor(l.timestamp / sec) * sec}`;
        if (!buckets.has(k)) buckets.set(k, { ...l, timestamp: Math.floor(l.timestamp / sec) * sec, values: [] });
        buckets.get(k).values.push(Number(l.value));
      }
      const fnOf = { avg: (v) => v.reduce((a, b) => a + b, 0) / v.length, mean: (v) => v.reduce((a, b) => a + b, 0) / v.length, min: (v) => Math.min(...v), max: (v) => Math.max(...v), sum: (v) => v.reduce((a, b) => a + b, 0), last: (v) => v[v.length - 1], first: (v) => v[0], count: (v) => v.length, median: (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] };
      const f = fnOf[am] || fnOf.median;
      data = [...buckets.values()].map(({ values, ...b }) => ({ ...b, value: f(values) }));
    }
    data.sort((a, b) => (q.get('order') === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp));
    const total = data.length;
    const off = Number(q.get('offset') || 0);
    data = data.slice(off, off + Number(q.get('limit') || 500)).map((e) => ({ ...e, topic: `${e.client_id}/${e.topic}` })); // real Lynx prefixes the client id
    return send(res, 200, { total, count: data.length, last_time: data[data.length - 1]?.timestamp || 0, data });
  }

  if (seg[2] === 'file') {
    if (seg[3] === 'download') { const b = blobs.get(seg[4]); return b ? send(res, 200, b.buf, { 'Content-Type': b.mime }) : send(res, 404, { message: 'Not found' }); }
    const iid = Number(seg[4]);
    const id = seg[5] ? Number(seg[5]) : null;
    const finst = installations.find((x) => x.id === iid);
    if (m !== 'GET' && finst) res.once('finish', () => res.statusCode < 300 && mqttPublish(`${finst.client_id}/evt/file/updated`, {}));
    if (!id && m === 'GET') return send(res, 200, files.filter((f) => f.installation_id === iid));
    if (!id && m === 'POST') { const part = parseMultipart(body, req.headers['content-type']); log(part.filename); return send(res, 200, addFile(iid, part.filename, part.type, part.data)); }
    const f = files.find((x) => x.id === id);
    if (!f) return send(res, 404, { message: 'Not found' });
    if (m === 'DELETE') { files.splice(files.indexOf(f), 1); log(f.name); return send(res, 200, { message: 'ok' }); }
    if (m === 'PUT' || m === 'POST') {
      const part = parseMultipart(body, req.headers['content-type']);
      const hash = crypto.createHash('sha256').update(part.data).update(String(Math.random())).digest('hex');
      blobs.set(hash, { buf: part.data, mime: part.type });
      Object.assign(f, { hash, name: part.filename, mime: part.type, updated: now() });
      log(part.filename);
      return send(res, 200, f);
    }
  }
  return send(res, 404, { message: `Mock: no route for ${m} ${p}` });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // like IoT Open: CORS open for all origins, so the dashboard can also use it as a custom server
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    send(res, 404, { message: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
});

// topics without a function in IoT Open, for the MQTT widget: a weather station sending its own JSON and
// production lines publishing their state as bare text (all invented). Retained, like a real device would.
function rawPublish(full, text) {
  retained.set(full, text);
  mqttPublishText(full, text);
}
const LINE_STATES = ['running', 'running', 'running', 'stopped', 'fault'];
function rawSignals() {
  const t = now();
  rawPublish('5001/sensor/weather/station', JSON.stringify({ temperature: +(9 + 3 * Math.sin(t / 3000) + Math.random() * 0.3).toFixed(2), humidity: Math.round(70 + 10 * Math.sin(t / 5000)), wind: { speed: +(2 + Math.random() * 4).toFixed(1), direction: Math.round(Math.random() * 359) }, timestamp: t }));
  const line = 1 + Math.floor(Math.random() * 3);
  rawPublish(`5001/lab/line/${line}/status`, LINE_STATES[Math.floor(Math.random() * LINE_STATES.length)]);
}
for (const n of [1, 2, 3]) retained.set(`5001/lab/line/${n}/status`, 'running');
setTimeout(rawSignals, 0); // after the MQTT section below has run
setInterval(rawSignals, 5000);

// ---------------- MQTT over WebSocket (/mqtt) ----------------
const mqttClients = new Set();
function wsSend(socket, bytes) {
  const len = bytes.length;
  const head = len < 126 ? Buffer.from([0x82, len]) : len < 65536 ? Buffer.from([0x82, 126, len >> 8, len & 255]) : null;
  if (head) socket.write(Buffer.concat([head, Buffer.from(bytes)]));
}
const mstr = (s) => { const b = Buffer.from(s); return [b.length >> 8, b.length & 255, ...b]; };
const mlen = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
/** A thermostat answers like the Home Assistant bridge: the new target or mode, and what it is doing now. */
function thermostatWrite(inst, f, pl) {
  const m = /^(.*)\/(target|mode)$/.exec(f.meta.topic_read);
  if (!m || !thermostats.has(m[1])) return false;
  const send = (part, value, msg = '') => {
    const e = { client_id: inst.client_id, installation_id: inst.id, topic: `${m[1]}/${part}`, value, msg, timestamp: now() };
    logs.push(e); setStatus(e); mqttBroadcast(e);
  };
  setTimeout(() => {
    if (m[2] === 'target') send('target', Number(pl.value));
    else send('mode', String(pl.value), String(pl.value));
    const mode = statuses.get(`${inst.id}|${m[1]}/mode`)?.value;
    const cur = Number(statuses.get(`${inst.id}|${m[1]}/current`)?.value);
    const tgt = Number(statuses.get(`${inst.id}|${m[1]}/target`)?.value);
    const action = mode === 'off' ? 'off' : cur < tgt ? 'heating' : 'idle';
    send('action', action, action);
  }, 400);
  return true;
}
/** A media player answers like the Home Assistant bridge: playing keeps the track in msg, state follows. */
function mediaWrite(inst, f, pl) {
  const m = /^(.*)\/(playing|volume|mute|power)$/.exec(f.meta.topic_read);
  const p = m && media.get(m[1]);
  if (!p) return false;
  const send = (part, value, msg = '') => {
    const e = { client_id: inst.client_id, installation_id: inst.id, topic: `${m[1]}/${part}`, value, msg, timestamp: now() };
    logs.push(e); setStatus(e); mqttBroadcast(e);
  };
  const v = Number(pl.value);
  setTimeout(() => {
    if (m[2] === 'playing') {
      send('playing', v ? 1 : 0, TRACKS[p.track]);
      send('state', v ? 'playing' : 'paused');
    } else if (m[2] === 'power') {
      send('power', v ? 1 : 0);
      send('playing', 0, '');
      send('state', v ? 'idle' : 'off');
    } else send(m[2], v);
  }, 400);
  return true;
}
// a new track every two minutes while playing: same value, new msg
setInterval(() => {
  for (const [base, p] of media) {
    const st = statuses.get(`${p.iid}|${base}/playing`);
    if (!st || !st.value) continue;
    p.track = (p.track + 1) % TRACKS.length;
    const e = { ...st, msg: TRACKS[p.track], timestamp: now() };
    logs.push(e); setStatus(e); mqttBroadcast(e);
  }
}, 120000);

function mqttBroadcast(e) {
  mqttPublish(`${e.client_id}/${e.topic}`, { value: e.value, timestamp: e.timestamp, msg: e.msg });
}
function mqttPublish(full, obj) {
  mqttPublishText(full, JSON.stringify(obj));
}
function mqttPublishText(full, text) {
  const t = mstr(full);
  const p = [...Buffer.from(text)];
  const pkt = [0x30, ...mlen(t.length + p.length), ...t, ...p];
  for (const c of mqttClients) if (c.authed && subscribed(c, full)) wsSend(c.socket, pkt);
}
/** MQTT topic matching like a broker: "+" = one level, "#" = this level and everything below. */
function topicMatch(filter, topic) {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false;
  }
  return f.length === t.length;
}
const subscribed = (c, full) => [...c.topics].some((f) => topicMatch(f, full));
function handleMqtt(c, type, body) {
  if (type === 1) { // CONNECT – password is the token
    let o = 10; o += 2 + ((body[o] << 8) | body[o + 1]);
    o += 2 + ((body[o] << 8) | body[o + 1]);
    const pl = (body[o] << 8) | body[o + 1];
    c.authed = tokens.has(body.subarray(o + 2, o + 2 + pl).toString());
    wsSend(c.socket, [0x20, 2, 0, c.authed ? 0 : 5]);
  } else if (type === 8) {
    const rc = [];
    for (let o = 2; o < body.length;) { const l = (body[o] << 8) | body[o + 1]; c.topics.add(body.subarray(o + 2, o + 2 + l).toString()); o += 3 + l; rc.push(0); }
    wsSend(c.socket, [0x90, 2 + rc.length, body[0], body[1], ...rc]);
    const fresh = [];
    for (let o = 2; o < body.length;) { const l = (body[o] << 8) | body[o + 1]; fresh.push(body.subarray(o + 2, o + 2 + l).toString()); o += 3 + l; }
    for (const [full, text] of retained) {
      if (!fresh.some((f) => topicMatch(f, full))) continue;
      const t = mstr(full);
      const p = [...Buffer.from(text)];
      wsSend(c.socket, [0x31, ...mlen(t.length + p.length), ...t, ...p]);
    }
  } else if (type === 10) {
    for (let o = 2; o < body.length;) { const l = (body[o] << 8) | body[o + 1]; c.topics.delete(body.subarray(o + 2, o + 2 + l).toString()); o += 2 + l; }
    wsSend(c.socket, [0xb0, 2, body[0], body[1]]);
  } else if (type === 12) wsSend(c.socket, [0xd0, 0]);
  else if (type === 3 && c.authed) {
    // PUBLISH from the dashboard: "<client_id>/<topic_write>". The simulated device answers on its topic_read.
    const tl = (body[0] << 8) | body[1];
    const full = body.subarray(2, 2 + tl).toString();
    const mm = /^(\d+)\/(.*)$/.exec(full);
    const inst = mm && installations.find((i) => i.client_id === Number(mm[1]));
    if (!inst) return;
    let pl = {}; try { pl = JSON.parse(body.subarray(2 + tl).toString()); } catch { /* ignore */ }
    console.log(`[mqtt publish] ${full} ${JSON.stringify(pl)}`);
    const f = functions.find((x) => x.installation_id === inst.id && (x.meta.topic_write === mm[2] || x.meta.topic_write_onoff === mm[2]));
    if (!f) return;
    if (mediaWrite(inst, f, pl)) return;
    if (thermostatWrite(inst, f, pl)) return;
    setTimeout(() => {
      const topic = f.meta.topic_write_onoff === mm[2] ? f.meta.topic_read_onoff : f.meta.topic_read;
      const e = { client_id: inst.client_id, installation_id: inst.id, topic, value: pl.value, msg: '', timestamp: now() };
      logs.push(e); setStatus(e); mqttBroadcast(e);
    }, 400);
  }
}
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/mqtt')) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n`);
  const c = { socket, topics: new Set(), authed: false };
  mqttClients.add(c);
  let wsBuf = Buffer.alloc(0);
  let mq = Buffer.alloc(0);
  socket.on('data', (d) => {
    wsBuf = Buffer.concat([wsBuf, d]);
    for (;;) {
      if (wsBuf.length < 2) break;
      const op = wsBuf[0] & 15;
      let len = wsBuf[1] & 127; let o = 2;
      if (len === 126) { if (wsBuf.length < 4) break; len = wsBuf.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (wsBuf.length < 10) break; len = Number(wsBuf.readBigUInt64BE(2)); o = 10; }
      if (wsBuf.length < o + 4 + len) break;
      const mask = wsBuf.subarray(o, o + 4);
      const data = Buffer.from(wsBuf.subarray(o + 4, o + 4 + len)).map((b, i) => b ^ mask[i % 4]);
      wsBuf = wsBuf.subarray(o + 4 + len);
      if (op === 8) { socket.end(); return; }
      if (op !== 2 && op !== 0) continue;
      mq = Buffer.concat([mq, data]);
      for (;;) {
        if (mq.length < 2) break;
        let mul = 1, l = 0, i = 1, b;
        do { if (i >= mq.length) { b = -1; break; } b = mq[i++]; l += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (b === -1 || mq.length < i + l) break;
        handleMqtt(c, mq[0] >> 4, mq.subarray(i, i + l));
        mq = mq.subarray(i + l);
      }
    }
  });
  const drop = () => mqttClients.delete(c);
  socket.on('close', drop);
  socket.on('error', drop);
});

server.listen(PORT, () => console.log(`IoT Open mock on http://localhost:${PORT}  (login demo@example.com / demo, MQTT on ws://localhost:${PORT}/mqtt)`));
