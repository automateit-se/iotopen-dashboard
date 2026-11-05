import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { linkAccount } from '../api/lynx.js';
import { defaultServer, serverLabel } from '../api/server.js';
import { config } from '../api/config.js';

/**
 * A direct link (#token=…) that would replace the current sign-in, or that is for another server: shows which
 * account and which server the link signs in to, and who is signed in now, before anything changes.
 */
export default function LinkConfirm() {
  const { link, answerLink, user } = useApp();
  const [account, setAccount] = useState(null); // { email } | { error }
  // the host, or the whole origin when only the scheme or port tells it from this dashboard's server
  const ownLabel = serverLabel(defaultServer());
  const where = link.server && serverLabel(link.server) === ownLabel ? link.server : serverLabel(link.server || defaultServer());

  useEffect(() => {
    if (link.error) return undefined;
    let alive = true;
    linkAccount(link)
      .then((me) => alive && setAccount({ email: me?.email || `användare ${me?.id ?? '?'}` }))
      .catch((e) => alive && setAccount({ error: e.status === 401 || e.status === 403 ? `${where} godkände inte länkens nyckel.` : `Kunde inte nå ${where}.` }));
    return () => {
      alive = false;
    };
  }, [link, where]);

  const other = !!link.server;
  return (
    <div className="login">
      <div className="login-form link-confirm">
        <picture>
          <source srcSet="branding/iotopen-logo-white.svg" media="(prefers-color-scheme: dark)" />
          <img className="login-logo" src="branding/iotopen-logo.svg" alt="IoT Open" />
        </picture>
        <h1>{config.appTitle}</h1>
        {link.error ? (
          <div className="error-box">{link.error}</div>
        ) : (
          <>
            <p>Länken du öppnade loggar in med en API-nyckel.</p>
            <dl className="link-facts">
              <dt>Länkens konto</dt>
              <dd>{account?.email ? <strong>{account.email}</strong> : account?.error ? <span className="crit-text">{account.error}</span> : <span className="muted">Kontrollerar…</span>}</dd>
              <dt>Server</dt>
              <dd>
                <strong>{where}</strong>
                {other && <span className="muted"> (inte {ownLabel}, som den här dashboarden använder)</span>}
              </dd>
              <dt>Inloggad nu</dt>
              <dd>{user ? user.email : <span className="muted">Ingen</span>}</dd>
            </dl>
            {other && <div className="info-box">Fortsätt bara om du litar på servern {where}. Det du ser och skriver efter bytet hanteras av den.</div>}
            <p className="muted small">Bytet gäller bara den här fliken. {user ? 'Din nuvarande inloggning finns kvar och används igen när du loggar ut här eller stänger fliken.' : ''}</p>
          </>
        )}
        <div className="link-actions">
          {!link.error && (
            <button type="button" className="btn primary" disabled={!account?.email} onClick={() => answerLink(true)}>
              {user ? 'Byt konto' : 'Logga in'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => answerLink(false)}>
            {user ? 'Behåll nuvarande' : 'Avbryt'}
          </button>
        </div>
      </div>
    </div>
  );
}
