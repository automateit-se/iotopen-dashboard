import { useMemo, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Icon } from './icons.jsx';
import { candidates, isHidden } from '../lib/dashboard.js';
import { formatValue } from '../lib/format.js';

/** Lists devices and functions that are not on the dashboard yet. */
export function AddWidget({ raw, valueOf, onPick, onNewGroup, onClose }) {
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const all = useMemo(() => candidates(raw), [raw]);
  const hiddenCount = all.filter((c) => isHidden(c.obj)).length;
  const list = showHidden ? all : all.filter((c) => !isHidden(c.obj));
  const devName = useMemo(() => Object.fromEntries(raw.devices.map((d) => [String(d.id), d.meta?.name || d.type || `Enhet ${d.id}`])), [raw]);
  const needle = q.trim().toLowerCase();
  const shown = list.filter(
    (c) => !needle || [c.name, c.obj.type, c.obj.meta?.topic_read, devName[String(c.obj.meta?.device_id)]].some((s) => String(s || '').toLowerCase().includes(needle)),
  );
  const devices = shown.filter((c) => c.kind === 'device');
  const functions = shown.filter((c) => c.kind === 'function');

  const Row = ({ c }) => (
    <li>
      <button type="button" onClick={() => onPick(c)}>
        <span>
          <strong>{c.name}</strong>
          <span className="muted small">
            {' '}
            · {c.obj.type || '–'}
            {c.kind === 'function' && c.obj.meta?.device_id && devName[String(c.obj.meta.device_id)] ? ` · ${devName[String(c.obj.meta.device_id)]}` : ''}
          </span>
        </span>
        {c.kind === 'function' && <span className="muted small">{formatValue(c.obj, valueOf(c.obj)?.value)}</span>}
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
      </div>
      <p className="muted small add-hint">
        Övriga widgets (värde, graf, <strong>mätare</strong>, brytare, status, börvärde, enhetskort): välj först en funktion eller enhet nedan, sedan typ i nästa steg.
      </p>
      <div className="row gap wrap">
        <input className="search grow" placeholder="Sök namn, typ eller topic…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {hiddenCount > 0 && (
          <label className="check small" title='Funktioner och enheter med meta visible = "false"'>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Visa dolda ({hiddenCount})
          </label>
        )}
      </div>
      {!list.length && <p className="muted">Alla enheter och funktioner finns redan på dashboarden.</p>}
      {!!functions.length && (
        <>
          <h3>Funktioner ({functions.length})</h3>
          <ul className="pick-list">
            {functions.map((c) => (
              <Row key={`f${c.obj.id}`} c={c} />
            ))}
          </ul>
        </>
      )}
      {!!devices.length && (
        <>
          <h3>Enheter ({devices.length})</h3>
          <ul className="pick-list">
            {devices.map((c) => (
              <Row key={`d${c.obj.id}`} c={c} />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
