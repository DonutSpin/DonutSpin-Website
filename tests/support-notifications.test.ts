import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DB } from '../server/db/index.ts';
import type { SessionUser } from '../shared/types.ts';

const PRODUCTION_URL = 'https://donutspin.runasp.net';
const PASSWORD = 'SupportNotify!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const GUILD = '123456789012345678';
const TICKETS = '223456789012345678';
const TICKET_TRANSCRIPTS = '323456789012345678';
const CASHIER = '423456789012345678';
const CASHIER_TRANSCRIPTS = '523456789012345678';
const OWNER_ROLE = '611111111111111111';
const ADMIN_ROLE = '622222222222222222';
const STAFF_ROLE = '633333333333333333';

process.env.APP_URL = PRODUCTION_URL;

type Agent = ReturnType<typeof request.agent>;
const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: Express;
let ownerId: string;
let playerId: string;
let playerEmail: string;
let playerAgent: Agent;
let supportAgent: Agent;
let ownerAgent: Agent;
let processTicketReplyDigests: (db: DB, limit?: number) => number;
let renderEmail: (template: 'ticket-created' | 'ticket-reply', payload: Record<string, unknown>, email: unknown) => {
  subject: string;
  html: string;
  text: string;
};
let getEmailConfig: (db: DB) => unknown;

async function seedUser(
  cryptoModule: typeof import('../server/lib/crypto.ts'),
  walletModule: typeof import('../server/lib/wallet.ts'),
  legalModule: typeof import('../server/lib/legal.ts'),
  username: string,
  role: 'user' | 'support' | 'owner',
  email: string,
): Promise<string> {
  const id = `usr_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, email, cryptoModule.hashPassword(PASSWORD), role, now, now);
  walletModule.createWallet(db, id, 20_000_000, null);
  legalModule.recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

function outbox(eventType: string): { id: string; payload: string; dedupe_key: string }[] {
  return db
    .prepare('SELECT id, payload, dedupe_key FROM discord_outbox WHERE event_type = ? ORDER BY rowid ASC')
    .all(eventType) as { id: string; payload: string; dedupe_key: string }[];
}

function emailJobs(template: string): { id: string; payload: string; status: string; dedupe_key: string }[] {
  return db
    .prepare('SELECT id, payload, status, dedupe_key FROM email_jobs WHERE template = ? ORDER BY rowid ASC')
    .all(template) as { id: string; payload: string; status: string; dedupe_key: string }[];
}

function digestDueNow(ticketId: string): void {
  db.prepare("UPDATE ticket_reply_digests SET due_at = ? WHERE ticket_id = ? AND status = 'pending'").run(
    new Date(Date.now() - 1000).toISOString(),
    ticketId,
  );
}

function markPlayerOffline(): void {
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  db.prepare('UPDATE sessions SET last_used_at = ? WHERE user_id = ?').run(old, playerId);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(old, playerId);
}

function markPlayerOnline(ticketId: string, readAt?: string): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE sessions SET last_used_at = ?, revoked_at = NULL WHERE user_id = ?').run(now, playerId);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, playerId);
  if (readAt) {
    db.prepare(
      `INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, ?)
       ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    ).run(ticketId, playerId, readAt);
  }
}

