import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DB } from '../server/db/index.ts';
import { createDatabase } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { roulettePayout } from '../server/games/instant.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'ChipValueTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;
let playerAgent: Agent;
let otherAgent: Agent;
let playerId: string;
let otherId: string;

function createUser(username: string, balance: number): string {
  const id = `usr_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@chip.test`, hashPassword(PASSWORD), now, now);
  createWallet(db, id, balance, null);
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

function sessionCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM game_sessions').get() as { count: number }).count;
}

async function acknowledge(sessionId: string) {
  const res = await playerAgent.post(`/api/games/sessions/${sessionId}/acknowledge`).set(CSRF).send({});
  expectStatus(res, 200);
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);
  playerId = createUser('chip_player', 1_000_000);
  otherId = createUser('chip_other', 1_000);
  playerAgent = await signIn('chip_player');
  otherAgent = await signIn('chip_other');
});

afterAll(() => {
  db.close();
});

describe('roulette payout arithmetic', () => {
  it('keeps the same payout ratios and expected return for every chip value', () => {
    const chipValues = [1, 10, 250, 1_000, 1_000_000];
    const singleStraight = [{ type: 'straight' as const, number: 7, chips: 1 }];
    const evenMoney = [{ type: 'red' as const, chips: 1 }];
    const dozen = [{ type: 'dozen1' as const, chips: 1 }];

    for (const chipValue of chipValues) {
      const straightReturns = Array.from({ length: 37 }, (_, winning) =>
        roulettePayout(singleStraight, winning, chipValue),
      );
      expect(straightReturns.filter((payout) => payout > 0)).toHaveLength(1);
      expect(straightReturns.reduce((sum, payout) => sum + payout, 0)).toBe(36 * chipValue);

      const redReturns = Array.from({ length: 37 }, (_, winning) => roulettePayout(evenMoney, winning, chipValue));
      expect(redReturns.filter((payout) => payout > 0)).toHaveLength(18);
      expect(redReturns.reduce((sum, payout) => sum + payout, 0)).toBe(36 * chipValue);

      const dozenReturns = Array.from({ length: 37 }, (_, winning) => roulettePayout(dozen, winning, chipValue));
      expect(dozenReturns.filter((payout) => payout > 0)).toHaveLength(12);
      expect(dozenReturns.reduce((sum, payout) => sum + payout, 0)).toBe(36 * chipValue);
    }
  });

  it('pays every winning chip at the table multiple', () => {
    const bets = [
      { type: 'red' as const, chips: 2 },
      { type: 'straight' as const, number: 7, chips: 1 },
      { type: 'column1' as const, chips: 3 },
    ];
    // 7 is red and in column 1: red 2 chips × 2, straight 1 × 36, column 3 × 3.
    expect(roulettePayout(bets, 7, 25)).toBe((4 + 36 + 9) * 25);
    // 1 is red and in column 1, but the straight loses.
    expect(roulettePayout(bets, 1, 25)).toBe((4 + 9) * 25);
    // Black 2 loses all three.
    expect(roulettePayout(bets, 2, 25)).toBe(0);
    // Zero loses every outside bet and the straight.
    expect(roulettePayout(bets, 0, 25)).toBe(0);
  });

  it('applies the platform payout cap after the chip value is applied', () => {
    expect(roulettePayout([{ type: 'straight', number: 7, chips: 1 }], 7, 1_000_000, 500_000)).toBe(500_000);
  });
});

describe('roulette chip preferences', () => {
  it('stores a per-user chip value and rejects invalid values', async () => {
    const initial = await playerAgent.get('/api/games/roulette/preferences');
    expectStatus(initial, 200);
    expect(initial.body.chipValue).toBe(10);

    const saved = await playerAgent.put('/api/games/roulette/preferences').set(CSRF).send({ chipValue: 250 });
    expectStatus(saved, 200);
    expect(saved.body.chipValue).toBe(250);

    const loaded = await playerAgent.get('/api/games/roulette/preferences');
    expect(loaded.body.chipValue).toBe(250);
    const row = db
      .prepare('SELECT roulette_chip_value FROM game_preferences WHERE user_id = ?')
      .get(playerId) as { roulette_chip_value: number };
    expect(row.roulette_chip_value).toBe(250);

    const other = await otherAgent.get('/api/games/roulette/preferences');
    expect(other.body.chipValue).toBe(10);

    const anonymous = await request(app).get('/api/games/roulette/preferences');
    expectStatus(anonymous, 401);

    for (const chipValue of [0, -5, 1.5, 1_000_000_000_001]) {
      const invalid = await playerAgent.put('/api/games/roulette/preferences').set(CSRF).send({ chipValue });
      expectStatus(invalid, 400);
    }

    const aboveTableMaximum = await playerAgent
      .put('/api/games/roulette/preferences')
      .set(CSRF)
      .send({ chipValue: 20_000 });
    expectStatus(aboveTableMaximum, 400);
    expect(aboveTableMaximum.body.error.code).toBe('CHIP_VALUE_TOO_HIGH');
    expect((await playerAgent.get('/api/games/roulette/preferences')).body.chipValue).toBe(250);
  });
});

