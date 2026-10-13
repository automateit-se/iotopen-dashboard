import { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { SeriesColor } from './ColorPicker.jsx';
import { devName, fnName, isHidden, SERIES_COLORS } from '../lib/dashboard.js';
import { geoRole } from '../lib/geo.js';

const ROLE_TEXT = { lat: 'latitud', lon: 'longitud', geohash: 'geohash' };

/** "Latitude 10.0.0.1" and "Longitude 10.0.0.1" belong together: the name without the role word. */
const pairKey = (f) =>
  fnName(f)
    .toLowerCase()
    .replace(/\b(latitude|longitude|lat|lon|lng)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The functions a device gets when it is ticked: its geohash, or the best matching latitude + longitude. */
export function defaultPick(g) {
  if (g.gh.length) return [g.gh[0].id];
  if (!g.lat.length || !g.lon.length) return [...g.lat, ...g.lon].slice(0, 1).map((f) => f.id);
  for (const la of g.lat) {
    const lo = g.lon.find((x) => pairKey(x) === pairKey(la));
    if (lo) return [la.id, lo.id];
  }
  return [g.lat[0].id, g.lon[0].id];
}

/** Devices with position functions (latitude, longitude, geohash), plus "Utan enhet" for the rest. */
export function geoDevices(raw, { showHidden = false, selected = new Set() } = {}) {
  const byId = new Map(raw.devices.map((d) => [String(d.id), d]));
  const map = new Map();
  for (const f of raw.functions) {
    const role = geoRole(f);
    if (!role || (!showHidden && isHidden(f) && !selected.has(f.id))) continue;
    const id = byId.has(String(f.meta?.device_id)) ? String(f.meta.device_id) : '';
    if (!map.has(id)) map.set(id, { id, name: id ? devName(byId.get(id)) : 'Utan enhet', lat: [], lon: [], gh: [] });
    map.get(id)[role === 'geohash' ? 'gh' : role].push(f);
  }
  return [...map.values()].sort((a, b) => (!a.id - !b.id) || a.name.localeCompare(b.name, 'sv'));
}

/** What is missing for a device's selection to be a track, or ''. */
export function trackProblem(g, selected) {
  const has = (list) => list.some((f) => selected.has(f.id));
  if (has(g.gh)) return '';
  if (has(g.lat) && !has(g.lon)) return 'saknar longitud';
  if (has(g.lon) && !has(g.lat)) return 'saknar latitud';
  return '';
}

/**
 * Picks the tracks of a map: first the device, then (if it has several) which geohash or latitude + longitude
 * functions to use. Per device one function per role, and either a geohash or a latitude/longitude pair.
 */
export function TrackerPicker({ raw, selected, setSelected, series, setSeries, oldName, metaKey, q, showHidden }) {
  const [open, setOpen] = useState(() => new Set());
  const groups = useMemo(() => geoDevices(raw, { showHidden, selected }), [raw, showHidden, selected]);
  const needle = q.trim().toLowerCase();
  const shown = groups.filter((g) => !needle || [g.name, ...[...g.lat, ...g.lon, ...g.gh].map(fnName)].some((s) => s.toLowerCase().includes(needle)));
  const all = (g) => [...g.gh, ...g.lat, ...g.lon];
  const chosen = (g) => all(g).filter((f) => selected.has(f.id));
  const ticked = groups.filter((g) => chosen(g).length);

  const update = (fn) =>
    setSelected((s) => {
      const n = new Set(s);
      fn(n);
      return n;
    });
  const toggleDevice = (g) =>
    update((n) => {
      if (chosen(g).length) all(g).forEach((f) => n.delete(f.id));
      else defaultPick(g).forEach((id) => n.add(id));
    });
  // one function per role; a geohash and a latitude/longitude pair exclude each other
  const pickFn = (g, f) =>
    update((n) => {
      if (n.has(f.id)) return n.delete(f.id);
      const role = geoRole(f);
      const drop = role === 'geohash' ? all(g) : [...g.gh, ...g[role]];
      drop.forEach((x) => n.delete(x.id));
      n.add(f.id);
    });
  const toggleOpen = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (!groups.length) return <p className="muted small">Inga funktioner av typen latitude, longitude eller geohash hittades.</p>;
  return (
    <ul className="dev-list tracker-pick">
      {shown.map((g) => {
        const sel = chosen(g);
        const lead = sel.find((f) => geoRole(f) !== 'lon');
        const problem = trackProblem(g, selected);
        const several = all(g).length > (g.gh.length ? 1 : 2);
        const elsewhere = [...new Set(all(g).map((f) => f.meta?.[metaKey]).filter((n) => n && n !== oldName))];
        const isOpen = open.has(g.id) || (!!needle && sel.length === 0 && shown.length === 1);
        return (
          <li key={g.id || 'none'} className={isOpen ? 'open' : ''}>
            <div className="row gap tracker-dev">
              <label className="check">
                <input type="checkbox" checked={sel.length > 0} onChange={() => toggleDevice(g)} aria-label={`Visa ${g.name} på kartan`} />
              </label>
              {lead && (
                <SeriesColor
                  value={series[lead.id] || ''}
                  fallback={SERIES_COLORS[Math.max(0, ticked.indexOf(g)) % SERIES_COLORS.length]}
                  label={g.name}
                  onChange={(c) => setSeries((s) => ({ ...s, [lead.id]: c }))}
                />
              )}
              <button type="button" className="dev-head grow" onClick={() => toggleOpen(g.id)} aria-expanded={isOpen}>
                <Icon name="back" size={14} className="chev" />
                <strong>{g.name}</strong>
                <span className="muted small grow">
                  {sel.length ? ` · ${sel.map(fnName).join(' + ')}` : ` · ${all(g).length} ${all(g).length === 1 ? 'funktion' : 'funktioner'}${several ? ', välj vilka' : ''}`}
                  {elsewhere.length > 0 && ` · i ${elsewhere.map((n) => `"${n}"`).join(', ')}`}
                  {problem && <span className="warn-text"> · {problem}</span>}
                </span>
              </button>
            </div>
            {isOpen && (
              <ul className="check-list tracker-fns">
                {all(g).map((f) => (
                  <li key={f.id}>
                    <label className="check">
                      <input type="checkbox" checked={selected.has(f.id)} onChange={() => pickFn(g, f)} />
                      <span>
                        {fnName(f)}
                        <span className="muted small">
                          {' '}
                          · {ROLE_TEXT[geoRole(f)]}
                          {isHidden(f) ? ' · dold' : ''}
                          {f.meta?.[metaKey] && f.meta[metaKey] !== oldName ? ` · i "${f.meta[metaKey]}"` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {!shown.length && <li className="muted small">Inget matchar.</li>}
    </ul>
  );
}
