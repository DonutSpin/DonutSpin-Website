import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '../shared/legal.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'AurumTest!2026';
const CSRF = { 'X-Requested-With': 'donutcash' };
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;

let ownerAgent: Agent;
let adminAgent: Agent;
let supportAgent: Agent;
let playerAgent: Agent;
let otherAgent: Agent;

let ownerId: string;
let adminId: string;
let supportId: string;
let playerId: string;
let otherId: string;

interface TicketLike {
  id: string;
  reference: string;
  status: string;
  subject: string;
  assignee: { id: string; username: string } | null;
  holdReason: string | null;
  rejectionReason: string | null;
  messages: { body: string; visibility: string }[];
  events: { type: string }[];
  creditRequest: { id: string; amount: number; status: string; ledgerId: string | null; reviewerName: string | null } | null;
}

let workflowTicket: TicketLike;
let walletTicket: TicketLike;
let legacyTicketReference: string;

const LEGAL_CONSENT = { ageConfirmed: true, acceptTerms: true, acknowledgeDonutRules: true };

async function registerAgent(username: string, email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').set(CSRF).send({ username, email, password: PASSWORD, ...LEGAL_CONSENT });
  expectStatus(res, 201);
  return { agent, userId: res.body.user.id as string };
}

function createDirectUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner', balance = 1000, status = 'active') {
  const id = `usr_test_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, username, `${username}@test.local`, hashPassword(PASSWORD), role, status, now, now);
  createWallet(db, id, balance, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string, password = PASSWORD): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password });
  expectStatus(res, 200);
  return agent;
}

async function createTicket(
  agent: Agent,
  input: Partial<{ subject: string; category: string; description: string; priority: string }> = {},
): Promise<TicketLike> {
  const res = await agent
    .post('/api/tickets')
    .set(CSRF)
    .send({
      subject: 'Test ticket',
      category: 'question',
      description: 'A sufficiently detailed description for the support request.',
      ...input,
    });
  expectStatus(res, 201);
  return res.body.ticket as TicketLike;
}

function ledgerTotal(userId: string): number {
  return (
    db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM ledger WHERE user_id = ?').get(userId) as { total: number }
  ).total;
}

function walletBalance(userId: string): number {
  return (db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId) as { balance: number }).balance;
}

function assertLedgerMatchesWallet(userId: string) {
  expect(ledgerTotal(userId)).toBe(walletBalance(userId));
  expect(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM wallets w WHERE w.user_id = ?
         AND w.balance <> (SELECT COALESCE(SUM(amount),0) FROM ledger l WHERE l.user_id = w.user_id)`,
      )
      .get(userId) as { count: number },
  ).toEqual({ count: 0 });
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  const owner = await registerAgent('ownerqa', 'ownerqa@test.local');
  const admin = await registerAgent('adminqa', 'adminqa@test.local');
  const support = await registerAgent('supportqa', 'supportqa@test.local');
  const player = await registerAgent('playerqa', 'playerqa@test.local');

  ownerAgent = owner.agent;
  ownerId = owner.userId;
  adminAgent = admin.agent;
  adminId = admin.userId;
  supportAgent = support.agent;
  supportId = support.userId;
  playerAgent = player.agent;
  playerId = player.userId;

  db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(ownerId);
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminId);
  db.prepare("UPDATE users SET role = 'support' WHERE id = ?").run(supportId);

  otherId = createDirectUser('otherqa', 'user');
  otherAgent = await signIn('otherqa');
}, 30_000);

afterAll(() => {
  db.close();
});

