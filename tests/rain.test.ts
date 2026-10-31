import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'RainTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const STARTING = 10_000_000;

const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;

const agents: Record<string, Agent> = {};
const ids: Record<string, string> = {};

function createUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner'): string {
  const id = `usr_rain_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@rain.test`, hashPassword(PASSWORD), role, now, now);
  createWallet(db, id, STARTING, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

function walletBalance(userId: string): number {
  return (db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId) as { balance: number }).balance;
}

function ledgerTotal(userId: string): number {
  return (
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ?').get(userId) as { total: number }
  ).total;
}

function assertLedgerMatchesWallet(userId: string) {
  expect(ledgerTotal(userId)).toBe(walletBalance(userId));
}

function forceRainEnded(rainId: string) {
  db.prepare('UPDATE rain_events SET ends_at = ? WHERE id = ?').run(new Date(Date.now() - 5_000).toISOString(), rainId);
}

function rainLedgerEntries(rainId: string, userId?: string): { type: string; amount: number; user_id: string }[] {
  const where = userId ? 'AND user_id = ?' : '';
  const params = userId ? [rainId, userId] : [rainId];
  return db
    .prepare(`SELECT type, amount, user_id FROM ledger WHERE ref_type = 'rain' AND ref_id = ? ${where} ORDER BY created_at`)
    .all(...params) as { type: string; amount: number; user_id: string }[];
}

async function createRain(agent: Agent, amount: number, countdownSeconds = 30) {
  return agent.post('/api/rain').set(CSRF).send({ amount, countdownSeconds });
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  ids.owner = createUser('rainowner', 'owner');
  ids.admin = createUser('rainadmin', 'admin');
  ids.moderator = createUser('rainmoderator', 'moderator');
  ids.support = createUser('rainsupport', 'support');
  ids.creator = createUser('raincreator', 'user');
  ids.alpha = createUser('rainalpha', 'user');
  ids.beta = createUser('rainbeta', 'user');
  ids.gamma = createUser('raingamma', 'user');
  ids.delta = createUser('raindelta', 'user');

  for (const username of ['owner', 'admin', 'moderator', 'support', 'creator', 'alpha', 'beta', 'gamma', 'delta']) {
    agents[username] = await signIn(`rain${username}`);
  }
}, 30_000);

afterAll(() => {
  db.close();
});

describe('rain creation and escrow', () => {
  it('escrows the pool, exposes live state, and allows only one active rain', async () => {
    const before = walletBalance(ids.creator!);
    const created = await createRain(agents.creator!, 250_000, 30);
    expectStatus(created, 201);
    expect(created.body.rain.status).toBe('countdown');
    expect(created.body.rain.creator.id).toBe(ids.creator);
    expect(created.body.rain.creator.username).toBe('raincreator');
    expect(created.body.rain.totalAmount).toBe(250_000);
    expect(created.body.rain.participantCount).toBe(0);
    expect(created.body.rain.payoutPerParticipant).toBeNull();
    expect(created.body.rain.secondsRemaining).toBeGreaterThan(0);
    expect(created.body.rain.isCreator).toBe(true);
    expect(created.body.rain.joined).toBe(false);

    expect(walletBalance(ids.creator!)).toBe(before - 250_000);
    const escrow = rainLedgerEntries(created.body.rain.id);
    expect(escrow).toEqual([{ type: 'admin_adjustment', amount: -250_000, user_id: ids.creator }]);
    assertLedgerMatchesWallet(ids.creator!);

    // Another user cannot start a second rain while this one is live.
    const secondBefore = walletBalance(ids.alpha!);
    const duplicate = await createRain(agents.alpha!, 150_000, 30);
    expectStatus(duplicate, 409);
    expect(duplicate.body.error.code).toBe('RAIN_ACTIVE');
    expect(walletBalance(ids.alpha!)).toBe(secondBefore);
    expect(rainLedgerEntries(created.body.rain.id)).toHaveLength(1);

    const state = await agents.alpha!.get('/api/rain');
    expectStatus(state, 200);
    expect(state.body.rain.id).toBe(created.body.rain.id);
    expect(state.body.rain.joined).toBe(false);
    expect(state.body.rain.minAmount).toBe(10_000);
    expect(state.body.rain.maxAmount).toBe(5_000_000);

    // Clean up for the following tests.
    forceRainEnded(created.body.rain.id);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.rain.status).toBe('settled');
    expect(settled.body.rain.participantCount).toBe(0);
    expect(walletBalance(ids.creator!)).toBe(before);
    assertLedgerMatchesWallet(ids.creator!);
  });

  it('rejects amounts and countdowns outside the configured bounds', async () => {
    const tooSmall = await createRain(agents.alpha!, 9_999, 30);
    expectStatus(tooSmall, 400);
    expect(tooSmall.body.error.code).toBe('RAIN_AMOUNT_OUT_OF_RANGE');

    const tooLarge = await createRain(agents.alpha!, 5_000_001, 30);
    expectStatus(tooLarge, 400);
    expect(tooLarge.body.error.code).toBe('RAIN_AMOUNT_OUT_OF_RANGE');

    const tooShort = await createRain(agents.alpha!, 100_000, 9);
    expectStatus(tooShort, 400);
    const tooLong = await createRain(agents.alpha!, 100_000, 301);
    expectStatus(tooLong, 400);

    expect(walletBalance(ids.alpha!)).toBe(STARTING);
  });
});