beforeAll(async () => {
  const dbModule = await import('../server/db/index.ts');
  const appModule = await import('../server/app.ts');
  const cryptoModule = await import('../server/lib/crypto.ts');
  const walletModule = await import('../server/lib/wallet.ts');
  const legalModule = await import('../server/lib/legal.ts');
  const emailModule = await import('../server/lib/email.ts');
  const supportModule = await import('../server/lib/support-notifications.ts');
  const discordCore = await import('../server/lib/discord/core.ts');

  processTicketReplyDigests = supportModule.processTicketReplyDigests;
  renderEmail = emailModule.renderEmail as typeof renderEmail;
  getEmailConfig = emailModule.getEmailConfig;

  db = dbModule.createDatabase(':memory:');
  app = appModule.createApp(db);

  dbModule.setSetting(db, 'email.enabled', true, null);
  dbModule.setSetting(db, 'email.host', 'smtp.test.local', null);
  dbModule.setSetting(db, 'email.port', 587, null);
  dbModule.setSetting(db, 'email.secure', false, null);
  dbModule.setSetting(db, 'email.user', 'smtp-user', null);
  dbModule.setSetting(db, 'email.from_email', 'no-reply@donutspin.runasp.net', null);
  dbModule.setSetting(db, 'email.from_name', 'DonutSpin', null);
  dbModule.setSetting(db, 'email.smtp_pass_enc', cryptoModule.encryptSecret('smtp-pass'), null);

  ownerId = await seedUser(cryptoModule, walletModule, legalModule, 'notifyowner', 'owner', 'owner@notify.test');
  await seedUser(cryptoModule, walletModule, legalModule, 'notifysupport', 'support', 'support@notify.test');
  const playerName = `notifyplayer_${Date.now().toString(36)}`;
  playerEmail = `${playerName}@notify.test`;
  playerId = await seedUser(cryptoModule, walletModule, legalModule, playerName, 'user', playerEmail);

  playerAgent = await signIn(playerName);
  supportAgent = await signIn('notifysupport');
  ownerAgent = await signIn('notifyowner');

  discordCore.ensureGuildPlaceholder(db, GUILD);
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId) as SessionUser;
  discordCore.updateGuildConfig(
    db,
    GUILD,
    {
      channels: {
        tickets: TICKETS,
        ticketTranscripts: TICKET_TRANSCRIPTS,
        cashierRequests: CASHIER,
        cashierTranscripts: CASHIER_TRANSCRIPTS,
      },
      roles: { owner: [OWNER_ROLE], admin: [ADMIN_ROLE], staff: [STAFF_ROLE], moderator: [] },
    },
    owner,
  );

}, 30_000);

afterAll(() => {
  db?.close();
});

async function createTicket(subject: string): Promise<{ id: string; reference: string }> {
  const res = await playerAgent.post('/api/tickets').set(CSRF).send({
    subject,
    category: 'technical',
    description: 'The ticket integration test needs a detailed description.',
  });
  expectStatus(res, 201);
  return res.body.ticket as { id: string; reference: string };
}

