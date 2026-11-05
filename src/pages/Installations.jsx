import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { Icon } from '../components/icons.jsx';
import { useEdgePresence } from '../lib/edgePresence.js';

/** Online / Offline for an installation with an edge client, as App Management shows it; nothing without one. */
function EdgeBadge({ state }) {
  if (state !== 'online' && state !== 'offline') return null;
  const on = state === 'online';
  return (
    <span className={`edge-state ${on ? 'ok' : 'crit'}`} title={on ? 'Edge clienten har kontakt med IoT Open' : 'Edge clienten har inte kontakt med IoT Open'}>
      <span className="dot" /> {on ? 'Online' : 'Offline'}
    </span>
  );
}

export default function Installations() {
  const { installations } = useApp();
  const [q, setQ] = useState('');
  const presence = useEdgePresence(installations);

  const needle = q.trim().toLowerCase();
  const shown = installations.filter((i) => !needle || i.name.toLowerCase().includes(needle) || String(i.id).includes(needle));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Installationer</h1>
        {installations.length > 6 && <input className="search" placeholder="Sök…" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {!installations.length && <p className="muted">Ditt konto har inga installationer i IoT Open.</p>}
      <div className="inst-list">
        {shown.map((i) => (
          <a key={i.id} className="inst" href={`#/i/${i.id}`}>
            <Icon name="home" />
            <span className="grow">
              <strong>{i.name || `Installation ${i.id}`}</strong>
              <span className="muted small">
                id {i.id} · client_id {i.client_id}
              </span>
            </span>
            <EdgeBadge state={presence[i.client_id]} />
          </a>
        ))}
      </div>
    </div>
  );
}
