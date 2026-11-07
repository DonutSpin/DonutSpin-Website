import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDatabase, type DB } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';
import { hashPassword } from '../server/lib/crypto.ts';
import { createWallet } from '../server/lib/wallet.ts';
import { recordLegalAcceptance } from '../server/lib/legal.ts';
import { getGuildConfig, updateGuildConfig, ensureGuildPlaceholder } from '../server/lib/discord/core.ts';
import { balanceOf } from '../server/lib/wallet.ts';

type Agent = ReturnType<typeof request.agent>;

const PASSWORD = 'DiscordTest!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };
const BOT_KEY = 'discord-bot-test-key-0123456789abcdef';
const GUILD = '123456789012345678';
const WELCOME = '223456789012345678';
const VOUCHES = '323456789012345678';
const SCAM_VOUCHES = '423456789012345678';
const CODES = '523456789012345678';
const GIVEAWAYS = '623456789012345678';
const INVITES = '633456789012345678';
const NEWS = '723456789012345678';
const CHANGELOG = '823456789012345678';
const LOGS = '923456789012345678';
const STAFF_ROLE = '111111111111111111';

let db: DB;
let app: ReturnType<typeof createApp>;
const agents: Record<string, Agent> = {};
const ids: Record<string, string> = {};

const expectStatus = (res: { status: number; body: unknown }, status: number) =>
  expect(res.status, `${res.status} ${JSON.stringify(res.body)}`).toBe(status);

function createUser(username: string, role: 'user' | 'support' | 'moderator' | 'admin' | 'owner'): string {
  const id = `usr_dc_${username}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
  ).run(id, username, `${username}@discord.test`, hashPassword(PASSWORD), role, now, now);
  createWallet(db, id, 20_000_000, null);
  recordLegalAcceptance(db, { userId: id, ip: '127.0.0.1', acceptedAt: now });
  return id;
}

async function signIn(username: string): Promise<Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CSRF).send({ identifier: username, password: PASSWORD });
  expectStatus(res, 200);
  return agent;
}

function link(userId: string, discordUserId: string, discordUsername: string): void {
  db.prepare(
    `INSERT INTO discord_links (user_id, discord_user_id, discord_username, linked_at)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, discordUserId, discordUsername, new Date().toISOString());
}

function bot(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  const base = request(app);
  const auth = `Bearer ${BOT_KEY}`;
  const call =
    method === 'get'
      ? base.get(path)
      : method === 'post'
        ? base.post(path)
        : method === 'patch'
          ? base.patch(path)
          : base.delete(path);
  return call.set('Authorization', auth);
}

function actor(discordUserId: string, discordUsername: string, roleIds: string[] = []) {
  return { guildId: GUILD, discordUserId, discordUsername, roleIds };
}

function wallet(userId: string): number {
  return balanceOf(db, userId);
}

async function createLinkedGiveaway(overrides: Record<string, unknown> = {}) {
  const res = await bot('post', '/api/bot/giveaways').send({
    ...actor(ids.ownerDiscord!, 'owner'),
    title: 'Integration prize pool',
    description: 'Shared giveaway integration test',
    prizeAmount: 100_000,
    winnerCount: 1,
    durationSeconds: 900,
    bannerUrl: null,
    ...overrides,
  });
  expectStatus(res, 201);
  return res.body.giveaway as { id: string; reference: string; status: string };
}

beforeAll(async () => {
  db = createDatabase(':memory:');
  (config as { discordBotApiKey: string }).discordBotApiKey = BOT_KEY;
  app = createApp(db);

  ids.owner = createUser('dcowner', 'owner');
  ids.support = createUser('dcsupport', 'support');
  ids.alice = createUser('dcalice', 'user');
  ids.bob = createUser('dcbob', 'user');
  ids.carol = createUser('dccarol', 'user');
  ids.inviter = createUser('dcinviter', 'user');
  ids.pending = createUser('dcpending', 'user');

  ids.ownerDiscord = '900000000000000001';
  ids.supportDiscord = '900000000000000002';
  ids.aliceDiscord = '900000000000000003';
  ids.bobDiscord = '900000000000000004';
  ids.carolDiscord = '900000000000000005';
  ids.inviterDiscord = '900000000000000010';
  ids.pendingDiscord = '900000000000000011';

  link(ids.owner!, ids.ownerDiscord!, 'owner');
  link(ids.support!, ids.supportDiscord!, 'support');
  link(ids.alice!, ids.aliceDiscord!, 'alice');
  link(ids.bob!, ids.bobDiscord!, 'bob');
  link(ids.carol!, ids.carolDiscord!, 'carol');
  link(ids.inviter!, ids.inviterDiscord!, 'inviter');

  for (const username of ['owner', 'support', 'alice', 'bob', 'carol', 'inviter', 'pending']) {
    agents[username] = await signIn(`dc${username}`);
  }

  ensureGuildPlaceholder(db, GUILD);
  updateGuildConfig(
    db,
    GUILD,
    {
      channels: {
        welcome: WELCOME,
        vouches: VOUCHES,
        scamVouches: SCAM_VOUCHES,
        codes: CODES,
        giveaways: GIVEAWAYS,
        news: NEWS,
        changelog: CHANGELOG,
        logs: LOGS,
      },
      roles: { owner: [], admin: [], staff: [], moderator: [] },
      inviteRewardsEnabled: true,
      inviteRewardEvery: 3,
      inviteRewardAmount: 5_000_000,
      announcementEveryone: true,
    },
    { id: ids.owner!, username: 'dcowner', role: 'owner' } as never,
  );
}, 30_000);

