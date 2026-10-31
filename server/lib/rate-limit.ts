import type { DB } from '../db/index.ts';
import { isLoopbackAddress } from './core.ts';

/**
 * Small sliding-window limiter for authentication and abuse-prone endpoints.
 *
 * Limits are counted in memory unless a shared store is attached. A database
 * backed store is used for file databases so every Node worker on the host
 * (IIS web garden, a second process) counts into the same window — otherwise
 * the effective limit would be the configured limit times the worker count.
 */

export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

let sharedDb: DB | null = null;
let calls = 0;

/** Attach (or detach) the shared window store. `null` keeps counters in memory. */
export function useSharedRateLimitStore(db: DB | null): void {
  sharedDb = db;
}

export function isSharedRateLimitStoreEnabled(): boolean {
  return sharedDb !== null;
}

function consumeShared(db: DB, key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  const run = db.transaction((): LimitResult => {
    // Housekeeping is amortised: expired windows are dropped a few times a
    // minute instead of on every request.
    calls += 1;
    if (calls % 256 === 0) db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').run(now - windowMs);

    const row = db.prepare('SELECT window_start, hits FROM rate_limits WHERE key = ?').get(key) as
      | { window_start: number; hits: number }
      | undefined;

    if (!row || now - row.window_start >= windowMs) {
      db.prepare(
        `INSERT INTO rate_limits (key, window_start, hits, expires_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           window_start = excluded.window_start,
           hits = 1,
           expires_at = excluded.expires_at`,
      ).run(key, now, now + windowMs);
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) };
    }

    if (row.hits >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)),
        remaining: 0,
      };
    }

    db.prepare('UPDATE rate_limits SET hits = hits + 1 WHERE key = ?').run(key);
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - row.hits - 1) };
  });
  return run.immediate();
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  private live(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }

  /** Returns false when the key is over its limit. */
  consume(key: string): LimitResult {
    if (sharedDb) return consumeShared(sharedDb, key, this.limit, this.windowMs);
    const now = Date.now();
    const list = this.live(key, now);
    if (list.length >= this.limit) {
      const oldest = list[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000)),
        remaining: 0,
      };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - list.length };
  }

  reset(key: string): void {
    if (sharedDb) {
      sharedDb.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
      return;
    }
    this.hits.delete(key);
  }

  /** Clears this limiter's local counters. Shared windows expire on their own. */
  clear(): void {
    this.hits.clear();
  }

  prune(): void {
    const now = Date.now();
    for (const key of this.hits.keys()) this.live(key, now);
  }
}

/**
 * The caller's address, or null when only the local reverse proxy is visible.
 *
 * There is deliberately no fingerprint fallback: a User-Agent is shared by
 * every visitor on the same browser build, so using it as a bucket would let
 * one busy or malicious client exhaust the quota for everyone. Routes that
 * need a per-client limit fall back to per-account keys instead.
 */
export function clientAddress(req: { ip?: string }): string | null {
  const ip = req.ip ?? null;
  return ip && !isLoopbackAddress(ip) ? ip : null;
}

export const loginLimiter = new RateLimiter(10, 10 * 60_000);
export const loginIpLimiter = new RateLimiter(30, 10 * 60_000);
export const registerLimiter = new RateLimiter(8, 60 * 60_000);
export const registerGlobalLimiter = new RateLimiter(120, 60 * 60_000);
export const resetLimiter = new RateLimiter(6, 60 * 60_000);
export const mutationLimiter = new RateLimiter(240, 60_000);
export const ticketCreateLimiter = new RateLimiter(10, 60 * 60_000);
export const cashierRequestLimiter = new RateLimiter(10, 60 * 60_000);
export const chatMessageLimiter = new RateLimiter(12, 60_000);
