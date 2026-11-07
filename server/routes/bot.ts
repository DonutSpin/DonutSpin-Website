import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { config } from '../config.ts';
import { ApiError, badRequest, conflict, notFound, nowIso, parseJson } from '../lib/core.ts';
import { parse } from '../lib/validation.ts';
import { RateLimiter } from '../lib/rate-limit.ts';
import { balanceOf } from '../lib/wallet.ts';
import { assertEmailVerified, assertNotOnHold } from '../lib/account-status.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from '../lib/discord/announcements.ts';
import { createRewardCode, redeemRewardCode } from '../lib/discord/codes.ts';
import {
  getBotStatus,
  getGuildConfig,
  getLinkForDiscord,
  isDiscordSnowflake,
  mapGuildSummary,
  recordHeartbeat,
  redeemDiscordLinkCode,
  requireDiscordAccount,
  requireDiscordStaff,
  updateGuildConfig,
} from '../lib/discord/core.ts';
import {
  createDiscordGiveaway,
  endDiscordGiveaway,
  joinDiscordGiveaway,
  listDiscordGiveaways,
  cancelDiscordGiveaway,
  rerollDiscordGiveaway,
} from '../lib/discord/giveaways.ts';
import {
  getInviteLeaderboard,
  getInvitePanelSettings,
  getInviteStats,
  getPersonalInviteByCode,
  getPersonalInviteLink,
  recordInviteJoin,
  savePersonalInviteLink,
  setInvitePanelMessage,
  settlePendingInviteRewards,
} from '../lib/discord/invites.ts';
import { attachOutboxMessage } from '../lib/discord/events.ts';
import {
  getCashierTranscriptForBot,
  getTicketTranscriptForBot,
} from '../lib/discord/support.ts';
import { claimOutbox, failOutbox, skipOutbox, type DiscordEventType } from '../lib/discord/outbox.ts';
import { createVouch, getVouchStats } from '../lib/discord/vouches.ts';

const snowflake = z.string().regex(/^\d{15,22}$/, 'Invalid Discord ID.');
const optionalSnowflake = snowflake.nullable().optional();
const roleIds = z.array(snowflake).max(50).optional().default([]);

const heartbeatSchema = z.object({
  botVersion: z.string().trim().min(1).max(40),
  latencyMs: z.number().finite().min(0).max(600_000).nullable().optional().default(null),
  guilds: z
    .array(
      z.object({
        id: snowflake,
        name: z.string().trim().min(1).max(100),
        iconUrl: z.string().trim().max(500).nullable().optional().default(null),
        memberCount: z.number().int().min(0).max(100_000_000).optional().default(0),
        ownerId: snowflake.nullable().optional().default(null),
      }),
    )
    .max(200),
});

const actorSchema = z.object({
  guildId: snowflake,
  discordUserId: snowflake,
  discordUsername: z.string().trim().min(1).max(100),
  roleIds,
});

const linkSchema = z.object({
  code: z.string().trim().min(4).max(40),
  discordUserId: snowflake,
  discordUsername: z.string().trim().min(1).max(100),
});

const inviteJoinSchema = z.object({
  guildId: snowflake,
  discordUserId: snowflake,
  username: z.string().trim().min(1).max(100),
  inviterDiscordId: snowflake.nullable().optional().default(null),
  inviterUsername: z.string().trim().max(100).nullable().optional().default(null),
  inviteCode: z.string().trim().max(100).nullable().optional().default(null),
  joinedAt: z.string().trim().max(40).optional(),
});

const invitePanelMessageSchema = z.object({
  messageId: snowflake.nullable().optional().default(null),
  channelId: snowflake.nullable().optional().default(null),
});

const inviteLinkSchema = z.object({
  guildId: snowflake,
  discordUserId: snowflake,
  inviteCode: z.string().trim().min(2).max(100),
  inviteUrl: z.string().trim().min(10).max(500),
});

const vouchSchema = actorSchema.extend({
  voucherDiscordId: snowflake,
  voucherUsername: z.string().trim().min(1).max(100),
  targetDiscordId: snowflake,
  targetUsername: z.string().trim().min(1).max(100),
  type: z.enum(['positive', 'scam']),
  reason: z.string().trim().min(3).max(500),
});

const codeSchema = actorSchema.extend({
  code: z.string().trim().min(3).max(32),
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  amount: z.number().int().positive().max(1_000_000_000_000),
  maxRedemptions: z.number().int().min(1).max(100_000),
  expiresAt: z.string().trim().max(40).nullable().optional(),
});

const codeRedeemSchema = z.object({
  code: z.string().trim().min(3).max(32),
  discordUserId: snowflake,
});