afterAll(() => {
  db.close();
});

beforeEach(() => {
  db.prepare('DELETE FROM discord_outbox').run();
  const current = getGuildConfig(db, GUILD);
  updateGuildConfig(
    db,
    GUILD,
    {
      channels: current.channels,
      roles: { owner: [], admin: [], staff: [], moderator: [] },
      inviteRewardsEnabled: true,
      inviteRewardEvery: 3,
      inviteRewardAmount: 5_000_000,
      announcementEveryone: true,
    },
    { id: ids.owner!, username: 'dcowner', role: 'owner' } as never,
  );
});

describe('bot API authentication and permissions', () => {
  it('rejects requests without the bot key and blocks players from configuration', async () => {
    expectStatus(await request(app).get(`/api/bot/config/${GUILD}`), 401);

    const denied = await bot('post', `/api/bot/config/${GUILD}`).send({
      ...actor(ids.aliceDiscord!, 'alice'),
      announcementEveryone: true,
    });
    expectStatus(denied, 403);
    expect(denied.body.error.code).toBe('DISCORD_PERMISSION_DENIED');

    const allowed = await bot('post', `/api/bot/config/${GUILD}`).send({
      ...actor(ids.ownerDiscord!, 'owner'),
      announcementEveryone: false,
    });
    expectStatus(allowed, 200);
    expect(allowed.body.config.announcementEveryone).toBe(false);
  });

  it('requires both a configured Discord role and the website permission', async () => {
    expectStatus(
      await bot('post', `/api/bot/config/${GUILD}`).send({
        ...actor(ids.ownerDiscord!, 'owner'),
        roles: { admin: [STAFF_ROLE] },
      }),
      200,
    );

    const noDiscordRole = await bot('post', `/api/bot/config/${GUILD}`).send({
      ...actor(ids.ownerDiscord!, 'owner'),
      announcementEveryone: false,
    });
    expectStatus(noDiscordRole, 403);
    expect(noDiscordRole.body.error.code).toBe('DISCORD_ROLE_REQUIRED');

    const withRole = await bot('post', `/api/bot/config/${GUILD}`).send({
      ...actor(ids.ownerDiscord!, 'owner', [STAFF_ROLE]),
      announcementEveryone: true,
    });
    expectStatus(withRole, 200);
    expect(withRole.body.config.announcementEveryone).toBe(true);
  });

  it('returns the live website balance for a linked account', async () => {
    const res = await bot('get', `/api/bot/balance/${ids.aliceDiscord}`);
    expectStatus(res, 200);
    expect(res.body.linked).toBe(true);
    expect(res.body.websiteUsername).toBe('dcalice');
    expect(res.body.balance).toBe(wallet(ids.alice!));
  });
});

