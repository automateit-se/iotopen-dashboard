import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { lynx, getToken, getTokenKind, setToken, setUnauthorizedHandler } from '../api/lynx.js';
import { appUrl, config } from '../api/config.js';
import { localLogin } from '../lib/local.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Session and the list of installations the user can see. Everything else is per installation
// (see useInstallation).
export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  // local mode (edge app): no IoT Open account; the app itself says whether a password is needed
  const [booting, setBooting] = useState(!!getToken() || !!config.local);
  const [installations, setInstallations] = useState([]);
  const [brandLogo, setBrandLogo] = useState(null); // the open installation's logo (object URL), null = IoT Open

  const signOut = useCallback(async (callApi = true) => {
    // an API key is not a session – DELETE /auth is only for tokens from a password login
    if (callApi && getTokenKind() !== 'apikey') await lynx.logout().catch(() => {});
    setToken(null);
    setUser(null);
    setInstallations([]);
  }, []);

  useEffect(() => setUnauthorizedHandler(() => signOut(false)), [signOut]);

  const refreshInstallations = useCallback(async () => {
    const list = (await lynx.installations()) || [];
    setInstallations(list.map((i) => ({ ...i, name: (i.name || '').trim() })).sort((a, b) => a.name.localeCompare(b.name, 'sv')));
  }, []);

  const afterLogin = useCallback(async () => {
    const me = await lynx.me();
    await refreshInstallations();
    setUser(me);
    return me;
  }, [refreshInstallations]);

  useEffect(() => {
    if (!getToken() && !config.local) return;
    afterLogin()
      .catch(() => signOut(false))
      .finally(() => setBooting(false));
  }, [afterLogin, signOut]);

  const signIn = useCallback(
    async (email, password, remember) => {
      const res = await lynx.login(email, password);
      if (res.next_step) {
        const e = new Error('Tvåfaktorsinloggning krävs');
        e.twoFactor = true;
        e.tmpToken = res.token;
        throw e;
      }
      setToken(res.token, remember);
      return afterLogin();
    },
    [afterLogin],
  );

  /** Sign in with an IoT Open API key: it is used as X-API-Key directly, checked with /user/me. */
  const signInApiKey = useCallback(
    async (key, remember) => {
      setToken(key.trim(), remember, 'apikey');
      try {
        return await afterLogin();
      } catch (e) {
        setToken(null);
        throw e;
      }
    },
    [afterLogin],
  );

  /**
   * Local mode: the edge app's PIN (control) or password (everything). The session is kept in this browser, so a
   * wall screen stays signed in; MQTT picks it up on the next connection, so the page is reloaded for a PIN.
   */
  const signInLocal = useCallback(
    async (secret) => {
      const token = await localLogin(appUrl('local/login'), secret);
      setToken(token, true, 'apikey');
      if (config.local?.access === 'pin') return window.location.reload();
      return afterLogin();
    },
    [afterLogin],
  );

  const signIn2fa = useCallback(
    async (tmpToken, challenge, remember) => {
      const res = await lynx.login2fa(tmpToken, challenge);
      setToken(res.token, remember);
      return afterLogin();
    },
    [afterLogin],
  );

  const value = useMemo(
    () => ({ user, booting, signIn, signIn2fa, signInApiKey, signInLocal, signOut, installations, refreshInstallations, brandLogo, setBrandLogo }),
    [user, booting, signIn, signIn2fa, signInApiKey, signInLocal, signOut, installations, refreshInstallations, brandLogo],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
