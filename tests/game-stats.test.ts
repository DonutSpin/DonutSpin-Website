import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { evaluateDeviation, wilsonInterval } from '../server/lib/game-stats.ts';
import { resolveCoinflip } from '../server/games/instant.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'AurumStats!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let dir: string;
let file: string;
let db: DB;
let app: ReturnType<typeof createApp>;

let ownerAgent: Agent;
let adminAgent: Agent;
let supportAgent: Agent;
let moderatorAgent: Agent;
let playerAgent: Agent;
let playerTwoAgent: Agent;

let playerId: string;
let playerTwoId: string;
let roundSeq = 0;

function createUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner'): string {
  const id = `usr_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@test.local`, hashPassword(PASSWORD), role, now, now);
  createWallet(db, id, 10_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

function insertRound(input: {
  game?: string;
  bet: number;
  payout: number;
  status: 'active' | 'won' | 'lost' | 'push';
  chance?: number | null;
  endedAt?: string | null;
  userId?: string;
}): string {
  roundSeq += 1;
  const id = `gs_stats_${roundSeq}`;
  const at = input.endedAt === undefined ? new Date().toISOString() : input.endedAt;
  const chance = input.chance === undefined ? 45 : input.chance;
  db.prepare(
    `INSERT INTO game_sessions
       (id, user_id, game_id, bet, status, payout, state, outcome, idempotency_key, wager_ledger_id,
        payout_ledger_id, config_snapshot, configured_win_chance, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', NULL, ?, NULL, NULL, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId ?? playerId,
    input.game ?? 'mines',
    input.bet,
    input.status,
    input.payout,
    `${id}_key`,
    chance === null ? null : JSON.stringify({ winChance: chance }),
    chance,
    at ?? new Date().toISOString(),
    input.status === 'active' ? null : at,
  );
  return id;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'donutspin-game-stats-'));
  file = path.join(dir, 'app.db');
  db = createDatabase(file);
  app = createApp(db);

  createUser('statsowner', 'owner');
  createUser('statsadmin', 'admin');
  createUser('statssupport', 'support');
  createUser('statsmod', 'moderator');
  playerId = createUser('statsplayer', 'user');
  playerTwoId = createUser('statsplayer2', 'user');

  ownerAgent = await signIn('statsowner');
  adminAgent = await signIn('statsadmin');
  supportAgent = await signIn('statssupport');
  moderatorAgent = await signIn('statsmod');
  playerAgent = await signIn('statsplayer');
  playerTwoAgent = await signIn('statsplayer2');
});

afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('statistics permissions and configuration', () => {
  it('allows staff to read statistics and denies players', async () => {
    const denied = await playerAgent.get('/api/staff/game-stats');
    expectStatus(denied, 403);

    const support = await supportAgent.get('/api/staff/game-stats?range=30d');
    expectStatus(support, 200);
    expect(support.body.games).toHaveLength(6);
    expect(support.body.minimumSample).toBe(50);
    expect(support.body.games.map((game: { slug: string }) => game.slug).sort()).toEqual([
      'blackjack',
      'coinflip',
      'mines',
      'plinko',
      'roulette',
      'towers',
    ]);

    const moderator = await moderatorAgent.get('/api/staff/game-stats?range=7d');
    expectStatus(moderator, 200);
  });

  it('only lets administrators change a win chance', async () => {
    const moderator = await moderatorAgent
      .patch('/api/admin/games/coinflip/win-chance')
      .set(CSRF)
      .send({ winChance: 35 });
    expectStatus(moderator, 403);

    const support = await supportAgent
      .patch('/api/admin/games/coinflip/win-chance')
      .set(CSRF)
      .send({ winChance: 35 });
    expectStatus(support, 403);

    const before = await adminAgent.get('/api/admin/games');
    expectStatus(before, 200);
    const initial = before.body.games.find((game: { slug: string }) => game.slug === 'coinflip');
    expect(initial.config.winChance).toBe(50);

    const missingReason = await adminAgent
      .patch('/api/admin/games/coinflip/win-chance')
      .set(CSRF)
      .send({ winChance: 37.5 });
    expectStatus(missingReason, 200);
    expect(missingReason.body.game.config.winChance).toBe(37.5);

    const history = await adminAgent.get('/api/admin/games/coinflip/history');
    expectStatus(history, 200);
    expect(history.body.history[0]).toMatchObject({
      actorName: 'statsadmin',
      previousWinChance: 50,
      newWinChance: 37.5,
      changedKeys: ['winChance'],
    });

    const audit = await adminAgent.get('/api/admin/audit?pageSize=100');
    expectStatus(audit, 200);
    const entry = audit.body.items.find((item: { action: string }) => item.action === 'game.win_chance.update');
    expect(entry).toBeTruthy();
    expect(entry.targetLabel).toBe('Coinflip');
    expect(entry.metadata.previousWinChance).toBe(50);
    expect(entry.metadata.newWinChance).toBe(37.5);
  });

  it('rejects invalid chances server-side and leaves the stored value intact', async () => {
    for (const value of [0, 100, -5, 12.345, '45']) {
      const res = await adminAgent
        .patch('/api/admin/games/coinflip/win-chance')
        .set(CSRF)
        .send({ winChance: value });
      expectStatus(res, 400);
    }

    const games = await adminAgent.get('/api/admin/games');
    expectStatus(games, 200);
    const coinflip = games.body.games.find((game: { slug: string }) => game.slug === 'coinflip');
    expect(coinflip.config.winChance).toBe(37.5);

    const unknown = await adminAgent
      .patch('/api/admin/games/not-a-game/win-chance')
      .set(CSRF)
      .send({ winChance: 35 });
    expectStatus(unknown, 404);
  });
});

describe('round snapshots and configuration history', () => {
  it('records the configuration on new rounds and never rewrites older rounds', async () => {
    const setOne = await adminAgent
      .patch('/api/admin/games/coinflip/win-chance')
      .set(CSRF)
      .send({ winChance: 41.25, reason: 'Baseline experiment' });
    expectStatus(setOne, 200);

    const first = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('snap-a'), bet: 10, pick: 'heads' });
    expectStatus(first, 201);
    const firstRow = db
      .prepare('SELECT config_snapshot, configured_win_chance FROM game_sessions WHERE id = ?')
      .get(first.body.session.id) as { config_snapshot: string; configured_win_chance: number };
    expect(JSON.parse(firstRow.config_snapshot).winChance).toBe(41.25);
    expect(firstRow.configured_win_chance).toBe(41.25);

    const setTwo = await adminAgent
      .patch('/api/admin/games/coinflip/win-chance')
      .set(CSRF)
      .send({ winChance: 73.5 });
    expectStatus(setTwo, 200);

    const second = await playerTwoAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('snap-b'), bet: 10, pick: 'tails' });
    expectStatus(second, 201);
    const secondRow = db
      .prepare('SELECT config_snapshot, configured_win_chance FROM game_sessions WHERE id = ?')
      .get(second.body.session.id) as { config_snapshot: string; configured_win_chance: number };
    expect(JSON.parse(secondRow.config_snapshot).winChance).toBe(73.5);
    expect(secondRow.configured_win_chance).toBe(73.5);

    const oldRow = db
      .prepare('SELECT config_snapshot, configured_win_chance FROM game_sessions WHERE id = ?')
      .get(first.body.session.id) as { config_snapshot: string; configured_win_chance: number };
    expect(JSON.parse(oldRow.config_snapshot).winChance).toBe(41.25);
    expect(oldRow.configured_win_chance).toBe(41.25);
  });

  it('preserves the chance when a generic configuration update omits it', async () => {
    const update = await adminAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: 1, maxBet: 10000, config: { winMultiplier: 1.8 } });
    expectStatus(update, 200);
    expect(update.body.game.config.winChance).toBe(73.5);
    expect(update.body.game.config.winMultiplier).toBe(1.8);

    const history = await adminAgent.get('/api/admin/games/coinflip/history?limit=10');
    expectStatus(history, 200);
    const ruleChange = history.body.history.find(
      (entry: { changedKeys: string[] }) =>
        entry.changedKeys.includes('winMultiplier') && !entry.changedKeys.includes('winChance'),
    );
    expect(ruleChange).toBeTruthy();
    expect(ruleChange.previousWinChance).toBe(73.5);
    expect(ruleChange.newWinChance).toBe(73.5);
  });

  it('returns history only to game administrators', async () => {
    const support = await supportAgent.get('/api/admin/games/coinflip/history');
    expectStatus(support, 403);
    const moderator = await moderatorAgent.get('/api/admin/games/coinflip/history');
    expectStatus(moderator, 403);
    const admin = await adminAgent.get('/api/admin/games/coinflip/history');
    expectStatus(admin, 200);
  });
});

describe('real statistics and trends', () => {
  it('calculates wins, losses, pushes, house profit and date ranges from settled rows', async () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    insertRound({ bet: 1000, payout: 2000, status: 'won', chance: 40 });
    insertRound({ bet: 500, payout: 0, status: 'lost', chance: 40 });
    insertRound({ bet: 300, payout: 300, status: 'push', chance: 40 });
    insertRound({ bet: 100, payout: 250, status: 'won', chance: 60, endedAt: old });
    insertRound({ bet: 400, payout: 0, status: 'active', chance: 40, endedAt: null });

    const month = await supportAgent.get('/api/staff/game-stats?range=30d&q=mines&sort=name&direction=asc');
    expectStatus(month, 200);
    const row = month.body.games.find((game: { slug: string }) => game.slug === 'mines');
    expect(row).toMatchObject({
      bets: 4,
      wins: 2,
      losses: 1,
      pushes: 1,
      wagered: 1900,
      payouts: 2550,
      houseProfit: -650,
      comparisonSample: 3,
      openRounds: 1,
    });
    expect(row.actualWinRate).toBeCloseTo(66.67, 1);
    expect(row.comparisonWinRate).toBeCloseTo(66.67, 1);
    expect(row.averageConfiguredWinChance).toBe(45);
    expect(row.rtp).toBeCloseTo(134.21, 1);
    expect(month.body.totals.bets).toBe(4);
    expect(month.body.totals.houseProfit).toBe(-650);

    const day = await supportAgent.get('/api/staff/game-stats?range=24h&q=mines');
    expectStatus(day, 200);
    const dayRow = day.body.games.find((game: { slug: string }) => game.slug === 'mines');
    expect(dayRow).toMatchObject({ bets: 3, wins: 1, losses: 1, pushes: 1, wagered: 1800, payouts: 2300 });
    expect(dayRow.actualWinRate).toBe(50);
    expect(dayRow.averageConfiguredWinChance).toBe(40);

    const all = await supportAgent.get('/api/staff/game-stats?range=all&q=mines');
    expectStatus(all, 200);
    expect(all.body.games[0].bets).toBe(4);
    expect(all.body.from).toBeNull();

    const week = await supportAgent.get('/api/staff/game-stats?range=7d&q=mines');
    expectStatus(week, 200);
    expect(week.body.games[0].bets).toBe(3);

    const empty = await supportAgent.get('/api/staff/game-stats?range=30d&q=zzzz-no-game');
    expectStatus(empty, 200);
    expect(empty.body.games).toEqual([]);
    expect(empty.body.totals.bets).toBe(0);
  });

  it('returns historical buckets and configuration history for an individual game', async () => {
    const detail = await supportAgent.get('/api/staff/game-stats/mines?range=30d');
    expectStatus(detail, 200);
    expect(detail.body.game.slug).toBe('mines');
    expect(detail.body.trend.length).toBe(30);
    const activeBuckets = detail.body.trend.filter((point: { bets: number }) => point.bets > 0);
    expect(activeBuckets.length).toBeGreaterThanOrEqual(1);
    const totals = activeBuckets.reduce(
      (acc: { bets: number; wagered: number; payouts: number }, point: { bets: number; wagered: number; payouts: number }) => ({
        bets: acc.bets + point.bets,
        wagered: acc.wagered + point.wagered,
        payouts: acc.payouts + point.payouts,
      }),
      { bets: 0, wagered: 0, payouts: 0 },
    );
    expect(totals).toEqual({ bets: 4, wagered: 1900, payouts: 2550 });
    expect(detail.body.trend.some((point: { houseProfit: number }) => point.houseProfit !== 0)).toBe(true);
    expect(detail.body.history).toEqual([]);

    const missing = await supportAgent.get('/api/staff/game-stats/not-a-game?range=30d');
    expectStatus(missing, 404);
  });
});

describe('deviation monitoring', () => {
  it('applies the configured chance to the coin at round creation', () => {
    expect(resolveCoinflip('heads', 50, 0.499)).toEqual({ outcome: 'heads', won: true });
    expect(resolveCoinflip('heads', 50, 0.5)).toEqual({ outcome: 'tails', won: false });
    expect(resolveCoinflip('tails', 1, 0.009)).toEqual({ outcome: 'tails', won: true });
    expect(resolveCoinflip('tails', 1, 0.01)).toEqual({ outcome: 'heads', won: false });
    expect(resolveCoinflip('heads', 99, 0.989)).toEqual({ outcome: 'heads', won: true });
    expect(resolveCoinflip('heads', 99, 0.99)).toEqual({ outcome: 'tails', won: false });
  });

  it('uses a sample-size-aware z-score and never changes configuration', () => {
    const normal = evaluateDeviation({
      wins: 58,
      losses: 42,
      expectedWins: 45,
      variance: 24.75,
      averageConfigured: 45,
    });
    expect(normal.level).toBe('normal');
    expect(normal.zScore).toBeCloseTo(2.61, 1);

    const warning = evaluateDeviation({
      wins: 65,
      losses: 35,
      expectedWins: 45,
      variance: 24.75,
      averageConfigured: 45,
    });
    expect(warning.level).toBe('warning');
    expect(warning.sampleSize).toBe(100);
    expect(warning.deltaPercentagePoints).toBe(20);
    expect(warning.message).toContain('3σ');

    const insufficient = evaluateDeviation({
      wins: 10,
      losses: 0,
      expectedWins: 4.5,
      variance: 2.475,
      averageConfigured: 45,
    });
    expect(insufficient.level).toBe('insufficient');
    expect(insufficient.message).toContain('50');

    const interval = wilsonInterval(65, 100);
    expect(interval.low).toBeGreaterThan(50);
    expect(interval.high).toBeLessThan(80);
  });

  it('warns on a materially biased game but not on a small sample', async () => {
    db.transaction(() => {
      for (let index = 0; index < 65; index += 1) {
        insertRound({ game: 'blackjack', bet: 100, payout: 200, status: 'won', chance: 45 });
      }
      for (let index = 0; index < 35; index += 1) {
        insertRound({ game: 'blackjack', bet: 100, payout: 0, status: 'lost', chance: 45 });
      }
      for (let index = 0; index < 4; index += 1) {
        insertRound({ game: 'towers', bet: 100, payout: 200, status: 'won', chance: 40 });
      }
      insertRound({ game: 'towers', bet: 100, payout: 0, status: 'lost', chance: 40 });
    })();

    const blackjack = await supportAgent.get('/api/staff/game-stats/blackjack?range=90d');
    expectStatus(blackjack, 200);
    expect(blackjack.body.game.deviation.level).toBe('warning');
    expect(blackjack.body.game.deviation.sampleSize).toBe(100);
    expect(blackjack.body.game.deviation.observedWinRate).toBe(65);
    expect(blackjack.body.game.deviation.configuredWinChance).toBe(45);
    expect(blackjack.body.game.deviation.zScore).toBeGreaterThan(3);

    const towers = await supportAgent.get('/api/staff/game-stats/towers?range=90d');
    expectStatus(towers, 200);
    expect(towers.body.game.deviation.level).toBe('insufficient');
    expect(towers.body.game.deviation.sampleSize).toBe(5);

    const list = await supportAgent.get('/api/staff/game-stats?range=90d');
    expectStatus(list, 200);
    expect(list.body.warningCount).toBeGreaterThanOrEqual(1);
    expect(list.body.games.find((game: { slug: string }) => game.slug === 'blackjack').deviation.level).toBe('warning');

    const games = await adminAgent.get('/api/admin/games');
    expectStatus(games, 200);
    const blackjackConfig = games.body.games.find((game: { slug: string }) => game.slug === 'blackjack');
    expect(blackjackConfig.config.winChance).toBe(42);
  });
});

describe('persistence', () => {
  it('keeps the configured chance and rule changes on disk', () => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const reopened = new Database(file, { readonly: true });
    try {
      const row = reopened.prepare("SELECT config FROM games WHERE id = 'coinflip'").get() as { config: string };
      const config = JSON.parse(row.config) as { winChance: number; winMultiplier: number };
      expect(config.winChance).toBe(73.5);
      expect(config.winMultiplier).toBe(1.8);
      const history = reopened
        .prepare("SELECT COUNT(*) AS count FROM game_config_history WHERE game_id = 'coinflip'")
        .get() as { count: number };
      expect(history.count).toBeGreaterThanOrEqual(3);
    } finally {
      reopened.close();
    }
  });
});