const giveawayCreateSchema = actorSchema.extend({
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().max(2000).optional().default(''),
  prizeAmount: z.number().int().positive().max(1_000_000_000_000),
  winnerCount: z.number().int().min(1).max(50),
  durationSeconds: z.number().int().min(300).max(30 * 24 * 60 * 60),
  bannerUrl: z.string().trim().max(500).nullable().optional(),
});

const giveawayActionSchema = actorSchema;

const giveawayCancelSchema = actorSchema.extend({
  reason: z.string().trim().min(3).max(500),
});

const giveawayJoinSchema = z.object({
  discordUserId: snowflake,
});

const announcementSectionsSchema = z.object({
  features: z.array(z.string().max(400)).max(20),
  improvements: z.array(z.string().max(400)).max(20),
  fixes: z.array(z.string().max(400)).max(20),
  removed: z.array(z.string().max(400)).max(20),
  other: z.array(z.string().max(400)).max(20),
});

const announcementBase = {
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().max(4000).nullable().optional(),
  sections: announcementSectionsSchema.nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  thumbnailUrl: z.string().trim().max(500).nullable().optional(),
  footer: z.string().trim().max(200).nullable().optional(),
  author: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(10).nullable().optional(),
  emoji: z.string().trim().max(20).nullable().optional(),
  mentionEveryone: z.boolean().optional(),
};

const announcementSchema = actorSchema.extend({
  kind: z.enum(['news', 'changelog']),
  ...announcementBase,
});

const announcementEditSchema = z.object(announcementBase);

const configSchema = z.object({
  channels: z
    .object({
      welcome: optionalSnowflake,
      vouches: optionalSnowflake,
      scamVouches: optionalSnowflake,
      invites: optionalSnowflake,
      codes: optionalSnowflake,
      giveaways: optionalSnowflake,
      news: optionalSnowflake,
      changelog: optionalSnowflake,
      logs: optionalSnowflake,
      tickets: optionalSnowflake,
      ticketTranscripts: optionalSnowflake,
      cashierRequests: optionalSnowflake,
      cashierTranscripts: optionalSnowflake,
    })
    .partial()
    .optional(),
  roles: z
    .object({
      owner: z.array(snowflake).max(25).optional(),
      admin: z.array(snowflake).max(25).optional(),
      staff: z.array(snowflake).max(25).optional(),
      moderator: z.array(snowflake).max(25).optional(),
    })
    .partial()
    .optional(),
  inviteRewardsEnabled: z.boolean().optional(),
  inviteRewardEvery: z.number().int().min(1).max(100).optional(),
  inviteRewardAmount: z.number().int().min(1).max(1_000_000_000_000).optional(),
  invitePanelTitle: z.string().trim().min(3).max(120).optional(),
  invitePanelBody: z.string().trim().min(10).max(3_900).optional(),
  inviteCopyMessage: z.string().trim().min(10).max(1_800).optional(),
  announcementEveryone: z.boolean().optional(),
});

const outboxClaimSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(20),
});

const outboxCompleteSchema = z.object({
  messageId: snowflake.nullable().optional(),
});

const outboxFailSchema = z.object({
  error: z.string().trim().min(1).max(1000),
});

const outboxSkipSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const botLimiter = new RateLimiter(2400, 60_000);

function botAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = config.discordBotApiKey;
  if (!expected || expected.length < 32) {
    next(
      new ApiError(
        503,
        'BOT_API_DISABLED',
        'The Discord bot API is disabled until DISCORD_BOT_API_KEY is configured with at least 32 characters.',
      ),
    );
    return;
  }
  const header = req.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const valid =
    providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
  if (!valid) {
    next(new ApiError(401, 'BOT_UNAUTHORIZED', 'The bot API key is missing or invalid.'));
    return;
  }
  const limit = botLimiter.consume('discord-bot');
  if (!limit.allowed) {
    next(new ApiError(429, 'RATE_LIMITED', 'The bot is sending requests too quickly.', {
      retryAfterSeconds: limit.retryAfterSeconds,
    }));
    return;
  }
  res.set('Cache-Control', 'no-store');
  next();
}

function eventRow(db: DB, id: string): {
  id: string;
  guildId: string | null;
  eventType: DiscordEventType;
  payload: Record<string, unknown>;
  attempts: number;
  status: string;
} {
  const row = db
    .prepare('SELECT id, guild_id, event_type, payload, attempts, status FROM discord_outbox WHERE id = ?')
    .get(id) as
    | {
        id: string;
        guild_id: string | null;
        event_type: DiscordEventType;
        payload: string;
        attempts: number;
        status: string;
      }
    | undefined;
  if (!row) throw notFound('Outbox event not found.');
  if (row.status !== 'processing' && row.status !== 'sent') {
    throw conflict('This outbox event is not leased to a bot worker.', 'OUTBOX_NOT_CLAIMED');
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    eventType: row.event_type,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    attempts: row.attempts,
    status: row.status,
  };
}

