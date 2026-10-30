import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { payoutFor } from '../shared/payout.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'MoneyPath!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;

let adminAgent: Agent;
let supportAgent: Agent;
let adminId: string;
let supportId: string;

const rid = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function createUser(username: string, role: 'user' | 'support' | 'admin' | 'owner', balance: number): string {
  const id = `usr_test_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@test.local`, hashPassword(PASSWORD), role, now, now);
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

const balanceOf = (userId: string) =>
  (db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId) as { balance: number }).balance;
const ledgerTotal = (userId: string) =>
  (db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE user_id = ?').get(userId) as { total: number })
    .total;

function setCap(value: number, key = 'economy.max_payout'): void {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(value), key);
  else db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), new Date().toISOString());
}

function setGameLimits(slug: string, min: number, max: number): void {
  db.prepare('UPDATE games SET min_bet = ?, max_bet = ? WHERE id = ?').run(min, max, slug);
}

function sessionState(sessionId: string): { mineTiles: number[]; revealed: number[]; multiplier: number } {
  const row = db.prepare('SELECT state FROM game_sessions WHERE id = ?').get(sessionId) as { state: string };
  return JSON.parse(row.state);
}

function firstSafeTile(sessionId: string): number {
  const state = sessionState(sessionId);
  const taken = new Set([...state.mineTiles, ...state.revealed]);
  for (let tile = 0; tile < 25; tile += 1) if (!taken.has(tile)) return tile;
  throw new Error('no safe tile left');
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  const adminName = unique('moneyadmin');
  const supportName = unique('moneysupport');
  adminId = createUser(adminName, 'admin', 0);
  supportId = createUser(supportName, 'support', 0);
  adminAgent = await signIn(adminName);
  supportAgent = await signIn(supportName);
});

afterAll(() => {
  db.close();
});