describe('invite rewards', () => {
  it('pays 5M at every third first-join, ignores duplicates and self-invites, and settles after linking', async () => {
    const before = wallet(ids.inviter!);
    for (let index = 1; index <= 3; index += 1) {
      const res = await bot('post', '/api/bot/invites/join').send({
        guildId: GUILD,
        discordUserId: `80000000000000000${index}`,
        username: `joined${index}`,
        inviterDiscordId: ids.inviterDiscord,
        inviterUsername: 'inviter',
        inviteCode: 'donut',
        joinedAt: new Date().toISOString(),
      });
      expectStatus(res, 200);
      expect(res.body.counted).toBe(true);
      expect(res.body.rewarded).toBe(index === 3);
    }
    expect(wallet(ids.inviter!)).toBe(before + 5_000_000);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_invite_rewards WHERE inviter_discord_id = ? AND status = 'paid'").get(ids.inviterDiscord),
    ).toEqual({ count: 1 });

    const duplicate = await bot('post', '/api/bot/invites/join').send({
      guildId: GUILD,
      discordUserId: '800000000000000001',
      username: 'joined1',
      inviterDiscordId: ids.inviterDiscord,
      inviterUsername: 'inviter',
      inviteCode: 'donut',
    });
    expectStatus(duplicate, 200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(wallet(ids.inviter!)).toBe(before + 5_000_000);

    const self = await bot('post', '/api/bot/invites/join').send({
      guildId: GUILD,
      discordUserId: '800000000000000099',
      username: 'self',
      inviterDiscordId: '800000000000000099',
      inviterUsername: 'self',
      inviteCode: 'self',
    });
    expectStatus(self, 200);
    expect(self.body.counted).toBe(false);
    expect(self.body.selfInvite).toBe(true);

    for (let index = 4; index <= 6; index += 1) {
      const res = await bot('post', '/api/bot/invites/join').send({
        guildId: GUILD,
        discordUserId: `80000000000000000${index}`,
        username: `joined${index}`,
        inviterDiscordId: ids.inviterDiscord,
        inviterUsername: 'inviter',
        inviteCode: 'donut',
      });
      expectStatus(res, 200);
      if (index === 6) {
        expect(res.body.rewarded).toBe(true);
        expect(res.body.inviteCount).toBe(6);
      }
    }
    expect(wallet(ids.inviter!)).toBe(before + 10_000_000);

    // An unlinked inviter accrues a pending reward, then linking pays it once.
    for (let index = 1; index <= 3; index += 1) {
      const res = await bot('post', '/api/bot/invites/join').send({
        guildId: GUILD,
        discordUserId: `81000000000000000${index}`,
        username: `pendingJoin${index}`,
        inviterDiscordId: ids.pendingDiscord,
        inviterUsername: 'pending',
        inviteCode: 'pending',
      });
      expectStatus(res, 200);
    }
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_invite_rewards WHERE inviter_discord_id = ? AND status = 'pending'").get(ids.pendingDiscord),
    ).toEqual({ count: 1 });

    const codeRes = await agents.pending!.post('/api/me/discord/code').set(CSRF).send({});
    expectStatus(codeRes, 201);
    const linkRes = await bot('post', '/api/bot/link').send({
      code: codeRes.body.code,
      discordUserId: ids.pendingDiscord,
      discordUsername: 'pending',
    });
    expectStatus(linkRes, 200);
    expect(linkRes.body.settledInviteRewards).toBe(1);
    expect(wallet(ids.pending!)).toBe(20_000_000 + 5_000_000);

    const stats = await bot('get', `/api/bot/invites/${GUILD}/${ids.inviterDiscord}`);
    expectStatus(stats, 200);
    expect(stats.body.stats.totalInvites).toBe(6);
    expect(stats.body.stats.rewardsEarned).toBe(10_000_000);
    expect(stats.body.stats.progress).toBe(0);
  });
});

