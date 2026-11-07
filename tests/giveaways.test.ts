import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, setSetting, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { encryptSecret, hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { giveawayInternals } from '../server/lib/giveaways.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'GiveawayTest!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const STARTING = 50_000_000;

const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;

const agents: Record<string, Agent> = {};
const ids: Record<string, string> = {};

function createUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner'): string {
  const id = `usr_giveaway_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@giveaway.test`, hashPassword(PASSWORD), role, now, now);
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

function balance(userId: string): number {
  return (db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId) as { balance: number }).balance;
}

function forceEnd(giveawayId: string) {
  const start = new Date(Date.now() - 10_000).toISOString();
  const end = new Date(Date.now() - 5_000).toISOString();
  db.prepare("UPDATE giveaways SET starts_at = ?, ends_at = ?, status = 'active' WHERE id = ?").run(start, end, giveawayId);
}

async function settleAll() {
  const start = new Date(Date.now() - 10_000).toISOString();
  const end = new Date(Date.now() - 5_000).toISOString();
  db.prepare("UPDATE giveaways SET starts_at = ?, ends_at = ? WHERE status IN ('scheduled','active')").run(start, end);
  await agents.owner!.get('/api/giveaways');
}

async function createGiveaway(
  agent: Agent,
  overrides: Partial<{ title: string; prizeAmount: number; winnerCount: number; startsAt: string; endsAt: string }> = {},
) {
  return agent.post('/api/giveaways').set(CSRF).send({
    title: overrides.title ?? 'Test prize pool',
    description: 'Integration test giveaway',
    prizeAmount: overrides.prizeAmount ?? 100_000,
    winnerCount: overrides.winnerCount ?? 1,
    startsAt: overrides.startsAt ?? new Date().toISOString(),
    endsAt: overrides.endsAt ?? new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  ids.owner = createUser('giveowner', 'owner');
  ids.admin = createUser('giveadmin', 'admin');
  ids.moderator = createUser('givemoderator', 'moderator');
  ids.support = createUser('givesupport', 'support');
  ids.alice = createUser('givealice', 'user');
  ids.bob = createUser('givebob', 'user');
  ids.carol = createUser('givecarol', 'user');

  for (const username of ['owner', 'admin', 'moderator', 'support', 'alice', 'bob', 'carol']) {
    agents[username] = await signIn(`give${username}`);
  }

  // Enable the email queue so winner/sponsor notifications are queued even
  // though this test never connects to an SMTP server.
  setSetting(db, 'email.enabled', true, null);
  setSetting(db, 'email.host', 'smtp.test.local', null);
  setSetting(db, 'email.port', 587, null);
  setSetting(db, 'email.secure', false, null);
  setSetting(db, 'email.user', 'mailer@test.local', null);
  setSetting(db, 'email.from_email', 'no-reply@test.local', null);
  setSetting(db, 'email.smtp_pass_enc', encryptSecret('test-smtp-key'), null);
}, 30_000);

afterAll(() => {
  db.close();
});

beforeEach(async () => {
  await settleAll();
});

describe('giveaway creation and escrow', () => {
  it('only lets staff create, secures the prize and keeps the draw seed hidden', async () => {
    const denied = await createGiveaway(agents.alice!);
    expectStatus(denied, 403);

    const supportBefore = balance(ids.support!);
    const created = await createGiveaway(agents.support!, { prizeAmount: 250_000, winnerCount: 2 });
    expectStatus(created, 201);
    const giveaway = created.body.giveaway;
    expect(giveaway.status).toBe('active');
    expect(giveaway.fundingKind).toBe('staff');
    expect(giveaway.prizeAmount).toBe(250_000);
    expect(giveaway.drawCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(giveaway.drawSeed).toBeNull();
    expect(balance(ids.support!)).toBe(supportBefore - 250_000);

    const escrow = db
      .prepare('SELECT amount, idempotency_key FROM ledger WHERE ref_type = ? AND ref_id = ?')
      .get('giveaway', giveaway.id) as { amount: number; idempotency_key: string };
    expect(escrow.amount).toBe(-250_000);
    expect(escrow.idempotency_key).toBe(`giveaway-escrow:${giveaway.id}`);

    const playerManage = await agents.alice!.get('/api/giveaways/manage');
    expectStatus(playerManage, 403);
    const staffManage = await agents.support!.get('/api/giveaways/manage');
    expectStatus(staffManage, 200);
  });

  it('rejects invalid amounts, winner counts and short durations', async () => {
    const tooLarge = await agents.owner!.post('/api/giveaways').set(CSRF).send({
      title: 'Bad amount',
      prizeAmount: 2_000_000_000_000,
      winnerCount: 1,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expectStatus(tooLarge, 400);

    const noWinners = await createGiveaway(agents.owner!, { winnerCount: 0 });
    expectStatus(noWinners, 400);

    const tooShort = await createGiveaway(agents.owner!, {
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expectStatus(tooShort, 400);

    const playerSponsorship = await agents.alice!.post('/api/giveaways/sponsorships').set(CSRF).send({
      prizeAmount: 999_999_999_999,
      winnerCount: 1,
      durationSeconds: 3600,
    });
    expectStatus(playerSponsorship, 400);
  });
});

describe('joining and drawing', () => {
  it('allows one entry per user and only while active', async () => {
    const created = await createGiveaway(agents.owner!, { prizeAmount: 90_000 });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;

    const first = await agents.alice!.post(`/api/giveaways/${id}/join`).set(CSRF).send({});
    expectStatus(first, 200);
    expect(first.body.giveaway.joined).toBe(true);
    expect(first.body.giveaway.participantCount).toBe(1);

    const duplicate = await agents.alice!.post(`/api/giveaways/${id}/join`).set(CSRF).send({});
    expectStatus(duplicate, 200);
    expect(duplicate.body.giveaway.participantCount).toBe(1);
    expect(balance(ids.alice!)).toBe(STARTING);

    forceEnd(id);
    const late = await agents.bob!.post(`/api/giveaways/${id}/join`).set(CSRF).send({});
    expectStatus(late, 409);
    expect(late.body.error.code).toBe('GIVEAWAY_ENDED');
  });

  it('selects unique winners with the committed seed and does not pay until a claim is approved', async () => {
    const created = await createGiveaway(agents.owner!, { prizeAmount: 100_000, winnerCount: 2 });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;
    expectStatus(await agents.alice!.post(`/api/giveaways/${id}/join`).set(CSRF).send({}), 200);
    expectStatus(await agents.bob!.post(`/api/giveaways/${id}/join`).set(CSRF).send({}), 200);
    expectStatus(await agents.carol!.post(`/api/giveaways/${id}/join`).set(CSRF).send({}), 200);

    const aliceBefore = balance(ids.alice!);
    const bobBefore = balance(ids.bob!);
    const carolBefore = balance(ids.carol!);

    forceEnd(id);
    const settled = await agents.owner!.get('/api/giveaways');
    expectStatus(settled, 200);
    const giveaway = [...settled.body.completed].find((entry: { id: string }) => entry.id === id);
    expect(giveaway).toBeTruthy();
    expect(giveaway.status).toBe('completed');
    expect(giveaway.winners).toHaveLength(2);
    expect(new Set(giveaway.winners.map((winner: { userId: string }) => winner.userId)).size).toBe(2);
    expect(giveaway.winners.reduce((sum: number, winner: { payoutAmount: number }) => sum + winner.payoutAmount, 0)).toBe(100_000);
    expect(giveaway.drawSeed).toMatch(/^[a-f0-9]{64}$/);

    // Recompute the draw from the revealed seed and the exact entry order.
    const entryIds = (
      db
        .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY joined_at ASC, user_id ASC')
        .all(id) as { user_id: string }[]
    ).map((entry) => entry.user_id);
    const expected = giveawayInternals.drawOrder(giveaway.drawSeed, id, entryIds, 2);
    expect(giveaway.winners.map((winner: { userId: string }) => winner.userId)).toEqual(expected);

    // The pool is still in escrow; winners are paid only after a verified claim.
    expect(balance(ids.alice!)).toBe(aliceBefore);
    expect(balance(ids.bob!)).toBe(bobBefore);
    expect(balance(ids.carol!)).toBe(carolBefore);

    const winnerUsernames = new Set(giveaway.winners.map((winner: { username: string }) => winner.username));
    const winnerEntry = Object.entries(agents).find(([username]) => winnerUsernames.has(`give${username}`));
    const loserEntry = Object.entries(agents).find(
      ([username]) => ['alice', 'bob', 'carol'].includes(username) && !winnerUsernames.has(`give${username}`),
    );
    expect(winnerEntry).toBeTruthy();
    const [winnerName, winnerAgent] = winnerEntry!;
    const winnerId = ids[winnerName]!;
    const payout = giveaway.winners.find((winner: { userId: string }) => winner.userId === winnerId).payoutAmount;

    const unauthorisedClaim = await loserEntry![1].post(`/api/giveaways/${id}/claim`).set(CSRF).send({ message: 'mine' });
    expectStatus(unauthorisedClaim, 403);

    const claim = await winnerAgent.post(`/api/giveaways/${id}/claim`).set(CSRF).send({ message: 'Verifying please.' });
    expectStatus(claim, 201);
    const ticketReference = claim.body.ticketReference as string;
    expect(ticketReference).toMatch(/^TKT-/);
    const ticketRow = db.prepare('SELECT category, status FROM tickets WHERE reference = ?').get(ticketReference) as {
      category: string;
      status: string;
    };
    expect(ticketRow.category).toBe('giveaway_claim');
    expect(ticketRow.status).toBe('new');

    const winnerBefore = balance(winnerId);
    const approved = await agents.support!.post(`/api/giveaways/claims/${claim.body.claim.id}/approve`).set(CSRF).send({});
    expectStatus(approved, 200);
    expect(approved.body.claim.claimStatus).toBe('approved');
    expect(balance(winnerId)).toBe(winnerBefore + payout);

    const duplicate = await agents.support!.post(`/api/giveaways/claims/${claim.body.claim.id}/approve`).set(CSRF).send({});
    expectStatus(duplicate, 409);
    expect(balance(winnerId)).toBe(winnerBefore + payout);
    const payouts = db
      .prepare("SELECT COUNT(*) AS count FROM ledger WHERE idempotency_key = ?")
      .get(`giveaway-payout:${claim.body.claim.id}`) as { count: number };
    expect(payouts.count).toBe(1);

    const resolved = db.prepare('SELECT status FROM tickets WHERE reference = ?').get(ticketReference) as { status: string };
    expect(resolved.status).toBe('resolved');

    const queued = db
      .prepare("SELECT COUNT(*) AS count FROM email_jobs WHERE template = 'giveaway-winner' AND dedupe_key LIKE ?")
      .get(`giveaway-winner:${id}:%`) as { count: number };
    expect(queued.count).toBe(2);
  });

  it('refunds the funder when nobody entered', async () => {
    const before = balance(ids.owner!);
    const created = await createGiveaway(agents.owner!, { prizeAmount: 40_000 });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;
    expect(balance(ids.owner!)).toBe(before - 40_000);

    forceEnd(id);
    await agents.owner!.get('/api/giveaways');
    expect(balance(ids.owner!)).toBe(before);
    const row = db.prepare('SELECT status, refund_ledger_id FROM giveaways WHERE id = ?').get(id) as {
      status: string;
      refund_ledger_id: string | null;
    };
    expect(row.status).toBe('completed');
    expect(row.refund_ledger_id).toBeTruthy();
  });

  it('blocks staff from approving their own claim', async () => {
    const created = await createGiveaway(agents.owner!, { prizeAmount: 30_000, winnerCount: 1 });
    const id = created.body.giveaway.id as string;
    expectStatus(await agents.support!.post(`/api/giveaways/${id}/join`).set(CSRF).send({}), 200);
    forceEnd(id);
    const view = await agents.support!.get('/api/giveaways');
    const giveaway = view.body.completed.find((entry: { id: string }) => entry.id === id);
    expect(giveaway.winners[0].userId).toBe(ids.support);

    const claim = await agents.support!.post(`/api/giveaways/${id}/claim`).set(CSRF).send({});
    expectStatus(claim, 201);
    const selfApproval = await agents.support!.post(`/api/giveaways/claims/${claim.body.claim.id}/approve`).set(CSRF).send({});
    expectStatus(selfApproval, 403);
    expect(selfApproval.body.error.code).toBe('SELF_APPROVAL');

    const approved = await agents.admin!.post(`/api/giveaways/claims/${claim.body.claim.id}/approve`).set(CSRF).send({});
    expectStatus(approved, 200);
  });
});

describe('scheduling, editing and cancellation', () => {
  it('schedules an upcoming giveaway and opens entries when it starts', async () => {
    const future = new Date(Date.now() + 120_000);
    const created = await createGiveaway(agents.owner!, {
      startsAt: future.toISOString(),
      endsAt: new Date(future.getTime() + 3600_000).toISOString(),
    });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;
    expect(created.body.giveaway.status).toBe('scheduled');
    expect(created.body.giveaway.secondsUntilStart).toBeGreaterThan(0);

    const early = await agents.alice!.post(`/api/giveaways/${id}/join`).set(CSRF).send({});
    expectStatus(early, 409);
    expect(early.body.error.code).toBe('GIVEAWAY_NOT_STARTED');

    db.prepare("UPDATE giveaways SET starts_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
    const overview = await agents.alice!.get('/api/giveaways');
    expectStatus(overview, 200);
    expect(overview.body.active.some((entry: { id: string }) => entry.id === id)).toBe(true);

    const joined = await agents.alice!.post(`/api/giveaways/${id}/join`).set(CSRF).send({});
    expectStatus(joined, 200);
  });

  it('edits an upcoming prize and ajusts escrow, then refunds on cancellation', async () => {
    const before = balance(ids.owner!);
    const created = await createGiveaway(agents.owner!, {
      prizeAmount: 50_000,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 7200_000).toISOString(),
    });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;
    expect(balance(ids.owner!)).toBe(before - 50_000);

    const edited = await agents.owner!
      .patch(`/api/giveaways/${id}`)
      .set(CSRF)
      .send({ prizeAmount: 80_000, title: 'Edited prize pool' });
    expectStatus(edited, 200);
    expect(edited.body.giveaway.prizeAmount).toBe(80_000);
    expect(balance(ids.owner!)).toBe(before - 80_000);

    const cancelled = await agents.owner!
      .post(`/api/giveaways/${id}/cancel`)
      .set(CSRF)
      .send({ reason: 'Test cancellation' });
    expectStatus(cancelled, 200);
    expect(cancelled.body.giveaway.status).toBe('cancelled');
    expect(balance(ids.owner!)).toBe(before);
  });
});

describe('player-sponsored giveaways', () => {
  it('deducts only on approval, publishes under the sponsor name and pays the winner once', async () => {
    const sponsorBefore = balance(ids.alice!);
    const requested = await agents.alice!.post('/api/giveaways/sponsorships').set(CSRF).send({
      prizeAmount: 120_000,
      winnerCount: 1,
      durationSeconds: 600,
      title: 'Alice community pool',
      description: 'A sponsored test giveaway.',
    });
    expectStatus(requested, 201);
    const sponsorship = requested.body.sponsorship;
    expect(sponsorship.status).toBe('pending');
    expect(sponsorship.ticketReference).toMatch(/^TKT-/);
    expect(balance(ids.alice!)).toBe(sponsorBefore);

    const approve = await agents.support!
      .post(`/api/giveaways/sponsorships/${sponsorship.id}/approve`)
      .set(CSRF)
      .send({});
    expectStatus(approve, 200);
    expect(approve.body.sponsorship.status).toBe('approved');
    expect(balance(ids.alice!)).toBe(sponsorBefore - 120_000);

    const publish = await agents.support!
      .post(`/api/giveaways/sponsorships/${sponsorship.id}/publish`)
      .set(CSRF)
      .send({ title: 'Alice community pool', description: 'A sponsored test giveaway.' });
    expectStatus(publish, 201);
    const giveaway = publish.body.giveaway;
    expect(giveaway.fundingKind).toBe('sponsor');
    expect(giveaway.sponsor.username).toBe('givealice');
    expect(balance(ids.alice!)).toBe(sponsorBefore - 120_000);

    const conflicting = await agents.support!
      .post(`/api/giveaways/sponsorships/${sponsorship.id}/publish`)
      .set(CSRF)
      .send({});
    expectStatus(conflicting, 409);

    expectStatus(await agents.bob!.post(`/api/giveaways/${giveaway.id}/join`).set(CSRF).send({}), 200);
    forceEnd(giveaway.id);
    const view = await agents.bob!.get('/api/giveaways');
    const settled = view.body.completed.find((entry: { id: string }) => entry.id === giveaway.id);
    expect(settled.winners[0].userId).toBe(ids.bob);

    const claim = await agents.bob!.post(`/api/giveaways/${giveaway.id}/claim`).set(CSRF).send({});
    expectStatus(claim, 201);
    const bobBefore = balance(ids.bob!);
    const paid = await agents.support!
      .post(`/api/giveaways/claims/${claim.body.claim.id}/approve`)
      .set(CSRF)
      .send({});
    expectStatus(paid, 200);
    expect(balance(ids.bob!)).toBe(bobBefore + 120_000);

    const sponsorEmail = db
      .prepare("SELECT COUNT(*) AS count FROM email_jobs WHERE template = 'giveaway-sponsor' AND dedupe_key = ?")
      .get(`giveaway-sponsor-published:${sponsorship.id}`) as { count: number };
    expect(sponsorEmail.count).toBe(1);
  });

  it('refunds an approved sponsorship that is never published', async () => {
    const before = balance(ids.alice!);
    const requested = await agents.alice!.post('/api/giveaways/sponsorships').set(CSRF).send({
      prizeAmount: 75_000,
      winnerCount: 2,
      durationSeconds: 3600,
    });
    expectStatus(requested, 201);
    const id = requested.body.sponsorship.id as string;

    expectStatus(
      await agents.moderator!.post(`/api/giveaways/sponsorships/${id}/approve`).set(CSRF).send({}),
      200,
    );
    expect(balance(ids.alice!)).toBe(before - 75_000);

    const refund = await agents.moderator!.post(`/api/giveaways/sponsorships/${id}/refund`).set(CSRF).send({});
    expectStatus(refund, 200);
    expect(refund.body.sponsorship.status).toBe('cancelled');
    expect(balance(ids.alice!)).toBe(before);
  });

  it('keeps the prize and winner count a sponsor approved', async () => {
    const requested = await agents.bob!.post('/api/giveaways/sponsorships').set(CSRF).send({
      prizeAmount: 80_000,
      winnerCount: 2,
      durationSeconds: 3600,
    });
    expectStatus(requested, 201);
    const sponsorshipId = requested.body.sponsorship.id as string;
    expectStatus(
      await agents.support!.post(`/api/giveaways/sponsorships/${sponsorshipId}/approve`).set(CSRF).send({}),
      200,
    );

    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const publish = await agents.support!
      .post(`/api/giveaways/sponsorships/${sponsorshipId}/publish`)
      .set(CSRF)
      .send({ title: 'Bob sponsor pool', startsAt, endsAt: new Date(Date.now() + 7_200_000).toISOString() });
    expectStatus(publish, 201);
    const giveawayId = publish.body.giveaway.id as string;
    expect(publish.body.giveaway.status).toBe('scheduled');

    const changedPrize = await agents.support!
      .patch(`/api/giveaways/${giveawayId}`)
      .set(CSRF)
      .send({ prizeAmount: 200_000 });
    expectStatus(changedPrize, 400);
    expect(changedPrize.body.error.code).toBe('SPONSOR_TERMS_LOCKED');

    const changedWinners = await agents.support!
      .patch(`/api/giveaways/${giveawayId}`)
      .set(CSRF)
      .send({ winnerCount: 1 });
    expectStatus(changedWinners, 400);
    expect(changedWinners.body.error.code).toBe('SPONSOR_TERMS_LOCKED');

    const renamed = await agents.support!
      .patch(`/api/giveaways/${giveawayId}`)
      .set(CSRF)
      .send({ title: 'Renamed sponsor pool' });
    expectStatus(renamed, 200);
    expect(renamed.body.giveaway.title).toBe('Renamed sponsor pool');

    const cancelled = await agents.support!
      .post(`/api/giveaways/${giveawayId}/cancel`)
      .set(CSRF)
      .send({ reason: 'Test cleanup' });
    expectStatus(cancelled, 200);
  });

  it('rejects sponsorship requests without a reason or with the wrong balance', async () => {
    const requested = await agents.carol!.post('/api/giveaways/sponsorships').set(CSRF).send({
      prizeAmount: 60_000,
      winnerCount: 1,
      durationSeconds: 3600,
    });
    expectStatus(requested, 201);
    const id = requested.body.sponsorship.id as string;

    const noReason = await agents.support!.post(`/api/giveaways/sponsorships/${id}/reject`).set(CSRF).send({});
    expectStatus(noReason, 400);
    const rejected = await agents.support!
      .post(`/api/giveaways/sponsorships/${id}/reject`)
      .set(CSRF)
      .send({ reason: 'Prize structure needs work.' });
    expectStatus(rejected, 200);
    expect(rejected.body.sponsorship.status).toBe('rejected');
    expect(balance(ids.carol!)).toBe(STARTING);

    const playerApprove = await agents.carol!
      .post(`/api/giveaways/sponsorships/${id}/approve`)
      .set(CSRF)
      .send({});
    expectStatus(playerApprove, 403);
  });
});
