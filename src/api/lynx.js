import { apiUrl, apiUrlFor, customServersAllowed, defaultServer, getServer, normalizeServer, serverLabel, setServer } from './server.js';

// Minimal IoT Open (Lynx) REST client.
// By default all requests go to the same origin under /api – nginx (or the Vite dev server) proxies them
// to the IoT Open instance. With a custom server (see server.js) they go to that server directly.
// Users, roles and permissions are handled entirely by IoT Open; the dashboard only keeps the session token.

export class HTTPError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ---- sign-in: the token and the server it belongs to ----------------------------------------------------------
//
// The token is stored together with the server it was issued by, as one record ("dash.auth"): { token, kind,
// server, link }. server is the custom server's origin, or '' for this container's own server (LYNX_URL). The
// record decides which server the tab talks to, and a token is only sent while that server is the current one,
// so a token never goes to another server than its own.
//   sessionStorage: this tab only (no "remember me", or a direct link)
//   localStorage:   remembered in this browser
// A record is only written once the sign-in has been checked (/user/me and the installations).

const AUTH_KEY = 'dash.auth';
const OLD_KEYS = ['dash.token', 'dash.tokenKind']; // before 0.18.2: token and kind without their server

const stores = () => {
  const out = {};
  try {
    out.session = window.sessionStorage;
  } catch {
    /* unavailable */
  }
  try {
    out.local = window.localStorage;
  } catch {
    /* unavailable */
  }
  return out;
};

function readRecord(store) {
  if (!store) return null;
  try {
    const rec = JSON.parse(store.getItem(AUTH_KEY) || 'null');
    if (rec && typeof rec.token === 'string' && rec.token && typeof rec.server === 'string') return rec;
    // an older version: the token was used with the server saved in this browser, so it stays bound to that one
    const t = store.getItem(OLD_KEYS[0]);
    if (t) return { token: t, kind: store.getItem(OLD_KEYS[1]) || 'session', server: getServer() || '' };
  } catch {
    /* unreadable */
  }
  return null;
}
function writeRecord(store, rec) {
  if (!store) return;
  try {
    OLD_KEYS.forEach((k) => store.removeItem(k));
    if (rec) store.setItem(AUTH_KEY, JSON.stringify(rec));
    else store.removeItem(AUTH_KEY);
  } catch {
    /* storage unavailable - kept in memory only */
  }
}

/** Makes a record's server the current one; false when it may not be used (custom servers off). */
function applyServer(server) {
  if (!server) {
    setServer(null);
    return true;
  }
  if (!customServersAllowed()) return false;
  setServer(server);
  return true;
}
/** '' for this container's own server, else the custom server's origin. */
export const serverId = () => getServer() || '';

let state = null; // { token, kind, server, from: 'session' | 'local' | null, link }
let onUnauthorized = () => {};

