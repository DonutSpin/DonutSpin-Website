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
  login: (identifier: string, password: string, turnstileToken?: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    consent: { ageConfirmed: boolean; acceptTerms: boolean; acknowledgeDonutRules: boolean },
    turnstileToken?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  updateBalance: (balance: number) => void;
  /**
   * Temporarily stops background balance synchronization. Games use this while
   * an outcome is still animating so a refresh cannot reveal the result early.
   */
  setBalanceSyncPaused: (paused: boolean) => void;
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
  const balanceSyncPaused = useRef(false);
  const syncBalanceNow = useRef<() => void>(() => undefined);

  const refresh = useCallback(async () => {
    setBootError(null);
    try {
      const [me, publicConfig] = await Promise.all([
        api.get<{ user: SessionUser | null; unreadNotifications: number }>('/auth/me'),
        api.get<PublicConfig>('/public/config'),
      ]);
      setUser(me.user);
      setConfig(publicConfig);
      setUnread(me.user && !me.user.legalAcceptanceRequired ? me.unreadNotifications : 0);
    } catch (error) {
      setBootError(error instanceof ApiRequestError ? error.message : 'Cannot reach the DonutSpin server.');
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

  const login = useCallback(async (identifier: string, password: string, turnstileToken?: string) => {
    const result = await api.post<{ user: SessionUser }>('/auth/login', {
      identifier,
      password,
      turnstileToken,
    });
    setUser(result.user);
    setUnread(0);
  }, []);

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      consent: { ageConfirmed: boolean; acceptTerms: boolean; acknowledgeDonutRules: boolean },
      turnstileToken?: string,
    ) => {
      const result = await api.post<{ user: SessionUser }>('/auth/register', {
        username,
        email,
        password,
        ...consent,
        turnstileToken,
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
    setUser((current) => (current && current.balance !== balance ? { ...current, balance } : current));
  }, []);

  const setBalanceSyncPaused = useCallback((paused: boolean) => {
    const wasPaused = balanceSyncPaused.current;
    balanceSyncPaused.current = paused;
    // Catch up immediately after an animation or page handoff releases the
    // pause, instead of waiting for the next scheduled tick.
    if (wasPaused && !paused) window.setTimeout(() => syncBalanceNow.current(), 0);
  }, []);

  // Notifications can be created by another session (a staff reply, a cashier
  // decision, a reward) while this tab is already open. Poll the unread count on
  // its own timer so the bell badge updates without a reload, even while a game
  // has paused balance synchronization for an animation.
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let timer: number | null = null;

    const syncUnread = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      try {
        const result = await api.get<{ unreadNotifications: number }>('/auth/me');
        if (active) setUnread(result.unreadNotifications);
      } catch {
        /* Keep the last known badge; the next tick can recover. */
      }
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        void syncUnread().finally(() => {
          if (active) schedule();
        });
      }, 10_000);
    };

    const syncNow = () => {
      if (document.visibilityState === 'visible') void syncUnread();
    };

    // Cover the gap between login/navigation and the first scheduled tick.
    void syncUnread();
    schedule();
    document.addEventListener('visibilitychange', syncNow);
    window.addEventListener('focus', syncNow);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', syncNow);
      window.removeEventListener('focus', syncNow);
    };
  }, [user?.id]);

  // Cashier decisions happen in another session, so the player's open page
  // learns about them through a cheap authenticated balance check. The timer
  // stops while hidden and is paused by animated games, which must not have
  // their outcome revealed before the animation ends.
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let timer: number | null = null;

    const syncBalance = async () => {
      if (!active || balanceSyncPaused.current || document.visibilityState !== 'visible') return;
      try {
        const result = await api.get<{ user: SessionUser | null; unreadNotifications: number }>('/auth/me');
        if (active && result.user && !balanceSyncPaused.current) {
          updateBalance(result.user.balance);
        }
        if (active) setUnread(result.unreadNotifications);
      } catch {
        /* Keep the last known balance; the next tick can recover. */
      }
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        void syncBalance().finally(() => {
          if (active) schedule();
        });
      }, 2000);
    };

    const syncNow = () => {
      if (document.visibilityState === 'visible') void syncBalance();
    };
    syncBalanceNow.current = syncNow;

    schedule();
    document.addEventListener('visibilitychange', syncNow);
    window.addEventListener('focus', syncNow);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      syncBalanceNow.current = () => undefined;
      document.removeEventListener('visibilitychange', syncNow);
      window.removeEventListener('focus', syncNow);
    };
  }, [user?.id, updateBalance]);

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
      setBalanceSyncPaused,
      setUser,
    }),
    [
      user,
      config,
      loading,
      bootError,
      unread,
      login,
      register,
      logout,
      refresh,
      refreshConfig,
      updateBalance,
      setBalanceSyncPaused,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
