import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from './api.js';

// Estado da sessão: carrega /auth/me uma vez e expõe login/logout/refresh.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, tenant: null, workspaces: [] });

  const refresh = useCallback(async () => {
    try {
      const me = await api('GET', '/auth/me');
      setState({ loading: false, user: me.user, tenant: me.tenant || null, workspaces: me.workspaces || [] });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setState({ loading: false, user: null, tenant: null, workspaces: [] });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    await api('POST', '/auth/login', { email, password });
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api('POST', '/auth/logout'); } catch { /* sessão já pode ter caído */ }
    setState({ loading: false, user: null, tenant: null, workspaces: [] });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refresh, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