describe('authentication and account security', () => {
  it('creates an account with a persisted wallet and welcome ledger entry', async () => {
    const me = await playerAgent.get('/api/auth/me');
    expectStatus(me, 200);
    expect(me.body.user.id).toBe(playerId);
    expect(me.body.user.balance).toBe(5_000_000);

    const wallet = await playerAgent.get('/api/me/wallet');
    expectStatus(wallet, 200);
    expect(wallet.body.balance).toBe(5_000_000);
    expect(wallet.body.lifetimeGranted).toBe(5_000_000);
    expect(wallet.body.payoutCap).toBeGreaterThan(0);

    const transactions = await playerAgent.get('/api/me/transactions');
    expectStatus(transactions, 200);
    expect(transactions.body.total).toBe(1);
    expect(transactions.body.items[0]).toMatchObject({ type: 'initial_grant', amount: 5_000_000, balanceAfter: 5_000_000 });
    assertLedgerMatchesWallet(playerId);
  });

  it('rejects duplicate usernames and emails', async () => {
    const duplicate = request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ username: 'playerqa', email: 'brand-new@test.local', password: PASSWORD, ...LEGAL_CONSENT });
    const res = await duplicate;
    expectStatus(res, 409);
    expect(res.body.error.code).toBe('ACCOUNT_EXISTS');

    const duplicateEmail = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ username: 'brandnew', email: 'playerqa@test.local', password: PASSWORD, ...LEGAL_CONSENT });
    expectStatus(duplicateEmail, 409);
    expect(duplicateEmail.body.error.details.fields.email).toBeTruthy();
  });

  it('rejects malformed registrations with field errors', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ username: 'x', email: 'not-an-email', password: 'short' });
    expectStatus(res, 400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.username).toBeTruthy();
    expect(res.body.error.details.fields.email).toBeTruthy();
    expect(res.body.error.details.fields.password).toBeTruthy();
  });

  it('requires authentication for protected endpoints and rejects missing CSRF headers', async () => {
    const anonymous = await request(app).get('/api/me/overview');
    expectStatus(anonymous, 401);

    const noCsrf = await playerAgent.post('/api/tickets').send({
      subject: 'No CSRF',
      category: 'question',
      description: 'This should be rejected before validation.',
    });
    expectStatus(noCsrf, 403);
    expect(noCsrf.body.error.code).toBe('CSRF_HEADER');
  });

  it('handles invalid credentials, valid login, and logout', async () => {
    createDirectUser('loginuser', 'user');
    const agent = request.agent(app);
    const bad = await agent.post('/api/auth/login').set(CSRF).send({ identifier: 'loginuser', password: 'wrong-password' });
    expectStatus(bad, 401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

    const good = await agent.post('/api/auth/login').set(CSRF).send({ identifier: 'loginuser', password: PASSWORD });
    expectStatus(good, 200);
    expect(good.body.user.username).toBe('loginuser');

    const logout = await agent.post('/api/auth/logout').set(CSRF);
    expectStatus(logout, 200);
    const after = await agent.get('/api/auth/me');
    expectStatus(after, 200);
    expect(after.body.user).toBeNull();
  });

  it('blocks suspended accounts at login', async () => {
    createDirectUser('suspendedqa', 'user', 1000, 'suspended');
    const res = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: 'suspendedqa', password: PASSWORD });
    expectStatus(res, 403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('completes password reset, invalidates old sessions, and accepts the new password', async () => {
    createDirectUser('resetuser', 'user');
    const oldAgent = await signIn('resetuser');

    const forgot = await request(app).post('/api/auth/forgot-password').set(CSRF).send({ email: 'resetuser@test.local' });
    expectStatus(forgot, 200);
    expect(forgot.body.resetPath).toMatch(/^\/reset-password\?token=/);
    const token = new URL(forgot.body.resetPath, 'http://localhost').searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .set(CSRF)
      .send({ token, password: 'BrandNewPass!2026' });
    expectStatus(reset, 200);

    const oldSession = await oldAgent.get('/api/auth/me');
    expect(oldSession.body.user).toBeNull();

    const oldPassword = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: 'resetuser', password: PASSWORD });
    expectStatus(oldPassword, 401);

    const newAgent = await signIn('resetuser', 'BrandNewPass!2026');
    const me = await newAgent.get('/api/auth/me');
    expect(me.body.user.username).toBe('resetuser');
  });

  it('invalidates expired sessions', async () => {
    createDirectUser('expiryuser', 'user');
    const agent = await signIn('expiryuser');
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(
      'usr_test_expiryuser',
    );
    const res = await agent.get('/api/auth/me');
    expectStatus(res, 200);
    expect(res.body.user).toBeNull();
  });

  it('records versioned legal consent with timestamp and IP, and gates outdated versions', async () => {
    const suffix = unique('legal');
    const userId = createDirectUser(suffix, 'user');
    const account = { agent: await signIn(suffix), userId };

    const stored = db
      .prepare('SELECT * FROM legal_acceptances WHERE user_id = ?')
      .get(playerId) as {
      terms_version: string;
      privacy_version: string;
      age_confirmed: number;
      tos_accepted: number;
      donut_rules_acknowledged: number;
      accepted_at: string;
      ip: string | null;
    };
    expect(stored.terms_version).toBe(LEGAL_TERMS_VERSION);
    expect(stored.privacy_version).toBe(LEGAL_PRIVACY_VERSION);
    expect(stored.age_confirmed).toBe(1);
    expect(stored.tos_accepted).toBe(1);
    expect(stored.donut_rules_acknowledged).toBe(1);
    expect(Date.parse(stored.accepted_at)).not.toBeNaN();
    expect(stored.ip).toBeTruthy();

    const accepted = await account.agent.get('/api/legal/status');
    expectStatus(accepted, 200);
    expect(accepted.body.required).toBe(false);

    db.prepare('UPDATE legal_acceptances SET terms_version = ? WHERE user_id = ?').run('0.9', account.userId);
    const stale = await account.agent.get('/api/auth/me');
    expectStatus(stale, 200);
    expect(stale.body.user.legalAcceptanceRequired).toBe(true);

    const blocked = await account.agent.get('/api/me/wallet');
    expectStatus(blocked, 403);
    expect(blocked.body.error.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');

    const missing = await account.agent
      .post('/api/legal/accept')
      .set(CSRF)
      .send({ ageConfirmed: true, acceptTerms: true, acknowledgeDonutRules: false });
    expectStatus(missing, 400);

    const reaccepted = await account.agent
      .post('/api/legal/accept')
      .set(CSRF)
      .send({ ageConfirmed: true, acceptTerms: true, acknowledgeDonutRules: true });
    expectStatus(reaccepted, 200);
    expect(reaccepted.body.user.legalAcceptanceRequired).toBe(false);
    expect(reaccepted.body.status.required).toBe(false);

    const history = db
      .prepare('SELECT COUNT(*) AS count FROM legal_acceptances WHERE user_id = ?')
      .get(account.userId) as { count: number };
    expect(history.count).toBe(2);

    const wallet = await account.agent.get('/api/me/wallet');
    expectStatus(wallet, 200);
  });

  it('self-excludes an account, signs it out, and blocks future login', async () => {
    const suffix = unique('sx');
    const userId = createDirectUser(suffix, 'user');
    const account = { agent: await signIn(suffix), userId };

    const excluded = await account.agent
      .post('/api/me/self-exclusion')
      .set(CSRF)
      .send({ duration: '24h', reason: 'Testing the self-exclusion flow.' });
    expectStatus(excluded, 200);
    expect(excluded.body.until).toBeTruthy();

    const signedOut = await account.agent.get('/api/auth/me');
    expectStatus(signedOut, 200);
    expect(signedOut.body.user).toBeNull();

    const login = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: suffix, password: PASSWORD });
    expectStatus(login, 403);
    expect(login.body.error.code).toBe('SELF_EXCLUDED');

    const row = db
      .prepare('SELECT self_excluded_until, self_exclusion_reason FROM users WHERE id = ?')
      .get(account.userId) as { self_excluded_until: string; self_exclusion_reason: string };
    expect(new Date(row.self_excluded_until).getTime()).toBeGreaterThan(Date.now());
    expect(row.self_exclusion_reason).toContain('self-exclusion flow');
  });
});

