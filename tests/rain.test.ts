import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { migrate } from '../server/db/schema.ts';
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

function forceAllRainsEnded() {
  db.prepare("UPDATE rain_events SET ends_at = ? WHERE status = 'countdown'").run(
    new Date(Date.now() - 5_000).toISOString(),
  );
}

async function resetRains(agent: Agent) {
  forceAllRainsEnded();
  const response = await agent.get('/api/rain');
  expectStatus(response, 200);
  expect(response.body.active).toEqual([]);
}

function joinRain(agent: Agent, rainId: string) {
  return agent.post(`/api/rain/${rainId}/join`).set(CSRF).send({});
}

function leaveRain(agent: Agent, rainId: string) {
  return agent.post(`/api/rain/${rainId}/leave`).set(CSRF).send({});
}

function rainLedgerEntries(rainId: string, userId?: string): { type: string; amount: number; user_id: string }[] {
  const where = userId ? 'AND user_id = ?' : '';
  const params = userId ? [rainId, userId] : [rainId];
  return db
    .prepare(`SELECT type, amount, user_id FROM ledger WHERE ref_type = 'rain' AND ref_id = ? ${where} ORDER BY created_at`)
    .all(...params) as { type: string; amount: number; user_id: string }[];
}

function rainRow(rainId: string): { status: string; participant_count: number; refunded_amount: number } | undefined {
  return db
    .prepare('SELECT status, participant_count, refunded_amount FROM rain_events WHERE id = ?')
    .get(rainId) as { status: string; participant_count: number; refunded_amount: number } | undefined;
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
  beforeEach(async () => {
    await resetRains(agents.owner!);
  });

  it('lets everyone fund an independent rain and exposes every live pool', async () => {
    const creatorBefore = walletBalance(ids.creator!);
    const alphaBefore = walletBalance(ids.alpha!);
    const betaBefore = walletBalance(ids.beta!);

    const first = await createRain(agents.creator!, 250_000, 30);
    expectStatus(first, 201);
    expect(first.body.rain.status).toBe('countdown');
    expect(first.body.rain.creator.id).toBe(ids.creator);
    expect(first.body.rain.creator.username).toBe('raincreator');
    expect(first.body.rain.totalAmount).toBe(250_000);
    expect(first.body.rain.participantCount).toBe(0);
    expect(first.body.rain.payoutPerParticipant).toBeNull();
    expect(first.body.rain.secondsRemaining).toBeGreaterThan(0);
    expect(first.body.rain.isCreator).toBe(true);
    expect(first.body.rain.joined).toBe(false);

    const second = await createRain(agents.alpha!, 150_000, 45);
    expectStatus(second, 201);
    expect(second.body.rain.creator.id).toBe(ids.alpha);
    expect(second.body.rain.isCreator).toBe(true);

    const firstId = first.body.rain.id as string;
    const secondId = second.body.rain.id as string;
    expect(firstId).not.toBe(secondId);

    expect(walletBalance(ids.creator!)).toBe(creatorBefore - 250_000);
    expect(first.body.balance).toBe(creatorBefore - 250_000);
    expect(walletBalance(ids.alpha!)).toBe(alphaBefore - 150_000);
    expect(second.body.balance).toBe(alphaBefore - 150_000);
    expect(rainLedgerEntries(firstId)).toEqual([
      { type: 'admin_adjustment', amount: -250_000, user_id: ids.creator },
    ]);
    expect(rainLedgerEntries(secondId)).toEqual([
      { type: 'admin_adjustment', amount: -150_000, user_id: ids.alpha },
    ]);
    assertLedgerMatchesWallet(ids.creator!);
    assertLedgerMatchesWallet(ids.alpha!);

    // A creator already funded the whole pool; joining would pay part of it back.
    const selfJoin = await joinRain(agents.creator!, firstId);
    expectStatus(selfJoin, 409);
    expect(selfJoin.body.error.code).toBe('RAIN_SELF_JOIN');
    expect(walletBalance(ids.creator!)).toBe(creatorBefore - 250_000);

    // A third player can join either live rain, and the pools stay separate.
    const firstJoin = await joinRain(agents.beta!, firstId);
    expectStatus(firstJoin, 200);
    expect(firstJoin.body.rain.participantCount).toBe(1);
    expect(firstJoin.body.rain.payoutPerParticipant).toBe(250_000);

    const secondJoin = await joinRain(agents.beta!, secondId);
    expectStatus(secondJoin, 200);
    expect(secondJoin.body.rain.participantCount).toBe(1);
    expect(secondJoin.body.rain.payoutPerParticipant).toBe(150_000);

    const state = await agents.creator!.get('/api/rain');
    expectStatus(state, 200);
    expect(state.body.active).toHaveLength(2);
    expect(state.body.active.map((entry: { id: string }) => entry.id)).toEqual([firstId, secondId]);
    expect(state.body.rain.id).toBe(firstId);
    expect(state.body.rain.minAmount).toBe(10_000);
    expect(state.body.rain.maxAmount).toBe(5_000_000);
    expect(state.body.rain.isCreator).toBe(true);
    expect(state.body.active[1].isCreator).toBe(false);
    expect(state.body.latest).toBeNull();

    forceRainEnded(firstId);
    forceRainEnded(secondId);
    const settled = await agents.beta!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.active).toEqual([]);
    expect(settled.body.latest.id).toBe(secondId);
    expect(settled.body.latest.status).toBe('settled');
    expect(settled.body.latest.participantCount).toBe(1);
    expect(settled.body.latest.payoutPerParticipant).toBe(150_000);

    expect(rainRow(firstId)?.status).toBe('settled');
    expect(rainRow(secondId)?.status).toBe('settled');
    expect(rainRow(firstId)?.refunded_amount).toBe(0);
    expect(rainRow(secondId)?.refunded_amount).toBe(0);

    expect(walletBalance(ids.creator!)).toBe(creatorBefore - 250_000);
    expect(walletBalance(ids.alpha!)).toBe(alphaBefore - 150_000);
    expect(walletBalance(ids.beta!)).toBe(betaBefore + 400_000);
    expect(
      rainLedgerEntries(firstId)
        .filter((entry) => entry.amount > 0)
        .reduce((sum, entry) => sum + entry.amount, 0),
    ).toBe(250_000);
    expect(
      rainLedgerEntries(secondId)
        .filter((entry) => entry.amount > 0)
        .reduce((sum, entry) => sum + entry.amount, 0),
    ).toBe(150_000);
    for (const userId of [ids.creator!, ids.alpha!, ids.beta!]) assertLedgerMatchesWallet(userId);
  });

  it('rejects amounts and countdowns outside the configured bounds', async () => {
    const alphaBefore = walletBalance(ids.alpha!);
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

    expect(walletBalance(ids.alpha!)).toBe(alphaBefore);
  });
});

