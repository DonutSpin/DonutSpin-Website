import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { DiscordOverviewResponse } from '../../shared/types.ts';
import { config } from '../config.ts';
import { ApiError, badRequest, notFound, nowIso } from '../lib/core.ts';
import { parse } from '../lib/validation.ts';
import { RateLimiter } from '../lib/rate-limit.ts';
import { requireActive, requireAuth, requirePermission } from '../lib/permissions.ts';
import { assertEmailVerified, assertNotOnHold } from '../lib/account-status.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from '../lib/discord/announcements.ts';
import {
  createRewardCode,
  deleteRewardCode,
  listRewardCodes,
  listUserCodeRedemptions,
  redeemRewardCode,
  setRewardCodeDisabled,
} from '../lib/discord/codes.ts';
import {
  getBotStatus,
  getDiscordStats,
  getGuildConfig,
  getLinkForUser,
  getPrimaryGuild,
  issueDiscordLinkCode,
  listDiscordActivity,
  mapGuildSummary,
  unlinkDiscord,
  updateGuildConfig,
  type DiscordGuildRow,
} from '../lib/discord/core.ts';
import {
  createInfoChannel,
  createPanel,
  deleteInfoChannel,
  deletePanel,
  listInfoChannels,
  listPanels,
  updateInfoChannel,
  updatePanel,
} from '../lib/discord/panels.ts';
import { getInviteLeaderboard } from '../lib/discord/invites.ts';
import { listRecentVouches } from '../lib/discord/vouches.ts';
import { recordAudit } from '../lib/audit.ts';

const snowflake = z.string().regex(/^\d{15,22}$/, 'Invalid Discord ID.');
const optionalSnowflake = snowflake.nullable().optional();

const configSchema = z.object({
  guildId: snowflake.optional(),
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

const sectionsSchema = z.object({
  features: z.array(z.string().max(400)).max(20),
  improvements: z.array(z.string().max(400)).max(20),
  fixes: z.array(z.string().max(400)).max(20),
  removed: z.array(z.string().max(400)).max(20),
  other: z.array(z.string().max(400)).max(20),
});

const announcementSchema = z.object({
  kind: z.enum(['news', 'changelog']),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().max(4000).nullable().optional(),
  sections: sectionsSchema.nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  thumbnailUrl: z.string().trim().max(500).nullable().optional(),
  footer: z.string().trim().max(200).nullable().optional(),
  author: z.string().trim().max(100).nullable().optional(),
  color: z.string().trim().max(10).nullable().optional(),
  emoji: z.string().trim().max(20).nullable().optional(),
  mentionEveryone: z.boolean().optional(),
});

const announcementEditSchema = announcementSchema.omit({ kind: true });

const infoChannelSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().min(2).max(50),
  channelId: snowflake,
  description: z.string().trim().max(200).nullable().optional(),
});

const panelLinkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().max(500),
});

const panelSchema = z.object({
  infoChannelId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(4000),
  color: z.string().trim().max(10).nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  thumbnailUrl: z.string().trim().max(500).nullable().optional(),
  footer: z.string().trim().max(200).nullable().optional(),
  links: z.array(panelLinkSchema).max(4).optional(),
  mentionEveryone: z.boolean().optional(),
});

const codeSchema = z.object({
  code: z.string().trim().min(3).max(32),
  name: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  amount: z.number().int().positive().max(1_000_000_000_000),
  maxRedemptions: z.number().int().min(1).max(100_000),
  expiresAt: z.string().trim().max(40).nullable().optional(),
});

const codeToggleSchema = z.object({ disabled: z.boolean() });

