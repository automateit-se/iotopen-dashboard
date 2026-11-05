import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { lynx, acceptLink, clearToken, dropLink, getToken, getTokenKind, holdToken, pendingLink, saveToken, setToken, setUnauthorizedHandler } from '../api/lynx.js';
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
  // a direct link (#token=…) that waits for the user's choice, see lynx.js
  const [link, setLink] = useState(() => pendingLink());

  const signOut = useCallback(async (callApi = true) => {
    // an API key is not a session – DELETE /auth is only for tokens from a password login
    if (callApi && getTokenKind() !== 'apikey') await lynx.logout().catch(() => {});
    // a direct link's sign-in only leaves this tab: a remembered sign-in is then used again
    const back = clearToken();
    setUser(null);
    setInstallations([]);
    if (back) {
      setBooting(true);
      afterLoginRef
        .current()
        .catch(() => signOutRef.current(false))
        .finally(() => setBooting(false));
    }
  }, []);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;

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
  const afterLoginRef = useRef(afterLogin);
  afterLoginRef.current = afterLogin;

  /**
   * Signs in with a token that is only kept once IoT Open has accepted it (/user/me and the installations), so a
   * failed sign-in leaves nothing behind that a reload could send anywhere.
   */
  const checkedSignIn = useCallback(
    async (token, remember, kind) => {
      holdToken(token, kind);
      try {
        const me = await afterLogin();
        saveToken(remember);
        return me;
      } catch (e) {
        holdToken(null);
        setUser(null);
        throw e;
      }
    },
    [afterLogin],
  );

  /** The waiting direct link: sign in with it in this tab (true), or keep the current sign-in (false). */
  const answerLink = useCallback(
    (use) => {
      setLink(null);
      if (!use) return dropLink();
      acceptLink();
      setUser(null);
      setInstallations([]);
      setBooting(true);
      afterLogin()
        .catch(() => signOutRef.current(false))
        .finally(() => setBooting(false));
    },
    [afterLogin],
  );

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
      return checkedSignIn(res.token, remember, 'session');
    },
    [checkedSignIn],
  );

  /** Sign in with an IoT Open API key: it is used as X-API-Key directly, checked with /user/me. */
  const signInApiKey = useCallback(
    async (key, remember) => checkedSignIn(key.trim(), remember, 'apikey'),
    [checkedSignIn],
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
      return checkedSignIn(res.token, remember, 'session');
    },
    [checkedSignIn],
  );

  const value = useMemo(
    () => ({ user, booting, signIn, signIn2fa, signInApiKey, signInLocal, signOut, installations, refreshInstallations, brandLogo, setBrandLogo, link, answerLink }),
    [user, booting, signIn, signIn2fa, signInApiKey, signInLocal, signOut, installations, refreshInstallations, brandLogo, link, answerLink],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
