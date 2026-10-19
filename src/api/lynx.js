import { apiUrl } from './server.js';

// Minimal IoT Open (Lynx) REST client.
// By default all requests go to the same origin under /api – nginx (or the Vite dev server) proxies them
// to the IoT Open instance. With a custom server (see server.js) they go to that server directly.
// Users, roles and permissions are handled entirely by IoT Open; the dashboard only keeps the session token.

const TOKEN_KEY = 'dash.token';

export class HTTPError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function storageGet(key) {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  } catch {
    return null;
  }
}

let token = storageGet(TOKEN_KEY);
let onUnauthorized = () => {};

const KIND_KEY = 'dash.tokenKind';
let tokenKind = storageGet(KIND_KEY) || 'session';

// Direct link / QR code: #token=KEY or #/i/<id>?token=KEY signs in with an API key. It is kept after the #
// so it never reaches the server (logs, Referer), and is removed from the address bar at once.
(function tokenFromUrl() {
  const hash = window.location.hash.replace(/^#/, '');
  const q = hash.indexOf('?');
  const [path, query] = /^token=/.test(hash) ? ['/', hash] : q >= 0 ? [hash.slice(0, q), hash.slice(q + 1)] : [hash, ''];
  const params = new URLSearchParams(query);
  const t = params.get('token')?.trim();
  if (!t) return;
  params.delete('token');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${path || '/'}${rest ? '?' + rest : ''}`);
  // tab only (sessionStorage) and always 'apikey', so signing out never revokes the shared key
  setToken(t, false, 'apikey');
})();

export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);
export const getToken = () => token;
/** 'session' (password login, may expire) or 'apikey' (created in IoT Open, does not expire). */
export const getTokenKind = () => tokenKind;

export function setToken(t, remember = false, kind = 'session') {
  token = t;
  tokenKind = kind;
  try {
    for (const s of [sessionStorage, localStorage]) {
      s.removeItem(TOKEN_KEY);
      s.removeItem(KIND_KEY);
    }
    if (t) {
      const s = remember ? localStorage : sessionStorage;
      s.setItem(TOKEN_KEY, t);
      s.setItem(KIND_KEY, kind);
    }
  } catch {
    /* storage unavailable – keep the token in memory only */
  }
}

// A 401 from one endpoint does not have to mean the session is gone (some endpoints answer 401 for a
// missing permission). Only sign out when /user/me also says 401 for the same token.
let checking = null;
function checkSession(t) {
  if (checking) return;
  checking = fetch(apiUrl('api/v2/user/me'), { headers: { 'X-API-Key': t } })
    .then((r) => {
      if (r.status === 401 && token === t) {
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
