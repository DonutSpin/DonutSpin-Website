import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { getEmailConfig, renderEmail } from '../server/lib/email.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'DeleteTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const unique = (prefix: string) =>
  `${prefix.replace(/[^a-z0-9]/gi, '').slice(0, 6)}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let playerAgent: Agent;
let playerId: string;
let playerUsername: string;
let playerEmail: string;
let otherAgent: Agent;
let ownerAgent: Agent;
let ownerId: string;
let ownerUsername: string;

function directUser(username: string, role: 'user' | 'owner') {
  const id = `usr_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@test.local`, hashPassword(PASSWORD), role, now, now);
  createWallet(db, id, 1_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

async function register(prefix: string) {
  const username = unique(prefix);
  const email = `${username}@test.local`;
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set(CSRF).send({
    username,
    email,
    password: PASSWORD,
    ageConfirmed: true,
    acceptTerms: true,
    acknowledgeDonutRules: true,
  });
  expectStatus(res, 201);
  return { agent, userId: res.body.user.id as string, username, email };
}

function seedPersonalRecords(userId: string, username: string, email: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
     VALUES (?, ?, 'security', 'Notice', 'Personal notice', '/settings', ?)`,
  ).run(`ntf_${userId}`, userId, now);
  db.prepare(
    `INSERT INTO game_sessions (id, user_id, game_id, bet, status, payout, state, idempotency_key, created_at, ended_at)
     VALUES (?, ?, 'coinflip', 1000, 'won', 1960, '{}', ?, ?, ?)`,
  ).run(`gms_${userId}`, userId, `idem_${userId}`, now, now);
  db.prepare(
    `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
     VALUES (?, ?, ?, 'Account ticket', 'Personal support history', 'question', 'open', 'normal', ?, ?, ?)`,
  ).run(`tkt_${userId}`, `T-${userId.toUpperCase()}`, userId, now, now, now);
  db.prepare(
    `INSERT INTO cashier_requests (id, reference, user_id, kind, amount, status, created_at, updated_at, last_activity_at)
     VALUES (?, ?, ?, 'deposit', 5000, 'pending', ?, ?, ?)`,
  ).run(`csh_${userId}`, `C-${userId.toUpperCase()}`, userId, now, now, now);
  db.prepare(
    `INSERT INTO reward_claims (id, user_id, claim_day, timezone, streak_day, base_amount, increment_amount, milestone_amount, amount, created_at)
     VALUES (?, ?, '2026-01-01', 'UTC', 1, 50000, 10000, 0, 50000, ?)`,
  ).run(`rwd_${userId}`, userId, now);
  db.prepare('INSERT INTO bet_activity_days (user_id, activity_day, first_bet_at) VALUES (?, ?, ?)').run(
    userId,
    '2026-01-01',
    now,
  );
  db.prepare(
    `INSERT INTO account_reviews (id, user_id, status, reason, related_user_ids, related_count, flagged_at, updated_at)
     VALUES (?, ?, 'open', 'Review reason', '[]', 1, ?, ?)`,
  ).run(`rev_${userId}`, userId, now, now);
  db.prepare(
    `INSERT INTO email_verifications (id, user_id, email, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`evf_${userId}`, userId, email, `hash-${userId}`, now, now);
  db.prepare(
    `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`prs_${userId}`, userId, `reset-${userId}`, now, now);
  db.prepare(
    `INSERT INTO email_jobs (id, user_id, recipient, template, payload, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'welcome', '{}', 'failed', 1, 3, ?, ?, ?)`,
  ).run(`eml_${userId}`, userId, email, now, now, now);
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, target_label, created_at)
     VALUES (?, ?, 'profile.update', 'user', ?, ?, ?)`,
  ).run(`aud_${userId}`, userId, userId, username, now);
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  ownerUsername = unique('del_owner');
  ownerId = directUser(ownerUsername, 'owner');
  ownerAgent = await signIn(ownerUsername);

  const player = await register('del_player');
  playerAgent = player.agent;
  playerId = player.userId;
  playerUsername = player.username;
  playerEmail = player.email;
  seedPersonalRecords(playerId, playerUsername, playerEmail);

  const other = await register('del_other');
  otherAgent = other.agent;
});

afterAll(() => {
  db.close();
});

describe('self-service account deletion', () => {
  it('requires the current password and an emailed one-time token before erasing an account', async () => {
    const wrongPassword = await playerAgent
      .post('/api/me/delete-account/request')
      .set(CSRF)
      .send({ password: 'not-the-password' });
    expectStatus(wrongPassword, 400);
    expect(wrongPassword.body.error.code).toBe('INVALID_PASSWORD');

    const requestLink = await playerAgent
      .post('/api/me/delete-account/request')
      .set(CSRF)
      .send({ password: PASSWORD });
    expectStatus(requestLink, 200);
    expect(requestLink.body.sent).toBe(false);
    expect(requestLink.body.deletePath).toMatch(/^\/delete-account\?token=/);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM account_deletion_requests WHERE user_id = ?').get(playerId),
    ).toEqual({ count: 1 });

    const token = new URL(requestLink.body.deletePath, 'http://localhost').searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(20);

    const anonymous = await request(app).post('/api/me/delete-account/confirm').set(CSRF).send({ token });
    expectStatus(anonymous, 401);

    const otherAccount = await otherAgent.post('/api/me/delete-account/confirm').set(CSRF).send({ token });
    expectStatus(otherAccount, 400);
    expect(otherAccount.body.error.code).toBe('INVALID_DELETION_TOKEN');

    db.prepare("UPDATE account_deletion_requests SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(
      playerId,
    );
    const expired = await playerAgent.post('/api/me/delete-account/confirm').set(CSRF).send({ token });
    expectStatus(expired, 400);
    expect(expired.body.error.code).toBe('INVALID_DELETION_TOKEN');

    const secondRequest = await playerAgent
      .post('/api/me/delete-account/request')
      .set(CSRF)
      .send({ password: PASSWORD });
    expectStatus(secondRequest, 200);
    const freshToken =
      new URL(secondRequest.body.deletePath, 'http://localhost').searchParams.get('token') ?? '';

    const confirmed = await playerAgent
      .post('/api/me/delete-account/confirm')
      .set(CSRF)
      .send({ token: freshToken });
    expectStatus(confirmed, 200);

    const erased = db
      .prepare(
        `SELECT username, email, password_hash, status, deleted_at, email_verified, email_notifications,
                registration_ip, last_login_at
           FROM users WHERE id = ?`,
      )
      .get(playerId) as {
      username: string;
      email: string;
      password_hash: string;
      status: string;
      deleted_at: string | null;
      email_verified: number;
      email_notifications: number;
      registration_ip: string | null;
      last_login_at: string | null;
    };
    expect(erased.username).toMatch(/^deleted_[a-f0-9]{24}$/);
    expect(erased.email).toMatch(/^deleted_[a-f0-9]{24}@deleted\.invalid$/);
    expect(erased.password_hash).toMatch(/^!deleted-/);
    expect(erased.status).toBe('suspended');
    expect(erased.deleted_at).toBeTruthy();
    expect(erased.email_verified).toBe(0);
    expect(erased.email_notifications).toBe(0);
    expect(erased.registration_ip).toBeNull();
    expect(erased.last_login_at).toBeNull();

    for (const table of [
      'sessions',
      'wallets',
      'legal_acceptances',
      'game_sessions',
      'tickets',
      'cashier_requests',
      'reward_claims',
      'bet_activity_days',
      'notifications',
      'email_verifications',
      'password_resets',
      'email_jobs',
      'account_reviews',
      'account_deletion_requests',
    ]) {
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).get(playerId),
        table,
      ).toEqual({ count: 0 });
    }

    const ledger = db.prepare('SELECT COUNT(*) AS count FROM ledger WHERE user_id = ?').get(playerId) as {
      count: number;
    };
    expect(ledger.count).toBeGreaterThan(0);

    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE actor_id = ? OR target_id = ? OR target_label IN (?, ?)')
        .get(playerId, playerId, playerUsername, playerEmail),
    ).toEqual({ count: 0 });
    const deletionAudit = db
      .prepare("SELECT actor_id, target_id, target_label FROM audit_logs WHERE action = 'account.deleted'")
      .get() as { actor_id: string | null; target_id: string | null; target_label: string | null } | undefined;
    expect(deletionAudit).toEqual({ actor_id: null, target_id: null, target_label: 'self-service deletion' });

    const session = await playerAgent.get('/api/auth/me');
    expectStatus(session, 200);
    expect(session.body.user).toBeNull();

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: playerUsername, password: PASSWORD });
    expectStatus(oldLogin, 401);
  });

  it('refuses to delete the last owner account', async () => {
    const requestLink = await ownerAgent
      .post('/api/me/delete-account/request')
      .set(CSRF)
      .send({ password: PASSWORD });
    expectStatus(requestLink, 200);
    const token = new URL(requestLink.body.deletePath, 'http://localhost').searchParams.get('token') ?? '';

    const confirmed = await ownerAgent.post('/api/me/delete-account/confirm').set(CSRF).send({ token });
    expectStatus(confirmed, 409);
    expect(confirmed.body.error.code).toBe('LAST_OWNER');

    const owner = db.prepare('SELECT status, deleted_at FROM users WHERE id = ?').get(ownerId) as {
      status: string;
      deleted_at: string | null;
    };
    expect(owner.status).toBe('active');
    expect(owner.deleted_at).toBeNull();
  });

  it('invalidates a pending deletion link when the email address changes', async () => {
    const user = await register('del_email');
    const requestLink = await user.agent
      .post('/api/me/delete-account/request')
      .set(CSRF)
      .send({ password: PASSWORD });
    expectStatus(requestLink, 200);
    const token = new URL(requestLink.body.deletePath, 'http://localhost').searchParams.get('token') ?? '';

    const changed = await user.agent
      .patch('/api/me')
      .set(CSRF)
      .send({ email: `${user.username}-moved@test.local` });
    expectStatus(changed, 200);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM account_deletion_requests WHERE user_id = ? AND used_at IS NULL')
        .get(user.userId),
    ).toEqual({ count: 0 });

    const confirmed = await user.agent.post('/api/me/delete-account/confirm').set(CSRF).send({ token });
    expectStatus(confirmed, 400);
    expect(confirmed.body.error.code).toBe('INVALID_DELETION_TOKEN');
  });

  it('renders a deletion email with the confirmation link and retention note', () => {
    const rendered = renderEmail(
      'account-deletion',
      { username: 'tester', deleteUrl: '/delete-account?token=abc123', expiresAt: new Date().toISOString() },
      getEmailConfig(db),
    );
    expect(rendered.subject).toContain('Confirm deletion');
    expect(rendered.html).toContain('/delete-account?token=abc123');
    expect(rendered.text).toContain('/delete-account?token=abc123');
    expect(rendered.text).toContain('pseudonymous');
  });
});