describe('support tickets and cashier-only money requests', () => {
  it('creates ordinary tickets and rejects every ticket money-request path', async () => {
    workflowTicket = await createTicket(playerAgent, {
      subject: 'Roulette display question',
      category: 'question',
      description: 'I would like to understand how the roulette multiplier labels work.',
    });
    walletTicket = await createTicket(playerAgent, {
      subject: 'Wallet correction question',
      category: 'wallet',
      description: 'Please review a ledger entry for a round I believe settled incorrectly.',
    });

    const refs = [workflowTicket.reference, walletTicket.reference];
    expect(new Set(refs).size).toBe(2);
    for (const reference of refs) expect(reference).toMatch(/^TKT-\d{4}-\d{6}$/);

    const categories = await playerAgent.get('/api/tickets/categories');
    expectStatus(categories, 200);
    expect(
      categories.body.categories.some((category: { key: string }) => category.key === 'credit_request'),
    ).toBe(false);

    const oldCategory = await playerAgent
      .post('/api/tickets')
      .set(CSRF)
      .send({
        subject: 'Need practice money',
        category: 'credit_request',
        description: 'Please grant me DonutSMP money through a support ticket.',
      });
    expectStatus(oldCategory, 400);
    expect(oldCategory.body.error.code).toBe('USE_CASHIER');

    const before = (
      db.prepare('SELECT COUNT(*) AS count FROM credit_requests').get() as { count: number }
    ).count;
    expect(before).toBe(0);
  });

  it('scopes player lists to their own tickets while staff see the permitted queue', async () => {
    const own = await playerAgent.get('/api/tickets?own=true&pageSize=50');
    expectStatus(own, 200);
    expect(own.body.total).toBe(2);
    expect(own.body.counts.new).toBe(2);
    expect(own.body.items.every((ticket: { requester: { id: string } }) => ticket.requester.id === playerId)).toBe(true);

    const playerUnscoped = await playerAgent.get('/api/tickets');
    expectStatus(playerUnscoped, 200);
    expect(playerUnscoped.body.total).toBe(2);

    const ownerOwn = await ownerAgent.get('/api/tickets?own=true');
    expect(ownerOwn.body.total).toBe(0);

    const staffList = await supportAgent.get('/api/tickets?pageSize=50');
    expectStatus(staffList, 200);
    expect(staffList.body.total).toBeGreaterThanOrEqual(2);
    expect(staffList.body.counts.new).toBeGreaterThanOrEqual(2);
  });

  it('filters, searches, paginates, and protects ticket access', async () => {
    const filtered = await supportAgent.get('/api/tickets?status=new&category=wallet&pageSize=50');
    expectStatus(filtered, 200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items.every((ticket: { category: string }) => ticket.category === 'wallet')).toBe(true);

    const searched = await supportAgent.get(`/api/tickets?q=${encodeURIComponent(workflowTicket.reference)}&pageSize=50`);
    expectStatus(searched, 200);
    expect(searched.body.items.map((ticket: { reference: string }) => ticket.reference)).toContain(workflowTicket.reference);

    const firstPage = await supportAgent.get('/api/tickets?page=1&pageSize=1');
    const secondPage = await supportAgent.get('/api/tickets?page=2&pageSize=1');
    expectStatus(firstPage, 200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.totalPages).toBeGreaterThanOrEqual(2);
    expect(secondPage.body.items.length).toBeGreaterThan(0);

    const forbidden = await otherAgent.get(`/api/tickets/${workflowTicket.reference}`);
    expectStatus(forbidden, 403);

    const notFound = await supportAgent.get('/api/tickets/TKT-2026-999999');
    expectStatus(notFound, 404);
  });

  it('lets staff claim, reassign, reply, note, and change priority', async () => {
    const claim = await supportAgent.post(`/api/tickets/${workflowTicket.reference}/claim`).set(CSRF).send({});
    expectStatus(claim, 200);
    expect(claim.body.ticket.assignee.id).toBe(supportId);
    expect(claim.body.ticket.reference).toBe(workflowTicket.reference);

    const duplicateClaim = await supportAgent.post(`/api/tickets/${workflowTicket.reference}/claim`).set(CSRF).send({});
    expectStatus(duplicateClaim, 409);

    const counts = await supportAgent.get('/api/staff/overview');
    expectStatus(counts, 200);
    expect(counts.body.counts.assignedToMe).toBe(1);
    expect(counts.body.counts.unassigned).toBeGreaterThanOrEqual(1);

    const reassign = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/assign`)
      .set(CSRF)
      .send({ assigneeId: adminId, reason: 'Escalating the product question.' });
    expectStatus(reassign, 200);
    expect(reassign.body.ticket.assignee.id).toBe(adminId);

    const note = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/messages`)
      .set(CSRF)
      .send({ body: 'INTERNAL-SECRET note for staff only', visibility: 'internal' });
    expectStatus(note, 201);
    expect(note.body.ticket.messages.some((message: { body: string }) => message.body.includes('INTERNAL-SECRET'))).toBe(
      true,
    );

    const reply = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Thanks for reaching out — the labels are wager multipliers.' });
    expectStatus(reply, 201);
    expect(reply.body.ticket.status).toBe('in_progress');

    const priority = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/priority`)
      .set(CSRF)
      .send({ priority: 'high' });
    expectStatus(priority, 200);
    expect(priority.body.ticket.priority).toBe('high');
  });

  it('hides internal notes and staff-only data from the requester', async () => {
    const res = await playerAgent.get(`/api/tickets/${workflowTicket.reference}`);
    expectStatus(res, 200);
    expect(res.body.ticket.messages.some((message: { visibility: string }) => message.visibility === 'internal')).toBe(
      false,
    );
    expect(JSON.stringify(res.body.ticket)).not.toContain('INTERNAL-SECRET');
    expect(res.body.ticket.canAssign).toBe(false);
    expect(res.body.ticket.canNote).toBe(false);
  });

  it('enforces the ticket status workflow and keeps the reference stable', async () => {
    const noReason = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'on_hold' });
    expectStatus(noReason, 400);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const onHold = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'on_hold', reason: 'Waiting on the game provider.' });
    expectStatus(onHold, 200);
    expect(onHold.body.ticket.status).toBe('on_hold');
    expect(onHold.body.ticket.holdReason).toContain('Waiting');

    const replyFromHold = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/messages`)
      .set(CSRF)
      .send({ body: 'We have an update and can continue here.' });
    expectStatus(replyFromHold, 201);
    expect(replyFromHold.body.ticket.status).toBe('open');

    const waiting = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'waiting_user', reason: 'Please confirm the table name.' });
    expectStatus(waiting, 200);
    expect(waiting.body.ticket.status).toBe('waiting_user');

    const waitingCounts = await supportAgent.get('/api/staff/overview');
    expect(waitingCounts.body.counts.waitingUser).toBeGreaterThanOrEqual(1);

    const requesterReply = await playerAgent
      .post(`/api/tickets/${workflowTicket.reference}/messages`)
      .set(CSRF)
      .send({ body: 'It was the European roulette table.' });
    expectStatus(requesterReply, 201);
    expect(requesterReply.body.ticket.status).toBe('open');

    const resolved = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'resolved', reason: 'Explained the payout labels.' });
    expectStatus(resolved, 200);
    expect(resolved.body.ticket.status).toBe('resolved');

    const closed = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'closed' });
    expectStatus(closed, 200);
    expect(closed.body.ticket.status).toBe('closed');
    expect(closed.body.ticket.closedAt).toBeTruthy();

    const invalidReopen = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'in_progress' });
    expectStatus(invalidReopen, 400);
    expect(invalidReopen.body.error.code).toBe('INVALID_TRANSITION');

    const reopened = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'open', reason: 'Additional question arrived.' });
    expectStatus(reopened, 200);
    expect(reopened.body.ticket.reference).toBe(workflowTicket.reference);

    const rejectNoReason = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'rejected' });
    expectStatus(rejectNoReason, 400);

    const rejected = await supportAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'rejected', reason: 'Out of the supported scope for this queue.' });
    expectStatus(rejected, 200);
    expect(rejected.body.ticket.status).toBe('rejected');
    expect(rejected.body.ticket.rejectionReason).toContain('scope');
  });

  it('prevents players and lower roles from staff ticket actions', async () => {
    const playerStatus = await playerAgent
      .post(`/api/tickets/${workflowTicket.reference}/status`)
      .set(CSRF)
      .send({ status: 'closed' });
    expectStatus(playerStatus, 403);

    const playerClaim = await playerAgent.post(`/api/tickets/${workflowTicket.reference}/claim`).set(CSRF).send({});
    expectStatus(playerClaim, 403);

    const supportAdmin = await supportAgent.get('/api/admin/overview');
    expectStatus(supportAdmin, 403);

    const supportAudit = await supportAgent.get('/api/admin/audit');
    expectStatus(supportAudit, 403);
  });

  it('archives legacy ticket money requests as read-only history', async () => {
    // Simulate data created before money requests moved to the Cashier.
    db.prepare(
      `INSERT OR IGNORE INTO support_categories (key, label, description, enabled, default_priority, request_kinds, sort_order)
       VALUES ('credit_request', 'Archived money request', 'Archived. Money requests are handled in the Cashier.', 0, 'normal', '[]', 10)`,
    ).run();
    legacyTicketReference = 'TKT-2000-000001';
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
       VALUES ('tkt_legacy_money', ?, ?, 'Old money request', 'Historical ticket money request content.', 'credit_request', 'new', 'normal', ?, ?, ?)`,
    ).run(legacyTicketReference, playerId, now, now, now);
    db.prepare(
      `INSERT INTO credit_requests (id, ticket_id, user_id, kind, amount, status, created_at)
       VALUES ('crq_legacy_money', 'tkt_legacy_money', ?, 'grant', 7500, 'pending', ?)`,
    ).run(playerId, now);

    const before = walletBalance(playerId);
    const detail = await playerAgent.get(`/api/tickets/${legacyTicketReference}`);
    expectStatus(detail, 200);
    expect(detail.body.ticket.creditRequest).toMatchObject({ amount: 7500, status: 'pending' });
    expect(detail.body.ticket.canReviewCredit).toBeUndefined();
    expect(detail.body.ticket.categoryLabel).toBe('Archived money request');

    const list = await playerAgent.get('/api/tickets?own=true&pageSize=50');
    expectStatus(list, 200);
    expect(
      list.body.items.find((ticket: { reference: string }) => ticket.reference === legacyTicketReference)
        ?.hasArchivedMoneyRequest,
    ).toBe(true);

    const wallet = await playerAgent.get('/api/me/wallet');
    expectStatus(wallet, 200);
    expect(wallet.body.pendingCashier).toBe(0);
    expect(wallet.body.pendingRequests).toBeUndefined();

    const decision = await ownerAgent
      .post(`/api/tickets/${legacyTicketReference}/credit-decision`)
      .set(CSRF)
      .send({ decision: 'approve', reason: 'This endpoint should no longer exist.' });
    expectStatus(decision, 404);

    const oldMine = await playerAgent.get('/api/me/credit-requests');
    expectStatus(oldMine, 404);
    const oldAdmin = await ownerAgent.get('/api/admin/credit-requests');
    expectStatus(oldAdmin, 404);

    expect(walletBalance(playerId)).toBe(before);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM ledger WHERE user_id = ? AND type = 'credit_request'").get(playerId),
    ).toEqual({ count: 0 });

    const adminRecord = await adminAgent.get(`/api/admin/users/${playerId}`);
    expectStatus(adminRecord, 200);
    expect(adminRecord.body.creditRequests[0]).toMatchObject({ amount: 7500, status: 'pending' });
  });

  it('removes ticket money-request settings and exposes only cashier review queues', async () => {
    const oldTicketLimit = await ownerAgent
      .patch('/api/admin/settings/economy.credit_request_limit')
      .set(CSRF)
      .send({ value: 1000 });
    expectStatus(oldTicketLimit, 404);

    const oldStaffLimit = await ownerAgent
      .patch('/api/admin/settings/support.staff_approval_limit')
      .set(CSRF)
      .send({ value: 1000 });
    expectStatus(oldStaffLimit, 404);

    const cashierLimit = await ownerAgent
      .patch('/api/admin/settings/economy.cashier_request_limit')
      .set(CSRF)
      .send({ value: '5b' });
    expectStatus(cashierLimit, 200);
    expect(cashierLimit.body.value).toBe(5_000_000_000);

    const settings = await ownerAgent.get('/api/admin/settings');
    expectStatus(settings, 200);
    expect(settings.body.settings['economy.cashier_request_limit']).toBe(5_000_000_000);
    expect(settings.body.settings['economy.credit_request_limit']).toBeUndefined();
    expect(settings.body.settings['support.staff_approval_limit']).toBeUndefined();
    expect(
      settings.body.categories.some((category: { key: string }) => category.key === 'credit_request'),
    ).toBe(false);
    expect(settings.body.categories.every((category: { requestKinds?: unknown }) => category.requestKinds === undefined)).toBe(true);

    const reservedCategory = await ownerAgent
      .post('/api/admin/categories')
      .set(CSRF)
      .send({ key: 'credit_request', label: 'Money request', description: 'No longer allowed.', defaultPriority: 'normal' });
    expectStatus(reservedCategory, 409);

    const overview = await adminAgent.get('/api/admin/overview');
    expectStatus(overview, 200);
    expect(overview.body.tickets.pendingCashier).toBe(0);
    expect(overview.body.tickets.pendingCredits).toBeUndefined();
    expect(overview.body.pendingCashierRequests).toEqual([]);
    expect(overview.body.pendingRequests).toBeUndefined();

    const economy = await adminAgent.get('/api/admin/economy');
    expectStatus(economy, 200);
    expect(economy.body.pendingRequests).toBeUndefined();
  });

  it('delivers notifications and supports read state changes', async () => {
    const list = await playerAgent.get('/api/me/notifications?pageSize=50');
    expectStatus(list, 200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(list.body.unread).toBeGreaterThan(0);
    const firstUnread = list.body.items.find((notification: { readAt: string | null }) => !notification.readAt);
    expect(firstUnread).toBeTruthy();

    const read = await playerAgent.post(`/api/me/notifications/${firstUnread.id}/read`).set(CSRF).send({});
    expectStatus(read, 200);
    expect(read.body.unread).toBe(list.body.unread - 1);

    const all = await playerAgent.post('/api/me/notifications/read-all').set(CSRF).send({});
    expectStatus(all, 200);
    expect(all.body.unread).toBe(0);
  });
});

describe('wallet accounting and administrative controls', () => {
  it('applies an idempotent administrative adjustment and logs it', async () => {
    const before = walletBalance(playerId);
    const requestId = unique('adjust');
    const first = await ownerAgent
      .post(`/api/admin/users/${playerId}/adjust`)
      .set(CSRF)
      .send({ amount: 250, reason: 'Support goodwill credit.', requestId });
    expectStatus(first, 200);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.balance).toBe(before + 250);

    const second = await ownerAgent
      .post(`/api/admin/users/${playerId}/adjust`)
      .set(CSRF)
      .send({ amount: 250, reason: 'Support goodwill credit.', requestId });
    expectStatus(second, 200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.balance).toBe(before + 250);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM ledger WHERE idempotency_key = ?").get(`admin-adjust:${requestId}`),
    ).toEqual({ count: 1 });

    const self = await ownerAgent
      .post(`/api/admin/users/${ownerId}/adjust`)
      .set(CSRF)
      .send({ amount: 100, reason: 'Owner self adjustment.', requestId: unique('self') });
    expectStatus(self, 403);
    expect(self.body.error.code).toBe('SELF_ADJUSTMENT');

    const overdraft = await ownerAgent
      .post(`/api/admin/users/${playerId}/adjust`)
      .set(CSRF)
      .send({ amount: -9_999_999, reason: 'Invalid overdraft correction.', requestId: unique('overdraft') });
    expectStatus(overdraft, 400);
    expect(overdraft.body.error.code).toBe('INSUFFICIENT_CREDITS');
    assertLedgerMatchesWallet(playerId);

    const audit = await ownerAgent.get('/api/admin/audit?pageSize=100');
    expectStatus(audit, 200);
    expect(JSON.stringify(audit.body)).toContain('credits.admin_adjustment');
  });

  it('enforces user-management permissions and role hierarchy', async () => {
    const supportUsers = await supportAgent.get('/api/admin/users');
    expectStatus(supportUsers, 403);

    const ownerSelfRole = await ownerAgent
      .patch(`/api/admin/users/${ownerId}/role`)
      .set(CSRF)
      .send({ role: 'admin', reason: 'Attempting self demotion.' });
    expectStatus(ownerSelfRole, 403);
    expect(ownerSelfRole.body.error.code).toBe('SELF_MODERATION');

    const adminOwnerRole = await adminAgent
      .patch(`/api/admin/users/${ownerId}/role`)
      .set(CSRF)
      .send({ role: 'admin', reason: 'Attempting to demote the owner.' });
    expectStatus(adminOwnerRole, 403);

    const adminUsers = await adminAgent.get('/api/admin/users?pageSize=50');
    expectStatus(adminUsers, 200);
    expect(JSON.stringify(adminUsers.body)).toContain('playerqa');

    const staffCreated = await ownerAgent
      .post('/api/admin/staff')
      .set(CSRF)
      .send({ username: 'newstaff', email: 'newstaff@test.local', role: 'support', reason: 'Adding a support agent.' });
    expectStatus(staffCreated, 201);
    expect(staffCreated.body.user.role).toBe('support');
    expect(staffCreated.body.temporaryPassword).toMatch(/^Donutcash-/);

    const tempAgent = request.agent(app);
    const tempLogin = await tempAgent
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: 'newstaff', password: staffCreated.body.temporaryPassword });
    expectStatus(tempLogin, 200);

    const restricted = await adminAgent
      .patch(`/api/admin/users/${otherId}/status`)
      .set(CSRF)
      .send({ status: 'suspended', reason: 'Repeated abuse of virtual tables.' });
    expectStatus(restricted, 200);
    expect(restricted.body.user.status).toBe('suspended');

    const suspendedLogin = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: 'otherqa', password: PASSWORD });
    expectStatus(suspendedLogin, 403);
  });

  it('rejects invalid game configuration and records valid changes', async () => {
    const invalid = await ownerAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: 0, maxBet: 10000, config: { winMultiplier: 1.96 } });
    expectStatus(invalid, 400);

    const invalidMultiplier = await ownerAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: 1, maxBet: 10000, config: { winMultiplier: 999 } });
    expectStatus(invalidMultiplier, 400);

    const valid = await ownerAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: 1, maxBet: 10000, config: { winMultiplier: 1.96 } });
    expectStatus(valid, 200);

    const audit = await ownerAgent.get('/api/admin/audit?pageSize=100');
    expect(JSON.stringify(audit.body)).toContain('game.update');

    const economy = await ownerAgent.get('/api/admin/economy');
    expectStatus(economy, 200);
    expect(economy.body.reconcile).toEqual([]);
  });

  it('accepts K, M, B, and T shorthand in settings and wagers', async () => {
    const invalid = await ownerAgent
      .patch('/api/admin/settings/economy.starting_credits')
      .set(CSRF)
      .send({ value: 'not-a-number' });
    expectStatus(invalid, 400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.details.fields['economy.starting_credits']).toBeTruthy();

    const start = await ownerAgent
      .patch('/api/admin/settings/economy.starting_credits')
      .set(CSRF)
      .send({ value: '5m' });
    expectStatus(start, 200);
    expect(start.body.value).toBe(5_000_000);

    const requestLimit = await ownerAgent
      .patch('/api/admin/settings/economy.cashier_request_limit')
      .set(CSRF)
      .send({ value: '5b' });
    expectStatus(requestLimit, 200);
    expect(requestLimit.body.value).toBe(5_000_000_000);

    const cap = await ownerAgent
      .patch('/api/admin/settings/economy.max_payout')
      .set(CSRF)
      .send({ value: '1t' });
    expectStatus(cap, 200);
    expect(cap.body.value).toBe(1_000_000_000_000);

    const restoreCap = await ownerAgent
      .patch('/api/admin/settings/economy.max_payout')
      .set(CSRF)
      .send({ value: '1m' });
    expectStatus(restoreCap, 200);
    expect(restoreCap.body.value).toBe(1_000_000);

    const limits = await ownerAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: '1k', maxBet: '1m', config: { winMultiplier: 1.96 } });
    expectStatus(limits, 200);
    expect(limits.body.game.minBet).toBe(1000);
    expect(limits.body.game.maxBet).toBe(1_000_000);

    const restoreLimits = await ownerAgent
      .patch('/api/admin/games/coinflip')
      .set(CSRF)
      .send({ enabled: true, minBet: '1', maxBet: '10k', config: { winMultiplier: 1.96 } });
    expectStatus(restoreLimits, 200);
    expect(restoreLimits.body.game.minBet).toBe(1);
    expect(restoreLimits.body.game.maxBet).toBe(10_000);

    const shortWager = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('short-wager'), bet: '1k', pick: 'heads' });
    expectStatus(shortWager, 201);
    expect(shortWager.body.session.bet).toBe(1000);
    const ack = await playerAgent
      .post(`/api/games/sessions/${shortWager.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);
  });
});

