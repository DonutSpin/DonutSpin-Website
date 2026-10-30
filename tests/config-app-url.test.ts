import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOPMENT_APP_URL,
  DEFAULT_PRODUCTION_APP_URL,
  resolveAppUrl,
} from '../server/config.ts';

describe('public app URL resolution', () => {
  it('uses the Vite origin for local development', () => {
    expect(resolveAppUrl(undefined, false)).toEqual({
      appUrl: DEFAULT_DEVELOPMENT_APP_URL,
      configured: false,
    });
  });

  it('uses the production site when APP_URL is missing', () => {
    expect(resolveAppUrl(undefined, true)).toEqual({
      appUrl: DEFAULT_PRODUCTION_APP_URL,
      configured: false,
      warning: expect.stringContaining(DEFAULT_PRODUCTION_APP_URL),
    });
  });

  it('normalises an explicit public origin', () => {
    expect(resolveAppUrl('https://donutcash.runasp.net/', true)).toEqual({
      appUrl: 'https://donutcash.runasp.net',
      configured: true,
    });
  });

  it('never accepts a loopback origin in production', () => {
    for (const value of [
      'http://localhost:5173',
      'http://127.0.0.1:4000',
      'http://[::1]:5173',
      'http://0.0.0.0:4000',
    ]) {
      const resolved = resolveAppUrl(value, true);
      expect(resolved.appUrl).toBe(DEFAULT_PRODUCTION_APP_URL);
      expect(resolved.configured).toBe(false);
      expect(resolved.warning).toContain('loopback');
    }
  });

  it('falls back to the production site for malformed or unsupported values', () => {
    for (const value of ['not a url', 'ftp://donutcash.runasp.net', 'javascript:alert(1)']) {
      expect(resolveAppUrl(value, true).appUrl).toBe(DEFAULT_PRODUCTION_APP_URL);
    }
  });
});