describe('payout correctness', () => {
  it('pays wager × multiplier on a Mines cash-out and shows the same number', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('mines', 1, 10_000_000);
    const username = unique('minesplayer');
    const userId = createUser(username, 'user', 20_000_000);
    const agent = await signIn(username);

    const bet = 1_000_000;
    const play = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet, mines: 3 });
    expectStatus(play, 201);
    const sessionId = play.body.session.id as string;

    let view = play.body;
    for (let step = 0; step < 2; step += 1) {
      const res = await agent
        .post(`/api/games/sessions/${sessionId}/action`)
        .set(CSRF)
        .send({ requestId: rid(), action: 'reveal', tile: firstSafeTile(sessionId) });
      expectStatus(res, 200);
      view = res.body;
    }

    const expected = payoutFor(bet, view.multiplier, 1_000_000_000_000);
    expect(view.multiplier).toBeGreaterThan(1);
    // The figure the player sees must be the figure that is paid.
    expect(view.potential).toBe(expected);

    const cashout = await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'cashout' });
    expectStatus(cashout, 200);
    expect(cashout.body.session.status).toBe('won');
    expect(cashout.body.session.payout).toBe(expected);
    expect(expected).toBeGreaterThan(bet);
    expect(balanceOf(userId)).toBe(20_000_000 - bet + expected);
    expect(ledgerTotal(userId)).toBe(balanceOf(userId));
  });

  it('caps the displayed potential at the payout ceiling so display matches payment', async () => {
    setCap(1_200_000);
    try {
      setGameLimits('mines', 1, 10_000_000);
      const username = unique('capplayer');
      const userId = createUser(username, 'user', 20_000_000);
      const agent = await signIn(username);

      const bet = 1_000_000;
      const play = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet, mines: 3 });
      expectStatus(play, 201);
      const sessionId = play.body.session.id as string;

      let view = play.body;
      for (let step = 0; step < 3; step += 1) {
        const res = await agent
          .post(`/api/games/sessions/${sessionId}/action`)
          .set(CSRF)
          .send({ requestId: rid(), action: 'reveal', tile: firstSafeTile(sessionId) });
        expectStatus(res, 200);
        view = res.body;
      }

      expect(view.potential).toBe(1_200_000);
      const cashout = await agent
        .post(`/api/games/sessions/${sessionId}/action`)
        .set(CSRF)
        .send({ requestId: rid(), action: 'cashout' });
      expectStatus(cashout, 200);
      expect(cashout.body.session.payout).toBe(1_200_000);
      expect(balanceOf(userId)).toBe(20_000_000 - bet + 1_200_000);
    } finally {
      setCap(1_000_000_000_000);
    }
  });

  it('never pays a settled round twice, even with a fresh request id', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('mines', 1, 10_000_000);
    const username = unique('repeatplayer');
    const userId = createUser(username, 'user', 20_000_000);
    const agent = await signIn(username);

    const bet = 1_000_000;
    const play = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet, mines: 5 });
    expectStatus(play, 201);
    const sessionId = play.body.session.id as string;
    await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'reveal', tile: firstSafeTile(sessionId) });

    const first = await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'cashout' });
    expectStatus(first, 200);
    const paid = first.body.session.payout as number;
    const balanceAfterFirst = balanceOf(userId);

    const second = await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'cashout' });
    expectStatus(second, 409);
    expect(balanceOf(userId)).toBe(balanceAfterFirst);

    const payouts = db
      .prepare("SELECT COUNT(*) AS count FROM ledger WHERE ref_id = ? AND type = 'game_payout'")
      .get(sessionId) as { count: number };
    expect(payouts.count).toBe(paid > 0 ? 1 : 0);
  });

  it('serialises simultaneous cash-outs into exactly one payout', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('mines', 1, 10_000_000);
    const username = unique('raceplayer');
    const userId = createUser(username, 'user', 20_000_000);
    const agent = await signIn(username);

    const bet = 1_000_000;
    const play = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet, mines: 5 });
    expectStatus(play, 201);
    const sessionId = play.body.session.id as string;
    await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'reveal', tile: firstSafeTile(sessionId) });

    const [a, b] = await Promise.all([
      agent.post(`/api/games/sessions/${sessionId}/action`).set(CSRF).send({ requestId: rid(), action: 'cashout' }),
      agent.post(`/api/games/sessions/${sessionId}/action`).set(CSRF).send({ requestId: rid(), action: 'cashout' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);

    const winner = a.status === 200 ? a : b;
    const paid = winner.body.session.payout as number;
    const payouts = db
      .prepare("SELECT COUNT(*) AS count FROM ledger WHERE ref_id = ? AND type = 'game_payout'")
      .get(sessionId) as { count: number };
    expect(payouts.count).toBe(1);
    expect(balanceOf(userId)).toBe(20_000_000 - bet + paid);
    expect(ledgerTotal(userId)).toBe(balanceOf(userId));
  });

  it('pays coinflip exactly the configured multiplier and stays ledger-consistent', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('coinflip', 1, 10_000_000);
    const username = unique('flipplayer');
    const userId = createUser(username, 'user', 30_000_000);
    const agent = await signIn(username);
    const bet = 500_000;

    let wins = 0;
    let losses = 0;
    let totalPaid = 0;
    for (let round = 0; round < 12; round += 1) {
      const play = await agent
        .post('/api/games/coinflip/play')
        .set(CSRF)
        .send({ requestId: rid(), bet, pick: round % 2 === 0 ? 'heads' : 'tails' });
      expectStatus(play, 201);
      const expected = play.body.won ? payoutFor(bet, play.body.multiplier, 1_000_000_000_000) : 0;
      expect(play.body.session.payout).toBe(expected);
      totalPaid += expected;
      if (play.body.won) wins += 1;
      else losses += 1;
      const ack = await agent.post(`/api/games/sessions/${play.body.session.id}/acknowledge`).set(CSRF).send({});
      expectStatus(ack, 200);
    }

    expect(wins + losses).toBe(12);
    expect(ledgerTotal(userId)).toBe(balanceOf(userId));
    expect(balanceOf(userId)).toBe(30_000_000 - 12 * bet + totalPaid);
  });
});

describe('wager limits follow the stored game configuration', () => {
  it('accepts a wager above the old 1,000,000 platform cap when the game allows it', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('mines', 1, 5_000_000);
    const username = unique('bigbettor');
    createUser(username, 'user', 50_000_000);
    const agent = await signIn(username);

    const res = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet: 5_000_000, mines: 3 });
    expectStatus(res, 201);
    expect(res.body.session.bet).toBe(5_000_000);
  });

  it('rejects a wager above the configured maximum', async () => {
    setGameLimits('mines', 1, 100);
    const username = unique('smallbettor');
    createUser(username, 'user', 50_000_000);
    const agent = await signIn(username);

    const res = await agent.post('/api/games/mines/play').set(CSRF).send({ requestId: rid(), bet: 1_000_000, mines: 3 });
    expectStatus(res, 400);
    expect(res.body.error.code).toBe('WAGER_TOO_HIGH');
  });
});

