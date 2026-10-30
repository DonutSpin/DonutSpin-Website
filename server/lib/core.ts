import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';

export const nowIso = (): string => new Date().toISOString();

export const newId = (prefix: string): string => `${prefix}_${randomBytes(10).toString('hex')}`;

export const ledgerId = (): string => `TX-${randomBytes(6).toString('hex').toUpperCase()}`;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.', code = 'UNAUTHORIZED') =>
  new ApiError(401, code, message);
export const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN') =>
  new ApiError(403, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new ApiError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new ApiError(409, code, message, details);

/** Runs a synchronous SQLite write transaction with immediate write locking. */
export function inTransaction<T>(db: DB, fn: () => T): T {
  const txn = db.transaction(fn);
  return txn.immediate();
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:0.0.0.0']);

/**
 * True when the socket address is the local proxy rather than a real visitor.
 * Hosts such as IIS/HttpPlatformHandler terminate the request and forward it
 * from the loopback interface, so the client address is not known.
 */
export function isLoopbackAddress(ip: string | null | undefined): boolean {
  if (!ip) return true;
  return LOOPBACK_ADDRESSES.has(ip.trim().toLowerCase());
}

/**
 * The visitor's address, or null when only the local proxy is visible.
 * Recording `127.0.0.1` in an audit log would look like a real address when it
 * is really the absence of one.
 */
export function clientIp(req: { ip?: string }): string | null {
  const ip = req.ip ?? null;
  return ip && !isLoopbackAddress(ip) ? ip : null;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function pagination(query: Record<string, unknown>, defaultSize = 20, maxSize = 100): { page: number; pageSize: number; offset: number } {
  const pageRaw = Number(query.page ?? 1);
  const sizeRaw = Number(query.pageSize ?? defaultSize);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.min(Math.floor(sizeRaw), maxSize) : defaultSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
