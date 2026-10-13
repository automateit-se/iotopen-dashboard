// Positions for the Tracker widget: latitude/longitude function pairs or a geohash function, and the
// Web Mercator maths for drawing them on map tiles.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Decodes a geohash to { lat, lon } (the centre of its cell), or null when it is not a geohash. */
export function decodeGeohash(hash) {
  const s = String(hash ?? '').trim().toLowerCase();
  if (!s || s.length > 22) return null;
  let even = true;
  const lat = [-90, 90];
  const lon = [-180, 180];
  for (const ch of s) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> bit) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

/** Role of a function in a track, from its type: 'lat', 'lon', 'geohash' or ''. */
export function geoRole(fn) {
  const t = String(fn?.type || '').toLowerCase();
  if (t.includes('geohash')) return 'geohash';
  if (/lat/.test(t)) return 'lat';
  if (/lon|lng/.test(t)) return 'lon';
  return '';
}

export const isGeo = (fn) => !!geoRole(fn);

const validLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const validLon = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * Positions from separate latitude and longitude series ([{ ts, value }], sorted by time).
 * A position is only formed when both values have arrived within `window` seconds of each other, so a new
 * latitude is not drawn with the previous longitude. window = 0 pairs each value with the other's latest.
 * Returns [{ ts, lat, lon }] sorted by time.
 */
export function pairPositions(lats, lons, window = 5) {
  const events = [...lats.map((p) => ({ ...p, k: 'lat' })), ...lons.map((p) => ({ ...p, k: 'lon' }))].sort((a, b) => a.ts - b.ts);
  const last = { lat: null, lon: null };
  const out = [];
  let used = { lat: null, lon: null };
  for (const e of events) {
    const v = Number(e.value);
    if (!(e.k === 'lat' ? validLat(v) : validLon(v))) continue;
    last[e.k] = { ts: e.ts, v };
    const other = last[e.k === 'lat' ? 'lon' : 'lat'];
    if (!other) continue;
    if (window > 0 && Math.abs(e.ts - other.ts) > window) continue;
    // each value is used in one position only, so a late sibling does not pair with a stale one again
    if (window > 0 && used[e.k === 'lat' ? 'lon' : 'lat'] === other) continue;
    used = { lat: last.lat, lon: last.lon };
    out.push({ ts: Math.max(e.ts, other.ts), lat: last.lat.v, lon: last.lon.v });
  }
  return out;
}

/** Positions from a geohash series. */
export const geohashPositions = (points) =>
  points.map((p) => ({ ts: p.ts, ...decodeGeohash(p.value) })).filter((p) => validLat(p.lat) && validLon(p.lon));

// ---- Web Mercator ---------------------------------------------------------------------------------

export const TILE = 256;

/** World pixel coordinates at zoom z. */
export function project(lat, lon, z) {
  const s = TILE * 2 ** z;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

/** The highest zoom (up to maxZoom) at which all positions fit in width × height with some padding. */
export function fitZoom(points, width, height, maxZoom = 17) {
  if (points.length < 2) return Math.min(15, maxZoom);
  for (let z = maxZoom; z > 1; z--) {
    const xy = points.map((p) => project(p.lat, p.lon, z));
    const w = Math.max(...xy.map((p) => p.x)) - Math.min(...xy.map((p) => p.x));
    const h = Math.max(...xy.map((p) => p.y)) - Math.min(...xy.map((p) => p.y));
    if (w <= width * 0.8 && h <= height * 0.8) return z;
  }
  return 1;
}

/** Centre (lat/lon) of the positions' bounding box. */
export function centreOf(points) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 };
}

/** Back from world pixels at zoom z to lat/lon. */
export function unproject(x, y, z) {
  const s = TILE * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}
