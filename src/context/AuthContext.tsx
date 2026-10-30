import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicConfig, SessionUser } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  config: PublicConfig | null;
  loading: boolean;
  bootError: string | null;
  unread: number;
  setUnread: (value: number) => void;
  login: (identifier: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    consent: { ageConfirmed: boolean; acceptTerms: boolean; acknowledgeDonutRules: boolean },
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  updateBalance: (balance: number) => void;
  setUser: (user: SessionUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const booted = useRef(false);

  const refresh = useCallback(async () => {
    setBootError(null);
    try {
      const [me, publicConfig] = await Promise.all([
        api.get<{ user: SessionUser | null }>('/auth/me'),
        api.get<PublicConfig>('/public/config'),
      ]);
      setUser(me.user);
      setConfig(publicConfig);
      if (me.user && !me.user.legalAcceptanceRequired) {
        try {
          const notifications = await api.get<{ unread: number }>('/me/notifications?pageSize=1&filter=unread');
          setUnread(notifications.unread);
        } catch {
          setUnread(0);
        }
      } else {
        setUnread(0);
      }
    } catch (error) {
      setBootError(error instanceof ApiRequestError ? error.message : 'Cannot reach the Donutcash server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('donutcash:unauthorized', onUnauthorized);
    return () => window.removeEventListener('donutcash:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.post<{ user: SessionUser }>('/auth/login', { identifier, password });
    setUser(result.user);
    setUnread(0);
  }, []);

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      consent: { ageConfirmed: boolean; acceptTerms: boolean; acknowledgeDonutRules: boolean },
    ) => {
      const result = await api.post<{ user: SessionUser }>('/auth/register', {
        username,
        email,
        password,
        ...consent,
      });
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setUnread(0);
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.get<PublicConfig>('/public/config'));
    } catch {
      /* keep previous config */
    }
  }, []);

  // Maintenance and registration switches must reach open tabs without a
  // manual reload. Poll cheap public config and refresh when the tab wakes up.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === 'visible') void refreshConfig();
    };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [refreshConfig]);

  const updateBalance = useCallback((balance: number) => {
    setUser((current) => (current ? { ...current, balance } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      config,
      loading,
      bootError,
      unread,
      setUnread,
      login,
      register,
      logout,
      refresh,
      refreshConfig,
      updateBalance,
      setUser,
    }),
    [user, config, loading, bootError, unread, login, register, logout, refresh, refreshConfig, updateBalance],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