describe('joining, leaving, and settlement', () => {
  beforeEach(async () => {
    await resetRains(agents.owner!);
  });

  it('joins one specific rain idempotently, supports leaving, and pays every participant exactly once', async () => {
    const creatorBefore = walletBalance(ids.creator!);
    const alphaBefore = walletBalance(ids.alpha!);
    const betaBefore = walletBalance(ids.beta!);
    const gammaBefore = walletBalance(ids.gamma!);
    const created = await createRain(agents.creator!, 100_000, 30);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;

    const firstJoin = await joinRain(agents.alpha!, rainId);
    expectStatus(firstJoin, 200);
    expect(firstJoin.body.rain.participantCount).toBe(1);
    expect(firstJoin.body.rain.joined).toBe(true);
    expect(firstJoin.body.rain.payoutPerParticipant).toBe(100_000);

    // Duplicate join is idempotent: one participant, no balance change.
    const duplicateJoin = await joinRain(agents.alpha!, rainId);
    expectStatus(duplicateJoin, 200);
    expect(duplicateJoin.body.rain.participantCount).toBe(1);
    expect(walletBalance(ids.alpha!)).toBe(alphaBefore);

    const secondJoin = await joinRain(agents.beta!, rainId);
    expectStatus(secondJoin, 200);
    expect(secondJoin.body.rain.participantCount).toBe(2);
    expect(secondJoin.body.rain.payoutPerParticipant).toBe(50_000);

    const leave = await leaveRain(agents.alpha!, rainId);
    expectStatus(leave, 200);
    expect(leave.body.rain.participantCount).toBe(1);
    expect(leave.body.rain.joined).toBe(false);

    const rejoin = await joinRain(agents.alpha!, rainId);
    expectStatus(rejoin, 200);
    expect(rejoin.body.rain.participantCount).toBe(2);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.active).toEqual([]);
    expect(settled.body.latest.id).toBe(rainId);
    expect(settled.body.latest.status).toBe('settled');
    expect(settled.body.latest.participantCount).toBe(2);
    expect(settled.body.latest.payoutPerParticipant).toBe(50_000);
    expect(settled.body.latest.remainder).toBe(0);

    expect(walletBalance(ids.alpha!)).toBe(alphaBefore + 50_000);
    expect(walletBalance(ids.beta!)).toBe(betaBefore + 50_000);
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
    expect(repeated.body.latest.status).toBe('settled');
    const lateJoin = await joinRain(agents.gamma!, rainId);
    expectStatus(lateJoin, 409);
    expect(lateJoin.body.error.code).toBe('RAIN_ENDED');
    expect(walletBalance(ids.gamma!)).toBe(gammaBefore);
    expect(rainLedgerEntries(rainId).filter((entry) => entry.amount > 0)).toHaveLength(2);
  });

  it('splits an indivisible pool to the last unit', async () => {
    const created = await createRain(agents.creator!, 100_001, 15);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;
    expectStatus(await joinRain(agents.alpha!, rainId), 200);
    expectStatus(await joinRain(agents.beta!, rainId), 200);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.latest.id).toBe(rainId);
    expect(settled.body.latest.status).toBe('settled');
    expect(settled.body.latest.payoutPerParticipant).toBe(50_000);
    expect(settled.body.latest.remainder).toBe(1);

    const payouts = settled.body.latest.participants.map((participant: { payout: number }) => participant.payout);
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
    expect(settled.body.latest.id).toBe(rainId);
    expect(settled.body.latest.status).toBe('settled');
    expect(settled.body.latest.participantCount).toBe(0);
    expect(settled.body.latest.payoutPerParticipant).toBeNull();
    expect(walletBalance(ids.creator!)).toBe(before);
    assertLedgerMatchesWallet(ids.creator!);

    const refund = db
      .prepare("SELECT amount FROM ledger WHERE ref_type = 'rain' AND ref_id = ? AND type = 'credit_request'")
      .get(rainId) as { amount: number } | undefined;
    expect(refund?.amount).toBe(75_000);
  });
});

