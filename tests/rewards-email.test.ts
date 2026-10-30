import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, setSetting, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { getEmailConfig, renderEmail } from '../server/lib/email.ts';
import { rewardDayKey } from '../server/lib/rewards.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'RewardTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let ownerAgent: Agent;
let playerAgent: Agent;
let playerId: string;

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

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);
  directUser('rewardowner', 'owner');
  ownerAgent = await signIn('rewardowner');

  const suffix = unique('rp');
  playerAgent = request.agent(app);
  const registration = await playerAgent
    .post('/api/auth/register')
    .set(CSRF)
    .send({
      username: suffix,
      email: `${suffix}@test.local`,
      password: PASSWORD,
      ageConfirmed: true,
      acceptTerms: true,
      acknowledgeDonutRules: true,
    });
  expectStatus(registration, 201);
  playerId = registration.body.user.id as string;
});

afterAll(() => {
  db.close();
});

describe('daily rewards', () => {
  it('claims once, credits the ledger and builds the next day reward', async () => {
    const before = await playerAgent.get('/api/rewards');
    expectStatus(before, 200);
    expect(before.body.streak).toBe(0);
    expect(before.body.claimedToday).toBe(false);
    expect(before.body.nextReward.total).toBe(50_000);

    const balanceBefore = (
      db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(playerId) as { balance: number }
    ).balance;
    const claim = await playerAgent.post('/api/rewards/claim').set(CSRF).send({});
    expectStatus(claim, 200);
    expect(claim.body.claim.streakDay).toBe(1);
    expect(claim.body.claim.amount).toBe(50_000);
    expect(claim.body.balance).toBe(balanceBefore + 50_000);
    expect(claim.body.claimedToday).toBe(true);

    const duplicate = await playerAgent.post('/api/rewards/claim').set(CSRF).send({});
    expectStatus(duplicate, 409);
    expect(duplicate.body.error.code).toBe('ALREADY_CLAIMED');

    const ledger = db
      .prepare("SELECT amount, type, ref_type, metadata FROM ledger WHERE user_id = ? AND ref_type = 'reward'")
      .all(playerId) as { amount: number; type: string; ref_type: string; metadata: string }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.amount).toBe(50_000);
    expect(ledger[0]?.type).toBe('admin_adjustment');
    expect(JSON.parse(ledger[0]?.metadata ?? '{}')).toMatchObject({ source: 'rewards', streakDay: 1 });

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    db.prepare('UPDATE reward_claims SET claim_day = ? WHERE user_id = ?').run(yesterday, playerId);
    setSetting(db, 'rewards.milestones', [{ day: 2, amount: 5_000, label: 'Day two' }], null);

    const next = await playerAgent.get('/api/rewards');
    expectStatus(next, 200);
    expect(next.body.streak).toBe(1);
    expect(next.body.nextReward).toMatchObject({ streakDay: 2, baseAmount: 60_000, milestoneAmount: 5_000, total: 65_000 });

    const second = await playerAgent.post('/api/rewards/claim').set(CSRF).send({});
    expectStatus(second, 200);
    expect(second.body.claim.streakDay).toBe(2);
    expect(second.body.claim.amount).toBe(65_000);
    expect(second.body.claim.milestoneLabel).toBe('Day two');
    expect(second.body.streak).toBe(2);
  });

  it('respects timezone reset days and grace policies', async () => {
    const graceId = directUser('rewardgrace', 'user');
    const graceAgent = await signIn('rewardgrace');
    const today = rewardDayKey(new Date(), 'UTC', 0);
    const old = new Date(`${today}T00:00:00.000Z`);
    old.setUTCDate(old.getUTCDate() - 4);
    const oldDay = old.toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO reward_claims (id, user_id, claim_day, timezone, streak_day, base_amount, increment_amount, milestone_amount, amount, created_at)
       VALUES ('rwd_old', ?, ?, 'UTC', 5, 50000, 10000, 0, 50000, ?)`,
    ).run(graceId, oldDay, new Date().toISOString());

    setSetting(db, 'rewards.missed_policy', 'reset', null);
    const reset = await graceAgent.get('/api/rewards');
    expectStatus(reset, 200);
    expect(reset.body.streak).toBe(0);

    setSetting(db, 'rewards.missed_policy', 'grace', null);
    setSetting(db, 'rewards.grace_days', 3, null);
    const grace = await graceAgent.get('/api/rewards');
    expectStatus(grace, 200);
    expect(grace.body.streak).toBe(5);
  });

  it('validates and audits admin reward settings', async () => {
    const current = await ownerAgent.get('/api/admin/rewards');
    expectStatus(current, 200);
    expect(current.body.timezone).toBe('UTC');

    const invalid = await ownerAgent.patch('/api/admin/rewards').set(CSRF).send({
      enabled: true,
      timezone: 'Mars/Olympus',
      resetHour: 0,
      baseAmount: 50_000,
      incrementAmount: 10_000,
      maxAmount: 500_000,
      maxStreakDays: 365,
      missedPolicy: 'reset',
      graceDays: 1,
      emailEnabled: true,
      milestones: [],
    });
    expectStatus(invalid, 400);
    expect(invalid.body.error.details.fields.timezone).toBeTruthy();

    const valid = await ownerAgent.patch('/api/admin/rewards').set(CSRF).send({
      enabled: true,
      timezone: 'Europe/London',
      resetHour: 4,
      baseAmount: 75_000,
      incrementAmount: 12_500,
      maxAmount: 1_000_000,
      maxStreakDays: 90,
      missedPolicy: 'grace',
      graceDays: 2,
      emailEnabled: false,
      milestones: [{ day: 7, amount: 100_000, label: 'Week one' }],
    });
    expectStatus(valid, 200);
    expect(valid.body).toMatchObject({
      timezone: 'Europe/London',
      resetHour: 4,
      baseAmount: 75_000,
      missedPolicy: 'grace',
      graceDays: 2,
      emailEnabled: false,
    });

    const audit = db
      .prepare("SELECT action FROM audit_logs WHERE action = 'rewards.settings_update' ORDER BY created_at DESC LIMIT 1")
      .get() as { action: string } | undefined;
    expect(audit?.action).toBe('rewards.settings_update');
  });
});

describe('email settings and queue', () => {
  it('never exposes the SMTP key and encrypts it at rest', async () => {
    const save = await ownerAgent.patch('/api/admin/email').set(CSRF).send({
      enabled: false,
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      user: 'c05ccf001@smtp-brevo.com',
      fromName: 'Donutcash QA',
      fromEmail: 'sender@test.local',
      replyTo: '',
      securityNotifications: true,
      rewardNotifications: true,
      smtpPass: 'brevo-super-secret-key',
    });
    expectStatus(save, 200);
    expect(save.body.smtpPassSet).toBe(true);
    expect(JSON.stringify(save.body)).not.toContain('brevo-super-secret-key');
    expect(Object.prototype.hasOwnProperty.call(save.body, 'smtpPass')).toBe(false);

    const stored = db.prepare("SELECT value FROM settings WHERE key = 'email.smtp_pass_enc'").get() as { value: string };
    expect(stored.value).not.toContain('brevo-super-secret-key');
    expect((JSON.parse(stored.value) as string).startsWith('v1.')).toBe(true);

    const adminSettings = await ownerAgent.get('/api/admin/settings');
    expectStatus(adminSettings, 200);
    expect(JSON.stringify(adminSettings.body)).not.toContain('brevo-super-secret-key');
    expect(JSON.stringify(adminSettings.body)).not.toContain('email.smtp_pass_enc');
  });

  it('queues transactional email after email is enabled', async () => {
    const enable = await ownerAgent.patch('/api/admin/email').set(CSRF).send({
      enabled: true,
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      user: 'c05ccf001@smtp-brevo.com',
      fromName: 'Donutcash QA',
      fromEmail: 'sender@test.local',
      replyTo: '',
      securityNotifications: true,
      rewardNotifications: true,
    });
    expectStatus(enable, 200);
    expect(enable.body.enabled).toBe(true);
    expect(getEmailConfig(db).pass).toBe('brevo-super-secret-key');

    const suffix = unique('mp');
    const agent = request.agent(app);
    const registration = await agent
      .post('/api/auth/register')
      .set(CSRF)
      .send({
      username: suffix,
      email: `${suffix}@test.local`,
      password: PASSWORD,
      ageConfirmed: true,
      acceptTerms: true,
      acknowledgeDonutRules: true,
    });
    expectStatus(registration, 201);
    const userId = registration.body.user.id as string;

    const job = db
      .prepare("SELECT template, status, recipient FROM email_jobs WHERE user_id = ? AND template = 'welcome'")
      .get(userId) as { template: string; status: string; recipient: string } | undefined;
    expect(job).toBeTruthy();
    expect(job?.status).toBe('pending');
    expect(job?.recipient).toBe(`${suffix}@test.local`);

    const resend = await agent.post('/api/auth/resend-verification').set(CSRF).send({});
    expectStatus(resend, 200);
    expect(resend.body.sent).toBe(true);
    expect(typeof resend.body.verifyPath).toBe('string');
    const token = new URL(resend.body.verifyPath, 'http://local').searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(20);

    const verify = await agent.post('/api/auth/verify-email').set(CSRF).send({ token });
    expectStatus(verify, 200);
    const me = await agent.get('/api/auth/me');
    expectStatus(me, 200);
    expect(me.body.user.emailVerified).toBe(true);

    const change = await agent.patch('/api/me').set(CSRF).send({ email: `${suffix}-new@test.local` });
    expectStatus(change, 200);
    expect(change.body.user.emailVerified).toBe(false);
    const changedJobs = db
      .prepare("SELECT template, recipient FROM email_jobs WHERE user_id = ? AND template IN ('email-changed','verify-email') ORDER BY created_at")
      .all(userId) as { template: string; recipient: string }[];
    expect(changedJobs.some((entry) => entry.template === 'email-changed' && entry.recipient === `${suffix}@test.local`)).toBe(true);
    expect(changedJobs.some((entry) => entry.template === 'verify-email' && entry.recipient === `${suffix}-new@test.local`)).toBe(true);
  });

  it('renders responsive HTML with escaped content and a plain-text fallback', () => {
    const email = getEmailConfig(db);
    const rendered = renderEmail(
      'announcement',
      { title: 'A <b>bold</b> update', body: '<script>alert(1)</script>\nSecond line', username: 'tester' },
      email,
    );
    expect(rendered.subject).toBe('A <b>bold</b> update');
    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.html).toContain('@media only screen');
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.text).toContain('Second line');
    expect(rendered.text).toContain('/settings#email');

    const reset = renderEmail('password-reset', { username: 'tester', resetUrl: '/reset-password?token=abc' }, email);
    expect(reset.text).toContain('http://localhost:5173/reset-password?token=abc');
    expect(reset.html).toContain('Choose a new password');
  });
});
