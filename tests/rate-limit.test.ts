import { describe, expect, it } from 'vitest';
import { clientAddress } from '../server/lib/rate-limit.ts';
import { isLoopbackAddress } from '../server/lib/core.ts';

describe('rate-limit client addresses', () => {
  it('treats proxy and loopback addresses as unknown clients', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress(undefined)).toBe(true);
    expect(isLoopbackAddress('203.0.113.9')).toBe(false);
  });

  it('uses a real client address for per-IP limits', () => {
    expect(clientAddress({ ip: '203.0.113.9' })).toBe('203.0.113.9');
    expect(clientAddress({ ip: '198.51.100.4' })).toBe('198.51.100.4');
  });

  it('returns no address instead of a shared proxy or fingerprint bucket', () => {
    expect(clientAddress({ ip: '127.0.0.1' })).toBeNull();
    expect(clientAddress({ ip: '::ffff:127.0.0.1' })).toBeNull();
    expect(clientAddress({})).toBeNull();
  });
});