describe('concurrent rains and authorization', () => {
  beforeEach(async () => {
    await resetRains(agents.owner!);
  });

  it('accepts two simultaneous creations and refunds each unsettled pool', async () => {
    const alphaBefore = walletBalance(ids.alpha!);
    const deltaBefore = walletBalance(ids.delta!);
    const [first, second] = await Promise.all([
      createRain(agents.alpha!, 120_000, 45),
      createRain(agents.delta!, 90_000, 30),
    ]);
    expectStatus(first, 201);
    expectStatus(second, 201);

    const active = db.prepare("SELECT id, creator_id FROM rain_events WHERE status = 'countdown'").all() as {
      id: string;
      creator_id: string;
    }[];
    expect(active).toHaveLength(2);
    expect(active.map((row) => row.creator_id).sort()).toEqual([ids.alpha, ids.delta].sort());
    expect(walletBalance(ids.alpha!)).toBe(alphaBefore - 120_000);
    expect(walletBalance(ids.delta!)).toBe(deltaBefore - 90_000);

    forceAllRainsEnded();
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.active).toEqual([]);

    expect(walletBalance(ids.alpha!)).toBe(alphaBefore);
    expect(walletBalance(ids.delta!)).toBe(deltaBefore);
    expect(rainRow(first.body.rain.id)?.refunded_amount).toBe(120_000);
    expect(rainRow(second.body.rain.id)?.refunded_amount).toBe(90_000);
    assertLedgerMatchesWallet(ids.alpha!);
    assertLedgerMatchesWallet(ids.delta!);
  });

  it('keeps joins and settlement isolated between concurrent rains', async () => {
    const creatorBefore = walletBalance(ids.creator!);
    const alphaBefore = walletBalance(ids.alpha!);
    const betaBefore = walletBalance(ids.beta!);
    const gammaBefore = walletBalance(ids.gamma!);
    const deltaBefore = walletBalance(ids.delta!);

    const first = await createRain(agents.creator!, 120_000, 60);
    const second = await createRain(agents.alpha!, 80_000, 30);
    expectStatus(first, 201);
    expectStatus(second, 201);
    const firstId = first.body.rain.id as string;
    const secondId = second.body.rain.id as string;

    expectStatus(await joinRain(agents.beta!, firstId), 200);
    expectStatus(await joinRain(agents.gamma!, secondId), 200);
    expectStatus(await joinRain(agents.delta!, firstId), 200);
    expectStatus(await joinRain(agents.delta!, secondId), 200);

    const overview = await agents.delta!.get('/api/rain');
    expectStatus(overview, 200);
    expect(overview.body.active).toHaveLength(2);
    const firstView = overview.body.active.find((entry: { id: string }) => entry.id === firstId);
    const secondView = overview.body.active.find((entry: { id: string }) => entry.id === secondId);
    expect(firstView.participantCount).toBe(2);
    expect(secondView.participantCount).toBe(2);
    expect(firstView.joined).toBe(true);
    expect(secondView.joined).toBe(true);

    const left = await leaveRain(agents.delta!, firstId);
    expectStatus(left, 200);
    expect(left.body.rain.participantCount).toBe(1);
    const stillJoined = await agents.delta!.get('/api/rain');
    expect(
      stillJoined.body.active.find((entry: { id: string }) => entry.id === secondId).joined,
    ).toBe(true);

    forceAllRainsEnded();
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.active).toEqual([]);

    expect(rainRow(firstId)?.participant_count).toBe(1);
    expect(rainRow(secondId)?.participant_count).toBe(2);
    expect(walletBalance(ids.creator!)).toBe(creatorBefore - 120_000);
    expect(walletBalance(ids.alpha!)).toBe(alphaBefore - 80_000);
    expect(walletBalance(ids.beta!)).toBe(betaBefore + 120_000);
    expect(walletBalance(ids.gamma!)).toBe(gammaBefore + 40_000);
    expect(walletBalance(ids.delta!)).toBe(deltaBefore + 40_000);
    for (const userId of [ids.creator!, ids.alpha!, ids.beta!, ids.gamma!, ids.delta!]) {
      assertLedgerMatchesWallet(userId);
    }
  });

  it('handles simultaneous joins and a simultaneous settlement without duplicates', async () => {
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
      joinRain(agents.alpha!, rainId),
      joinRain(agents.beta!, rainId),
      joinRain(agents.gamma!, rainId),
      joinRain(agents.delta!, rainId),
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
      joinRain(agents.support!, rainId),
    ]);
    expectStatus(readOne, 200);
    expectStatus(readTwo, 200);
    expectStatus(lateJoin, 409);
    expect(lateJoin.body.error.code).toBe('RAIN_ENDED');
    expect(readOne.body.latest.id).toBe(rainId);
    expect(readOne.body.latest.status).toBe('settled');

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
    const created = await createRain(agents.creator!, 100_000, 30);
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;
    expectStatus(await joinRain(agents.alpha!, rainId), 200);
    expectStatus(await joinRain(agents.beta!, rainId), 200);

    // Account deletion removes the wallet but keeps the pseudonymous ledger
    // rows. Settlement must skip that ineligible account rather than aborting
    // every other participant's payout.
    const betaBefore = walletBalance(ids.beta!);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(ids.alpha);

    forceRainEnded(rainId);
    const settled = await agents.owner!.get('/api/rain');
    expectStatus(settled, 200);
    expect(settled.body.latest.id).toBe(rainId);
    expect(settled.body.latest.status).toBe('settled');
    expect(settled.body.latest.participantCount).toBe(1);
    expect(settled.body.latest.payoutPerParticipant).toBe(100_000);
    expect(walletBalance(ids.beta!)).toBe(betaBefore + 100_000);
    assertLedgerMatchesWallet(ids.beta!);
  });

  it('repairs a database that applied the original rain migration without the refund column', () => {
    const drifted = createDatabase(':memory:');
    try {
      drifted.exec('ALTER TABLE rain_events DROP COLUMN refunded_amount');
      drifted.prepare('DELETE FROM schema_migrations WHERE version = 17').run();
      expect(
        (drifted.prepare('PRAGMA table_info(rain_events)').all() as { name: string }[]).map((column) => column.name),
      ).not.toContain('refunded_amount');

      migrate(drifted);

      expect(
        (drifted.prepare('PRAGMA table_info(rain_events)').all() as { name: string }[]).map((column) => column.name),
      ).toContain('refunded_amount');
      expect(
        drifted.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 17').get(),
      ).toEqual({ count: 1 });
    } finally {
      drifted.close();
    }
  });

  it('exposes history to rain managers only and keeps a read-only record', async () => {
    const created = await createRain(agents.creator!, 30_000, 30);
    expectStatus(created, 201);
    forceRainEnded(created.body.rain.id);
    expectStatus(await agents.owner!.get('/api/rain'), 200);

    const denied = await agents.gamma!.get('/api/rain/history');
    expectStatus(denied, 403);

    const history = await agents.moderator!.get('/api/rain/history?limit=5');
    expectStatus(history, 200);
    expect(history.body.items.length).toBeGreaterThan(0);
    expect(history.body.items.every((item: { status: string }) => item.status === 'settled')).toBe(true);
  });
});