describe('roulette chip settlement', () => {
  it('deducts and pays every chip at the selected value', async () => {
    const chipValues = [1, 10, 250, 1_000];
    for (const chipValue of chipValues) {
      const before = walletBalance(playerId);
      const res = await playerAgent
        .post('/api/games/roulette/play')
        .set(CSRF)
        .send({
          requestId: unique('chip-spin'),
          chipValue,
          bet: chipValue * 3,
          bets: [
            { type: 'red', chips: 2 },
            { type: 'straight', number: 7, chips: 1 },
          ],
        });
      expectStatus(res, 201);
      expect(res.body.chipValue).toBe(chipValue);
      expect(res.body.session.bet).toBe(chipValue * 3);
      expect(res.body.bets).toEqual([
        { type: 'red', chips: 2, amount: chipValue * 2 },
        { type: 'straight', number: 7, chips: 1, amount: chipValue },
      ]);

      const winningNumber = res.body.winningNumber as number;
      const expectedChips = winningNumber === 7 ? 40 : winningNumber === 0 ? 0 : [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(winningNumber) ? 4 : 0;
      expect(res.body.totalPayout, `winning number ${winningNumber}`).toBe(expectedChips * chipValue);
      expect(res.body.session.payout).toBe(expectedChips * chipValue);
      expect(res.body.balance).toBe(before - chipValue * 3 + expectedChips * chipValue);
      expect(ledgerTotal(playerId)).toBe(res.body.balance);

      const state = db.prepare('SELECT state FROM game_sessions WHERE id = ?').get(res.body.session.id) as {
        state: string;
      };
      expect(JSON.parse(state.state)).toMatchObject({
        chipValue,
        bets: [
          { type: 'red', chips: 2, amount: chipValue * 2 },
          { type: 'straight', number: 7, chips: 1, amount: chipValue },
        ],
      });

      await acknowledge(res.body.session.id);
    }
  });

  it('keeps the old amount-only request format working at one money per chip', async () => {
    const before = walletBalance(playerId);
    const res = await playerAgent
      .post('/api/games/roulette/play')
      .set(CSRF)
      .send({ requestId: unique('legacy-spin'), bet: 100, bets: [{ type: 'red', amount: 100 }] });
    expectStatus(res, 201);
    expect(res.body.chipValue).toBe(1);
    expect(res.body.bets).toEqual([{ type: 'red', chips: 100, amount: 100 }]);
    expect(res.body.session.bet).toBe(100);
    expect(res.body.balance).toBe(before - 100 + res.body.totalPayout);
    await acknowledge(res.body.session.id);
  });

  it('rejects mismatched or malformed chip calculations without moving money', async () => {
    const before = walletBalance(playerId);
    const beforeSessions = sessionCount();

    const invalidBodies = [
      // The declared total does not equal the chips placed.
      { requestId: unique('bad-total'), chipValue: 10, bet: 100, bets: [{ type: 'red', chips: 1 }] },
      // The money amount attached to a chip stack disagrees with chipValue.
      { requestId: unique('bad-amount'), chipValue: 10, bet: 100, bets: [{ type: 'red', chips: 1, amount: 20 }] },
      // A legacy amount cannot be split into whole chips.
      { requestId: unique('bad-divisible'), chipValue: 10, bet: 95, bets: [{ type: 'red', amount: 95 }] },
      // A straight bet without a number is not a valid position.
      { requestId: unique('bad-straight'), chipValue: 10, bet: 10, bets: [{ type: 'straight', chips: 1 }] },
      // Every fraction of a chip is rejected.
      { requestId: unique('bad-chip-value'), chipValue: 1.5, bet: 10, bets: [{ type: 'red', chips: 1 }] },
      { requestId: unique('zero-chip-value'), chipValue: 0, bet: 10, bets: [{ type: 'red', chips: 1 }] },
      { requestId: unique('too-many-chips'), chipValue: 1, bet: 1_000_001, bets: [{ type: 'red', chips: 1_000_001 }] },
      // A wager above the table maximum is refused before any debit.
      { requestId: unique('too-large'), chipValue: 10_000, bet: 20_000, bets: [{ type: 'red', chips: 2 }] },
    ];

    for (const body of invalidBodies) {
      const res = await playerAgent.post('/api/games/roulette/play').set(CSRF).send(body);
      expectStatus(res, 400);
    }

    expect(walletBalance(playerId)).toBe(before);
    expect(ledgerTotal(playerId)).toBe(before);
    expect(sessionCount()).toBe(beforeSessions);
  });
});