describe('joining, leaving, and settlement', () => {
  it('joins idempotently, supports leaving, and pays every participant exactly once', async () => {
    const creatorBefore = walletBalance(ids.creator!);
    const created = await createRain(agents.creator!, 100_000, 30);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;

    const firstJoin = await agents.alpha!.post('/api/rain/join').set(CSRF).send({});
    expectStatus(firstJoin, 200);
    expect(firstJoin.body.rain.participantCount).toBe(1);
    expect(firstJoin.body.rain.joined).toBe(true);
    expect(firstJoin.body.rain.payoutPerParticipant).toBe(100_000);

    // Duplicate join is idempotent: one participant, no balance change.
    const duplicateJoin = await agents.alpha!.post('/api/rain/join').set(CSRF).send({});
    expectStatus(duplicateJoin, 200);
    expect(duplicateJoin.body.rain.participantCount).toBe(1);
    expect(walletBalance(ids.alpha!)).toBe(STARTING);

    const secondJoin = await agents.beta!.post('/api/rain/join').set(CSRF).send({});
    expectStatus(secondJoin, 200);
    expect(secondJoin.body.rain.participantCount).toBe(2);
    expect(secondJoin.body.rain.payoutPerParticipant).toBe(50_000);

    const leave = await agents.alpha!.post('/api/rain/leave').set(CSRF).send({});
    expectStatus(leave, 200);
    expect(leave.body.rain.participantCount).toBe(1);
    expect(leave.body.rain.joined).toBe(false);

    const rejoin = await agents.alpha!.post('/api/rain/join').set(CSRF).send({});
    expectStatus(rejoin, 200);
    expect(rejoin.body.rain.participantCount).toBe(2);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.rain.id).toBe(rainId);
    expect(settled.body.rain.status).toBe('settled');
    expect(settled.body.rain.participantCount).toBe(2);
    expect(settled.body.rain.payoutPerParticipant).toBe(50_000);
    expect(settled.body.rain.remainder).toBe(0);

    expect(walletBalance(ids.alpha!)).toBe(STARTING + 50_000);
    expect(walletBalance(ids.beta!)).toBe(STARTING + 50_000);
    expect(walletBalance(ids.creator!)).toBe(creatorBefore - 100_000);
    assertLedgerMatchesWallet(ids.alpha!);
    assertLedgerMatchesWallet(ids.beta!);
    assertLedgerMatchesWallet(ids.creator!);

    const payouts = rainLedgerEntries(rainId).filter((entry) => entry.amount > 0);
    expect(payouts).toHaveLength(2);
    expect(payouts.reduce((sum, entry) => sum + entry.amount, 0)).toBe(100_000);

    // A repeated read and a late join cannot settle or pay again.
    const repeated = await agents.alpha!.get('/api/rain');
    expectStatus(repeated, 200);
    expect(repeated.body.rain.status).toBe('settled');
    const lateJoin = await agents.gamma!.post('/api/rain/join').set(CSRF).send({});
    expectStatus(lateJoin, 409);
    expect(lateJoin.body.error.code).toBe('NO_ACTIVE_RAIN');
    expect(walletBalance(ids.gamma!)).toBe(STARTING);
    expect(rainLedgerEntries(rainId).filter((entry) => entry.amount > 0)).toHaveLength(2);
  });

  it('splits an indivisible pool to the last unit', async () => {
    const created = await createRain(agents.creator!, 100_001, 15);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;
    expectStatus(await agents.alpha!.post('/api/rain/join').set(CSRF).send({}), 200);
    expectStatus(await agents.beta!.post('/api/rain/join').set(CSRF).send({}), 200);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.rain.status).toBe('settled');
    expect(settled.body.rain.payoutPerParticipant).toBe(50_000);
    expect(settled.body.rain.remainder).toBe(1);

    const payouts = settled.body.rain.participants.map((participant: { payout: number }) => participant.payout);
    expect(payouts.sort((a: number, b: number) => a - b)).toEqual([50_000, 50_001]);
    expect(payouts.reduce((sum: number, value: number) => sum + value, 0)).toBe(100_001);
    assertLedgerMatchesWallet(ids.alpha!);
    assertLedgerMatchesWallet(ids.beta!);
  });

  it('refunds the entire pool when nobody joins', async () => {
    const before = walletBalance(ids.creator!);
    const created = await createRain(agents.creator!, 75_000, 10);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;
    expect(walletBalance(ids.creator!)).toBe(before - 75_000);

    forceRainEnded(rainId);
    const settled = await agents.alpha!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.rain.status).toBe('settled');
    expect(settled.body.rain.participantCount).toBe(0);
    expect(settled.body.rain.payoutPerParticipant).toBeNull();
    expect(walletBalance(ids.creator!)).toBe(before);
    assertLedgerMatchesWallet(ids.creator!);

    const refund = db
      .prepare("SELECT amount FROM ledger WHERE ref_type = 'rain' AND ref_id = ? AND type = 'credit_request'")
      .get(rainId) as { amount: number } | undefined;
    expect(refund?.amount).toBe(75_000);
  });
});