export function createBotRouter(db: DB): Router {
  const router = Router();
  router.use(botAuth);

  router.get('/health', (_req, res) => {
    const status = getBotStatus(db);
    res.json({
      ok: true,
      now: nowIso(),
      botApiVersion: 1,
      connected: status.connected,
      guild: status.guild,
    });
  });

  router.post('/heartbeat', (req, res) => {
    const body = parse(heartbeatSchema, req.body);
    recordHeartbeat(db, {
      botVersion: body.botVersion,
      latencyMs: body.latencyMs,
      guilds: body.guilds.map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconUrl,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
      })),
    });
    const guilds = db.prepare('SELECT * FROM discord_guilds ORDER BY primary_guild DESC, created_at ASC').all() as Parameters<typeof mapGuildSummary>[0][];
    res.json({
      ok: true,
      guilds: guilds.map(mapGuildSummary),
      primaryGuildId: guilds[0]?.guild_id ?? null,
    });
  });

  router.get('/config/:guildId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    if (!isDiscordSnowflake(guildId)) throw badRequest('Invalid Discord server.');
    res.json({ config: getGuildConfig(db, guildId), status: getBotStatus(db) });
  });

  router.post('/config/:guildId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const body = parse(configSchema, req.body);
    const actorInput = z
      .object({
        discordUserId: snowflake,
        discordUsername: z.string().trim().min(1).max(100),
        roleIds,
      })
      .parse(req.body);
    const context = requireDiscordStaff(db, {
      guildId,
      discordUserId: actorInput.discordUserId,
      discordUsername: actorInput.discordUsername,
      roleIds: actorInput.roleIds,
      permission: 'discord.manage',
      scope: 'admin',
    });
    const updated = updateGuildConfig(db, guildId, body, context.user);
    res.json({ config: updated });
  });

  router.post('/link', (req, res) => {
    const body = parse(linkSchema, req.body);
    const result = redeemDiscordLinkCode(db, body);
    const settledRewards = settlePendingInviteRewards(db, body.discordUserId);
    res.json({
      linked: true,
      user: {
        id: result.user.id,
        username: result.user.username,
        balance: balanceOf(db, result.user.id),
        role: result.user.role,
      },
      discordUserId: result.link.discord_user_id,
      settledInviteRewards: settledRewards,
    });
  });

  router.get('/balance/:discordUserId', (req, res) => {
    const discordUserId = req.params.discordUserId ?? '';
    if (!isDiscordSnowflake(discordUserId)) throw badRequest('Invalid Discord user.');
    const link = getLinkForDiscord(db, discordUserId);
    if (!link) {
      res.json({
        linked: false,
        linkUrl: `${config.appUrl}/settings#discord`,
        command: '/link',
      });
      return;
    }
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.status, w.balance
           FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?`,
      )
      .get(link.user_id) as
      | { id: string; username: string; role: string; status: string; balance: number }
      | undefined;
    if (!row) {
      res.json({ linked: false, linkUrl: `${config.appUrl}/settings#discord`, command: '/link' });
      return;
    }
    res.json({
      linked: true,
      discordUserId: link.discord_user_id,
      discordUsername: link.discord_username,
      websiteUserId: row.id,
      websiteUsername: row.username,
      role: row.role,
      status: row.status,
      balance: row.balance,
    });
  });

  router.get('/accounts/:discordUserId', (req, res) => {
    const discordUserId = req.params.discordUserId ?? '';
    if (!isDiscordSnowflake(discordUserId)) throw badRequest('Invalid Discord user.');
    const link = getLinkForDiscord(db, discordUserId);
    if (!link) {
      res.json({ linked: false });
      return;
    }
    const { user } = requireDiscordAccount(db, discordUserId);
    res.json({
      linked: true,
      discordUserId: link.discord_user_id,
      discordUsername: link.discord_username,
      user: { id: user.id, username: user.username, balance: balanceOf(db, user.id), role: user.role },
    });
  });

  router.post('/invites/join', (req, res) => {
    const body = parse(inviteJoinSchema, req.body);
    const result = recordInviteJoin(db, body);
    res.json(result);
  });

  router.get('/invites/panel/:guildId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    res.json({ panel: getInvitePanelSettings(db, guildId) });
  });

  router.post('/invites/panel/:guildId/message', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const body = parse(invitePanelMessageSchema, req.body);
    setInvitePanelMessage(db, guildId, body.messageId, body.channelId);
    res.json({ ok: true });
  });

  router.post('/invites/link', (req, res) => {
    const body = parse(inviteLinkSchema, req.body);
    res.json({ link: savePersonalInviteLink(db, body) });
  });

  router.get('/invites/link/code/:guildId/:inviteCode', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const inviteCode = req.params.inviteCode ?? '';
    if (!isDiscordSnowflake(guildId)) throw badRequest('Invalid Discord server.');
    res.json({ link: getPersonalInviteByCode(db, guildId, inviteCode.slice(0, 100)) });
  });

  router.get('/invites/link/:guildId/:discordUserId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const discordUserId = req.params.discordUserId ?? '';
    res.json({ link: getPersonalInviteLink(db, guildId, discordUserId) });
  });

  router.get('/invites/:guildId/leaderboard', (req, res) => {
    const guildId = req.params.guildId ?? '';
    if (!isDiscordSnowflake(guildId)) throw badRequest('Invalid Discord server.');
    const limit = Math.min(25, Math.max(1, Number(req.query.limit ?? 10) || 10));
    res.json({ entries: getInviteLeaderboard(db, guildId, limit) });
  });

  router.get('/invites/:guildId/:discordUserId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const discordUserId = req.params.discordUserId ?? '';
    if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId)) {
      throw badRequest('Invalid Discord server or user.');
    }
    res.json({
      stats: getInviteStats(db, guildId, discordUserId),
      leaderboard: getInviteLeaderboard(db, guildId, 10),
    });
  });

  router.post('/vouches', (req, res) => {
    const body = parse(vouchSchema, req.body);
    const { user } = requireDiscordAccount(db, body.voucherDiscordId);
    const vouch = createVouch(db, user, body);
    res.status(201).json({ vouch });
  });

  router.get('/vouches/:guildId/:discordUserId', (req, res) => {
    const guildId = req.params.guildId ?? '';
    const discordUserId = req.params.discordUserId ?? '';
    if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId)) {
      throw badRequest('Invalid Discord server or user.');
    }
    res.json({ stats: getVouchStats(db, guildId, discordUserId) });
  });

  router.post('/codes', (req, res) => {
    const body = parse(codeSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'codes.manage',
      scope: 'staff',
    });
    const code = createRewardCode(
      db,
      context.user,
      {
        code: body.code,
        name: body.name,
        description: body.description,
        amount: body.amount,
        maxRedemptions: body.maxRedemptions,
        expiresAt: body.expiresAt ?? null,
      },
      { via: 'discord', guildId: body.guildId },
    );
    res.status(201).json({ code });
  });

  router.post('/codes/redeem', (req, res) => {
    const body = parse(codeRedeemSchema, req.body);
    const { user } = requireDiscordAccount(db, body.discordUserId);
    assertEmailVerified(user);
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    const result = redeemRewardCode(db, user, body.code, 'discord', body.discordUserId);
    res.json(result);
  });

  router.get('/giveaways', (_req, res) => {
    res.json({ giveaways: listDiscordGiveaways(db) });
  });

  router.post('/giveaways', (req, res) => {
    const body = parse(giveawayCreateSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'giveaways.manage',
      scope: 'staff',
    });
    const giveaway = createDiscordGiveaway(db, context, body);
    res.status(201).json({ giveaway });
  });

  router.post('/giveaways/:id/join', (req, res) => {
    const body = parse(giveawayJoinSchema, req.body);
    const { user } = requireDiscordAccount(db, body.discordUserId);
    assertEmailVerified(user);
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    const giveaway = joinDiscordGiveaway(db, user, req.params.id ?? '');
    res.json({ giveaway });
  });

  router.post('/giveaways/:id/end', (req, res) => {
    const body = parse(giveawayActionSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'giveaways.manage',
      scope: 'staff',
    });
    res.json({ giveaway: endDiscordGiveaway(db, context, req.params.id ?? '') });
  });

  router.post('/giveaways/:id/reroll', (req, res) => {
    const body = parse(giveawayActionSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'giveaways.manage',
      scope: 'staff',
    });
    res.json({ giveaway: rerollDiscordGiveaway(db, context, req.params.id ?? '') });
  });

  router.post('/giveaways/:id/cancel', (req, res) => {
    const body = parse(giveawayCancelSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'giveaways.manage',
      scope: 'staff',
    });
    res.json({ giveaway: cancelDiscordGiveaway(db, context, req.params.id ?? '', body.reason) });
  });

  router.get('/announcements', (req, res) => {
    const kind = req.query.kind === 'news' || req.query.kind === 'changelog' ? req.query.kind : undefined;
    res.json({ announcements: listAnnouncements(db, { kind, limit: 25 }) });
  });

  router.post('/announcements', (req, res) => {
    const body = parse(announcementSchema, req.body);
    const context = requireDiscordStaff(db, {
      guildId: body.guildId,
      discordUserId: body.discordUserId,
      discordUsername: body.discordUsername,
      roleIds: body.roleIds,
      permission: 'notifications.broadcast',
      scope: 'admin',
    });
    const announcement = createAnnouncement(db, context.user, body.kind, body, {
      guildId: body.guildId,
    });
    res.status(201).json({ announcement });
  });

  router.patch('/announcements/:id', (req, res) => {
    const body = parse(announcementEditSchema, req.body);
    const actorInput = z
      .object({ discordUserId: snowflake, discordUsername: z.string().trim().min(1).max(100), roleIds })
      .parse(req.body);
    const existing = listAnnouncements(db, { limit: 100, includeDeleted: true }).find(
      (item) => item.id === req.params.id,
    );
    if (!existing) throw notFound('Announcement not found.');
    const guildRow = db.prepare('SELECT guild_id FROM discord_announcements WHERE id = ?').get(existing.id) as {
      guild_id: string;
    };
    const context = requireDiscordStaff(db, {
      guildId: guildRow.guild_id,
      discordUserId: actorInput.discordUserId,
      discordUsername: actorInput.discordUsername,
      roleIds: actorInput.roleIds,
      permission: 'notifications.broadcast',
      scope: 'admin',
    });
    res.json({ announcement: updateAnnouncement(db, context.user, existing.id, body) });
  });

  router.delete('/announcements/:id', (req, res) => {
    const actorInput = z
      .object({ discordUserId: snowflake, discordUsername: z.string().trim().min(1).max(100), roleIds })
      .parse(req.body);
    const existing = listAnnouncements(db, { limit: 100, includeDeleted: true }).find(
      (item) => item.id === req.params.id,
    );
    if (!existing) throw notFound('Announcement not found.');
    const guildRow = db.prepare('SELECT guild_id FROM discord_announcements WHERE id = ?').get(existing.id) as {
      guild_id: string;
    };
    const context = requireDiscordStaff(db, {
      guildId: guildRow.guild_id,
      discordUserId: actorInput.discordUserId,
      discordUsername: actorInput.discordUsername,
      roleIds: actorInput.roleIds,
      permission: 'notifications.broadcast',
      scope: 'admin',
    });
    res.json({ announcement: deleteAnnouncement(db, context.user, existing.id) });
  });

  router.post('/outbox/claim', (req, res) => {
    const body = parse(outboxClaimSchema, req.body);
    res.json({ events: claimOutbox(db, body.limit) });
  });

  router.get('/support/transcripts/ticket/:id', (req, res) => {
    const transcript = getTicketTranscriptForBot(db, req.params.id ?? '');
    if (!transcript) throw notFound('Ticket transcript not found.');
    res.json({ transcript });
  });

  router.get('/support/transcripts/cashier/:id', (req, res) => {
    const transcript = getCashierTranscriptForBot(db, req.params.id ?? '');
    if (!transcript) throw notFound('Cashier transcript not found.');
    res.json({ transcript });
  });

  router.post('/outbox/:id/complete', (req, res) => {
    const body = parse(outboxCompleteSchema, req.body);
    const event = eventRow(db, req.params.id ?? '');
    if (event.status === 'sent') {
      res.json({ ok: true, duplicate: true });
      return;
    }
    attachOutboxMessage(db, event, body.messageId ?? null);
    res.json({ ok: true });
  });

  router.post('/outbox/:id/fail', (req, res) => {
    const body = parse(outboxFailSchema, req.body);
    const event = eventRow(db, req.params.id ?? '');
    if (event.status === 'sent') {
      res.json({ ok: true, duplicate: true });
      return;
    }
    failOutbox(db, event.id, body.error);
    res.json({ ok: true });
  });

  router.post('/outbox/:id/skip', (req, res) => {
    const body = parse(outboxSkipSchema, req.body);
    const event = eventRow(db, req.params.id ?? '');
    if (event.status === 'sent') {
      res.json({ ok: true, duplicate: true });
      return;
    }
    skipOutbox(db, event.id, body.reason);
    res.json({ ok: true });
  });

  // Kept last so a malformed path never reaches a mutating handler.
  router.use((_req, _res, next) => next(notFound('Bot API endpoint not found.')));

  return router;
}