describe('server-authoritative games', () => {
  function checkSessionLedgers(sessionId: string, bet: number, payout: number) {
    const rows = db
      .prepare('SELECT type, amount, ref_id FROM ledger WHERE ref_id = ? ORDER BY created_at')
      .all(sessionId) as { type: string; amount: number; ref_id: string }[];
    const wager = rows.find((row) => row.type === 'game_wager');
    expect(wager?.amount).toBe(-bet);
    if (payout > 0) {
      expect(rows.find((row) => row.type === 'game_payout')?.amount).toBe(payout);
    } else {
      expect(rows.some((row) => row.type === 'game_payout')).toBe(false);
    }
  }

  it('lists all six games with limits and public configuration', async () => {
    const res = await playerAgent.get('/api/games');
    expectStatus(res, 200);
    expect(res.body.games).toHaveLength(6);
    expect(res.body.games.map((game: { slug: string }) => game.slug).sort()).toEqual(
      ['blackjack', 'coinflip', 'mines', 'plinko', 'roulette', 'towers'].sort(),
    );
    expect(res.body.games.every((game: { minBet: number; maxBet: number }) => game.minBet > 0 && game.maxBet >= game.minBet)).toBe(true);
    expect(res.body.maintenance).toBe(false);
  });

  it('rejects invalid wagers before touching the wallet', async () => {
    const before = walletBalance(playerId);
    const zero = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('wager'), bet: 0, pick: 'heads' });
    expectStatus(zero, 400);

    const tooHigh = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('wager'), bet: 10_001, pick: 'heads' });
    expectStatus(tooHigh, 400);
    expect(tooHigh.body.error.code).toBe('WAGER_TOO_HIGH');

    expect(walletBalance(playerId)).toBe(before);
  });

  it('settles coinflip atomically and makes repeated request ids idempotent', async () => {
    const before = walletBalance(playerId);
    const requestId = unique('coinflip');
    const res = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId, bet: 100, pick: 'heads' });
    expectStatus(res, 201);
    expect(['won', 'lost']).toContain(res.body.session.status);
    expect(res.body.won).toBe(res.body.session.status === 'won');
    const expectedPayout = res.body.won ? 196 : 0;
    expect(res.body.session.payout).toBe(expectedPayout);
    expect(res.body.balance).toBe(before - 100 + expectedPayout);
    checkSessionLedgers(res.body.session.id, 100, expectedPayout);

    const duplicate = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId, bet: 100, pick: 'heads' });
    expectStatus(duplicate, 201);
    expect(duplicate.body.session.id).toBe(res.body.session.id);
    expect(duplicate.body.balance).toBe(res.body.balance);

    const reused = await playerAgent
      .post('/api/games/mines/play')
      .set(CSRF)
      .send({ requestId, bet: 10, mines: 3 });
    expectStatus(reused, 400);
    expect(reused.body.error.code).toBe('REQUEST_ID_REUSED');

    const ack = await playerAgent
      .post(`/api/games/sessions/${res.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);
    assertLedgerMatchesWallet(playerId);
  });

  it('settles mines with validated reveals and cash-out', async () => {
    const before = walletBalance(playerId);
    const start = await playerAgent
      .post('/api/games/mines/play')
      .set(CSRF)
      .send({ requestId: unique('mines'), bet: 50, mines: 3 });
    expectStatus(start, 201);
    expect(start.body.session.status).toBe('active');
    expect(start.body.balance).toBe(before - 50);
    expect(start.body.mineTiles).toBeNull();

    const premature = await playerAgent
      .post(`/api/games/sessions/${start.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: unique('mines'), action: 'cashout' });
    expectStatus(premature, 400);

    const revealId = unique('reveal');
    const reveal = await playerAgent
      .post(`/api/games/sessions/${start.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: revealId, action: 'reveal', tile: 0 });
    expectStatus(reveal, 200);
    expect(Array.isArray(reveal.body.revealed)).toBe(true);

    if (reveal.body.session.status === 'active') {
      const duplicate = await playerAgent
        .post(`/api/games/sessions/${start.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: revealId, action: 'reveal', tile: 0 });
      expectStatus(duplicate, 200);
      expect(duplicate.body.session.status).toBe('active');

      const cashout = await playerAgent
        .post(`/api/games/sessions/${start.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('cashout'), action: 'cashout' });
      expectStatus(cashout, 200);
      expect(cashout.body.session.status).toBe('won');
      expect(cashout.body.session.payout).toBeGreaterThan(0);
      checkSessionLedgers(start.body.session.id, 50, cashout.body.session.payout);
    } else {
      expect(reveal.body.session.status).toBe('lost');
      expect(reveal.body.session.payout).toBe(0);
      checkSessionLedgers(start.body.session.id, 50, 0);
      const afterLoss = await playerAgent
        .post(`/api/games/sessions/${start.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('after'), action: 'cashout' });
      expectStatus(afterLoss, 409);
    }

    const wallet = await playerAgent.get('/api/me/wallet');
    expect(wallet.body.balance).toBe(walletBalance(playerId));
    assertLedgerMatchesWallet(playerId);
  });

  it('settles a complete blackjack hand', async () => {
    const before = walletBalance(playerId);
    const start = await playerAgent
      .post('/api/games/blackjack/play')
      .set(CSRF)
      .send({ requestId: unique('blackjack'), bet: 50 });
    expectStatus(start, 201);
    expect(start.body.playerCards.length).toBeGreaterThanOrEqual(2);
    expect(start.body.dealerCards.length).toBeGreaterThanOrEqual(2);
    expect(['active', 'won', 'lost', 'push']).toContain(start.body.session.status);
    expect(start.body.balance).toBe(before - 50 + (start.body.session.status === 'active' ? 0 : start.body.session.payout));

    let view = start.body;
    if (view.session.status === 'active') {
      const stand = await playerAgent
        .post(`/api/games/sessions/${view.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('stand'), action: 'stand' });
      expectStatus(stand, 200);
      view = stand.body;
    }
    expect(['won', 'lost', 'push']).toContain(view.session.status);
    if (view.session.status === 'won') expect(view.session.payout).toBeGreaterThan(0);
    if (view.session.status === 'lost') expect(view.session.payout).toBe(0);
    if (view.session.status === 'push') expect(view.session.payout).toBe(50);
    expect(view.balance).toBe(before - 50 + view.session.payout);
    checkSessionLedgers(view.session.id, 50, view.session.payout);
  });

  it('validates roulette bets and applies the declared payout table', async () => {
    const before = walletBalance(playerId);
    const res = await playerAgent
      .post('/api/games/roulette/play')
      .set(CSRF)
      .send({ requestId: unique('roulette'), bet: 50, bets: [{ type: 'red', amount: 50 }] });
    expectStatus(res, 201);
    expect(res.body.winningNumber).toBeGreaterThanOrEqual(0);
    expect(res.body.winningNumber).toBeLessThanOrEqual(36);
    expect(['red', 'black', 'green']).toContain(res.body.color);
    expect([0, 100]).toContain(res.body.totalPayout);
    expect(res.body.balance).toBe(before - 50 + res.body.totalPayout);
    checkSessionLedgers(res.body.session.id, 50, res.body.totalPayout);

    const ack = await playerAgent
      .post(`/api/games/sessions/${res.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);

    const mismatch = await playerAgent
      .post('/api/games/roulette/play')
      .set(CSRF)
      .send({ requestId: unique('roulette'), bet: 100, bets: [{ type: 'red', amount: 50 }] });
    expectStatus(mismatch, 400);
    expect(mismatch.body.error.code).toBe('BET_MISMATCH');
  });

  it('settles towers with progression and cash-out', async () => {
    const before = walletBalance(playerId);
    const start = await playerAgent
      .post('/api/games/towers/play')
      .set(CSRF)
      .send({ requestId: unique('towers'), bet: 50 });
    expectStatus(start, 201);
    expect(start.body.session.status).toBe('active');

    const reveal = await playerAgent
      .post(`/api/games/sessions/${start.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: unique('tower'), action: 'reveal', tile: 0 });
    expectStatus(reveal, 200);

    if (reveal.body.session.status === 'active') {
      expect(reveal.body.multiplier).toBeGreaterThan(1);
      const cashout = await playerAgent
        .post(`/api/games/sessions/${start.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('tower-cashout'), action: 'cashout' });
      expectStatus(cashout, 200);
      expect(cashout.body.session.status).toBe('won');
      expect(cashout.body.session.payout).toBeGreaterThan(0);
      checkSessionLedgers(start.body.session.id, 50, cashout.body.session.payout);
    } else {
      expect(reveal.body.session.status).toBe('lost');
      expect(reveal.body.session.payout).toBe(0);
      checkSessionLedgers(start.body.session.id, 50, 0);
    }
    assertLedgerMatchesWallet(playerId);
  });

  it('settles plinko with the server-provided path and multiplier', async () => {
    const before = walletBalance(playerId);
    const res = await playerAgent
      .post('/api/games/plinko/play')
      .set(CSRF)
      .send({ requestId: unique('plinko'), bet: 50, risk: 'medium' });
    expectStatus(res, 201);
    expect(res.body.path).toHaveLength(12);
    expect(res.body.slot).toBeGreaterThanOrEqual(0);
    expect(res.body.slot).toBeLessThanOrEqual(12);
    expect(res.body.multiplier).toBeGreaterThan(0);
    expect(res.body.session.payout).toBe(Math.floor(50 * res.body.multiplier));
    expect(res.body.balance).toBe(before - 50 + res.body.session.payout);
    checkSessionLedgers(res.body.session.id, 50, res.body.session.payout);

    const ack = await playerAgent
      .post(`/api/games/sessions/${res.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);
    assertLedgerMatchesWallet(playerId);
  });

  it('prevents two concurrent wagers from overspending the same wallet', async () => {
    createDirectUser('racer', 'user');
    const racerAgent = await signIn('racer');
    const before = walletBalance('usr_test_racer');

    const [one, two] = await Promise.all([
      racerAgent
        .post('/api/games/mines/play')
        .set(CSRF)
        .send({ requestId: unique('race'), bet: 600, mines: 3 }),
      racerAgent
        .post('/api/games/mines/play')
        .set(CSRF)
        .send({ requestId: unique('race'), bet: 600, mines: 3 }),
    ]);
    const statuses = [one.status, two.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = one.status === 409 ? one : two;
    expect(rejected.body.error.code).toBe('ACTIVE_ROUND');
    expect(walletBalance('usr_test_racer')).toBe(before - 600);
    const active = db
      .prepare("SELECT COUNT(*) AS count FROM game_sessions WHERE user_id = 'usr_test_racer' AND status = 'active'")
      .get() as { count: number };
    expect(active.count).toBe(1);
    assertLedgerMatchesWallet('usr_test_racer');
  });

  it('limits a player to one round and restores it across navigation', async () => {
    createDirectUser('roundqa', 'user');
    const agent = await signIn('roundqa');

    const spin = await agent
      .post('/api/games/roulette/play')
      .set(CSRF)
      .send({ requestId: unique('lock'), bet: 10, bets: [{ type: 'red', amount: 10 }] });
    expectStatus(spin, 201);

    const blocked = await agent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('blocked'), bet: 10, pick: 'heads' });
    expectStatus(blocked, 409);
    expect(blocked.body.error.code).toBe('ACTIVE_ROUND');
    expect(blocked.body.error.message).toBe('Finish your current game first.');
    expect(blocked.body.error.details.activeRound.game).toBe('roulette');

    const active = await agent.get('/api/games/active');
    expectStatus(active, 200);
    expect(active.body.round.game).toBe('roulette');
    expect(active.body.round.status).toBe('settled');
    expect(active.body.round.view.winningNumber).toBe(spin.body.winningNumber);
    expect(active.body.round.view.session.id).toBe(spin.body.session.id);

    const ack = await agent
      .post(`/api/games/sessions/${spin.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(ack, 200);

    const cleared = await agent.get('/api/games/active');
    expect(cleared.body.round).toBeNull();

    const coinflip = await agent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('next'), bet: 10, pick: 'heads' });
    expectStatus(coinflip, 201);
    await agent.post(`/api/games/sessions/${coinflip.body.session.id}/acknowledge`).set(CSRF).send({});

    const mines = await agent
      .post('/api/games/mines/play')
      .set(CSRF)
      .send({ requestId: unique('mines-lock'), bet: 10, mines: 3 });
    expectStatus(mines, 201);

    const playing = await agent.get('/api/games/active');
    expect(playing.body.round.game).toBe('mines');
    expect(playing.body.round.status).toBe('playing');
    expect(playing.body.round.view.mineTiles).toBeNull();

    const prematureAck = await agent
      .post(`/api/games/sessions/${mines.body.session.id}/acknowledge`)
      .set(CSRF)
      .send({});
    expectStatus(prematureAck, 400);
    expect(prematureAck.body.error.code).toBe('ROUND_ACTIVE');

    // Simulate a database upgraded from before the lock existed: the session
    // is active but has no lock row. Loading the active round adopts it.
    db.prepare("DELETE FROM active_rounds WHERE user_id = 'usr_test_roundqa'").run();
    const adoptedOnLoad = await agent.get('/api/games/active');
    expect(adoptedOnLoad.body.round.game).toBe('mines');

    // Starting without loading the page must adopt it too, after the failed
    // start transaction rolls back.
    db.prepare("DELETE FROM active_rounds WHERE user_id = 'usr_test_roundqa'").run();
    const adopted = await agent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('legacy-blocked'), bet: 10, pick: 'heads' });
    expectStatus(adopted, 409);
    expect(adopted.body.error.code).toBe('ACTIVE_ROUND');
    expect(adopted.body.error.details.activeRound.game).toBe('mines');

    const rehydrated = await agent.get('/api/games/active');
    expect(rehydrated.body.round.game).toBe('mines');
    expect(rehydrated.body.round.status).toBe('playing');

    // A stale lock must not hide an unfinished legacy session either.
    db.prepare(
      "UPDATE active_rounds SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = 'usr_test_roundqa'",
    ).run();
    const stale = await agent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('stale-blocked'), bet: 10, pick: 'heads' });
    expectStatus(stale, 409);
    expect(stale.body.error.code).toBe('ACTIVE_ROUND');
    expect(stale.body.error.details.activeRound.game).toBe('mines');

    const rehydratedAgain = await agent.get('/api/games/active');
    expect(rehydratedAgain.body.round.game).toBe('mines');

    const reveal = await agent
      .post(`/api/games/sessions/${mines.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: unique('mines-reveal'), action: 'reveal', tile: 0 });
    expectStatus(reveal, 200);
    if (reveal.body.session.status === 'active') {
      const cashout = await agent
        .post(`/api/games/sessions/${mines.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('mines-cashout'), action: 'cashout' });
      expectStatus(cashout, 200);
      expect(cashout.body.session.status).toBe('won');
    }

    const released = await agent.get('/api/games/active');
    expect(released.body.round).toBeNull();
  });

  it('returns only the requester’s own session history', async () => {
    const history = await playerAgent.get('/api/games/history?pageSize=50');
    expectStatus(history, 200);
    expect(history.body.total).toBeGreaterThanOrEqual(5);
    for (const session of history.body.items) expect(session.game).toBeTruthy();

    const foreign = await ownerAgent.get('/api/games/history?pageSize=1');
    expectStatus(foreign, 200);
    expect(foreign.body.items).toEqual([]);
  });
});

