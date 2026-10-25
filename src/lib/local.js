// Local mode: the dashboard served by the edge app "Local dashboard" on the installation's edge client.
// The app answers /config.json with { local: { installation, access, control, pages, exclude, start, kiosk } }
// and acts as a read-only IoT Open (REST + MQTT over WebSocket) for that one installation. Editing is done in
// the cloud; what is shown locally can be narrowed per app instance (pages, widget types).

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** The pages to show: those named in `wanted` (page id or title, any case), all when none match or none are named. */
export function localPages(pages, wanted) {
  const want = (Array.isArray(wanted) ? wanted : []).map(norm).filter(Boolean);
  if (!want.length) return pages;
  const picked = pages.filter((p) => want.includes(norm(p.id)) || want.includes(norm(p.title)));
  return picked.length ? picked : pages;
}

/** The page shown when the address names none: `start` (id or title) when it is one of the pages, else the first. */
export function startPage(pages, start) {
  const s = norm(start);
  return (s && pages.find((p) => norm(p.id) === s || norm(p.title) === s)) || pages[0];
}

/** Widget types that are not shown locally (e.g. the map, which needs internet), lower case. */
export const excludedTypes = (list) => new Set((Array.isArray(list) ? list : []).map(norm).filter(Boolean));

/** Signs in to the local app with its PIN or password; resolves to a session token. */
export async function localLogin(url, secret) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.message || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return body.token;
}
