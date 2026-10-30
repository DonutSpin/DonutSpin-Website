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

export const loginLimiter = new RateLimiter(10, 10 * 60_000);
export const registerLimiter = new RateLimiter(8, 60 * 60_000);
export const resetLimiter = new RateLimiter(6, 60 * 60_000);
export const mutationLimiter = new RateLimiter(240, 60_000);
export const ticketCreateLimiter = new RateLimiter(10, 60 * 60_000);
export const cashierRequestLimiter = new RateLimiter(10, 60 * 60_000);
