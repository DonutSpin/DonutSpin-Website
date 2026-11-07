import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../server/db/index.ts';

/**
 * With TRUST_PROXY_HEADERS enabled the app trusts forwarding information only
 * from the local reverse proxy, which is where IIS/HttpPlatformHandler connects
 * from. The test client runs on loopback, so its X-Forwarded-For is accepted —
 * exactly like a correctly configured proxy that overwrites the header.
 */

const PASSWORD = 'ProxyTrust!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const CLIENT_IP = '203.0.113.7';
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

let db: DB;
let app: Express;
let adminId: string;
let targetId: string;
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  process.env.TRUST_PROXY_HEADERS = 'true';

  const dbModule = await import('../server/db/index.ts');
  const appModule = await import('../server/app.ts');
  const cryptoModule = await import('../server/lib/crypto.ts');
  const walletModule = await import('../server/lib/wallet.ts');
  const legalModule = await import('../server/lib/legal.ts');

  db = dbModule.createDatabase(':memory:');
  app = appModule.createApp(db);

  const now = new Date().toISOString();
  const insert = (id: string, username: string, role: string) => {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
    ).run(id, username, `${username}@test.local`, cryptoModule.hashPassword(PASSWORD), role, now, now);
    walletModule.createWallet(db, id, 1000, null);
    legalModule.recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  };

  const adminName = unique('proxyadmin');
  adminId = `usr_${adminName}`;
  targetId = `usr_${unique('proxytarget')}`;
  insert(adminId, adminName, 'admin');
  insert(targetId, targetId.replace('usr_', ''), 'user');

  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').set(CSRF).send({ identifier: adminName, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
});

afterAll(() => {
  db?.close();
  delete process.env.TRUST_PROXY_HEADERS;
});

describe('trusted proxy headers (opt-in)', () => {
  it('exposes the forwarded client address to diagnostics', async () => {
    const res = await agent.get('/api/admin/diagnostics/request').set('X-Forwarded-For', CLIENT_IP);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.trustProxyHeaders).toBe(true);
    expect(res.body.resolvedClientIp).toBe(CLIENT_IP);
    expect(res.body.forwardedFor).toBe(CLIENT_IP);
    expect(res.body.socketAddress).not.toBe(CLIENT_IP);
  });

  it('writes the forwarded client address into the audit log', async () => {
    const res = await agent
      .patch(`/api/admin/users/${targetId}/status`)
      .set(CSRF)
      .set('X-Forwarded-For', CLIENT_IP)
      .send({ status: 'restricted', reason: 'Proxy trust verification entry.' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const audit = db
      .prepare("SELECT ip FROM audit_logs WHERE action = 'user.status' AND target_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(targetId) as { ip: string | null } | undefined;
    expect(audit?.ip).toBe(CLIENT_IP);
  });

  it('records the forwarded address on registration consent', async () => {
    const username = `prx${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;
    const res = await request(app).post('/api/auth/register').set(CSRF).set('X-Forwarded-For', CLIENT_IP).send({
      username,
      email: `${username}@test.local`,
      password: PASSWORD,
      ageConfirmed: true,
      acceptTerms: true,
      acknowledgeDonutRules: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = db
      .prepare(
        'SELECT la.ip FROM legal_acceptances la JOIN users u ON u.id = la.user_id WHERE u.username = ? ORDER BY la.accepted_at DESC LIMIT 1',
      )
      .get(username) as { ip: string | null } | undefined;
    expect(row?.ip).toBe(CLIENT_IP);
  });

  it('keeps the diagnostic endpoint admin-only', async () => {
    const anonymous = await request(app).get('/api/admin/diagnostics/request');
    expect(anonymous.status).toBe(401);
  });
});
