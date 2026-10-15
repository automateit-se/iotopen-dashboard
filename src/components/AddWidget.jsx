import { useMemo, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Icon } from './icons.jsx';
import { WidgetThumb } from './WidgetThumb.jsx';
import { candidates, isHidden, fitsType, devName as deviceName, WIDGET_LABEL } from '../lib/dashboard.js';
import { formatValue } from '../lib/format.js';
import { isMediaDevice } from '../lib/media.js';

// the miniatures under the hint: what can be made from a function or device
const THUMBS = ['value', 'chart', 'gauge', 'switch', 'status', 'number', 'button', 'consumption', 'card', 'media'];

/**
 * Lists functions and devices, grouped per device; a function that already has widgets can get another type: click a device to open it and pick one of its
 * functions (or the whole device as a card, or as a media player when it has media functions). Search and the miniatures narrow the list.
 */
export function AddWidget({ raw, valueOf, onPick, onNewGroup, onNewLink, onClose }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const all = useMemo(() => candidates(raw), [raw]);
  const hiddenCount = all.filter((c) => isHidden(c.obj)).length;
  // with a type chosen: what fits it and does not already have a widget of that type
  // what a device can still become: a card, and a media player when it has media functions
  // (one more of a type the object already has becomes an extra widget, e.g. a second push button)
  const deviceTypes = (c) => ['card', ...(isMediaDevice(raw, c.obj.id) ? ['media'] : [])].filter((t) => !type || t === type);
  const list = (showHidden ? all : all.filter((c) => !isHidden(c.obj)))
    .filter((c) => !type || fitsType(type, c.kind, c.obj))
    .filter((c) => c.kind !== 'device' || deviceTypes(c).length);
  const needle = q.trim().toLowerCase();
  const hit = (...s) => !needle || s.some((x) => String(x || '').toLowerCase().includes(needle));

  // one group per device (plus "Utan enhet"); a device whose name matches shows all its functions
  const groups = useMemo(() => {
    const byId = new Map(raw.devices.map((d) => [String(d.id), d]));
    const map = new Map();
    const group = (id) => {
      if (!map.has(id)) map.set(id, { id, dev: byId.get(id) || null, card: null, fns: [] });
      return map.get(id);
    };
    for (const c of list) {
      if (c.kind === 'device') group(String(c.obj.id)).card = c;
      else group(byId.has(String(c.obj.meta?.device_id)) ? String(c.obj.meta.device_id) : '').fns.push(c);
    }
    return [...map.values()]
      .map((g) => {
        const name = g.dev ? deviceName(g.dev) : 'Utan enhet';
        const devHit = !!g.dev && hit(name, g.dev.type);
        return {
          ...g,
          name,
          card: g.card && (devHit || hit(g.card.name)) ? g.card : null,
          fns: g.fns.filter((c) => devHit || hit(c.name, c.obj.type, c.obj.meta?.topic_read)),
        };
      })
      .filter((g) => g.card || g.fns.length)
      .sort((a, b) => (!a.dev - !b.dev) || a.name.localeCompare(b.name, 'sv'));
  }, [list, raw, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  // a single match is opened right away
  const isOpen = (g) => open.has(g.id) || groups.length === 1;

  const FnRow = ({ c }) => (
    <li>
      <button type="button" onClick={() => onPick(c, type || undefined)}>
        <span>
          <strong>{c.name}</strong>
          <span className="muted small"> · {c.obj.type || '-'}</span>
          {c.used.length > 0 && <span className="small used"> · på dashboarden: {c.used.map((t) => WIDGET_LABEL[t] || t).join(', ')}</span>}
        </span>
        <span className="muted small">{formatValue(c.obj, valueOf(c.obj)?.value)}</span>
      </button>
    </li>
  );

  return (
    <Modal title="Lägg till widget" onClose={onClose}>
      <div className="group-buttons">
        <button type="button" className="btn block-left" onClick={() => onNewGroup('chart')}>
          <Icon name="chart" size={16} /> Ny graf med flera värden, t.ex. temperaturer
        </button>
        <button type="button" className="btn block-left" onClick={() => onNewGroup('timeline')}>
          <Icon name="chart" size={16} /> Ny tidslinje för på/av, öppet/stängt, rörelse…
        </button>
        <button type="button" className="btn block-left" onClick={() => onNewGroup('tracker')}>
          <Icon name="map" size={16} /> Ny karta (Tracker) med position och spår
        </button>
        <button type="button" className="btn block-left" onClick={onNewLink}>
          <Icon name="link" size={16} /> Ny länkknapp till en webbsida eller en annan sida i dashboarden
        </button>
      </div>
      <p className="muted small add-hint">
        Övriga widgets (värde, graf, mätare, brytare, status, börvärde, tryckknapp, förbrukning, enhetskort, media): välj först en funktion eller enhet nedan, sedan typ i nästa steg.
        Klicka på en miniatyr för att bara se det som passar. En funktion kan ha flera widgets, även av samma typ, t.ex. fyra tryckknappar som skickar olika värden.
      </p>
      <div className="thumbs" role="group" aria-label="Widgettyper">
        {THUMBS.map((t) => (
          <button key={t} type="button" className={`thumb ${type === t ? 'on' : ''}`} onClick={() => setType(type === t ? '' : t)} aria-pressed={type === t} title={type === t ? 'Visa alla igen' : `Visa det som kan bli ${WIDGET_LABEL[t].toLowerCase()}`}>
            <WidgetThumb type={t} />
            <span>{WIDGET_LABEL[t]}</span>
          </button>
        ))}
      </div>
      <div className="row gap wrap">
        <input className="search grow" placeholder="Sök enhet, funktion, typ eller topic…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {hiddenCount > 0 && (
          <label className="check small" title='Funktioner och enheter med meta visible = "false"'>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Visa dolda ({hiddenCount})
          </label>
        )}
      </div>
      {type && (
        <p className="muted small add-hint">
          Visar bara det som kan bli <strong>{WIDGET_LABEL[type].toLowerCase()}</strong>.{' '}
          <button type="button" className="link-btn small" onClick={() => setType('')}>
            Visa alla
          </button>
        </p>
      )}
      {!!all.length && !groups.length && <p className="muted">Inget matchar.</p>}
      {!!groups.length && (
        <>
          <h3>Enheter ({groups.length})</h3>
          <ul className="dev-list">
            {groups.map((g) => (
              <li key={g.id || 'none'} className={isOpen(g) ? 'open' : ''}>
                <button type="button" className="dev-head" onClick={() => toggle(g.id)} aria-expanded={isOpen(g)}>
                  <Icon name="back" size={14} className="chev" />
                  <strong>{g.name}</strong>
                  <span className="muted small grow">
                    {g.dev?.type ? ` · ${g.dev.type}` : ''}
                    {g.fns.length ? ` · ${g.fns.length} ${g.fns.length === 1 ? 'funktion' : 'funktioner'}` : ` · som ${deviceTypes(g.card).map((t) => (t === 'media' ? 'mediaspelare' : 'enhetskort')).join(' eller ')}`}
                  </span>
                </button>
                {isOpen(g) && (
                  <ul className="pick-list">
                    {g.card && deviceTypes(g.card).includes('media') && (
                      <li>
                        <button type="button" onClick={() => onPick(g.card, 'media')}>
                          <span>
                            <strong>Hela enheten som mediaspelare</strong>
                            <span className="muted small"> · låt, status, spela/pausa, volym</span>
                          </span>
                        </button>
                      </li>
                    )}
                    {g.card && deviceTypes(g.card).includes('card') && (
                      <li>
                        <button type="button" onClick={() => onPick(g.card, 'card')}>
                          <span>
                            <strong>Hela enheten som enhetskort</strong>
                            <span className="muted small"> · alla funktioner i ett kort</span>
                          </span>
                        </button>
                      </li>
                    )}
                    {g.fns.map((c) => (
                      <FnRow key={c.obj.id} c={c} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