describe('invite panel and personal links', () => {
  it('serves editable panel copy, stores the panel message and keeps one link per member', async () => {
    const initial = await bot('get', `/api/bot/invites/panel/${GUILD}`);
    expectStatus(initial, 200);
    expect(initial.body.panel.rewardEvery).toBe(3);
    expect(initial.body.panel.rewardAmount).toBe(5_000_000);
    expect(initial.body.panel.channelId).toBeNull();
    expect(initial.body.panel.copyMessage).toContain('{INVITE_LINK}');

    const saved = await bot('post', `/api/bot/config/${GUILD}`).send({
      ...actor(ids.ownerDiscord!, 'owner'),
      channels: { invites: INVITES },
      invitePanelTitle: 'Invite & earn',
      invitePanelBody: 'Bring {INVITES} friends and earn {REWARD}.',
      inviteCopyMessage: 'Join DonutSpin: {INVITE_LINK}',
    });
    expectStatus(saved, 200);
    expect(saved.body.config.invitePanelTitle).toBe('Invite & earn');
    expect(saved.body.config.channels.invites).toBe(INVITES);

    const updated = await bot('get', `/api/bot/invites/panel/${GUILD}`);
    expectStatus(updated, 200);
    expect(updated.body.panel.channelId).toBe(INVITES);
    expect(updated.body.panel.body).toContain('{INVITES}');
    expect(updated.body.panel.copyMessage).toContain('{INVITE_LINK}');

    const messageId = '700000000000000123';
    expectStatus(
      await bot('post', `/api/bot/invites/panel/${GUILD}/message`).send({
        messageId,
        channelId: INVITES,
      }),
      200,
    );
    const withMessage = await bot('get', `/api/bot/invites/panel/${GUILD}`);
    expect(withMessage.body.panel.messageId).toBe(messageId);
    expect(withMessage.body.panel.messageChannelId).toBe(INVITES);

    const none = await bot('get', `/api/bot/invites/link/${GUILD}/${ids.aliceDiscord}`);
    expectStatus(none, 200);
    expect(none.body.link).toBeNull();

    const first = await bot('post', '/api/bot/invites/link').send({
      guildId: GUILD,
      discordUserId: ids.aliceDiscord,
      inviteCode: 'alice-invite',
      inviteUrl: 'https://discord.gg/alice-invite',
    });
    expectStatus(first, 200);
    expect(first.body.link.inviteUrl).toBe('https://discord.gg/alice-invite');

    const second = await bot('post', '/api/bot/invites/link').send({
      guildId: GUILD,
      discordUserId: ids.aliceDiscord,
      inviteCode: 'different-code',
      inviteUrl: 'https://discord.gg/different-code',
    });
    expectStatus(second, 200);
    expect(second.body.link.inviteUrl).toBe('https://discord.gg/alice-invite');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM discord_invite_links WHERE discord_user_id = ?').get(ids.aliceDiscord),
    ).toEqual({ count: 1 });

    const rejected = await bot('post', '/api/bot/invites/link').send({
      guildId: GUILD,
      discordUserId: ids.bobDiscord,
      inviteCode: 'bob-invite',
      inviteUrl: 'https://example.com/not-discord',
    });
    expectStatus(rejected, 400);

    const ownerLookup = await bot('get', `/api/bot/invites/link/code/${GUILD}/alice-invite`);
    expectStatus(ownerLookup, 200);
    expect(ownerLookup.body.link.discordUserId).toBe(ids.aliceDiscord);

    // Discord reports the bot as the creator of a personal invite. The stored
    // code must still credit the member who owns it, not the bot.
    const personalJoin = await bot('post', '/api/bot/invites/join').send({
      guildId: GUILD,
      discordUserId: '820000000000000001',
      username: 'personalJoin',
      inviterDiscordId: '700000000000000999',
      inviterUsername: 'DonutSpinBot',
      inviteCode: 'alice-invite',
    });
    expectStatus(personalJoin, 200);
    expect(personalJoin.body.counted).toBe(true);
    expect(personalJoin.body.inviteCount).toBe(1);

    const aliceStats = await bot('get', `/api/bot/invites/${GUILD}/${ids.aliceDiscord}`);
    expectStatus(aliceStats, 200);
    expect(aliceStats.body.stats.totalInvites).toBe(1);

    const selfJoin = await bot('post', '/api/bot/invites/join').send({
      guildId: GUILD,
      discordUserId: ids.aliceDiscord,
      username: 'alice',
      inviterDiscordId: '700000000000000999',
      inviterUsername: 'DonutSpinBot',
      inviteCode: 'alice-invite',
    });
    expectStatus(selfJoin, 200);
    expect(selfJoin.body.selfInvite).toBe(true);
    expect(selfJoin.body.counted).toBe(false);
  });
});

describe('vouches', () => {
  it('publishes positive and scam feedback with distinct payloads and blocks spam', async () => {
    const positive = await bot('post', '/api/bot/vouches').send({
      ...actor(ids.aliceDiscord!, 'alice'),
      voucherDiscordId: ids.aliceDiscord,
      voucherUsername: 'alice',
      targetDiscordId: ids.bobDiscord,
      targetUsername: 'bob',
      type: 'positive',
      reason: 'Paid instantly and was easy to trade with.',
    });
    expectStatus(positive, 201);
    expect(positive.body.vouch.type).toBe('positive');

    const scam = await bot('post', '/api/bot/vouches').send({
      ...actor(ids.aliceDiscord!, 'alice'),
      voucherDiscordId: ids.aliceDiscord,
      voucherUsername: 'alice',
      targetDiscordId: ids.bobDiscord,
      targetUsername: 'bob',
      type: 'scam',
      reason: 'Did not deliver the agreed trade.',
    });
    expectStatus(scam, 201);
    expect(scam.body.vouch.type).toBe('scam');

    const duplicate = await bot('post', '/api/bot/vouches').send({
      ...actor(ids.aliceDiscord!, 'alice'),
      voucherDiscordId: ids.aliceDiscord,
      voucherUsername: 'alice',
      targetDiscordId: ids.bobDiscord,
      targetUsername: 'bob',
      type: 'positive',
      reason: 'Trying again too soon.',
    });
    expectStatus(duplicate, 409);
    expect(duplicate.body.error.code).toBe('VOUCH_COOLDOWN');

    const self = await bot('post', '/api/bot/vouches').send({
      ...actor(ids.aliceDiscord!, 'alice'),
      voucherDiscordId: ids.aliceDiscord,
      voucherUsername: 'alice',
      targetDiscordId: ids.aliceDiscord,
      targetUsername: 'alice',
      type: 'positive',
      reason: 'Self vouching is not allowed.',
    });
    expectStatus(self, 400);
    expect(self.body.error.code).toBe('SELF_VOUCH');

    const stats = await bot('get', `/api/bot/vouches/${GUILD}/${ids.bobDiscord}`);
    expectStatus(stats, 200);
    expect(stats.body.stats.positive).toBe(1);
    expect(stats.body.stats.scam).toBe(1);
    expect(stats.body.stats.reputation).toBe('negative');

    const events = db
      .prepare("SELECT event_type, payload FROM discord_outbox WHERE event_type = 'vouch_post' ORDER BY created_at")
      .all() as { event_type: string; payload: string }[];
    expect(events).toHaveLength(2);
    const channels = events.map((event) => JSON.parse(event.payload).channelId);
    expect(channels).toEqual(expect.arrayContaining([VOUCHES, SCAM_VOUCHES]));
  });
});

