import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../../db/index.ts';
import type {
  DiscordActivityView,
  DiscordBotStatus,
  DiscordGuildConfig,
  DiscordGuildSummary,
  DiscordLinkCodeResponse,
  DiscordLinkStatus,
  DiscordRoleConfig,
  Permission,
  SessionUser,
} from '../../../shared/types.ts';
import { config } from '../../config.ts';
import { loadUser } from '../../auth.ts';
import { can } from '../permissions.ts';
import { isSelfExclusionActive } from '../legal.ts';
import { ApiError, forbidden, inTransaction, newId, notFound, nowIso, parseJson } from '../core.ts';
import { notify } from '../notifications.ts';
import { recordAudit } from '../audit.ts';
import { outboxCounts } from './outbox.ts';

const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const ONLINE_WINDOW_MS = 120 * 1000;

export const DEFAULT_INVITE_PANEL_TITLE = '🎁 DonutSpin Invite Rewards';
export const DEFAULT_INVITE_PANEL_BODY = [
  'Invite friends to DonutSpin and earn money in the casino.',
  '',
  '**How it works**',
  '1. Click **Copy** to get your personal invite link.',
  '2. Share it with friends. Every friend who joins through your link counts once.',
  '3. **Reward: {INVITES} invites = {REWARD}** — paid straight to your wallet.',
  '',
  'Invites never expire, and a member can only count once — leaving and rejoining will not farm extra credit.',
  '',
  'Rewards are credited automatically when the milestone is reached and your Discord account is linked to a DonutSpin account.',
].join('\n');

export const DEFAULT_INVITE_COPY_MESSAGE = [
  '🍩🎰 **DONUTSPIN CASINO** 🎰🍩',
  '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
  '# 💰 **5M FREE JOIN BONUS**',
  '### 🎁 Just for joining! 🎁',
  'Start your run with a massive bankroll and take your shot at the top. 👑',
  '🎮 **6 GAME MODES**',
  '🪙 Coinflip • 🃏 Blackjack • 🔴 Plinko',
  '💣 Mines • 🎡 Roulette • 🗼 Towers',
  '🔥 **NEVER-ENDING REWARDS**',
  '🎁 Giveaways',
  '🌧️ Rains',
  '🎟️ Free money codes',
  '📅 Daily rewards',
  '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
  '👉 **Join the casino:** {INVITE_LINK}',
  '🌐 **Website:** https://donutspin.runasp.net/',
  '🍩 Claim your bonus and start spinning! 🍩',
].join('\n');

export interface DiscordGuildRow {
  guild_id: string;
  name: string;
  icon_url: string | null;
  member_count: number;
  owner_discord_id: string | null;
  primary_guild: number;
  bot_version: string | null;
  latency_ms: number | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GuildConfigRow {
  guild_id: string;
  welcome_channel_id: string | null;
  vouch_channel_id: string | null;
  scam_vouch_channel_id: string | null;
  invite_channel_id: string | null;
  codes_channel_id: string | null;
  giveaway_channel_id: string | null;
  news_channel_id: string | null;
  changelog_channel_id: string | null;
  logs_channel_id: string | null;
  owner_role_ids: string;
  admin_role_ids: string;
  staff_role_ids: string;
  moderator_role_ids: string;
  invite_rewards_enabled: number;
  invite_reward_every: number;
  invite_reward_amount: number;
  invite_panel_title: string | null;
  invite_panel_body: string | null;
  invite_copy_message: string | null;
  invite_panel_message_id: string | null;
  invite_panel_channel_id: string | null;
  announcement_everyone: number;
  updated_at: string | null;
  updated_by: string | null;
}

export interface DiscordLinkRow {
  user_id: string;
  discord_user_id: string;
  discord_username: string;
  linked_at: string;
}

export interface DiscordMemberContext {
  user: SessionUser;
  link: DiscordLinkRow;
  config: DiscordGuildConfig;
}

export interface HeartbeatGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string | null;
}

export function isDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{15,22}$/.test(value);
}