// Direct link / QR code: #token=KEY or #/i/<id>?token=KEY signs in with an API key, optionally with
// &server=<host> for another server than this container's. It is kept after the # so it never reaches the
// server (logs, Referer), and is removed from the address bar at once. init() decides what to do with it
// (see linkDecision): it never silently replaces another sign-in, and never goes to another server unasked.
let linkRaw = null;
let pending = null; // a link waiting for the user's choice: { token, server, error }
(function tokenFromUrl() {
  const hash = window.location.hash.replace(/^#/, '');
  const q = hash.indexOf('?');
  const [path, query] = /^token=/.test(hash) ? ['/', hash] : q >= 0 ? [hash.slice(0, q), hash.slice(q + 1)] : [hash, ''];
  const params = new URLSearchParams(query);
  const t = params.get('token')?.trim();
  if (!t) return;
  const server = params.get('server')?.trim() || '';
  params.delete('token');
  params.delete('server');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${path || '/'}${rest ? '?' + rest : ''}`);
  linkRaw = { token: t, server };
})();

/**
 * What to do with a direct link: 'same' (already signed in with it), 'use' (nobody is signed in and it is for
 * this container's own server) or 'ask' (show the account and the server first). link.server: '' or an origin.
 */
export function linkDecision(current, link) {
  if (link.error) return 'ask';
  if (current?.token && current.token === link.token && (current.server || '') === link.server) return 'same';
  if (!current?.token && !link.server) return 'use';
  return 'ask';
}

/** A link's server parameter as { server: '' } (this container's) or { server: origin }, or { error }. */
export function linkServer(raw) {
  if (!raw) return { server: '' };
  let origin;
  try {
    origin = normalizeServer(raw);
  } catch (e) {
    return { error: `Länkens server går inte att använda: ${e.message}` };
  }
  if (origin === defaultServer()) return { server: '' };
  if (!customServersAllowed()) return { error: `Länken gäller servern ${new URL(origin).host}, men andra servrar än ${serverLabel(defaultServer())} är avstängda här.` };
  return { server: origin };
}

function init() {
  if (state) return state;
  state = { token: null, kind: 'session', server: '', from: null, link: false };
  const { session, local } = stores();
  for (const [from, store] of [['session', session], ['local', local]]) {
    const rec = readRecord(store);
    if (rec && applyServer(rec.server)) {
      state = { token: rec.token, kind: rec.kind || 'session', server: serverId(), from, link: !!rec.link };
      break;
    }
  }
  if (linkRaw) {
    const { server = '', error } = linkServer(linkRaw.server);
    const link = { token: linkRaw.token, server, error };
    linkRaw = null;
    const what = linkDecision(state, link);
    if (what === 'use') activateLink(link);
    else if (what === 'ask') pending = link;
  }
  return state;
}

function activateLink(link) {
  if (!applyServer(link.server)) throw new Error('Andra servrar är avstängda här.');
  // tab only and always 'apikey', so signing out never revokes the shared key; a remembered sign-in stays
  state = { token: link.token, kind: 'apikey', server: serverId(), from: 'session', link: true };
  writeRecord(stores().session, { token: link.token, kind: 'apikey', server: state.server, link: true });
}

export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);
/** The token, or null when there is none or the current server is not the one it belongs to. */
export const getToken = () => {
  const s = init();
  return s.token && s.server === serverId() ? s.token : null;
};
/** 'session' (password login, may expire) or 'apikey' (created in IoT Open, does not expire). */
export const getTokenKind = () => init().kind;

/** Uses a token for the current server in this page only; saveToken() keeps it once the sign-in is checked. */
export function holdToken(t, kind = 'session') {
  init();
  state = { token: t || null, kind, server: serverId(), from: null, link: false };
}

/** Keeps the token in use, with its server: in this browser (remember) or this tab. Replaces any other. */
export function saveToken(remember = false) {
  const s = init();
  const { session, local } = stores();
  writeRecord(session, null);
  writeRecord(local, null);
  if (!s.token) return;
  writeRecord(remember ? local : session, { token: s.token, kind: s.kind, server: s.server });
  s.from = remember ? 'local' : 'session';
}

/** Uses and keeps a token; null signs out everywhere. */
export function setToken(t, remember = false, kind = 'session') {
  if (!t) return void clearToken(true);
  holdToken(t, kind);
  saveToken(remember);
}

/**
 * Signs out. A direct link's sign-in only leaves this tab, and a remembered sign-in is used again: true when that
 * happened. `everywhere` removes both.
 */
export function clearToken(everywhere = false) {
  const s = init();
  const { session, local } = stores();
  const back = !everywhere && s.from === 'session' && s.link ? readRecord(local) : null;
  writeRecord(session, null);
  if (!back) writeRecord(local, null);
  state = { token: null, kind: 'session', server: serverId(), from: null, link: false };
  if (back && applyServer(back.server)) {
    state = { token: back.token, kind: back.kind || 'session', server: serverId(), from: 'local', link: false };
    return true;
  }
  return false;
}

/** A direct link that waits for the user's choice: { token, server, error }, or null. */
export const pendingLink = () => (init(), pending);
/** Signs in with the waiting link (this tab only). */
export function acceptLink() {
  const link = pendingLink();
  pending = null;
  if (link && !link.error) activateLink(link);
}
/** Ignores the waiting link: the current sign-in stays. */
export const dropLink = () => void (pending = null);

/** The account a link's key belongs to, asked of the link's own server; throws an HTTPError when refused. */
export async function linkAccount(link) {
  const res = await fetch(apiUrlFor(link.server, 'api/v2/user/me'), { headers: { 'X-API-Key': link.token } });
  if (!res.ok) throw new HTTPError(res.statusText || `HTTP ${res.status}`, res.status);
  return res.json();
}

// A 401 from one endpoint does not have to mean the session is gone (some endpoints answer 401 for a
// missing permission). Only sign out when /user/me also says 401 for the same token.
let checking = null;
function checkSession(t) {
  if (checking) return;
  checking = fetch(apiUrl('api/v2/user/me'), { headers: { 'X-API-Key': t } })
    .then((r) => {
      if (r.status === 401 && getToken() === t) {
        console.warn('IoT Open session expired – signing out');
        onUnauthorized();
      }
    })
    .catch(() => {})
    .finally(() => (checking = null));
}

function qs(params) {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, auth = true } = {}) {
  const h = new Headers(headers);
  const token = getToken();
  if (auth && token && !h.has('Authorization')) h.set('X-API-Key', token);
  let payload = body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    payload = JSON.stringify(body);
    h.set('Content-Type', 'application/json');
  }
  const res = await fetch(apiUrl(path), { method, headers: h, body: payload });
  if (res.status === 401 && auth && token) checkSession(token);
  if (!res.ok) {
    let err;
    try {
      err = await res.clone().json();
    } catch {
      err = await res.text().catch(() => undefined);
    }
    const msg = (err && err.message) || (typeof err === 'string' && err) || res.statusText || `HTTP ${res.status}`;
    throw new HTTPError(msg, res.status, err);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;
const metaBody = (value) => ({ value: String(value ?? ''), protected: false });

// The log API returns topics prefixed with the client id ("5001/obj/..."), while status and
// function metadata use the bare topic ("obj/..."). Everything in the dashboard uses the bare form.
export const normTopic = (t) => (typeof t === 'string' ? t.replace(/^\d+\//, '') : t);
const normEntries = (list) => (list || []).map((e) => ({ ...e, topic: normTopic(e.topic) }));

export const lynx = {
  // ---- auth ----
  login: (username, password) =>
    request('/api/v2/auth', {
      method: 'POST',
      auth: false,
      headers: { Authorization: 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`))) },
    }),
  login2fa: (tmpToken, challenge) =>
    request('/api/v2/auth', { method: 'PUT', auth: false, headers: { 'X-API-Key': tmpToken }, body: { challenge } }),
  logout: () => request('/api/v2/auth', { method: 'DELETE' }),
  me: () => request('/api/v2/user/me'),

  // ---- installations ----
  installations: () => request('/api/v2/installationinfo?assigned=false'),
  installation: (id) => request(`/api/v2/installation/${id}`),
  putInstallationMeta: (id, key, value) =>
    request(`/api/v2/installation/${id}/meta/${enc(key)}?create_missing=true`, { method: 'PUT', body: metaBody(value) }),
  // IoT Open rejects empty meta values ("failed on the 'min' tag") – clearing a key means deleting it
  deleteInstallationMeta: (id, key) => request(`/api/v2/installation/${id}/meta/${enc(key)}`, { method: 'DELETE' }),

  // ---- devices / functions ----
  devices: (iid) => request(`/api/v2/devicex/${iid}`),
  functions: (iid) => request(`/api/v2/functionx/${iid}`),
  putDeviceMeta: (iid, id, key, value) =>
    request(`/api/v2/devicex/${iid}/${id}/meta/${enc(key)}?create_missing=true`, { method: 'PUT', body: metaBody(value) }),
  putFunctionMeta: (iid, id, key, value) =>
    request(`/api/v2/functionx/${iid}/${id}/meta/${enc(key)}?create_missing=true`, { method: 'PUT', body: metaBody(value) }),
  deleteDeviceMeta: (iid, id, key) => request(`/api/v2/devicex/${iid}/${id}/meta/${enc(key)}`, { method: 'DELETE' }),
  deleteFunctionMeta: (iid, id, key) => request(`/api/v2/functionx/${iid}/${id}/meta/${enc(key)}`, { method: 'DELETE' }),

  // ---- values ----
  status: (iid) => request(`/api/v2/status/${iid}`).then(normEntries),
  // aggr_method (avg, min, max, median, last, sum …) + aggr_interval (10m, 1h, 1d …) = server side downsampling
  log: (iid, { from, to, limit = 1000, offset = 0, order = 'asc', topics, aggr_method, aggr_interval } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return request(`/api/v3beta/log/${iid}${qs({ from: from ?? now - 86400, to: to ?? now, limit, offset, order, topics, aggr_method, aggr_interval })}`).then((res) =>
      res ? { ...res, data: normEntries(res.data) } : res,
    );
  },

  // ---- files (installation scope) ----
  files: (iid) => request(`/api/v2/file/installation/${iid}`),
  uploadFile: (iid, blob, filename) => {
    const fd = new FormData();
    fd.append('file', blob, filename);
    return request(`/api/v2/file/installation/${iid}`, { method: 'POST', body: fd });
  },
  replaceFile: async (iid, fileId, blob, filename) => {
    const mk = () => {
      const fd = new FormData();
      fd.append('file', blob, filename);
      return fd;
    };
    try {
      return await request(`/api/v2/file/installation/${iid}/${fileId}`, { method: 'PUT', body: mk() });
    } catch (e) {
      // older Lynx versions use POST for file updates
      if (e.status === 405) return request(`/api/v2/file/installation/${iid}/${fileId}`, { method: 'POST', body: mk() });
      throw e;
    }
  },
  deleteFile: (iid, fileId) => request(`/api/v2/file/installation/${iid}/${fileId}`, { method: 'DELETE' }),
  downloadFile: (hash) => request(`/api/v2/file/download/${hash}`, { raw: true }),
};