describe('reward codes', () => {
  it('creates a code from Discord, shares it with the website, and blocks duplicate redemption', async () => {
    const created = await bot('post', '/api/bot/codes').send({
      ...actor(ids.ownerDiscord!, 'owner'),
      code: 'DISCORD-DROP',
      name: 'Discord drop',
      description: 'A shared code created in Discord.',
      amount: 250_000,
      maxRedemptions: 5,
      expiresAt: null,
    });
    expectStatus(created, 201);
    const code = created.body.code;
    expect(code.code).toBe('DISCORD-DROP');
    expect(code.createdVia).toBe('discord');

    const event = db
      .prepare("SELECT payload, guild_id FROM discord_outbox WHERE event_type = 'code_post'")
      .get() as { payload: string; guild_id: string };
    expect(event.guild_id).toBe(GUILD);
    const payload = JSON.parse(event.payload);
    expect(payload.channelId).toBe(CODES);
    expect(payload.mentionEveryone).toBe(true);

    const before = wallet(ids.alice!);
    const redeem = await agents.alice!.post('/api/codes/redeem').set(CSRF).send({ code: 'DISCORD-DROP' });
    expectStatus(redeem, 200);
    expect(redeem.body.source).toBeUndefined();
    expect(wallet(ids.alice!)).toBe(before + 250_000);
    expect(
      db.prepare("SELECT source FROM reward_code_redemptions WHERE user_id = ?").get(ids.alice!),
    ).toEqual({ source: 'web' });

    const duplicate = await bot('post', '/api/bot/codes/redeem').send({
      code: 'DISCORD-DROP',
      discordUserId: ids.aliceDiscord,
    });
    expectStatus(duplicate, 409);
    expect(duplicate.body.error.code).toBe('CODE_ALREADY_REDEEMED');

    const websiteCode = await agents.owner!
      .post('/api/admin/discord/codes')
      .set(CSRF)
      .send({
        code: 'WEB-DROP',
        name: 'Website drop',
        description: 'Created from the website dashboard.',
        amount: 300_000,
        maxRedemptions: 10,
        expiresAt: null,
      });
    expectStatus(websiteCode, 201);
    expect(websiteCode.body.code.createdVia).toBe('web');

    const botRedeem = await bot('post', '/api/bot/codes/redeem').send({
      code: 'WEB-DROP',
      discordUserId: ids.bobDiscord,
    });
    expectStatus(botRedeem, 200);
    expect(
      db.prepare("SELECT source FROM reward_code_redemptions WHERE user_id = ?").get(ids.bob!),
    ).toEqual({ source: 'discord' });

    const disable = await agents.owner!
      .patch(`/api/admin/discord/codes/${websiteCode.body.code.id}`)
      .set(CSRF)
      .send({ disabled: true });
    expectStatus(disable, 200);
    const blocked = await bot('post', '/api/bot/codes/redeem').send({
      code: 'WEB-DROP',
      discordUserId: ids.carolDiscord,
    });
    expectStatus(blocked, 409);
    expect(blocked.body.error.code).toBe('CODE_DISABLED');
  });
});