export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseIds(raw: string): string[] {
  return parseJson<string[]>(raw, []).filter((id) => isDiscordSnowflake(id));
}

function emptyRoles(): DiscordRoleConfig {
  return { owner: [], admin: [], staff: [], moderator: [] };
}

export function defaultGuildConfig(guildId: string): DiscordGuildConfig {
  return {
    guildId,
    channels: {
      welcome: null,
      vouches: null,
      scamVouches: null,
      invites: null,
      codes: null,
      giveaways: null,
      news: null,
      changelog: null,
      logs: null,
    },
    roles: emptyRoles(),
    inviteRewardsEnabled: true,
    inviteRewardEvery: 3,
    inviteRewardAmount: 5_000_000,
    invitePanelTitle: DEFAULT_INVITE_PANEL_TITLE,
    invitePanelBody: DEFAULT_INVITE_PANEL_BODY,
    inviteCopyMessage: DEFAULT_INVITE_COPY_MESSAGE,
    invitePanelMessageId: null,
    invitePanelChannelId: null,
    announcementEveryone: true,
    updatedAt: null,
    updatedBy: null,
  };
}

export function mapGuildConfig(db: DB, row: GuildConfigRow): DiscordGuildConfig {
  const updatedBy = row.updated_by
    ? (db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.updated_by) as
        | { id: string; username: string }
        | undefined)
    : undefined;
  return {
    guildId: row.guild_id,
    channels: {
      welcome: row.welcome_channel_id,
      vouches: row.vouch_channel_id,
      scamVouches: row.scam_vouch_channel_id,
      invites: row.invite_channel_id,
      codes: row.codes_channel_id,
      giveaways: row.giveaway_channel_id,
      news: row.news_channel_id,
      changelog: row.changelog_channel_id,
      logs: row.logs_channel_id,
    },
    roles: {
      owner: parseIds(row.owner_role_ids),
      admin: parseIds(row.admin_role_ids),
      staff: parseIds(row.staff_role_ids),
      moderator: parseIds(row.moderator_role_ids),
    },
    inviteRewardsEnabled: Boolean(row.invite_rewards_enabled),
    inviteRewardEvery: row.invite_reward_every,
    inviteRewardAmount: row.invite_reward_amount,
    invitePanelTitle: row.invite_panel_title || DEFAULT_INVITE_PANEL_TITLE,
    invitePanelBody: row.invite_panel_body || DEFAULT_INVITE_PANEL_BODY,
    inviteCopyMessage: row.invite_copy_message || DEFAULT_INVITE_COPY_MESSAGE,
    invitePanelMessageId: row.invite_panel_message_id,
    invitePanelChannelId: row.invite_panel_channel_id,
    announcementEveryone: Boolean(row.announcement_everyone),
    updatedAt: row.updated_at,
    updatedBy: updatedBy ?? null,
  };
}

