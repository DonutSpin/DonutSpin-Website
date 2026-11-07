import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../server/db/index.ts';
import { isSharedRateLimitStoreEnabled, RateLimiter, useSharedRateLimitStore } from '../server/lib/rate-limit.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donutspin-ratelimit-'));
const file = path.join(dir, 'shared.db');

afterAll(() => {
  useSharedRateLimitStore(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('shared rate-limit windows', () => {
  it('counts one window across two app processes on the same database file', () => {
    // Two connections stand in for two Node workers behind IIS.
    const first = createDatabase(file);
    expect(isSharedRateLimitStoreEnabled()).toBe(true);
    const limiterA = new RateLimiter(2, 60_000);

    const second = createDatabase(file);
    const limiterB = new RateLimiter(2, 60_000);

    expect(limiterA.consume('login:ip:203.0.113.7')).toMatchObject({ allowed: true, remaining: 1 });
    // The second worker sees the first worker's hit instead of starting over.
    expect(limiterB.consume('login:ip:203.0.113.7')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiterA.consume('login:ip:203.0.113.7')).toMatchObject({ allowed: false });
    expect(limiterB.consume('login:ip:203.0.113.7')).toMatchObject({ allowed: false });

    // A reset is shared too, so a successful sign-in frees the bucket everywhere.
    limiterA.reset('login:ip:203.0.113.7');
    expect(limiterB.consume('login:ip:203.0.113.7')).toMatchObject({ allowed: true });

    // Keys are independent.
    expect(limiterB.consume('login:ip:198.51.100.9')).toMatchObject({ allowed: true });

    first.close();
    second.close();
  });

  it('keeps in-memory databases isolated', () => {
    const memory = createDatabase(':memory:');
    expect(isSharedRateLimitStoreEnabled()).toBe(false);
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.consume('only-key')).toMatchObject({ allowed: true });
    expect(limiter.consume('only-key')).toMatchObject({ allowed: false });
    memory.close();
  });
});