describe('admin account wipe', () => {
  it('rejects callers without users.manage', async () => {
    const targetId = createUser(unique('wipe_target_a'), 'user', 1000);
    const res = await supportAgent.post(`/api/admin/users/${targetId}/wipe`).set(CSRF).send({ confirmUsername: 'x' });
    expectStatus(res, 403);
  });

  it('refuses to let an administrator wipe their own account', async () => {
    const res = await adminAgent.post(`/api/admin/users/${adminId}/wipe`).set(CSRF).send({ confirmUsername: 'whatever' });
    expectStatus(res, 403);
    expect(res.body.error.code).toBe('SELF_MODERATION');
  });

  it('requires the exact username before wiping', async () => {
    const username = unique('wipe_target_b');
    const targetId = createUser(username, 'user', 1000);
    const res = await adminAgent
      .post(`/api/admin/users/${targetId}/wipe`)
      .set(CSRF)
      .send({ confirmUsername: 'not-the-username' });
    expectStatus(res, 400);
    expect(res.body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(balanceOf(targetId)).toBe(1000);
  });

  it('zeroes the balance, clears progression and records an audit entry atomically', async () => {
    const username = unique('wipe_target_c');
    const targetId = createUser(username, 'user', 7_500_000);

    const res = await adminAgent.post(`/api/admin/users/${targetId}/wipe`).set(CSRF).send({ confirmUsername: username });
    expectStatus(res, 200);
    expect(res.body.balance).toBe(0);
    expect(balanceOf(targetId)).toBe(0);
    expect(ledgerTotal(targetId)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM active_rounds WHERE user_id = ?').get(targetId)).toEqual({
      count: 0,
    });

    const audit = db
      .prepare("SELECT actor_id, target_id FROM audit_logs WHERE action = 'user.wipe' AND target_id = ?")
      .get(targetId) as { actor_id: string; target_id: string } | undefined;
    expect(audit?.actor_id).toBe(adminId);
    expect(audit?.target_id).toBe(targetId);

    // The account itself must remain usable.
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
    expectStatus(login, 200);

    // Wiping again is safe and cannot drive the balance negative.
    const again = await adminAgent
      .post(`/api/admin/users/${targetId}/wipe`)
      .set(CSRF)
      .send({ confirmUsername: username });
    expectStatus(again, 200);
    expect(balanceOf(targetId)).toBe(0);
  });
});

describe('blackjack wager integrity', () => {
  it('refuses a double that would push the round past the table maximum, and rolls the wager back', async () => {
    setCap(1_000_000_000_000);
    setGameLimits('blackjack', 1, 1_000_000);
    const username = unique('doublelimit');
    const userId = createUser(username, 'user', 50_000_000);
    const agent = await signIn(username);

    const bet = 1_000_000;
    let sessionId = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const play = await agent.post('/api/games/blackjack/play').set(CSRF).send({ requestId: rid(), bet });
      expectStatus(play, 201);
      if (play.body.session.status === 'active') {
        sessionId = play.body.session.id as string;
        break;
      }
      await agent.post(`/api/games/sessions/${play.body.session.id}/acknowledge`).set(CSRF).send({});
    }
    expect(sessionId).not.toBe('');

    const balanceBeforeDouble = balanceOf(userId);
    const double = await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'double' });
    expectStatus(double, 400);
    expect(double.body.error.code).toBe('WAGER_TOO_HIGH');
    // The rejected double must not keep the extra stake or change the table bet.
    expect(balanceOf(userId)).toBe(balanceBeforeDouble);
    expect((db.prepare('SELECT bet FROM game_sessions WHERE id = ?').get(sessionId) as { bet: number }).bet).toBe(bet);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM ledger WHERE ref_id = ? AND idempotency_key LIKE 'game-wager-double:%'").get(sessionId),
    ).toEqual({ count: 0 });

    const stand = await agent
      .post(`/api/games/sessions/${sessionId}/action`)
      .set(CSRF)
      .send({ requestId: rid(), action: 'stand' });
    expectStatus(stand, 200);
    expect(ledgerTotal(userId)).toBe(balanceOf(userId));
  });
});

describe('role management authorization', () => {
  it('rejects a support account changing roles', async () => {
    const targetId = createUser(unique('role_target'), 'user', 0);
    const res = await supportAgent.patch(`/api/admin/users/${targetId}/role`).set(CSRF).send({ role: 'admin' });
    expectStatus(res, 403);
  });
});
