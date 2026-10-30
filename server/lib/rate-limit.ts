import { createHash } from 'node:crypto';
import { isLoopbackAddress } from './core.ts';

/**
 * Small in-process sliding-window limiter for authentication and abuse-prone
 * endpoints. Single-node deployments only; documented as such.
 */
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
  consume(key: string): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
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
    this.hits.delete(key);
  }

  clear(): void {
    this.hits.clear();
  }

  prune(): void {
    const now = Date.now();
    for (const key of this.hits.keys()) this.live(key, now);
  }
}

/**
 * Bucket key for the caller of a rate-limited route.
 *
 * Behind IIS the socket address is always the loopback proxy, so keying a
 * limiter on `req.ip` puts every visitor into a single shared bucket: a few
 * sign-in attempts (or a busy minute of gameplay) would lock the whole site
 * out. When the real client address is unavailable the browser fingerprint is
 * used instead, which still bounds one client without creating a global cap.
 */
export function callerKey(req: { ip?: string; get: (name: string) => string | undefined }, scope: string): string {
  const ip = req.ip ?? null;
  if (!isLoopbackAddress(ip) && ip) return `${scope}:ip:${ip}`;
  const agent = (req.get('user-agent') ?? 'unknown').slice(0, 200);
  const hash = createHash('sha256').update(agent).digest('hex').slice(0, 16);
  return `${scope}:agent:${hash}`;
}

export const loginLimiter = new RateLimiter(10, 10 * 60_000);
export const registerLimiter = new RateLimiter(8, 60 * 60_000);
export const resetLimiter = new RateLimiter(6, 60 * 60_000);
export const mutationLimiter = new RateLimiter(240, 60_000);
export const ticketCreateLimiter = new RateLimiter(10, 60 * 60_000);
export const cashierRequestLimiter = new RateLimiter(10, 60 * 60_000);