export function ensureGuildPlaceholder(db: DB, guildId: string): void {
  if (!isDiscordSnowflake(guildId)) throw notFound('Unknown Discord server.');
  const exists = db.prepare('SELECT 1 FROM discord_guilds WHERE guild_id = ?').get(guildId);
  if (exists) return;
  const now = nowIso();
  const count = (db.prepare('SELECT COUNT(*) AS count FROM discord_guilds').get() as { count: number }).count;
  db.prepare(
    `INSERT INTO discord_guilds
       (guild_id, name, member_count, primary_guild, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
  ).run(guildId, guildId, count === 0 ? 1 : 0, now, now);
  db.prepare('INSERT OR IGNORE INTO discord_guild_config (guild_id) VALUES (?)').run(guildId);
}

export function getGuildConfig(db: DB, guildId: string): DiscordGuildConfig {
  ensureGuildPlaceholder(db, guildId);
  const row = db.prepare('SELECT * FROM discord_guild_config WHERE guild_id = ?').get(guildId) as
    | GuildConfigRow
    | undefined;
  return row ? mapGuildConfig(db, row) : defaultGuildConfig(guildId);
}

export function getPrimaryGuild(db: DB): DiscordGuildRow | null {
  return (
    (db
      .prepare('SELECT * FROM discord_guilds ORDER BY primary_guild DESC, created_at ASC LIMIT 1')
      .get() as DiscordGuildRow | undefined) ?? null
  );
}

export function mapGuildSummary(row: DiscordGuildRow): DiscordGuildSummary {
  return {
    id: row.guild_id,
    name: row.name,
    iconUrl: row.icon_url,
    memberCount: row.member_count,
    ownerDiscordId: row.owner_discord_id,
    primary: Boolean(row.primary_guild),
    lastSeenAt: row.last_seen_at,
    botVersion: row.bot_version,
    latencyMs: row.latency_ms,
  };
}

/** Records a bot heartbeat and the guilds it is currently connected to. */
export function recordHeartbeat(
  db: DB,
  input: { guilds: HeartbeatGuild[]; botVersion: string; latencyMs: number | null },
): void {
  if (input.guilds.length === 0) return;
  inTransaction(db, () => {
    const now = nowIso();
    const upsert = db.prepare(
      `INSERT INTO discord_guilds
         (guild_id, name, icon_url, member_count, owner_discord_id, primary_guild, bot_version, latency_ms, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         name = excluded.name,
         icon_url = excluded.icon_url,
         member_count = excluded.member_count,
         owner_discord_id = excluded.owner_discord_id,
         bot_version = excluded.bot_version,
         latency_ms = excluded.latency_ms,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
    );
    for (const guild of input.guilds) {
      if (!isDiscordSnowflake(guild.id)) continue;
      ensureGuildPlaceholder(db, guild.id);
      upsert.run(
        guild.id,
        guild.name.slice(0, 100),
        isSafeImageUrl(guild.iconUrl) ? guild.iconUrl : null,
        Math.max(0, Math.trunc(guild.memberCount)),
        guild.ownerId && isDiscordSnowflake(guild.ownerId) ? guild.ownerId : null,
        input.botVersion.slice(0, 40),
        input.latencyMs === null ? null : Math.max(0, Math.round(input.latencyMs)),
        now,
        now,
        now,
      );
    }
    // Exactly one primary guild. The first guild the bot ever joined stays
    // primary unless an operator explicitly promoted another one.
    const primaryCount = (
      db.prepare('SELECT COUNT(*) AS count FROM discord_guilds WHERE primary_guild = 1').get() as {
        count: number;
      }
    ).count;
    if (primaryCount === 0) {
      const first = db
        .prepare('SELECT guild_id FROM discord_guilds ORDER BY created_at ASC LIMIT 1')
        .get() as { guild_id: string } | undefined;
      if (first) db.prepare('UPDATE discord_guilds SET primary_guild = 1 WHERE guild_id = ?').run(first.guild_id);
    }
  });
}

