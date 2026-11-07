import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { assertDatabasePathSafe } from '../server/config.ts';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createTurnstileVerifier, type TurnstileSettings } from '../server/lib/turnstile.ts';

const CSRF = { 'X-Requested-With': 'donutspin' };
const PASSWORD = 'TurnstileTest!2026';
const CONSENT = { ageConfirmed: true, acceptTerms: true, acknowledgeDonutRules: true };

const databases: DB[] = [];

function unique(prefix: string): string {
  // Usernames are capped at 20 characters by the API schema.
  return `${prefix.slice(0, 5)}_${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
}

function makeApp(settings: TurnstileSettings) {
  const db = createDatabase(':memory:');
  databases.push(db);
  return { db, app: createApp(db, { turnstile: createTurnstileVerifier(settings) }) };
}

function enabled(overrides: Partial<TurnstileSettings> = {}): TurnstileSettings {
  return {
    enabled: true,
    siteKey: 'test-site-key',
    secretKey: 'test-secret',
    expectedHostname: '',
    ...overrides,
  };
}

function registration(username: string, turnstileToken?: string) {
  return {
    username,
    email: `${username}@test.local`,
    password: PASSWORD,
    ...CONSENT,
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}

function mockSiteverify(result: Record<string, unknown>, status = 200): URLSearchParams[] {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''));
      calls.push(body);
      return new Response(JSON.stringify(result), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (databases.length) databases.pop()?.close();
});

describe('Turnstile enforcement', () => {
  it('rejects a missing token without calling Siteverify', async () => {
    const { app } = makeApp(enabled());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const username = unique('nocaptcha');

    const res = await request(app).post('/api/auth/register').set(CSRF).send(registration(username));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAPTCHA_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token that Cloudflare marks invalid', async () => {
    const { app } = makeApp(enabled());
    mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const username = unique('badcaptcha');

    const res = await request(app).post('/api/auth/register').set(CSRF).send(registration(username, 'bad-token'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAPTCHA_FAILED');
  });

  it('registers only after a successful Siteverify response', async () => {
    const { app } = makeApp(enabled({ expectedHostname: 'donutspin.runasp.net' }));
    const calls = mockSiteverify({
      success: true,
      action: 'register',
      hostname: 'donutspin.runasp.net',
    });
    const username = unique('goodcaptcha');

    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'good-token'));

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.get('secret')).toBe('test-secret');
    expect(calls[0]?.get('response')).toBe('good-token');
    expect(calls[0]?.get('idempotency_key')).toBeTruthy();
  });

  it('accepts a successful validation that omits action, as official test keys do', async () => {
    const { app } = makeApp(enabled());
    mockSiteverify({ success: true });
    const username = unique('noaction');

    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'test-key-token'));

    expect(res.status).toBe(201);
  });

  it('requires a token for login and accepts a valid challenge', async () => {
    const { app } = makeApp(enabled());
    const username = unique('logincaptcha');
    const agent = request.agent(app);

    mockSiteverify({ success: true, action: 'register' });
    const created = await agent
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'register-token'));
    expect(created.status).toBe(201);
    await agent.post('/api/auth/logout').set(CSRF).send({});

    const missing = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('CAPTCHA_REQUIRED');

    mockSiteverify({ success: true, action: 'login' });
    const login = await agent
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: username, password: PASSWORD, turnstileToken: 'login-token' });
    expect(login.status).toBe(200);
    expect(login.body.user.username).toBe(username);
  });

  it('requires a token before issuing a password reset', async () => {
    const { app } = makeApp(enabled());
    const username = unique('forgotcaptcha');

    mockSiteverify({ success: true, action: 'register' });
    const created = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'register-token'));
    expect(created.status).toBe(201);

    const missing = await request(app)
      .post('/api/auth/forgot-password')
      .set(CSRF)
      .send({ email: `${username}@test.local` });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('CAPTCHA_REQUIRED');

    mockSiteverify({ success: true, action: 'forgot-password' });
    const accepted = await request(app)
      .post('/api/auth/forgot-password')
      .set(CSRF)
      .send({ email: `${username}@test.local`, turnstileToken: 'forgot-token' });
    expect(accepted.status).toBe(200);
  });

  it('rejects a token issued for a different action', async () => {
    const { app } = makeApp(enabled());
    mockSiteverify({ success: true, action: 'login' });
    const username = unique('actionmismatch');

    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'wrong-action-token'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAPTCHA_FAILED');
  });

  it('rejects a token issued for a different hostname when configured', async () => {
    const { app } = makeApp(enabled({ expectedHostname: 'donutspin.runasp.net' }));
    mockSiteverify({ success: true, action: 'register', hostname: 'attacker.example' });
    const username = unique('hostmismatch');

    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'other-host-token'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CAPTCHA_FAILED');
  });

  it('fails closed when Siteverify cannot be reached', async () => {
    const { app } = makeApp(enabled());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );
    const username = unique('offlinecaptcha');

    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send(registration(username, 'offline-token'));

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CAPTCHA_UNAVAILABLE');
  });

  it('leaves auth unchanged when Turnstile is disabled', async () => {
    const db = createDatabase(':memory:');
    databases.push(db);
    const app = createApp(db);
    const username = unique('disabledcaptcha');

    const res = await request(app).post('/api/auth/register').set(CSRF).send(registration(username));

    expect(res.status).toBe(201);
  });
});

describe('database path safety', () => {
  const root = process.cwd();

  it('refuses database paths inside generated build output', () => {
    expect(() => assertDatabasePathSafe(path.join(root, 'dist', 'aurum.db'), root)).toThrow(/dist/);
    expect(() => assertDatabasePathSafe(path.join(root, 'build', 'aurum.db'), root)).toThrow(/build/);
    expect(() => assertDatabasePathSafe(path.join(root, 'dist'), root)).toThrow(/dist/);
  });

  it('allows persistent paths and lookalike folder names', () => {
    expect(() => assertDatabasePathSafe(path.join(root, 'data', 'aurum.db'), root)).not.toThrow();
    expect(() => assertDatabasePathSafe(path.join(root, 'dist-backup', 'aurum.db'), root)).not.toThrow();
    expect(() => assertDatabasePathSafe(path.join(root, '..', 'persistent', 'aurum.db'), root)).not.toThrow();
  });
});
