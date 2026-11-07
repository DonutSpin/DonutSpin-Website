import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { notify } from '../server/lib/notifications.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'NotifyTest!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };

const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let agent: Agent;
let userId: string;

function createUser(username: string): string {
  const id = `usr_notify_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@notify.test`, hashPassword(PASSWORD), now, now);
  createWallet(db, id, 1_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);
  userId = createUser('live_badge');
  agent = request.agent(app);
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF)
    .send({ identifier: 'live_badge', password: PASSWORD });
  expectStatus(login, 200);
}, 30_000);

afterAll(() => {
  db.close();
});

describe('live notification badge', () => {
  it('returns the unread count on every session poll', async () => {
    const initial = await agent.get('/api/auth/me');
    expectStatus(initial, 200);
    expect(initial.body.unreadNotifications).toBe(0);

    const first = notify(db, {
      userId,
      type: 'ticket',
      title: 'Support replied',
      body: 'A staff member answered your ticket.',
      link: '/tickets',
    });
    const second = notify(db, {
      userId,
      type: 'wallet',
      title: 'Cashier approved',
      body: 'Your withdrawal was approved.',
      link: '/wallet',
    });

    const after = await agent.get('/api/auth/me');
    expectStatus(after, 200);
    expect(after.body.user.username).toBe('live_badge');
    expect(after.body.unreadNotifications).toBe(2);

    const read = await agent.post(`/api/me/notifications/${first}/read`).set(CSRF).send({});
    expectStatus(read, 200);
    expect(read.body.unread).toBe(1);

    const refreshed = await agent.get('/api/auth/me');
    expect(refreshed.body.unreadNotifications).toBe(1);

    const all = await agent.post('/api/me/notifications/read-all').set(CSRF).send({});
    expectStatus(all, 200);
    expect(all.body.unread).toBe(0);

    const cleared = await agent.get('/api/auth/me');
    expect(cleared.body.unreadNotifications).toBe(0);

    // The count is scoped to the signed-in account, not global.
    const other = createUser('live_badge_other');
    notify(db, {
      userId: other,
      type: 'ticket',
      title: 'Someone else',
      body: 'Not for this account.',
      link: null,
    });
    const isolated = await agent.get('/api/auth/me');
    expect(isolated.body.unreadNotifications).toBe(0);
    expect(second).toBeTruthy();
  });

  it('returns zero for signed-out requests instead of leaking a count', async () => {
    const anonymous = await request(app).get('/api/auth/me');
    expectStatus(anonymous, 200);
    expect(anonymous.body.user).toBeNull();
    expect(anonymous.body.unreadNotifications).toBe(0);
  });
});