export function createDiscordAdminRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    requirePermission(req, 'discord.manage');
    const status = getBotStatus(db);
    const primary = getPrimaryGuild(db);
    const guildRows = db
      .prepare('SELECT * FROM discord_guilds ORDER BY primary_guild DESC, created_at ASC')
      .all() as DiscordGuildRow[];
    const config = primary ? getGuildConfig(db, primary.guild_id) : null;
    const overview: DiscordOverviewResponse = {
      status,
      config,
      guilds: guildRows.map(mapGuildSummary),
      stats: getDiscordStats(db),
      recentActivity: listDiscordActivity(db, 30),
      announcements: listAnnouncements(db, { limit: 25 }),
      infoChannels: primary ? listInfoChannels(db, primary.guild_id) : [],
      panels: primary ? listPanels(db, primary.guild_id) : [],
      codes: listRewardCodes(db, 25),
      inviteLeaderboard: primary ? getInviteLeaderboard(db, primary.guild_id, 10) : [],
      recentVouches: listRecentVouches(db, 10),
    };
    res.set('Cache-Control', 'no-store');
    res.json(overview);
  });

  router.patch('/config', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const body = parse(configSchema, req.body);
    const primary = getPrimaryGuild(db);
    const guildId = body.guildId ?? primary?.guild_id;
    if (!guildId) throw badRequest('Connect the Discord bot before changing its configuration.', 'DISCORD_NOT_CONNECTED');
    const exists = db.prepare('SELECT 1 FROM discord_guilds WHERE guild_id = ?').get(guildId);
    if (!exists) throw notFound('Discord server not found.');
    res.json({ config: updateGuildConfig(db, guildId, body, user) });
  });

  router.post('/announcements', (req, res) => {
    const user = requirePermission(req, 'notifications.broadcast');
    const body = parse(announcementSchema, req.body);
    const primary = getPrimaryGuild(db);
    if (!primary) throw badRequest('Connect the Discord bot before publishing announcements.', 'DISCORD_NOT_CONNECTED');
    const announcement = createAnnouncement(db, user, body.kind, body, { guildId: primary.guild_id });
    res.status(201).json({ announcement });
  });

  router.patch('/announcements/:id', (req, res) => {
    const user = requirePermission(req, 'notifications.broadcast');
    const body = parse(announcementEditSchema, req.body);
    const existing = getAnnouncement(db, req.params.id ?? '');
    if (!existing) throw notFound('Announcement not found.');
    res.json({ announcement: updateAnnouncement(db, user, existing.id, body) });
  });

  router.delete('/announcements/:id', (req, res) => {
    const user = requirePermission(req, 'notifications.broadcast');
    const existing = getAnnouncement(db, req.params.id ?? '');
    if (!existing) throw notFound('Announcement not found.');
    res.json({ announcement: deleteAnnouncement(db, user, existing.id) });
  });

  router.post('/info-channels', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const body = parse(infoChannelSchema, req.body);
    res.status(201).json({ channel: createInfoChannel(db, user, body) });
  });

  router.patch('/info-channels/:id', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const body = parse(infoChannelSchema, req.body);
    res.json({ channel: updateInfoChannel(db, user, req.params.id ?? '', body) });
  });

  router.delete('/info-channels/:id', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    res.json({ ok: true, ...deleteInfoChannel(db, user, req.params.id ?? '') });
  });

  router.post('/panels', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const body = parse(panelSchema, req.body);
    res.status(201).json({ panel: createPanel(db, user, body) });
  });

  router.patch('/panels/:id', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const body = parse(panelSchema, req.body);
    res.json({ panel: updatePanel(db, user, req.params.id ?? '', body) });
  });

  router.delete('/panels/:id', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    res.json({ panel: deletePanel(db, user, req.params.id ?? '') });
  });

  router.get('/codes', (req, res) => {
    requirePermission(req, 'discord.manage');
    res.json({ codes: listRewardCodes(db, 100) });
  });

  router.post('/codes', (req, res) => {
    const user = requirePermission(req, 'codes.manage');
    const body = parse(codeSchema, req.body);
    const primary = getPrimaryGuild(db);
    const code = createRewardCode(
      db,
      user,
      {
        code: body.code,
        name: body.name,
        description: body.description,
        amount: body.amount,
        maxRedemptions: body.maxRedemptions,
        expiresAt: body.expiresAt ?? null,
      },
      { via: 'web', guildId: primary?.guild_id ?? null },
    );
    res.status(201).json({ code });
  });

  router.patch('/codes/:id', (req, res) => {
    const user = requirePermission(req, 'codes.manage');
    const body = parse(codeToggleSchema, req.body);
    res.json({ code: setRewardCodeDisabled(db, user, req.params.id ?? '', body.disabled) });
  });

  router.delete('/codes/:id', (req, res) => {
    const user = requirePermission(req, 'codes.manage');
    deleteRewardCode(db, user, req.params.id ?? '');
    res.json({ ok: true });
  });

  router.post('/outbox/:id/retry', (req, res) => {
    const user = requirePermission(req, 'discord.manage');
    const row = db.prepare('SELECT status FROM discord_outbox WHERE id = ?').get(req.params.id ?? '') as
      | { status: string }
      | undefined;
    if (!row) throw notFound('Outbox event not found.');
    if (row.status !== 'failed' && row.status !== 'skipped') {
      throw badRequest('Only failed or skipped events can be retried.', 'OUTBOX_NOT_RETRYABLE');
    }
    db.prepare(
      `UPDATE discord_outbox
          SET status = 'pending', attempts = 0, last_error = NULL, available_at = ?, locked_until = NULL
        WHERE id = ?`,
    ).run(nowIso(), req.params.id ?? '');
    recordAudit(db, {
      actorId: user.id,
      action: 'discord.outbox.retry',
      targetType: 'discord_outbox',
      targetId: req.params.id ?? '',
      metadata: { previousStatus: row.status },
    });
    res.json({ ok: true });
  });

  return router;
}

const codeRedeemLimiter = new RateLimiter(12, 60_000);
const linkCodeLimiter = new RateLimiter(6, 60_000);

export function createCodesRouter(db: DB): Router {
  const router = Router();

  router.get('/redemptions', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json({ redemptions: listUserCodeRedemptions(db, user.id) });
  });

  router.post('/redeem', (req, res) => {
    const user = requireActive(req);
    assertEmailVerified(user);
    assertNotOnHold(user);
    assertNotInMaintenance(db);
    const limit = codeRedeemLimiter.consume(user.id);
    if (!limit.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many code attempts. Try again in a minute.', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const body = parse(z.object({ code: z.string().trim().min(3).max(32) }), req.body);
    res.json(redeemRewardCode(db, user, body.code, 'web'));
  });

  return router;
}

export function createDiscordMeRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    res.json({ link: getLinkForUser(db, user.id), botConfigured: Boolean(config.discordBotApiKey) });
  });

  router.post('/code', (req, res) => {
    const user = requireAuth(req);
    const limit = linkCodeLimiter.consume(user.id);
    if (!limit.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many link codes. Try again in a minute.', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    res.status(201).json(issueDiscordLinkCode(db, user));
  });

  router.delete('/', (req, res) => {
    const user = requireAuth(req);
    unlinkDiscord(db, user);
    res.json({ link: getLinkForUser(db, user.id) });
  });

  return router;
}
