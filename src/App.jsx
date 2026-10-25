import { Component } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import { useRoute } from './lib/router.js';
import { config } from './api/config.js';
import { Icon } from './components/icons.jsx';
import Login from './pages/Login.jsx';
import Installations from './pages/Installations.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { CloudState, PinButton, useLocalStatus } from './components/LocalBar.jsx';

/** Keeps a crash in one page from blanking the whole app (and keeps the session). */
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="error-box">Något gick fel: {String(this.state.error?.message || this.state.error)}</div>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Ladda om sidan
        </button>
      </div>
    );
  }
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

function Shell() {
  const { user, booting, signOut, brandLogo } = useApp();
  const path = useRoute();
  const local = config.local;
  const localStatus = useLocalStatus();
  if (booting) return <div className="center-screen muted">Laddar…</div>;
  if (!user) return <Login />;
  // local mode: one installation, no list of installations
  const m = /^\/i\/(\d+)(?:\/p\/([^/]+))?/.exec(path) || (local ? [path, String(local.installation)] : null);
  if (local?.kiosk) {
    return (
      <div className="app kiosk">
        <main>
          <Boundary key={m[1]}>
            <Dashboard key={m[1]} iid={Number(m[1])} pageId={m[2] ? safeDecode(m[2]) : ''} />
          </Boundary>
        </main>
      </div>
    );
  }
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          {brandLogo ? <img className="custom-logo" src={brandLogo} alt="Logotyp" /> : <img src="branding/iotopen-logo-white.svg" alt="IoT Open" />}
          <span className="app-title">{config.appTitle}</span>
        </a>
        <span className="grow" />
        {local ? (
          <PinButton status={localStatus} />
        ) : (
          <>
            <span className="muted small user">{user.email}</span>
            <button type="button" className="icon-btn" onClick={() => signOut()} title="Logga ut" aria-label="Logga ut">
              <Icon name="logout" size={18} />
            </button>
          </>
        )}
      </header>
      <main>
        {/* switching page keeps the installation (and its live connection) loaded */}
        <Boundary key={m ? `i${m[1]}` : path}>{m ? <Dashboard key={m[1]} iid={Number(m[1])} pageId={m[2] ? safeDecode(m[2]) : ''} /> : <Installations />}</Boundary>
      </main>
      <footer className="app-foot">
        {local && <CloudState status={localStatus} />}
        <span className="app-version" title="Dashboardens version">
          v{__APP_VERSION__}
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
