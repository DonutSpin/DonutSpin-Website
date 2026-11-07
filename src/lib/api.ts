export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: {
    fields?: Record<string, string>;
    activeRound?: { game: string; sessionId: string; status: 'playing' | 'settled' };
  };
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: ApiErrorPayload['details'];

  constructor(status: number, payload: ApiErrorPayload | null) {
    super(payload?.message || 'The request could not be completed.');
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = payload?.code || 'REQUEST_FAILED';
    this.details = payload?.details;
  }

  get fieldErrors(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'donutspin';
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
      window.dispatchEvent(new Event('donutspin:unauthorized'));
    }
    throw new ApiRequestError(response.status, (payload as { error?: ApiErrorPayload } | null)?.error ?? null);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export const requestId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
