import { describe, expect, it } from 'vitest';
import { callerKey } from '../server/lib/rate-limit.ts';
import { isLoopbackAddress } from '../server/lib/core.ts';

function fakeRequest(ip: string, userAgent: string) {
  return { ip, get: (name: string) => (name.toLowerCase() === 'user-agent' ? userAgent : undefined) };
}

describe('rate-limit caller keys', () => {
  it('treats proxy and loopback addresses as unknown clients', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress(undefined)).toBe(true);
    expect(isLoopbackAddress('203.0.113.9')).toBe(false);
  });

  it('keys real client addresses by IP', () => {
    expect(callerKey(fakeRequest('203.0.113.9', 'browser-a'), 'login')).toBe('login:ip:203.0.113.9');
    expect(callerKey(fakeRequest('198.51.100.4', 'browser-a'), 'login')).toBe('login:ip:198.51.100.4');
  });

  it('never puts every visitor behind the same proxy into one shared bucket', () => {
    const first = callerKey(fakeRequest('127.0.0.1', 'browser-a'), 'login');
    const second = callerKey(fakeRequest('127.0.0.1', 'browser-b'), 'login');
    expect(first).not.toBe(second);
    // Stable for the same browser, so the limiter still bounds repeated attempts.
    expect(callerKey(fakeRequest('127.0.0.1', 'browser-a'), 'login')).toBe(first);
    expect(first.startsWith('login:agent:')).toBe(true);
  });

  it('scopes buckets per route so one route cannot exhaust another', () => {
    const request = fakeRequest('127.0.0.1', 'browser-a');
    expect(callerKey(request, 'login')).not.toBe(callerKey(request, 'mutate'));
  });
});
