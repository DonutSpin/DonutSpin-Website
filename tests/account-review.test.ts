import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { flagSharedIpAccounts } from '../server/lib/account-review.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'ReviewTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let supportAgent: Agent;
let playerAgent: Agent;
let ownerAgent: Agent;

const createdUsers: string[] = [];

function makeUser(prefix: string, ip: string, role: 'user' | 'owner' | 'support' = 'user') {
  const username = unique(prefix);
  const id = `usr_${username}`;
  const now = new Date(Date.now() + createdUsers.length).toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, registration_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
  ).run(id, username, `${username}@test.local`, hashPassword(PASSWORD), role, ip, now, now);
  createWallet(db, id, 1_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip, acceptedAt: now });
  createdUsers.push(id);
  return { id, username };
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

async function reviewsFor(agent: Agent) {
  const res = await agent.get('/api/staff/account-reviews?pageSize=100');
  expectStatus(res, 200);
  return res.body as {
    items: {
      id: string;
      userId: string;
      status: string;
      triggerIp: string | null;
      accountHold: boolean;
      reason: string;
    }[];
    counts: Record<string, number>;
    accountsPerIp: number;
  };
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  const support = makeUser('rev_support', '198.51.100.40', 'support');
  supportAgent = await signIn(support.username);
  const owner = makeUser('rev_owner', '198.51.100.41', 'owner');
  ownerAgent = await signIn(owner.username);
});

afterAll(() => {
  db.close();
});