describe('shared giveaways', () => {
  it('creates in Discord, joins from both platforms, ends, and claims through the website ticket', async () => {
    const giveaway = await createLinkedGiveaway();
    const event = db
      .prepare("SELECT payload FROM discord_outbox WHERE event_type = 'giveaway_post' AND payload LIKE ?")
      .get(`%${giveaway.id}%`) as { payload: string };
    const payload = JSON.parse(event.payload);
    expect(payload.channelId).toBe(GIVEAWAYS);
    expect(payload.giveaway.title).toBe('Integration prize pool');

    const discordJoin = await bot('post', `/api/bot/giveaways/${giveaway.id}/join`).send({
      discordUserId: ids.aliceDiscord,
    });
    expectStatus(discordJoin, 200);
    expect(discordJoin.body.giveaway.participantCount).toBe(1);

    const websiteJoin = await agents.bob!.post(`/api/giveaways/${giveaway.id}/join`).set(CSRF).send({});
    expectStatus(websiteJoin, 200);
    expect(websiteJoin.body.giveaway.participantCount).toBe(2);

    const ended = await bot('post', `/api/bot/giveaways/${giveaway.id}/end`).send(actor(ids.ownerDiscord!, 'owner'));
    expectStatus(ended, 200);
    expect(ended.body.giveaway.status).toBe('completed');
    const winner = ended.body.giveaway.winners[0] as { username: string; userId: string; payoutAmount: number };
    expect(winner).toBeTruthy();

    const resultEvent = db
      .prepare("SELECT payload FROM discord_outbox WHERE event_type = 'giveaway_result' AND payload LIKE ?")
      .get(`%${giveaway.id}%`) as { payload: string };
    const resultPayload = JSON.parse(resultEvent.payload);
    expect(resultPayload.giveaway.winnerDiscordIds.length).toBe(1);
    expect(resultPayload.giveaway.status).toBe('completed');

    const websiteView = await agents.alice!.get('/api/giveaways');
    expectStatus(websiteView, 200);
    const completed = websiteView.body.completed.find((entry: { id: string }) => entry.id === giveaway.id);
    expect(completed.winners[0].userId).toBe(winner.userId);

    const winnerAgent = winner.username === 'dcalice' ? agents.alice! : agents.bob!;
    const claim = await winnerAgent
      .post(`/api/giveaways/${giveaway.id}/claim`)
      .set(CSRF)
      .send({ message: 'Claiming my Discord giveaway prize.' });
    expectStatus(claim, 201);
    const ticket = db
      .prepare(
        `SELECT t.category, w.claim_ticket_id, w.giveaway_id
           FROM tickets t JOIN giveaway_winners w ON w.claim_ticket_id = t.id
          WHERE t.reference = ?`,
      )
      .get(claim.body.ticketReference) as {
      category: string;
      claim_ticket_id: string;
      giveaway_id: string;
    };
    expect(ticket.category).toBe('giveaway_claim');
    expect(ticket.giveaway_id).toBe(giveaway.id);

    const before = wallet(winner.userId);
    const approved = await agents.support!
      .post(`/api/giveaways/claims/${claim.body.claim.id}/approve`)
      .set(CSRF)
      .send({});
    expectStatus(approved, 200);
    expect(wallet(winner.userId)).toBe(before + winner.payoutAmount);
  });

  it('publishes a website-created giveaway into the primary Discord guild and channel', async () => {
    const created = await agents.owner!.post('/api/giveaways').set(CSRF).send({
      title: 'Website-created prize pool',
      description: 'Created from the website and published to Discord.',
      prizeAmount: 175_000,
      winnerCount: 1,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expectStatus(created, 201);
    const id = created.body.giveaway.id as string;

    const event = db
      .prepare("SELECT guild_id, payload FROM discord_outbox WHERE event_type = 'giveaway_post' AND payload LIKE ?")
      .get(`%${id}%`) as { guild_id: string; payload: string };
    expect(event).toBeTruthy();
    expect(event.guild_id).toBe(GUILD);
    const payload = JSON.parse(event.payload);
    expect(payload.channelId).toBe(GIVEAWAYS);
    expect(payload.giveaway.id).toBe(id);
  });
});

describe('announcements and the durable outbox', () => {
  it('publishes, edits, and deletes news through the website queue', async () => {
    const created = await bot('post', '/api/bot/announcements').send({
      ...actor(ids.ownerDiscord!, 'owner'),
      kind: 'news',
      title: 'DonutSpin is live',
      body: 'Weekly codes, community giveaways, and a shared wallet are now live.',
      mentionEveryone: true,
      emoji: '🍩',
    });
    expectStatus(created, 201);
    const announcement = created.body.announcement;
    expect(announcement.messageId).toBeNull();

    const postEvent = db
      .prepare("SELECT id, payload FROM discord_outbox WHERE event_type = 'announcement_post'")
      .get() as { id: string; payload: string };
    const postPayload = JSON.parse(postEvent.payload);
    expect(postPayload.channelId).toBe(NEWS);
    expect(postPayload.mentionEveryone).toBe(true);

    const claimed = await bot('post', '/api/bot/outbox/claim').send({ limit: 5 });
    expectStatus(claimed, 200);
    const claiming = claimed.body.events.find((event: { id: string }) => event.id === postEvent.id);
    expect(claiming).toBeTruthy();
    const completed = await bot('post', `/api/bot/outbox/${postEvent.id}/complete`).send({ messageId: '999999999999999999' });
    expectStatus(completed, 200);
    expect(
      db.prepare('SELECT message_id FROM discord_announcements WHERE id = ?').get(announcement.id),
    ).toEqual({ message_id: '999999999999999999' });

    const edited = await bot('patch', `/api/bot/announcements/${announcement.id}`).send({
      discordUserId: ids.ownerDiscord,
      discordUsername: 'owner',
      roleIds: [],
      title: 'DonutSpin is live now',
      body: 'Updated copy for the community announcement.',
      mentionEveryone: false,
    });
    expectStatus(edited, 200);
    expect(edited.body.announcement.title).toBe('DonutSpin is live now');
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_outbox WHERE event_type = 'announcement_edit'").get(),
    ).toEqual({ count: 1 });

    const deleted = await bot('delete', `/api/bot/announcements/${announcement.id}`).send({
      discordUserId: ids.ownerDiscord,
      discordUsername: 'owner',
      roleIds: [],
    });
    expectStatus(deleted, 200);
    expect(deleted.body.announcement.status).toBe('deleted');
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_outbox WHERE event_type = 'announcement_delete'").get(),
    ).toEqual({ count: 1 });
  });

  it('builds a changelog from section arrays and validates empty changelogs', async () => {
    const empty = await bot('post', '/api/bot/announcements').send({
      ...actor(ids.ownerDiscord!, 'owner'),
      kind: 'changelog',
      title: 'Empty changelog',
      sections: { features: [], improvements: [], fixes: [], removed: [], other: [] },
    });
    expectStatus(empty, 400);
    expect(empty.body.error.code).toBe('EMPTY_CHANGELOG');

    const created = await bot('post', '/api/bot/announcements').send({
      ...actor(ids.ownerDiscord!, 'owner'),
      kind: 'changelog',
      title: 'Week 44 update',
      sections: {
        features: ['Unified Discord wallet'],
        improvements: ['Faster giveaway sync'],
        fixes: ['Code redemption race'],
        removed: [],
        other: [],
      },
      mentionEveryone: true,
    });
    expectStatus(created, 201);
    expect(created.body.announcement.sections.features).toEqual(['Unified Discord wallet']);
  });

  it('leases events once so two bot workers cannot publish the same message', async () => {
    await createLinkedGiveaway({ title: 'Outbox lease prize' });
    const first = await bot('post', '/api/bot/outbox/claim').send({ limit: 10 });
    const second = await bot('post', '/api/bot/outbox/claim').send({ limit: 10 });
    expectStatus(first, 200);
    expectStatus(second, 200);
    expect(first.body.events.length).toBe(1);
    expect(second.body.events.length).toBe(0);
  });
});