describe('concurrency and authorization', () => {
  it('lets exactly one of two simultaneous rain creations win', async () => {
    forceRainEnded((db.prepare("SELECT id FROM rain_events WHERE status = 'countdown'").get() as { id: string } | undefined)?.id ?? '');
    const alphaBefore = walletBalance(ids.alpha!);
    const deltaBefore = walletBalance(ids.delta!);
    const [first, second] = await Promise.all([
      createRain(agents.alpha!, 120_000, 30),
      createRain(agents.delta!, 120_000, 30),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const active = db.prepare("SELECT creator_id, total_amount FROM rain_events WHERE status = 'countdown'").all() as {
      creator_id: string;
      total_amount: number;
    }[];
    expect(active).toHaveLength(1);
    const alphaId = ids.alpha!;
    const deltaId = ids.delta!;
    const winnerId = active[0]!.creator_id;
    const loserId = winnerId === alphaId ? deltaId : alphaId;
    expect(walletBalance(winnerId)).toBe((winnerId === alphaId ? alphaBefore : deltaBefore) - 120_000);
    expect(walletBalance(loserId)).toBe(loserId === alphaId ? alphaBefore : deltaBefore);
  });

  it('handles simultaneous joins and a simultaneous settlement without duplicates', async () => {
    const active = db.prepare("SELECT id FROM rain_events WHERE status = 'countdown'").get() as { id: string } | undefined;
    if (active) forceRainEnded(active.id);
    await agents.owner!.get('/api/rain');

    // Payouts from earlier tests are already in these wallets, so assertions
    // below compare against a per-test baseline rather than the starting grant.
    const before = {
      alpha: walletBalance(ids.alpha!),
      beta: walletBalance(ids.beta!),
      gamma: walletBalance(ids.gamma!),
      delta: walletBalance(ids.delta!),
    };

    const created = await createRain(agents.creator!, 300_000, 30);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;

    const joins = await Promise.all([
      agents.alpha!.post('/api/rain/join').set(CSRF).send({}),
      agents.beta!.post('/api/rain/join').set(CSRF).send({}),
      agents.gamma!.post('/api/rain/join').set(CSRF).send({}),
      agents.delta!.post('/api/rain/join').set(CSRF).send({}),
    ]);
    for (const join of joins) expectStatus(join, 200);
    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM rain_participants WHERE rain_id = ?').get(rainId) as { count: number }
    ).count;
    expect(count).toBe(4);
    expect(walletBalance(ids.alpha!)).toBe(before.alpha);
    expect(walletBalance(ids.beta!)).toBe(before.beta);
    expect(walletBalance(ids.gamma!)).toBe(before.gamma);
    expect(walletBalance(ids.delta!)).toBe(before.delta);

    forceRainEnded(rainId);
    const [readOne, readTwo, lateJoin] = await Promise.all([
      agents.owner!.get('/api/rain'),
      agents.admin!.get('/api/rain'),
      agents.support!.post('/api/rain/join').set(CSRF).send({}),
    ]);
    expectStatus(readOne, 200);
    expectStatus(readTwo, 200);
    expect(lateJoin.status).toBe(409);
    expect(readOne.body.rain.status).toBe('settled');

    expect(walletBalance(ids.alpha!)).toBe(before.alpha + 75_000);
    expect(walletBalance(ids.beta!)).toBe(before.beta + 75_000);
    expect(walletBalance(ids.gamma!)).toBe(before.gamma + 75_000);
    expect(walletBalance(ids.delta!)).toBe(before.delta + 75_000);
    expect(rainLedgerEntries(rainId).filter((entry) => entry.amount > 0)).toHaveLength(4);
    for (const userId of [ids.alpha!, ids.beta!, ids.gamma!, ids.delta!]) assertLedgerMatchesWallet(userId);
  });

  it('lets moderators set the limits while players and support cannot', async () => {
    const playerDenied = await agents.alpha!.patch('/api/rain/settings').set(CSRF).send({ minAmount: 1, maxAmount: 10 });
    expectStatus(playerDenied, 403);
    const supportDenied = await agents.support!.patch('/api/rain/settings').set(CSRF).send({ minAmount: 1, maxAmount: 10 });
    expectStatus(supportDenied, 403);

    const invalid = await agents.moderator!
      .patch('/api/rain/settings')
      .set(CSRF)
      .send({ minAmount: 200_000, maxAmount: 100_000 });
    expectStatus(invalid, 400);

    const saved = await agents.moderator!
      .patch('/api/rain/settings')
      .set(CSRF)
      .send({ minAmount: 20_000, maxAmount: 2_000_000 });
    expectStatus(saved, 200);
    expect(saved.body.minAmount).toBe(20_000);
    expect(saved.body.maxAmount).toBe(2_000_000);

    const read = await agents.moderator!.get('/api/rain/settings');
    expectStatus(read, 200);
    expect(read.body.maxAmount).toBe(2_000_000);

    const tooSmall = await createRain(agents.alpha!, 19_999, 30);
    expectStatus(tooSmall, 400);
    const allowed = await createRain(agents.alpha!, 20_000, 30);
    expectStatus(allowed, 201);

    const audit = await agents.owner!.get('/api/admin/audit?action=rain.limits.update&pageSize=10');
    expectStatus(audit, 200);
    expect(audit.body.total).toBeGreaterThanOrEqual(1);
  });

  it('still settles when a participant deleted their account before the countdown ended', async () => {
    const active = db.prepare("SELECT id FROM rain_events WHERE status = 'countdown'").get() as { id: string } | undefined;
    if (active) forceRainEnded(active.id);
    await agents.owner!.get('/api/rain');

    const created = await createRain(agents.creator!, 100_000, 30);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;
    expectStatus(await agents.alpha!.post('/api/rain/join').set(CSRF).send({}), 200);
    expectStatus(await agents.beta!.post('/api/rain/join').set(CSRF).send({}), 200);

    // Account deletion removes the wallet but keeps the pseudonymous ledger
    // rows. Settlement must skip that ineligible account rather than aborting
    // every other participant's payout.
    const betaBefore = walletBalance(ids.beta!);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(ids.alpha);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.rain.status).toBe('settled');
    expect(settled.body.rain.participantCount).toBe(1);
    expect(settled.body.rain.payoutPerParticipant).toBe(100_000);
    expect(walletBalance(ids.beta!)).toBe(betaBefore + 100_000);
    assertLedgerMatchesWallet(ids.beta!);
  });

  it('exposes history to rain managers only and keeps a read-only record', async () => {
    const active = db.prepare("SELECT id FROM rain_events WHERE status = 'countdown'").get() as { id: string } | undefined;
    if (active) forceRainEnded(active.id);
    await agents.owner!.get('/api/rain');

    const denied = await agents.gamma!.get('/api/rain/history');
    expectStatus(denied, 403);

    const history = await agents.moderator!.get('/api/rain/history?limit=5');
    expectStatus(history, 200);
    expect(history.body.items.length).toBeGreaterThan(0);
    expect(history.body.items.every((item: { status: string }) => item.status === 'settled')).toBe(true);
  });
});
