import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'ResetStats!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let ownerAgent: Agent;
let adminAgent: Agent;
let moderatorAgent: Agent;
let supportAgent: Agent;
let playerAgent: Agent;
let playerId: string;
let roundSeq = 0;

function createUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner'): string {
  const id = `usr_reset_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@reset.test`, hashPassword(PASSWORD), role, now, now);
  createWallet(db, id, role === 'user' ? 2_000_000 : 0, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

function insertRound(bet: number, payout: number, status: 'won' | 'lost' = 'lost'): string {
  roundSeq += 1;
  const id = `gs_reset_${roundSeq}`;
  const at = new Date(Date.now() - roundSeq * 1000).toISOString();
  db.prepare(
    `INSERT INTO game_sessions
       (id, user_id, game_id, bet, status, payout, state, outcome, idempotency_key, wager_ledger_id,
        payout_ledger_id, config_snapshot, configured_win_chance, created_at, ended_at)
     VALUES (?, ?, 'coinflip', ?, ?, ?, '{}', NULL, ?, NULL, NULL, ?, 50, ?, ?)`,
  ).run(id, playerId, bet, status, payout, `${id}_key`, JSON.stringify({ winChance: 50 }), at, at);
  return id;
}

function financialSnapshot() {
  return {
    sessions: (db.prepare('SELECT COUNT(*) AS count FROM game_sessions').get() as { count: number }).count,
    ledger: (db.prepare('SELECT COUNT(*) AS count FROM ledger').get() as { count: number }).count,
    ledgerSum: (db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM ledger').get() as { total: number }).total,
    balance: (db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(playerId) as { balance: number }).balance,
  };
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  createUser('resetowner', 'owner');
  createUser('resetadmin', 'admin');
  createUser('resetmod', 'moderator');
  createUser('resetsupport', 'support');
  playerId = createUser('resetplayer', 'user');

  ownerAgent = await signIn('resetowner');
  adminAgent = await signIn('resetadmin');
  moderatorAgent = await signIn('resetmod');
  supportAgent = await signIn('resetsupport');
  playerAgent = await signIn('resetplayer');

  insertRound(100, 0, 'lost');
  insertRound(200, 392, 'won');
  insertRound(50, 0, 'lost');
}, 30_000);

afterAll(() => {
  db.close();
});

describe('game statistics reset', () => {
  it('only lets game administrators reset and records the action', async () => {
    const player = await playerAgent.post('/api/staff/game-stats/reset').set(CSRF).send({});
    expectStatus(player, 403);
    const support = await supportAgent.post('/api/staff/game-stats/reset').set(CSRF).send({});
    expectStatus(support, 403);
    const moderator = await moderatorAgent.post('/api/staff/game-stats/reset').set(CSRF).send({});
    expectStatus(moderator, 403);

    const before = financialSnapshot();
    const beforeStats = await adminAgent.get('/api/staff/game-stats?range=all');
    expectStatus(beforeStats, 200);
    expect(beforeStats.body.totals.bets).toBe(3);
    expect(beforeStats.body.statsSince).toBeNull();

    const resetAt = new Date().toISOString();
    const reset = await adminAgent.post('/api/staff/game-stats/reset').set(CSRF).send({});
    expectStatus(reset, 200);
    expect(reset.body.statsSince >= resetAt).toBe(true);

    // Financial records are untouched: same sessions, ledger rows, ledger sum
    // and wallet balance. Only the reporting cutoff moved.
    expect(financialSnapshot()).toEqual(before);

    const afterStats = await adminAgent.get('/api/staff/game-stats?range=all');
    expectStatus(afterStats, 200);
    expect(afterStats.body.statsSince).toBe(reset.body.statsSince);
    expect(afterStats.body.totals.bets).toBe(0);
    expect(afterStats.body.totals.wagered).toBe(0);
    expect(afterStats.body.games.every((game: { bets: number }) => game.bets === 0)).toBe(true);

    const detail = await adminAgent.get('/api/staff/game-stats/coinflip?range=all');
    expectStatus(detail, 200);
    expect(detail.body.game.bets).toBe(0);
    expect(detail.body.trend.every((point: { bets: number }) => point.bets === 0)).toBe(true);
    expect(detail.body.statsSince).toBe(reset.body.statsSince);

    const audit = await ownerAgent.get('/api/admin/audit?action=game_stats.reset&pageSize=10');
    expectStatus(audit, 200);
    expect(audit.body.total).toBeGreaterThanOrEqual(1);

    const transactions = await playerAgent.get('/api/me/transactions?pageSize=50');
    expectStatus(transactions, 200);
    expect(transactions.body.total).toBeGreaterThanOrEqual(1);
    expect(transactions.body.balance).toBe(financialSnapshot().balance);
  });

  it('starts counting new rounds after the reset without restoring old ones', async () => {
    const before = financialSnapshot();
    const play = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: `reset_round_${Date.now()}`, bet: 100, pick: 'heads' });
    expectStatus(play, 201);
    const ack = await playerAgent
      .post(`/api/games/sessions/${play.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);

    const stats = await adminAgent.get('/api/staff/game-stats?range=all');
    expectStatus(stats, 200);
    expect(stats.body.totals.bets).toBe(1);
    expect(stats.body.totals.wagered).toBe(100);
    expect(stats.body.games.find((game: { slug: string }) => game.slug === 'coinflip').bets).toBe(1);

    const after = financialSnapshot();
    expect(after.sessions).toBe(before.sessions + 1);
    expect(after.ledger).toBeGreaterThan(before.ledger);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM wallets w WHERE w.user_id = ?
             AND w.balance <> (SELECT COALESCE(SUM(amount),0) FROM ledger l WHERE l.user_id = w.user_id)`,
        )
        .get(playerId),
    ).toEqual({ count: 0 });
  });

  it('moves the cutoff again when reset a second time', async () => {
    const first = await adminAgent.get('/api/staff/game-stats?range=all');
    const reset = await ownerAgent.post('/api/staff/game-stats/reset').set(CSRF).send({});
    expectStatus(reset, 200);
    expect(reset.body.statsSince).not.toBe(first.body.statsSince);

    const stats = await adminAgent.get('/api/staff/game-stats?range=all');
    expect(stats.body.totals.bets).toBe(0);
    expect(stats.body.statsSince).toBe(reset.body.statsSince);
  });
});
