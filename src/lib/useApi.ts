import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApiQuery<T>(path: string | null, options?: { enabled?: boolean }): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path, controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (!active || (err as Error).name === 'AbortError') return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, version, enabled]);

  const refetch = useCallback(() => setVersion((value) => value + 1), []);
  return { data, loading, error, refetch };
}
