import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface QueryOptions {
  enabled?: boolean;
  /**
   * Refetches quietly while the tab is visible. Used by conversations so new
   * messages and status changes arrive without a full page reload.
   */
  pollMs?: number;
}

export function useApiQuery<T>(path: string | null, options?: QueryOptions): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const enabled = options?.enabled !== false;
  const pollMs = options?.pollMs ?? 0;

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    let inFlight = false;

    const load = (initial: boolean) => {
      if (!active || inFlight) return;
      inFlight = true;
      if (initial) {
        setLoading(true);
        setError(null);
      }
      api
        .get<T>(path, controller.signal)
        .then((result) => {
          if (!active) return;
          setData(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!active || (err as Error).name === 'AbortError') return;
          // A failed background poll keeps the last good snapshot visible.
          if (initial) setError(errorMessage(err));
        })
        .finally(() => {
          inFlight = false;
          if (active && initial) setLoading(false);
        });
    };

    load(true);
    let timer: number | undefined;
    if (pollMs > 0) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') load(false);
      }, pollMs);
    }
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [path, version, enabled, pollMs]);

  const refetch = useCallback(() => setVersion((value) => value + 1), []);
  return { data, loading, error, refetch };
}