export function getBotStatus(db: DB): DiscordBotStatus {
  const primary = getPrimaryGuild(db);
  const guildCount = (db.prepare('SELECT COUNT(*) AS count FROM discord_guilds').get() as { count: number }).count;
  if (!primary) {
    return { connected: false, guild: null, guildCount, lastSeenAt: null };
  }
  const lastSeen = primary.last_seen_at ? new Date(primary.last_seen_at).getTime() : 0;
  return {
    connected: Boolean(lastSeen) && Date.now() - lastSeen < ONLINE_WINDOW_MS,
    guild: mapGuildSummary(primary),
    guildCount,
    lastSeenAt: primary.last_seen_at,
  };
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function normalizeLinkCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function newLinkCode(): string {
  const bytes = randomBytes(8);
  let raw = '';
  for (const byte of bytes) raw += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Creates a link code and returns the plaintext exactly once. */
export function issueDiscordLinkCode(db: DB, user: SessionUser): DiscordLinkCodeResponse {
  const existing = db.prepare('SELECT 1 FROM discord_links WHERE user_id = ?').get(user.id);
  if (existing) throw forbidden('This account is already linked to Discord.', 'DISCORD_ALREADY_LINKED');
  const now = Date.now();
  const code = newLinkCode();
  const normalized = normalizeLinkCode(code);
  const expiresAt = new Date(now + LINK_CODE_TTL_MS).toISOString();
  inTransaction(db, () => {
    db.prepare('DELETE FROM discord_link_codes WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)').run(
      user.id,
      new Date(now).toISOString(),
    );
    db.prepare('DELETE FROM discord_link_codes WHERE user_id = ? AND used_at IS NULL').run(user.id);
    db.prepare(
      `INSERT INTO discord_link_codes (id, user_id, code_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(newId('dlc'), user.id, hashCode(normalized), expiresAt, new Date(now).toISOString());
    db.prepare(
      `INSERT INTO discord_activity (id, actor_user_id, action, summary, created_at)
       VALUES (?, ?, 'link.code_created', ?, ?)`,
    ).run(newId('dca'), user.id, `Link code generated for @${user.username}`, new Date(now).toISOString());
  });
  return { code, expiresAt, command: `/link code:${code}` };
}

export function getLinkForUser(db: DB, userId: string): DiscordLinkStatus {
  const row = db
    .prepare('SELECT discord_user_id, discord_username, linked_at FROM discord_links WHERE user_id = ?')
    .get(userId) as { discord_user_id: string; discord_username: string; linked_at: string } | undefined;
  return {
    linked: Boolean(row),
    discordUserId: row?.discord_user_id ?? null,
    discordUsername: row?.discord_username ?? null,
    linkedAt: row?.linked_at ?? null,
  };
}

export function getLinkForDiscord(db: DB, discordUserId: string): DiscordLinkRow | undefined {
  return db.prepare('SELECT * FROM discord_links WHERE discord_user_id = ?').get(discordUserId) as
    | DiscordLinkRow
    | undefined;
}

/** Redeems a single-use website code inside one transaction. */
export function redeemDiscordLinkCode(
  db: DB,
  input: { code: string; discordUserId: string; discordUsername: string },
): { user: SessionUser; link: DiscordLinkRow } {
  if (!isDiscordSnowflake(input.discordUserId)) throw forbidden('Invalid Discord account.', 'INVALID_DISCORD_USER');
  const normalized = normalizeLinkCode(input.code);
  if (normalized.length < 6) throw notFound('That link code is invalid or has expired.', 'LINK_CODE_INVALID');
  const now = nowIso();
  const result = inTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT c.id, c.user_id, c.expires_at, c.used_at, u.username
           FROM discord_link_codes c JOIN users u ON u.id = c.user_id
          WHERE c.code_hash = ?`,
      )
      .get(hashCode(normalized)) as
      | { id: string; user_id: string; expires_at: string; used_at: string | null; username: string }
      | undefined;
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw notFound('That link code is invalid or has expired. Generate a new one on the website.', 'LINK_CODE_INVALID');
    }
    const userLink = db.prepare('SELECT * FROM discord_links WHERE user_id = ?').get(row.user_id) as
      | DiscordLinkRow
      | undefined;
    if (userLink && userLink.discord_user_id !== input.discordUserId) {
      throw forbidden('This website account is already linked to another Discord account.', 'DISCORD_ALREADY_LINKED');
    }
    const discordLink = db.prepare('SELECT * FROM discord_links WHERE discord_user_id = ?').get(input.discordUserId) as
      | DiscordLinkRow
      | undefined;
    if (discordLink && discordLink.user_id !== row.user_id) {
      throw forbidden('That Discord account is already linked to a different website account.', 'DISCORD_TAKEN');
    }
    if (!userLink) {
      db.prepare(
        'INSERT INTO discord_links (user_id, discord_user_id, discord_username, linked_at) VALUES (?, ?, ?, ?)',
      ).run(row.user_id, input.discordUserId, input.discordUsername.slice(0, 100), now);
    } else if (discordLink?.discord_username !== input.discordUsername.slice(0, 100)) {
      db.prepare('UPDATE discord_links SET discord_username = ? WHERE user_id = ?').run(
        input.discordUsername.slice(0, 100),
        row.user_id,
      );
    }
    db.prepare('UPDATE discord_link_codes SET used_at = ? WHERE id = ?').run(now, row.id);
    db.prepare(
      `INSERT INTO discord_activity (id, actor_discord_id, actor_user_id, action, summary, created_at)
       VALUES (?, ?, ?, 'link.completed', ?, ?)`,
    ).run(
      newId('dca'),
      input.discordUserId,
      row.user_id,
      `Discord @${input.discordUsername} linked to @${row.username}`,
      now,
    );
    notify(db, {
      userId: row.user_id,
      type: 'account',
      title: 'Discord connected',
      body: `Your Discord account @${input.discordUsername} is now linked to DonutSpin.`,
      link: '/settings#discord',
    });
    recordAudit(db, {
      actorId: row.user_id,
      action: 'discord.link',
      targetType: 'user',
      targetId: row.user_id,
      targetLabel: row.username,
      metadata: { discordUserId: input.discordUserId, discordUsername: input.discordUsername },
    });
    const link = db.prepare('SELECT * FROM discord_links WHERE user_id = ?').get(row.user_id) as DiscordLinkRow;
    const user = loadUser(db, row.user_id);
    if (!user) throw notFound('Account not found.');
    return { user, link };
  });
  return result;
}

export function unlinkDiscord(db: DB, user: SessionUser): void {
  inTransaction(db, () => {
    const link = db.prepare('SELECT * FROM discord_links WHERE user_id = ?').get(user.id) as
      | DiscordLinkRow
      | undefined;
    if (!link) return;
    db.prepare('DELETE FROM discord_links WHERE user_id = ?').run(user.id);
    db.prepare(
      `INSERT INTO discord_activity (id, actor_discord_id, actor_user_id, action, summary, created_at)
       VALUES (?, ?, ?, 'link.removed', ?, ?)`,
    ).run(
      newId('dca'),
      link.discord_user_id,
      user.id,
      `@${user.username} unlinked Discord @${link.discord_username}`,
      nowIso(),
    );
    recordAudit(db, {
      actorId: user.id,
      action: 'discord.unlink',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      metadata: { discordUserId: link.discord_user_id },
    });
  });
}

/** Requires a linked, active website account. Used by player-facing bot commands. */
export function requireDiscordAccount(db: DB, discordUserId: string): { user: SessionUser; link: DiscordLinkRow } {
  const link = getLinkForDiscord(db, discordUserId);
  if (!link) {
    throw new ApiError(
      403,
      'DISCORD_NOT_LINKED',
      'Link your Discord account first: open DonutSpin → Settings → Discord and run the `/link` command.',
      { linkUrl: `${config.appUrl}/settings#discord` },
    );
  }
  const user = loadUser(db, link.user_id);
  if (!user) throw forbidden('The linked DonutSpin account no longer exists.', 'DISCORD_LINK_BROKEN');
  if (user.status === 'suspended') throw forbidden('This account is suspended.', 'ACCOUNT_SUSPENDED');
  if (user.status === 'restricted') throw forbidden('This account is restricted. Contact support.', 'ACCOUNT_RESTRICTED');
  if (isSelfExclusionActive(user.selfExcludedUntil)) {
    throw forbidden('This account is self-excluded and cannot use the bot right now.', 'SELF_EXCLUDED');
  }
  return { user, link };
}

/**
 * Authoritative permission check for every administrative bot action. The bot
 * token identifies the process; this still resolves the linked website account
 * and re-checks its live role, so a demotion or suspension takes effect on the
 * next command. Discord roles are an additional gate, never a replacement.
 */
export function requireDiscordStaff(
  db: DB,
  input: {
    guildId: string;
    discordUserId: string;
    discordUsername: string;
    roleIds: string[];
    permission: Permission;
    scope?: 'staff' | 'admin';
  },
): DiscordMemberContext {
  if (!isDiscordSnowflake(input.guildId)) throw forbidden('Unknown Discord server.', 'UNKNOWN_GUILD');
  ensureGuildPlaceholder(db, input.guildId);
  const { user, link } = requireDiscordAccount(db, input.discordUserId);
  if (link.discord_username !== input.discordUsername.slice(0, 100)) {
    db.prepare('UPDATE discord_links SET discord_username = ? WHERE user_id = ?').run(
      input.discordUsername.slice(0, 100),
      user.id,
    );
  }
  if (!can(user.role, input.permission)) {
    throw forbidden('Your DonutSpin role does not include permission for that action.', 'DISCORD_PERMISSION_DENIED');
  }
  const guildConfig = getGuildConfig(db, input.guildId);
  const roleIds = new Set(input.roleIds.filter(isDiscordSnowflake));
  const configured = [
    ...guildConfig.roles.owner,
    ...guildConfig.roles.admin,
    ...guildConfig.roles.staff,
    ...guildConfig.roles.moderator,
  ];
  if (configured.length > 0) {
    const allowed =
      input.scope === 'admin'
        ? [guildConfig.roles.owner, guildConfig.roles.admin]
        : [
            guildConfig.roles.owner,
            guildConfig.roles.admin,
            guildConfig.roles.staff,
            guildConfig.roles.moderator,
          ];
    if (!allowed.some((list) => list.some((id) => roleIds.has(id)))) {
      throw forbidden(
        input.scope === 'admin'
          ? 'Your Discord roles are not configured for DonutSpin administrator actions.'
          : 'Your Discord roles are not configured for DonutSpin staff actions.',
        'DISCORD_ROLE_REQUIRED',
      );
    }
  }
  return { user, link, config: guildConfig };
}

export function recordDiscordActivity(
  db: DB,
  input: {
    guildId?: string | null;
    actorDiscordId?: string | null;
    actorUserId?: string | null;
    action: string;
    summary: string;
    metadata?: Record<string, unknown> | null;
  },
): void {
  db.prepare(
    `INSERT INTO discord_activity
       (id, guild_id, actor_discord_id, actor_user_id, action, summary, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('dca'),
    input.guildId ?? null,
    input.actorDiscordId ?? null,
    input.actorUserId ?? null,
    input.action,
    input.summary.slice(0, 500),
    input.metadata ? JSON.stringify(input.metadata) : null,
    nowIso(),
  );
}

export function listDiscordActivity(db: DB, limit = 25): DiscordActivityView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.summary, a.actor_user_id, a.actor_discord_id, a.created_at,
              u.username AS actor_name
         FROM discord_activity a
         LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(Math.min(100, Math.max(1, limit))) as {
    id: string;
    action: string;
    summary: string;
    actor_user_id: string | null;
    actor_discord_id: string | null;
    actor_name: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    actor: row.actor_user_id || row.actor_discord_id
      ? {
          userId: row.actor_user_id,
          username: row.actor_name,
          discordUserId: row.actor_discord_id,
        }
      : null,
    createdAt: row.created_at,
  }));
}

export interface GuildConfigUpdate {
  channels?: Partial<DiscordGuildConfig['channels']>;
  roles?: Partial<DiscordRoleConfig>;
  inviteRewardsEnabled?: boolean;
  inviteRewardEvery?: number;
  inviteRewardAmount?: number;
  invitePanelTitle?: string;
  invitePanelBody?: string;
  inviteCopyMessage?: string;
  announcementEveryone?: boolean;
}

export function updateGuildConfig(
  db: DB,
  guildId: string,
  update: GuildConfigUpdate,
  actor: SessionUser,
): DiscordGuildConfig {
  ensureGuildPlaceholder(db, guildId);
  const current = getGuildConfig(db, guildId);
  const channels = { ...current.channels, ...(update.channels ?? {}) };
  const roles = { ...current.roles, ...(update.roles ?? {}) };
  const timestamp = nowIso();
  db.prepare(
    `UPDATE discord_guild_config SET
       welcome_channel_id = ?, vouch_channel_id = ?, scam_vouch_channel_id = ?, invite_channel_id = ?,
       codes_channel_id = ?, giveaway_channel_id = ?, news_channel_id = ?, changelog_channel_id = ?,
       logs_channel_id = ?,
       owner_role_ids = ?, admin_role_ids = ?, staff_role_ids = ?, moderator_role_ids = ?,
       invite_rewards_enabled = ?, invite_reward_every = ?, invite_reward_amount = ?,
       invite_panel_title = ?, invite_panel_body = ?, invite_copy_message = ?,
       announcement_everyone = ?, updated_at = ?, updated_by = ?
     WHERE guild_id = ?`,
  ).run(
    channels.welcome,
    channels.vouches,
    channels.scamVouches,
    channels.invites,
    channels.codes,
    channels.giveaways,
    channels.news,
    channels.changelog,
    channels.logs,
    JSON.stringify(roles.owner),
    JSON.stringify(roles.admin),
    JSON.stringify(roles.staff),
    JSON.stringify(roles.moderator),
    (update.inviteRewardsEnabled ?? current.inviteRewardsEnabled) ? 1 : 0,
    update.inviteRewardEvery ?? current.inviteRewardEvery,
    update.inviteRewardAmount ?? current.inviteRewardAmount,
    (update.invitePanelTitle ?? current.invitePanelTitle).slice(0, 120),
    (update.invitePanelBody ?? current.invitePanelBody).slice(0, 4_000),
    (update.inviteCopyMessage ?? current.inviteCopyMessage).slice(0, 1_800),
    (update.announcementEveryone ?? current.announcementEveryone) ? 1 : 0,
    timestamp,
    actor.id,
    guildId,
  );
  recordAudit(db, {
    actorId: actor.id,
    action: 'discord.config.update',
    targetType: 'discord_guild',
    targetId: guildId,
    targetLabel: guildId,
    metadata: { update },
  });
  recordDiscordActivity(db, {
    guildId,
    actorUserId: actor.id,
    action: 'config.updated',
    summary: `${actor.username} updated the Discord bot configuration`,
    metadata: { update },
  });
  return getGuildConfig(db, guildId);
}

export function getDiscordStats(db: DB): {
  linkedAccounts: number;
  trackedInvites: number;
  inviteRewardsPaid: number;
  inviteRewardsPending: number;
  inviteRewardsAmount: number;
  positiveVouches: number;
  scamVouches: number;
  activeGiveaways: number;
  activeCodes: number;
  codeRedemptions: number;
  announcements: number;
  infoChannels: number;
  panels: number;
  pendingOutbox: number;
  failedOutbox: number;
} {
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { count: number }).count;
  const rewards = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS amount
       FROM discord_invite_rewards`,
    )
    .get() as { paid: number; pending: number; amount: number };
  const outbox = outboxCounts(db);
  return {
    linkedAccounts: count('SELECT COUNT(*) AS count FROM discord_links'),
    trackedInvites: count('SELECT COUNT(*) AS count FROM discord_invite_joins WHERE counted = 1'),
    inviteRewardsPaid: rewards.paid,
    inviteRewardsPending: rewards.pending,
    inviteRewardsAmount: rewards.amount,
    positiveVouches: count("SELECT COUNT(*) AS count FROM discord_vouches WHERE type = 'positive'"),
    scamVouches: count("SELECT COUNT(*) AS count FROM discord_vouches WHERE type = 'scam'"),
    activeGiveaways: count("SELECT COUNT(*) AS count FROM giveaways WHERE status IN ('scheduled','active')"),
    activeCodes: count(
      `SELECT COUNT(*) AS count FROM reward_codes
        WHERE disabled_at IS NULL AND redeemed_count < max_redemptions
          AND (expires_at IS NULL OR expires_at > ?)`,
      nowIso(),
    ),
    codeRedemptions: count('SELECT COUNT(*) AS count FROM reward_code_redemptions'),
    announcements: count("SELECT COUNT(*) AS count FROM discord_announcements WHERE status = 'published'"),
    infoChannels: count('SELECT COUNT(*) AS count FROM discord_info_channels'),
    panels: count("SELECT COUNT(*) AS count FROM discord_panels WHERE status = 'published'"),
    pendingOutbox: outbox.pending,
    failedOutbox: outbox.failed,
  };
}
