import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../server/db/index.ts';

/**
 * Default posture: forwarded headers are ignored. IIS passes client-supplied
 * `X-Forwarded-For` through untouched, so trusting it would let a caller pick a
 * fresh rate-limit bucket and forge audit-log IPs. These tests pin that the
 * header is visible but never used unless the deployment opts in.
 */

const PASSWORD = 'NoProxyTrust!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

let db: DB;
let app: Express;
let agent: ReturnType<typeof request.agent>;
let targetId: string;

beforeAll(async () => {
  delete process.env.TRUST_PROXY_HEADERS;

  const dbModule = await import('../server/db/index.ts');
  const appModule = await import('../server/app.ts');
  const cryptoModule = await import('../server/lib/crypto.ts');
  const walletModule = await import('../server/lib/wallet.ts');
  const legalModule = await import('../server/lib/legal.ts');

  db = dbModule.createDatabase(':memory:');
  app = appModule.createApp(db);

  const now = new Date().toISOString();
  const adminName = unique('noproxyadmin');
  const insert = (id: string, username: string, role: string) => {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
    ).run(id, username, `${username}@test.local`, cryptoModule.hashPassword(PASSWORD), role, now, now);
    walletModule.createWallet(db, id, 1000, null);
    legalModule.recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  };

  insert(`usr_${adminName}`, adminName, 'admin');
  targetId = `usr_${unique('noproxy_target')}`;
  insert(targetId, targetId.replace('usr_', ''), 'user');

  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').set(CSRF).send({ identifier: adminName, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
});

afterAll(() => {
  db?.close();
});

describe('untrusted forwarded headers (default)', () => {
  it('reports that forwarded headers are ignored and resolves no spoofed IP', async () => {
    const res = await agent
      .get('/api/admin/diagnostics/request')
      .set('X-Forwarded-For', '198.51.100.66')
      .set('X-Real-IP', '198.51.100.66');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.trustProxyHeaders).toBe(false);
    expect(res.body.forwardedFor).toBe('198.51.100.66');
    expect(res.body.resolvedClientIp).toBeNull();
  });

  it('never writes a spoofed address into the audit log', async () => {
    const res = await agent
      .patch(`/api/admin/users/${targetId}/status`)
      .set(CSRF)
      .set('X-Forwarded-For', '198.51.100.66')
      .send({ status: 'restricted', reason: 'Spoofed header must not be recorded.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const audit = db
      .prepare("SELECT ip FROM audit_logs WHERE action = 'user.status' AND target_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(targetId) as { ip: string | null } | undefined;
    expect(audit?.ip).toBeNull();
  });

  it('cannot reset the login limiter by rotating X-Forwarded-For', async () => {
    const identifier = unique('spray');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .set(CSRF)
        .set('X-Forwarded-For', `192.0.2.${attempt + 1}`)
        .send({ identifier, password: 'wrong-password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