describe('info channels and panels', () => {
  const DEV_CHANNEL = '1123456789012345678';

  it('registers a categorised channel and publishes a panel through the website', async () => {
    const created = await agents.owner!.post('/api/admin/discord/info-channels').set(CSRF).send({
      name: 'dev-updates',
      category: 'Development',
      channelId: DEV_CHANNEL,
      description: 'Release notes for the dev team',
    });
    expectStatus(created, 201);
    const channel = created.body.channel as { id: string; category: string; panelCount: number };
    expect(channel.category).toBe('Development');
    expect(channel.panelCount).toBe(0);

    const duplicate = await agents.owner!.post('/api/admin/discord/info-channels').set(CSRF).send({
      name: 'dev-updates-again',
      category: 'Development',
      channelId: DEV_CHANNEL,
    });
    expectStatus(duplicate, 409);
    expect(duplicate.body.error.code).toBe('CHANNEL_ALREADY_ADDED');

    const panelRes = await agents.owner!.post('/api/admin/discord/panels').set(CSRF).send({
      infoChannelId: channel.id,
      title: 'Meet the dev team',
      body: 'We ship website and bot updates every week.',
      color: '#5865F2',
      links: [{ label: 'Website', url: 'https://donutspin.example/updates' }],
      mentionEveryone: false,
    });
    expectStatus(panelRes, 201);
    const panel = panelRes.body.panel as {
      id: string;
      category: string;
      channelId: string;
      links: { label: string; url: string }[];
    };
    expect(panel.category).toBe('Development');
    expect(panel.channelId).toBe(DEV_CHANNEL);
    expect(panel.links).toEqual([{ label: 'Website', url: 'https://donutspin.example/updates' }]);

    const postEvent = db
      .prepare("SELECT id, payload FROM discord_outbox WHERE event_type = 'panel_post'")
      .get() as { id: string; payload: string };
    expect(JSON.parse(postEvent.payload).channelId).toBe(DEV_CHANNEL);

    const claimed = await bot('post', '/api/bot/outbox/claim').send({ limit: 5 });
    expectStatus(claimed, 200);
    expect(claimed.body.events.some((event: { id: string }) => event.id === postEvent.id)).toBe(true);
    const completed = await bot('post', `/api/bot/outbox/${postEvent.id}/complete`).send({
      messageId: '999999999999999998',
    });
    expectStatus(completed, 200);
    expect(
      db.prepare('SELECT message_id, channel_id FROM discord_panels WHERE id = ?').get(panel.id),
    ).toEqual({ message_id: '999999999999999998', channel_id: DEV_CHANNEL });

    const edited = await agents.owner!.patch(`/api/admin/discord/panels/${panel.id}`).set(CSRF).send({
      infoChannelId: channel.id,
      title: 'Meet the dev team',
      body: 'Updated: we ship website and bot updates daily.',
      links: [],
    });
    expectStatus(edited, 200);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_outbox WHERE event_type = 'panel_edit'").get(),
    ).toEqual({ count: 1 });

    const overview = await agents.owner!.get('/api/admin/discord');
    expectStatus(overview, 200);
    expect(overview.body.stats.infoChannels).toBeGreaterThanOrEqual(1);
    expect(overview.body.stats.panels).toBeGreaterThanOrEqual(1);
    expect(
      overview.body.infoChannels.some((item: { id: string }) => item.id === channel.id),
    ).toBe(true);
    expect(overview.body.panels.some((item: { id: string }) => item.id === panel.id)).toBe(true);
  });

  it('moves a panel to another update channel without marking it deleted', async () => {
    const fromChannel = await agents.owner!.post('/api/admin/discord/info-channels').set(CSRF).send({
      name: 'dev-old',
      category: 'Development',
      channelId: '1123456789012345681',
    });
    const toChannel = await agents.owner!.post('/api/admin/discord/info-channels').set(CSRF).send({
      name: 'dev-new',
      category: 'Development',
      channelId: '1123456789012345682',
    });
    expectStatus(fromChannel, 201);
    expectStatus(toChannel, 201);

    const panelRes = await agents.owner!.post('/api/admin/discord/panels').set(CSRF).send({
      infoChannelId: fromChannel.body.channel.id,
      title: 'Relocating panel',
      body: 'This panel moves to a new channel.',
    });
    expectStatus(panelRes, 201);
    const panelId = panelRes.body.panel.id as string;

    const firstClaim = await bot('post', '/api/bot/outbox/claim').send({ limit: 10 });
    const firstPost = firstClaim.body.events.find(
      (event: { eventType: string; payload: { panel?: { id: string } } }) =>
        event.eventType === 'panel_post' && event.payload.panel?.id === panelId,
    );
    expect(firstPost).toBeTruthy();
    await bot('post', `/api/bot/outbox/${firstPost.id}/complete`).send({ messageId: '999999999999999971' });

    const moved = await agents.owner!.patch(`/api/admin/discord/panels/${panelId}`).set(CSRF).send({
      infoChannelId: toChannel.body.channel.id,
      title: 'Relocating panel',
      body: 'This panel moves to a new channel.',
    });
    expectStatus(moved, 200);
    expect(moved.body.panel.channelId).toBe('1123456789012345682');
    expect(moved.body.panel.messageId).toBeNull();

    const claim = await bot('post', '/api/bot/outbox/claim').send({ limit: 10 });
    expectStatus(claim, 200);
    const events = claim.body.events as { id: string; eventType: string }[];
    expect(events.map((event) => event.eventType).sort()).toEqual(['panel_delete', 'panel_post']);

    const deleteEvent = events.find((event) => event.eventType === 'panel_delete')!;
    const deleted = await bot('post', `/api/bot/outbox/${deleteEvent.id}/complete`).send({ messageId: null });
    expectStatus(deleted, 200);
    expect(
      db.prepare('SELECT status, message_id FROM discord_panels WHERE id = ?').get(panelId),
    ).toEqual({ status: 'published', message_id: null });

    const postEvent = events.find((event) => event.eventType === 'panel_post')!;
    const posted = await bot('post', `/api/bot/outbox/${postEvent.id}/complete`).send({ messageId: '999999999999999972' });
    expectStatus(posted, 200);
    expect(
      db.prepare('SELECT status, message_id, channel_id FROM discord_panels WHERE id = ?').get(panelId),
    ).toEqual({ status: 'published', message_id: '999999999999999972', channel_id: '1123456789012345682' });
  });

  it('removes every attached panel when an update channel is deleted', async () => {
    const created = await agents.owner!.post('/api/admin/discord/info-channels').set(CSRF).send({
      name: 'dev-archive',
      category: 'Development',
      channelId: '1123456789012345679',
    });
    expectStatus(created, 201);
    const channel = created.body.channel as { id: string };

    const panelRes = await agents.owner!.post('/api/admin/discord/panels').set(CSRF).send({
      infoChannelId: channel.id,
      title: 'Archived release notes',
      body: 'This panel disappears with its channel.',
    });
    expectStatus(panelRes, 201);
    const panel = panelRes.body.panel as { id: string };

    const removed = await agents.owner!.delete(`/api/admin/discord/info-channels/${channel.id}`).set(CSRF);
    expectStatus(removed, 200);
    expect(removed.body.deletedPanels).toBe(1);
    expect(db.prepare('SELECT 1 FROM discord_panels WHERE id = ?').get(panel.id)).toBeUndefined();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM discord_outbox WHERE event_type = 'panel_delete'").get(),
    ).toEqual({ count: 1 });
  });
});