describe('support email notifications', () => {
  it('emails a transactional creation receipt with a production ticket link', async () => {
    const created = await createTicket('Production link check');
    const jobs = emailJobs('ticket-created');
    const job = jobs.find((entry) => entry.dedupe_key === `ticket-created:${created.id}`);
    expect(job).toBeTruthy();
    const payload = JSON.parse(job!.payload) as Record<string, unknown>;
    expect(payload.reference).toBe(created.reference);
    expect(payload.subject).toBe('Production link check');
    expect(payload.ticketUrl).toBe(`/tickets/${created.reference}`);

    const rendered = renderEmail('ticket-created', payload, getEmailConfig(db));
    expect(rendered.subject).toContain(created.reference);
    expect(rendered.html).toContain(`${PRODUCTION_URL}/tickets/${created.reference}`);
    expect(rendered.text).toContain(`${PRODUCTION_URL}/tickets/${created.reference}`);
    expect(rendered.html).not.toContain('localhost');
    expect(rendered.text).not.toContain('localhost');
  });

  it('delays, groups, and suppresses reply emails based on presence and read state', async () => {
    const created = await createTicket('Smart reply digest');
    const replyOne = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'First staff reply with a fix.' });
    expectStatus(replyOne, 201);

    const pending = db
      .prepare('SELECT * FROM ticket_reply_digests WHERE ticket_id = ?')
      .get(created.id) as { message_ids: string; status: string };
    expect(pending.status).toBe('pending');
    expect(JSON.parse(pending.message_ids)).toHaveLength(1);

    markPlayerOffline();
    digestDueNow(created.id);
    expect(processTicketReplyDigests(db, 20)).toBe(1);

    let replies = emailJobs('ticket-reply');
    expect(replies).toHaveLength(1);
    const firstPayload = JSON.parse(replies[0]!.payload) as {
      reference: string;
      messages: { body: string }[];
      ticketUrl: string;
    };
    expect(firstPayload.reference).toBe(created.reference);
    expect(firstPayload.messages).toHaveLength(1);
    expect(firstPayload.messages[0]?.body).toContain('First staff reply');
    const firstRendered = renderEmail('ticket-reply', firstPayload, getEmailConfig(db));
    expect(firstRendered.html).toContain(`${PRODUCTION_URL}/tickets/${created.reference}`);
    expect(firstRendered.html).not.toContain('localhost');

    expect(processTicketReplyDigests(db, 20)).toBe(0);
    expect(emailJobs('ticket-reply')).toHaveLength(1);

    const replyTwo = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Second reply while the player is reading.' });
    expectStatus(replyTwo, 201);
    const latest = db
      .prepare(
        `SELECT created_at FROM ticket_messages
          WHERE ticket_id = ? AND body LIKE 'Second reply%' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(created.id) as { created_at: string };
    markPlayerOnline(created.id, new Date(Date.parse(latest.created_at) + 1000).toISOString());
    digestDueNow(created.id);
    expect(processTicketReplyDigests(db, 20)).toBe(0);
    expect(emailJobs('ticket-reply')).toHaveLength(1);

    markPlayerOffline();
    db.prepare('DELETE FROM ticket_reads WHERE ticket_id = ?').run(created.id);
    const replyThree = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Third reply while offline.' });
    expectStatus(replyThree, 201);
    const replyFour = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Fourth reply while still offline.' });
    expectStatus(replyFour, 201);

    digestDueNow(created.id);
    expect(processTicketReplyDigests(db, 20)).toBe(1);
    replies = emailJobs('ticket-reply');
    expect(replies).toHaveLength(2);
    const grouped = JSON.parse(replies[1]!.payload) as { messages: { body: string }[] };
    expect(grouped.messages).toHaveLength(2);
    expect(grouped.messages.map((message) => message.body).join(' ')).toContain('Third reply');
    expect(grouped.messages.map((message) => message.body).join(' ')).toContain('Fourth reply');
    expect(processTicketReplyDigests(db, 20)).toBe(0);
    expect(emailJobs('ticket-reply')).toHaveLength(2);
  });
});

describe('Discord support logging', () => {
  it('pings configured support roles for a new ticket and throttles reply pings', async () => {
    const created = await createTicket('Discord ticket notification');
    const createdEvents = outbox('ticket_notification').filter((event) => {
      const payload = JSON.parse(event.payload) as { reference?: string };
      return payload.reference === created.reference;
    });
    expect(createdEvents).toHaveLength(1);
    const createdPayload = JSON.parse(createdEvents[0]!.payload) as {
      kind: string;
      channelId: string;
      roleIds: string[];
      reference: string;
      requester: string;
    };
    expect(createdPayload.kind).toBe('created');
    expect(createdPayload.channelId).toBe(TICKETS);
    expect(createdPayload.roleIds).toEqual([OWNER_ROLE, ADMIN_ROLE, STAFF_ROLE]);
    expect(createdPayload.requester).toContain('notifyplayer');

    const firstReply = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'A staff reply that should ping the support roles.' });
    expectStatus(firstReply, 201);
    const secondReply = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'A second reply in the same burst must stay quiet.' });
    expectStatus(secondReply, 201);

    const replyEvents = outbox('ticket_notification').filter((event) => {
      const payload = JSON.parse(event.payload) as { reference?: string; kind?: string };
      return payload.reference === created.reference && payload.kind === 'reply';
    });
    expect(replyEvents).toHaveLength(1);
  });

  it('writes a full ticket transcript on close and again on reopen', async () => {
    const created = await createTicket('Transcript lifecycle');
    const reply = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Visible customer-facing answer.' });
    expectStatus(reply, 201);
    const note = await supportAgent
      .post(`/api/tickets/${created.reference}/messages`)
      .set(CSRF)
      .send({ body: 'Private staff context.', visibility: 'internal' });
    expectStatus(note, 201);

    const closed = await supportAgent
      .post(`/api/tickets/${created.reference}/status`)
      .set(CSRF)
      .send({ status: 'closed', reason: 'Issue resolved.' });
    expectStatus(closed, 200);

    let rows = db
      .prepare('SELECT kind, content, filename, status FROM ticket_transcripts WHERE ticket_id = ? ORDER BY created_at')
      .all(created.id) as { kind: string; content: string; filename: string; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('closed');
    expect(rows[0]!.content).toContain(created.reference);
    expect(rows[0]!.content).toContain('Transcript lifecycle');
    expect(rows[0]!.content).toContain('Visible customer-facing answer.');
    expect(rows[0]!.content).toContain('Private staff context.');
    expect(rows[0]!.content).toContain('Closed by:');
    expect(rows[0]!.content).toContain('Issue resolved.');
    expect(rows[0]!.filename).toContain(created.reference);
    expect(outbox('ticket_transcript').filter((event) => event.dedupe_key?.includes('ticket-transcript')).length).toBeGreaterThanOrEqual(1);

    const reopened = await supportAgent
      .post(`/api/tickets/${created.reference}/status`)
      .set(CSRF)
      .send({ status: 'open', reason: 'Player asked for another look.' });
    expectStatus(reopened, 200);
    const reopenedRows = db
      .prepare('SELECT kind, content FROM ticket_transcripts WHERE ticket_id = ? ORDER BY created_at')
      .all(created.id) as { kind: string; content: string }[];
    expect(reopenedRows.map((row) => row.kind)).toEqual(['closed', 'reopened']);
    expect(reopenedRows[1]!.content).toContain('Reopened by:');
    expect(reopenedRows[1]!.content).toContain('Player asked for another look.');
  });

  it('logs every cashier transition and keeps one growing transcript without sensitive email data', async () => {
    const create = await playerAgent.post('/api/cashier').set(CSRF).send({ kind: 'deposit', amount: 250_000 });
    expectStatus(create, 201);
    const reference = create.body.request.reference as string;
    const requestId = create.body.request.id as string;

    let transcript = db.prepare('SELECT * FROM cashier_transcripts WHERE request_id = ?').get(requestId) as {
      content: string;
      revision: number;
    };
    expect(transcript.revision).toBe(1);
    expect(transcript.content).toContain('AUDIT EVENTS');
    expect(transcript.content).toContain('created');
    expect(transcript.content).toContain('notifyplayer');
    expect(transcript.content).not.toContain(playerEmail);

    let events = outbox('cashier_notification').filter((event) => {
      const payload = JSON.parse(event.payload) as { reference?: string };
      return payload.reference === reference;
    });
    expect(events).toHaveLength(1);
    const initial = JSON.parse(events[0]!.payload) as { event: string; userId: string; username: string; status: string };
    expect(initial.event).toBe('created');
    expect(initial.userId).toBe(playerId);
    expect(initial.status).toBe('pending');

    const approved = await ownerAgent
      .post(`/api/admin/cashier/${reference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve', reason: 'Verified the deposit.' });
    expectStatus(approved, 200);
    transcript = db.prepare('SELECT * FROM cashier_transcripts WHERE request_id = ?').get(requestId) as {
      content: string;
      revision: number;
    };
    expect(transcript.revision).toBe(2);
    expect(transcript.content).toContain('approved');
    expect(transcript.content).toContain('Verified the deposit.');

    events = outbox('cashier_notification').filter((event) => {
      const payload = JSON.parse(event.payload) as { reference?: string };
      return payload.reference === reference;
    });
    expect(events).toHaveLength(2);
    const decided = JSON.parse(events[1]!.payload) as { event: string; decidedAt: string | null; staffName: string };
    expect(decided.event).toBe('approved');
    expect(decided.decidedAt).toBeTruthy();
    expect(decided.staffName).toBe('notifyowner');

    const duplicate = await ownerAgent
      .post(`/api/admin/cashier/${reference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve' });
    expectStatus(duplicate, 409);
    expect(
      (db.prepare('SELECT revision FROM cashier_transcripts WHERE request_id = ?').get(requestId) as { revision: number })
        .revision,
    ).toBe(2);

    const second = await playerAgent.post('/api/cashier').set(CSRF).send({ kind: 'withdrawal', amount: 100_000 });
    expectStatus(second, 201);
    const secondReference = second.body.request.reference as string;
    const secondId = second.body.request.id as string;

    const held = await ownerAgent
      .post(`/api/admin/cashier/${secondReference}/hold`)
      .set(CSRF)
      .send({ reason: 'Waiting for a manual wallet audit.' });
    expectStatus(held, 200);
    const blockedByHold = await ownerAgent
      .post(`/api/admin/cashier/${secondReference}/decision`)
      .set(CSRF)
      .send({ decision: 'approve' });
    expectStatus(blockedByHold, 409);
    expect(blockedByHold.body.error.code).toBe('REQUEST_ON_HOLD');
    const resumed = await ownerAgent.delete(`/api/admin/cashier/${secondReference}/hold`).set(CSRF);
    expectStatus(resumed, 200);
    const edited = await ownerAgent
      .post(`/api/admin/cashier/${secondReference}/amount`)
      .set(CSRF)
      .send({ amount: 90_000, reason: 'Corrected the requested total.' });
    expectStatus(edited, 200);
    const cancelled = await playerAgent
      .post(`/api/cashier/${secondReference}/cancel`)
      .set(CSRF)
      .send({ reason: 'No longer needed.' });
    expectStatus(cancelled, 200);

    const secondEvents = outbox('cashier_notification')
      .map((event) => JSON.parse(event.payload) as { reference?: string; event?: string })
      .filter((payload) => payload.reference === secondReference)
      .map((payload) => payload.event);
    expect(secondEvents).toEqual(['created', 'on_hold', 'resumed', 'amount_changed', 'cancelled']);

    const secondTranscript = db.prepare('SELECT content, revision FROM cashier_transcripts WHERE request_id = ?').get(secondId) as {
      content: string;
      revision: number;
    };
    expect(secondTranscript.revision).toBe(5);
    expect(secondTranscript.content).toContain('on_hold');
    expect(secondTranscript.content).toContain('resumed');
    expect(secondTranscript.content).toContain('AMOUNT_CHANGED');
    expect(secondTranscript.content).toContain('cancelled');
  });

  it('prevents another user from reading a ticket or cashier request', async () => {
    const ticket = await createTicket('Private support conversation');
    const cashier = await playerAgent.post('/api/cashier').set(CSRF).send({ kind: 'deposit', amount: 50_000 });
    expectStatus(cashier, 201);

    const username = `notifystranger_${Date.now().toString(36)}`;
    const cryptoModule = await import('../server/lib/crypto.ts');
    const walletModule = await import('../server/lib/wallet.ts');
    const legalModule = await import('../server/lib/legal.ts');
    await seedUser(cryptoModule, walletModule, legalModule, username, 'user', `${username}@notify.test`);
    const stranger = await signIn(username);

    expectStatus(await stranger.get(`/api/tickets/${ticket.reference}`), 403);
    expectStatus(await stranger.get(`/api/cashier/${cashier.body.request.reference}`), 404);
  });
});