describe('multiple-account detection and support review', () => {
  it('holds accounts above the shared-IP allowance and blocks benefits server-side', async () => {
    const ip = '203.0.113.10';
    const group = Array.from({ length: 4 }, (_, index) => makeUser(`fam_${index}`, ip));
    const flagged = flagSharedIpAccounts(db, group[0]!.id, ip);
    expect(flagged).toEqual({ flagged: 4, related: 4 });

    const reviews = await reviewsFor(supportAgent);
    expect(reviews.accountsPerIp).toBe(3);
    expect(reviews.counts).toMatchObject({ open: 4, onHold: 4, total: 4 });
    expect(reviews.items).toHaveLength(4);
    expect(reviews.items.every((item) => item.triggerIp === ip && item.accountHold)).toBe(true);
    expect(reviews.items[0]?.reason).toContain('Automatic review');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(ip),
    ).toEqual({ count: 4 });

    const player = group[0]!;
    playerAgent = await signIn(player.username);

    const profile = await playerAgent.get('/api/auth/me');
    expectStatus(profile, 200);
    expect(profile.body.user.accountHold).toBe(true);
    expect(JSON.stringify(profile.body)).not.toContain(ip);
    expect(JSON.stringify(profile.body)).not.toContain('Automatic review');

    const wager = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('held'), bet: 100, pick: 'heads' });
    expectStatus(wager, 403);
    expect(wager.body.error.code).toBe('ACCOUNT_UNDER_REVIEW');

    const reward = await playerAgent.post('/api/rewards/claim').set(CSRF).send({});
    expectStatus(reward, 403);
    expect(reward.body.error.code).toBe('ACCOUNT_UNDER_REVIEW');

    const cashier = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 1_000 });
    expectStatus(cashier, 403);
    expect(cashier.body.error.code).toBe('ACCOUNT_UNDER_REVIEW');

    const denied = await playerAgent.get('/api/staff/account-reviews');
    expectStatus(denied, 403);

    const detail = await supportAgent.get(`/api/staff/account-reviews/${reviews.items[0]!.id}`);
    expectStatus(detail, 200);
    expect(detail.body.user.registrationIp).toBe(ip);
    expect(detail.body.relatedAccounts).toHaveLength(4);
    expect(detail.body.ipHistory[0]).toMatchObject({ ip, accounts: 4, registrations: 4 });
    expect(detail.body.events[0].action).toBe('auto_flag');
  });

  it('lets support clear legitimate households with a full review trail', async () => {
    const reviews = await reviewsFor(supportAgent);
    const open = reviews.items.filter((item) => item.status === 'open');
    expect(open).toHaveLength(4);

    const first = await supportAgent
      .post(`/api/staff/account-reviews/${open[0]!.id}/decision`)
      .set(CSRF)
      .send({ decision: 'separate_users', reason: 'Siblings on a shared home network.', applyToRelated: false });
    expectStatus(first, 200);
    expect(first.body.changed).toBe(1);
    expect(first.body.detail).toMatchObject({ status: 'cleared', accountHold: false });
    expect(first.body.detail.events.at(-1)).toMatchObject({
      action: 'decision',
      fromStatus: 'open',
      toStatus: 'cleared',
      reason: 'Siblings on a shared home network.',
    });
    expect(first.body.detail.events.at(-1).actorName).toBeTruthy();

    const releasedUser = db
      .prepare('SELECT account_hold FROM users WHERE id = ?')
      .get(first.body.detail.userId) as { account_hold: number };
    expect(releasedUser.account_hold).toBe(0);

    const remaining = (await reviewsFor(supportAgent)).items.filter((item) => item.status === 'open');
    expect(remaining).toHaveLength(3);
    const bulk = await supportAgent
      .post(`/api/staff/account-reviews/${remaining[0]!.id}/decision`)
      .set(CSRF)
      .send({ decision: 'separate_users', reason: 'Household confirmed with all residents.', applyToRelated: true });
    expectStatus(bulk, 200);
    expect(bulk.body.changed).toBe(3);

    const after = await reviewsFor(supportAgent);
    expect(after.counts).toMatchObject({ open: 0, cleared: 4, onHold: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(
        '203.0.113.10',
      ),
    ).toEqual({ count: 0 });

    const audit = db
      .prepare("SELECT action, reason FROM audit_logs WHERE action = 'account_review.decision' ORDER BY created_at DESC")
      .all() as { action: string; reason: string }[];
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((row) => row.reason === 'Household confirmed with all residents.')).toBe(true);
  });

  it('keeps holds for confirmed alt accounts until a release decision', async () => {
    const ip = '203.0.113.20';
    const group = Array.from({ length: 4 }, (_, index) => makeUser(`alt_${index}`, ip));
    expect(flagSharedIpAccounts(db, group[0]!.id, ip)).toEqual({ flagged: 4, related: 4 });

    const reviews = await reviewsFor(supportAgent);
    const altReviews = reviews.items.filter((item) => item.triggerIp === ip && item.status === 'open');
    expect(altReviews).toHaveLength(4);

    const confirmed = await supportAgent
      .post(`/api/staff/account-reviews/${altReviews[0]!.id}/decision`)
      .set(CSRF)
      .send({ decision: 'alt_account', reason: 'Same payment identity and device fingerprint.', applyToRelated: true });
    expectStatus(confirmed, 200);
    expect(confirmed.body.changed).toBe(4);

    const held = await reviewsFor(supportAgent);
    expect(held.counts).toMatchObject({ altConfirmed: 4, onHold: 4 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(ip),
    ).toEqual({ count: 4 });

    const altReview = held.items.find((item) => item.triggerIp === ip)!;
    const released = await supportAgent
      .post(`/api/staff/account-reviews/${altReview.id}/decision`)
      .set(CSRF)
      .send({ decision: 'release_hold', reason: 'Investigation closed; hold lifted.', applyToRelated: true });
    expectStatus(released, 200);

    const final = await reviewsFor(supportAgent);
    expect(final.counts).toMatchObject({ altConfirmed: 0, onHold: 0, resolved: 4 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(ip),
    ).toEqual({ count: 0 });
  });

  it('detects suspicious registrations through the real registration route', async () => {
    const previousTrustProxy = app.get('trust proxy');
    const ip = '203.0.113.60';
    app.set('trust proxy', true);
    try {
      for (let index = 0; index < 4; index += 1) {
        const username = unique('reg');
        const res = await request(app)
          .post('/api/auth/register')
          .set(CSRF)
          .set('X-Forwarded-For', ip)
          .send({
            username,
            email: `${username}@test.local`,
            password: PASSWORD,
            ageConfirmed: true,
            acceptTerms: true,
            acknowledgeDonutRules: true,
          });
        expectStatus(res, 201);
      }
    } finally {
      app.set('trust proxy', previousTrustProxy);
    }

    const rows = db.prepare('SELECT account_hold FROM users WHERE registration_ip = ?').all(ip) as {
      account_hold: number;
    }[];
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.account_hold === 1)).toBe(true);
    const reviews = db
      .prepare(
        `SELECT r.id FROM account_reviews r JOIN users u ON u.id = r.user_id
          WHERE u.registration_ip = ? AND r.status = 'open'`,
      )
      .all(ip);
    expect(reviews).toHaveLength(4);
  });

  it('uses the admin-configurable allowance for future registrations', async () => {
    const update = await ownerAgent
      .patch('/api/admin/settings/security.accounts_per_ip')
      .set(CSRF)
      .send({ value: 5 });
    expectStatus(update, 200);
    expect(update.body.value).toBe(5);

    const ip = '203.0.113.30';
    const firstFive = Array.from({ length: 5 }, (_, index) => makeUser(`lim_${index}`, ip));
    expect(flagSharedIpAccounts(db, firstFive[0]!.id, ip).flagged).toBe(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(ip),
    ).toEqual({ count: 0 });

    const sixth = makeUser('lim_5', ip);
    expect(flagSharedIpAccounts(db, sixth.id, ip)).toEqual({ flagged: 6, related: 6 });
    expect((await reviewsFor(supportAgent)).accountsPerIp).toBe(5);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND account_hold = 1').get(ip),
    ).toEqual({ count: 6 });
  });
});
