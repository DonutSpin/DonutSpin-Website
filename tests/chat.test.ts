import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { deleteAccount } from '../server/lib/account-deletion.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'ChatTest!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };

const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

let db: DB;
let app: ReturnType<typeof createApp>;

const agents: Record<string, Agent> = {};
const ids: Record<string, string> = {};

function createUser(username: string, verified = true): string {
  const id = `usr_chat_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', 'active', ?, ?, ?)`,
  ).run(id, username, `${username}@chat.test`, hashPassword(PASSWORD), verified ? 1 : 0, now, now);
  createWallet(db, id, 1_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  app = createApp(db);

  ids.alice = createUser('chat_alice');
  ids.bob = createUser('chat_bob');
  ids.charlie = createUser('chat_charlie', false);
  ids.dave = createUser('chat_dave');
  ids.limited = createUser('chat_limited');

  for (const username of ['alice', 'bob', 'charlie', 'dave', 'limited']) {
    agents[username] = await signIn(`chat_${username}`);
  }
}, 30_000);

afterAll(() => {
  db.close();
});

describe('verified room chat', () => {
  it('lets verified players send and read messages', async () => {
    const sent = await agents.alice!.post('/api/chat/messages')
      .set(CSRF)
      .send({ body: '  hello\n\nroom  ' });
    expectStatus(sent, 201);
    expect(sent.body.message.body).toBe('hello room');
    expect(sent.body.message.username).toBe('chat_alice');
    expect(sent.body.message.userId).toBe(ids.alice);
    expect(sent.body.message.role).toBe('user');

    const read = await agents.bob!.get('/api/chat');
    expectStatus(read, 200);
    expect(read.body.verified).toBe(true);
    expect(read.body.messages.some((message: { id: string }) => message.id === sent.body.message.id)).toBe(true);
    expect(read.body.activeRains).toEqual([]);
    expect(read.body.latestRain).toBeNull();

    const again = await agents.bob!.get('/api/chat');
    expectStatus(again, 200);
    expect(again.body.messages.filter((message: { id: string }) => message.id === sent.body.message.id)).toHaveLength(1);
  });

  it('hides messages from unverified accounts and blocks their writes', async () => {
    const hidden = await agents.charlie!.get('/api/chat');
    expectStatus(hidden, 200);
    expect(hidden.body.verified).toBe(false);
    expect(hidden.body.messages).toEqual([]);

    const blocked = await agents.charlie!.post('/api/chat/messages').set(CSRF).send({ body: 'let me in' });
    expectStatus(blocked, 403);
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const anonymous = await request(app).get('/api/chat');
    expectStatus(anonymous, 401);
  });

  it('rejects empty, whitespace-only, and oversized messages', async () => {
    const empty = await agents.alice!.post('/api/chat/messages').set(CSRF).send({ body: '' });
    expectStatus(empty, 400);

    const whitespace = await agents.alice!.post('/api/chat/messages').set(CSRF).send({ body: '   \n  ' });
    expectStatus(whitespace, 400);

    const oversized = await agents.alice!.post('/api/chat/messages')
      .set(CSRF)
      .send({ body: 'x'.repeat(501) });
    expectStatus(oversized, 400);

    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = ?').get(ids.alice) as { count: number }
    ).count;
    expect(count).toBe(1);
  });

  it('rate limits a single account without blocking everyone else', async () => {
    for (let index = 0; index < 12; index += 1) {
      const sent = await agents.limited!.post('/api/chat/messages')
        .set(CSRF)
        .send({ body: `rate ${index}` });
      expectStatus(sent, 201);
    }
    const limited = await agents.limited!.post('/api/chat/messages').set(CSRF).send({ body: 'one too many' });
    expectStatus(limited, 429);
    expect(limited.body.error.code).toBe('CHAT_RATE_LIMITED');

    const otherPlayer = await agents.alice!.post('/api/chat/messages').set(CSRF).send({ body: 'still allowed' });
    expectStatus(otherPlayer, 201);
  });

  it('shows live and recently settled rains alongside the chat', async () => {
    const created = await agents.alice!.post('/api/rain').set(CSRF).send({ amount: 100_000, countdownSeconds: 30 });
    expectStatus(created, 201);
    const rainId = created.body.rain.id as string;

    const live = await agents.bob!.get('/api/chat');
    expectStatus(live, 200);
    expect(live.body.activeRains).toHaveLength(1);
    expect(live.body.activeRains[0].id).toBe(rainId);
    expect(live.body.latestRain).toBeNull();

    const unverifiedView = await agents.charlie!.get('/api/chat');
    expectStatus(unverifiedView, 200);
    expect(unverifiedView.body.activeRains[0].id).toBe(rainId);
    expect(unverifiedView.body.messages).toEqual([]);

    db.prepare('UPDATE rain_events SET ends_at = ? WHERE id = ?').run(
      new Date(Date.now() - 5_000).toISOString(),
      rainId,
    );
    const after = await agents.bob!.get('/api/chat');
    expectStatus(after, 200);
    expect(after.body.activeRains).toEqual([]);
    expect(after.body.latestRain.id).toBe(rainId);
    expect(after.body.latestRain.status).toBe('settled');
  });

  it('reports the current server-side role and updates it when permissions change', async () => {
    const sent = await agents.alice!.post('/api/chat/messages').set(CSRF).send({ body: 'role check' });
    expectStatus(sent, 201);
    expect(sent.body.message.role).toBe('user');

    db.prepare("UPDATE users SET role = 'moderator' WHERE id = ?").run(ids.alice);

    const read = await agents.bob!.get('/api/chat');
    expectStatus(read, 200);
    const updated = read.body.messages.find((message: { id: string }) => message.id === sent.body.message.id);
    expect(updated.role).toBe('moderator');

    const promotedSend = await agents.alice!.post('/api/chat/messages').set(CSRF).send({ body: 'promoted' });
    expectStatus(promotedSend, 201);
    expect(promotedSend.body.message.role).toBe('moderator');

    db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(ids.alice);
  });

  it('anonymizes chat history when an account is deleted', async () => {
    const sent = await agents.dave!.post('/api/chat/messages').set(CSRF).send({ body: 'I was here' });
    expectStatus(sent, 201);

    deleteAccount(db, ids.dave!);

    const read = await agents.bob!.get('/api/chat');
    expectStatus(read, 200);
    const message = read.body.messages.find((entry: { id: string }) => entry.id === sent.body.message.id);
    expect(message).toBeTruthy();
    expect(message.userId).toBeNull();
    expect(message.username).toBe('Deleted account');
    expect(message.body).toBe('I was here');
  });
});