describe('platform maintenance mode', () => {
  it('allows only administrators to change maintenance settings', async () => {
    const denied = await supportAgent
      .patch('/api/admin/settings/platform.maintenance')
      .set(CSRF)
      .send({ value: true });
    expectStatus(denied, 403);
  });

  it('shows maintenance publicly and blocks player writes while staff access continues', async () => {
    const preExisting = await playerAgent
      .post('/api/games/mines/play')
      .set(CSRF)
      .send({ requestId: unique('maint-open'), bet: 25, mines: 3 });
    expectStatus(preExisting, 201);
    expect(preExisting.body.session.status).toBe('active');

    const enabled = await ownerAgent
      .patch('/api/admin/settings/platform.maintenance_message')
      .set(CSRF)
      .send({ value: 'Scheduled database maintenance. Back in a few minutes.' });
    expectStatus(enabled, 200);

    const on = await ownerAgent.patch('/api/admin/settings/platform.maintenance').set(CSRF).send({ value: true });
    expectStatus(on, 200);

    const config = await request(app).get('/api/public/config');
    expectStatus(config, 200);
    expect(config.headers['cache-control']).toContain('no-store');
    expect(config.body.maintenance).toBe(true);
    expect(config.body.maintenanceMessage).toContain('Scheduled database maintenance');

    const registration = await request(app)
      .post('/api/auth/register')
      .set(CSRF)
      .send({ username: 'maintenanceuser', email: 'maintenance@test.local', password: PASSWORD, ...LEGAL_CONSENT });
    expectStatus(registration, 503);
    expect(registration.body.error.code).toBe('MAINTENANCE');

    const wager = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('maint'), bet: 1, pick: 'heads' });
    expectStatus(wager, 503);
    expect(wager.body.error.code).toBe('MAINTENANCE');

    const activeAction = await playerAgent
      .post(`/api/games/sessions/${preExisting.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: unique('maint-action'), action: 'cashout' });
    expectStatus(activeAction, 503);
    expect(activeAction.body.error.code).toBe('MAINTENANCE');

    const ticket = await playerAgent
      .post('/api/tickets')
      .set(CSRF)
      .send({ subject: 'Blocked ticket', category: 'question', description: 'This ticket must not be created during maintenance.' });
    expectStatus(ticket, 503);
    expect(ticket.body.error.code).toBe('MAINTENANCE');

    const cashier = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 10 });
    expectStatus(cashier, 503);
    expect(cashier.body.error.code).toBe('MAINTENANCE');

    const walletRead = await playerAgent.get('/api/me/wallet');
    expectStatus(walletRead, 200);
    const ticketsRead = await playerAgent.get('/api/tickets?own=true');
    expectStatus(ticketsRead, 200);

    const staff = await supportAgent.get('/api/staff/overview');
    expectStatus(staff, 200);
    const admin = await adminAgent.get('/api/admin/overview');
    expectStatus(admin, 200);
    const playerProfile = await playerAgent.get('/api/auth/me');
    expectStatus(playerProfile, 200);
    expect(playerProfile.body.user.username).toBe('playerqa');

    const audit = await ownerAgent.get('/api/admin/audit?pageSize=100');
    expect(JSON.stringify(audit.body)).toContain('platform.maintenance');

    const off = await ownerAgent.patch('/api/admin/settings/platform.maintenance').set(CSRF).send({ value: false });
    expectStatus(off, 200);
    const restored = await request(app).get('/api/public/config');
    expect(restored.body.maintenance).toBe(false);

    const reveal = await playerAgent
      .post(`/api/games/sessions/${preExisting.body.session.id}/action`)
      .set(CSRF)
      .send({ requestId: unique('maint-reveal'), action: 'reveal', tile: 0 });
    expectStatus(reveal, 200);
    if (reveal.body.session.status === 'active') {
      const cashout = await playerAgent
        .post(`/api/games/sessions/${preExisting.body.session.id}/action`)
        .set(CSRF)
        .send({ requestId: unique('maint-cashout'), action: 'cashout' });
      expectStatus(cashout, 200);
    }

    const resumed = await playerAgent
      .post('/api/games/coinflip/play')
      .set(CSRF)
      .send({ requestId: unique('resume'), bet: 1, pick: 'heads' });
    expectStatus(resumed, 201);
    await playerAgent.post(`/api/games/sessions/${resumed.body.session.id}/acknowledge`).set(CSRF).send({});
    assertLedgerMatchesWallet(playerId);
  });
});

describe('cashier deposit and withdrawal requests', () => {
  let depositReference = '';
  let withdrawalReference = '';
  let rejectedReference = '';

  it('creates an amount-only deposit request, carries messages, and lets the owner approve it', async () => {
    const before = walletBalance(playerId);
    const created = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 400 });
    expectStatus(created, 201);
    expect(created.body.request.kind).toBe('deposit');
    expect(created.body.request.amount).toBe(400);
    expect(created.body.request.status).toBe('pending');
    expect(created.body.request.description).toBeUndefined();
    expect(created.body.request.reference).toMatch(/^DEP-\d{4}-\d{6}$/);
    depositReference = created.body.request.reference;

    const ownList = await playerAgent.get('/api/cashier?status=pending&pageSize=20');
    expectStatus(ownList, 200);
    expect(ownList.body.items.some((item: { reference: string }) => item.reference === depositReference)).toBe(true);
    expect(ownList.body.counts.pending).toBeGreaterThanOrEqual(1);

    const queue = await adminAgent.get('/api/admin/cashier?status=pending&pageSize=20');
    expectStatus(queue, 200);
    expect(queue.body.items.some((item: { reference: string }) => item.reference === depositReference)).toBe(true);
    expect(queue.body.counts.pending).toBeGreaterThanOrEqual(1);

    const supportDenied = await supportAgent.get('/api/admin/cashier');
    expectStatus(supportDenied, 403);
    const supportDecision = await supportAgent
      .post(`/api/admin/cashier/${depositReference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve', reason: 'Support must not decide this.' });
    expectStatus(supportDecision, 403);

    const foreign = await supportAgent.get(`/api/cashier/${depositReference}`);
    expectStatus(foreign, 404);

    const playerMessage = await playerAgent
      .post(`/api/cashier/${depositReference}/messages`)
      .set(CSRF)
      .send({ body: 'Please review this practice deposit when you have a moment.' });
    expectStatus(playerMessage, 200);
    expect(playerMessage.body.request.messages).toHaveLength(2);

    const adminMessage = await adminAgent
      .post(`/api/admin/cashier/${depositReference}/messages`)
      .set(CSRF)
      .send({ body: 'We are reviewing the amount now.' });
    expectStatus(adminMessage, 200);
    expect(adminMessage.body.request.messages).toHaveLength(3);

    const approved = await ownerAgent
      .post(`/api/admin/cashier/${depositReference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve', reason: 'Verified practice deposit.' });
    expectStatus(approved, 200);
    expect(approved.body.request.status).toBe('approved');
    expect(approved.body.request.reviewer.username).toBe('ownerqa');
    expect(approved.body.request.ledgerId).toBeTruthy();
    expect(approved.body.request.messages.some((message: { visibility: string }) => message.visibility === 'system')).toBe(true);
    expect(walletBalance(playerId)).toBe(before + 400);
    assertLedgerMatchesWallet(playerId);

    const playerDetail = await playerAgent.get(`/api/cashier/${depositReference}`);
    expectStatus(playerDetail, 200);
    expect(playerDetail.body.request.status).toBe('approved');
    expect(playerDetail.body.request.decisionReason).toBe('Verified practice deposit.');

    const notifications = await playerAgent.get('/api/me/notifications?pageSize=20');
    expectStatus(notifications, 200);
    expect(JSON.stringify(notifications.body)).toContain(depositReference);
  });

  it('lets an administrator approve a withdrawal and records a rejection reason', async () => {
    const before = walletBalance(playerId);
    const created = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'withdrawal', amount: 125 });
    expectStatus(created, 201);
    expect(created.body.request.reference).toMatch(/^WDR-\d{4}-\d{6}$/);
    withdrawalReference = created.body.request.reference;

    const approved = await adminAgent
      .post(`/api/admin/cashier/${withdrawalReference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve' });
    expectStatus(approved, 200);
    expect(approved.body.request.status).toBe('approved');
    expect(walletBalance(playerId)).toBe(before - 125);
    assertLedgerMatchesWallet(playerId);

    const rejected = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 80 });
    expectStatus(rejected, 201);
    rejectedReference = rejected.body.request.reference;

    const noReason = await ownerAgent
      .post(`/api/admin/cashier/${rejectedReference}/decision`)
      .set(CSRF)
      .send({ decision: 'reject' });
    expectStatus(noReason, 400);
    expect(noReason.body.error.code).toBe('VALIDATION_ERROR');

    const balanceBeforeReject = walletBalance(playerId);
    const rejectedDecision = await ownerAgent
      .post(`/api/admin/cashier/${rejectedReference}/decision`)
      .set(CSRF)
      .send({ decision: 'reject', reason: 'This practice request is not eligible.' });
    expectStatus(rejectedDecision, 200);
    expect(rejectedDecision.body.request.status).toBe('rejected');
    expect(rejectedDecision.body.request.decisionReason).toBe('This practice request is not eligible.');
    expect(walletBalance(playerId)).toBe(balanceBeforeReject);
    assertLedgerMatchesWallet(playerId);
  });

  it('validates limits, protects pending requests, and supports cancellation', async () => {
    const balance = walletBalance(playerId);
    const tooLarge = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 5_000_000_001 });
    expectStatus(tooLarge, 400);
    expect(tooLarge.body.error.code).toBe('REQUEST_TOO_LARGE');

    const overBalance = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'withdrawal', amount: balance + 1 });
    expectStatus(overBalance, 400);
    expect(overBalance.body.error.code).toBe('INSUFFICIENT_CREDITS');

    const created = await playerAgent
      .post('/api/cashier')
      .set(CSRF)
      .send({ kind: 'deposit', amount: 60 });
    expectStatus(created, 201);
    const reference = created.body.request.reference as string;
    const balanceBeforeCancel = walletBalance(playerId);

    const cancelled = await playerAgent.post(`/api/cashier/${reference}/cancel`).set(CSRF).send({});
    expectStatus(cancelled, 200);
    expect(cancelled.body.request.status).toBe('cancelled');
    expect(walletBalance(playerId)).toBe(balanceBeforeCancel);

    const cancelAgain = await playerAgent.post(`/api/cashier/${reference}/cancel`).set(CSRF).send({});
    expectStatus(cancelAgain, 409);
    expect(cancelAgain.body.error.code).toBe('REQUEST_FINAL');

    const decideCancelled = await ownerAgent
      .post(`/api/admin/cashier/${reference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve' });
    expectStatus(decideCancelled, 409);
    expect(decideCancelled.body.error.code).toBe('ALREADY_DECIDED');

    assertLedgerMatchesWallet(playerId);
  });
});
