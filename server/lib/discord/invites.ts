import type { DB } from '../../db/index.ts';
import type {
  DiscordInviteLeaderboardEntry,
  DiscordInviteLink,
  DiscordInvitePanelSettings,
  DiscordInviteStats,
  SessionUser,
} from '../../../shared/types.ts';
import { compactAmount } from '../../../shared/amount.ts';
import { badRequest, inTransaction, newId, nowIso } from '../core.ts';
import { applyLedger } from '../wallet.ts';
import { notify } from '../notifications.ts';
import { recordAudit } from '../audit.ts';
import { loadUser } from '../../auth.ts';
import {
  ensureGuildPlaceholder,
  getGuildConfig,
  getLinkForDiscord,
  isDiscordSnowflake,
  recordDiscordActivity,
} from './core.ts';

interface InviteRewardRow {
  id: string;
  guild_id: string;
  inviter_discord_id: string;
  inviter_username: string | null;
  user_id: string | null;
  threshold_count: number;
  amount: number;
  status: 'pending' | 'paid' | 'void';
  ledger_id: string | null;
  created_at: string;
  paid_at: string | null;
}

interface PersonalInviteRow {
  guild_id: string;
  discord_user_id: string;
  invite_code: string;
  invite_url: string;
  created_at: string;
}

function mapPersonalInvite(row: PersonalInviteRow): DiscordInviteLink {
  return {
    discordUserId: row.discord_user_id,
    inviteCode: row.invite_code,
    inviteUrl: row.invite_url,
    createdAt: row.created_at,
  };
}

function isDiscordInviteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['discord.gg', 'discord.com', 'www.discord.com'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** The website defaults are rendered by the server, so old rows never lose copy. */
export function getInvitePanelSettings(db: DB, guildId: string): DiscordInvitePanelSettings {
  if (!isDiscordSnowflake(guildId)) throw badRequest('Invalid Discord server.');
  const config = getGuildConfig(db, guildId);
  return {
    guildId,
    channelId: config.channels.invites,
    title: config.invitePanelTitle,
    body: config.invitePanelBody,
    copyMessage: config.inviteCopyMessage,
    rewardEvery: config.inviteRewardEvery,
    rewardAmount: config.inviteRewardAmount,
    enabled: config.inviteRewardsEnabled,
    messageId: config.invitePanelMessageId,
    messageChannelId: config.invitePanelChannelId,
  };
}

export function setInvitePanelMessage(
  db: DB,
  guildId: string,
  messageId: string | null,
  channelId: string | null,
): void {
  if (!isDiscordSnowflake(guildId)) throw badRequest('Invalid Discord server.');
  if (messageId !== null && !isDiscordSnowflake(messageId)) {
    throw badRequest('Invalid Discord message.');
  }
  if (channelId !== null && !isDiscordSnowflake(channelId)) {
    throw badRequest('Invalid Discord channel.');
  }
  ensureGuildPlaceholder(db, guildId);
  db.prepare(
    `UPDATE discord_guild_config
        SET invite_panel_message_id = ?, invite_panel_channel_id = ?
      WHERE guild_id = ?`,
  ).run(messageId, channelId, guildId);
}

export function getPersonalInviteByCode(
  db: DB,
  guildId: string,
  inviteCode: string,
): DiscordInviteLink | null {
  const row = db
    .prepare('SELECT * FROM discord_invite_links WHERE guild_id = ? AND invite_code = ?')
    .get(guildId, inviteCode) as PersonalInviteRow | undefined;
  return row ? mapPersonalInvite(row) : null;
}

export function getPersonalInviteLink(
  db: DB,
  guildId: string,
  discordUserId: string,
): DiscordInviteLink | null {
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId)) {
    throw badRequest('Invalid Discord guild or member.', 'INVALID_DISCORD_IDS');
  }
  const row = db
    .prepare('SELECT * FROM discord_invite_links WHERE guild_id = ? AND discord_user_id = ?')
    .get(guildId, discordUserId) as PersonalInviteRow | undefined;
  return row ? mapPersonalInvite(row) : null;
}

/**
 * Stores the first permanent invite created for a member. A second request
 * returns the stored link, so every click can safely return the same URL.
 */
export function savePersonalInviteLink(
  db: DB,
  input: { guildId: string; discordUserId: string; inviteCode: string; inviteUrl: string },
): DiscordInviteLink {
  if (!isDiscordSnowflake(input.guildId) || !isDiscordSnowflake(input.discordUserId)) {
    throw badRequest('Invalid Discord guild or member.', 'INVALID_DISCORD_IDS');
  }
  const code = input.inviteCode.trim();
  const url = input.inviteUrl.trim();
  if (code.length < 2 || code.length > 100 || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw badRequest('Invalid Discord invite code.', 'INVALID_INVITE_CODE');
  }
  if (!isDiscordInviteUrl(url) || url.length > 500) {
    throw badRequest('Invite links must be Discord https URLs.', 'INVALID_INVITE_URL');
  }
  db.prepare(
    `INSERT OR IGNORE INTO discord_invite_links
       (id, guild_id, discord_user_id, invite_code, invite_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId('dil'), input.guildId, input.discordUserId, code, url, nowIso());
  const stored = getPersonalInviteLink(db, input.guildId, input.discordUserId);
  if (!stored) throw badRequest('Could not store the invite link.', 'INVITE_LINK_NOT_STORED');
  return stored;
}

function inviteCount(db: DB, guildId: string, discordUserId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM discord_invite_joins
          WHERE guild_id = ? AND inviter_discord_id = ? AND counted = 1`,
      )
      .get(guildId, discordUserId) as { count: number }
  ).count;
}

function payReward(db: DB, reward: InviteRewardRow, user: SessionUser): boolean {
  if (reward.status !== 'pending') return false;
  const entry = applyLedger(db, {
    userId: user.id,
    amount: reward.amount,
    type: 'credit_request',
    actorId: null,
    reason: `Discord invite reward — ${reward.threshold_count} invites`,
    refType: 'discord_invite_reward',
    refId: reward.id,
    idempotencyKey: `discord-invite-reward:${reward.id}`,
    metadata: {
      kind: 'discord_invite_reward',
      guildId: reward.guild_id,
      discordUserId: reward.inviter_discord_id,
      thresholdCount: reward.threshold_count,
    },
  });
  const updated = db
    .prepare(
      `UPDATE discord_invite_rewards
          SET status = 'paid', user_id = ?, ledger_id = ?, paid_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .run(user.id, entry.id, nowIso(), reward.id);
  if (updated.changes !== 1) return false;
  notify(db, {
    userId: user.id,
    type: 'wallet',
    title: `Invite reward: ${compactAmount(reward.amount)} money`,
    body: `You reached ${reward.threshold_count} successful Discord invites. The reward is in your wallet.`,
    link: '/wallet',
  });
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.invite_reward.pay',
    targetType: 'discord_invite_reward',
    targetId: reward.id,
    targetLabel: reward.inviter_username ?? reward.inviter_discord_id,
    metadata: {
      amount: reward.amount,
      thresholdCount: reward.threshold_count,
      guildId: reward.guild_id,
    },
  });
  recordDiscordActivity(db, {
    guildId: reward.guild_id,
    actorDiscordId: reward.inviter_discord_id,
    actorUserId: user.id,
    action: 'invite.reward_paid',
    summary: `${user.username} earned ${compactAmount(reward.amount)} money for ${reward.threshold_count} invites`,
  });
  return true;
}

export interface RecordInviteJoinInput {
  guildId: string;
  discordUserId: string;
  username: string;
  inviterDiscordId: string | null;
  inviterUsername: string | null;
  inviteCode: string | null;
  joinedAt?: string;
}

export interface InviteJoinResult {
  counted: boolean;
  duplicate: boolean;
  selfInvite: boolean;
  inviteCount: number | null;
  rewarded: boolean;
}

/**
 * Records the first join for a member and awards the inviter at each threshold.
 * The unique `(guild_id, discord_user_id)` constraint means a leave/rejoin can
 * never count twice, and the unique reward threshold means a crash and retry
 * cannot pay the same milestone twice.
 */
export function recordInviteJoin(db: DB, input: RecordInviteJoinInput): InviteJoinResult {
  if (!isDiscordSnowflake(input.guildId) || !isDiscordSnowflake(input.discordUserId)) {
    throw badRequest('Invalid Discord guild or member.', 'INVALID_DISCORD_IDS');
  }
  // Personal invites are created by the bot, so Discord reports the bot as the
  // inviter. The stored code is the source of truth for who owns the link.
  const personalInvite = input.inviteCode
    ? getPersonalInviteByCode(db, input.guildId, input.inviteCode)
    : null;
  const creditDiscordId = personalInvite?.discordUserId ?? input.inviterDiscordId;
  const selfInvite =
    Boolean(creditDiscordId) && creditDiscordId === input.discordUserId;
  const inviter =
    creditDiscordId && !selfInvite && isDiscordSnowflake(creditDiscordId)
      ? creditDiscordId
      : null;
  const joinedAt = input.joinedAt ?? nowIso();
  const counted = Boolean(inviter);

  const result = inTransaction(db, (): InviteJoinResult => {
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO discord_invite_joins
           (id, guild_id, discord_user_id, username, inviter_discord_id, inviter_username, invite_code, counted, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('dij'),
        input.guildId,
        input.discordUserId,
        input.username.slice(0, 100),
        inviter,
        inviter && !personalInvite ? (input.inviterUsername ?? '').slice(0, 100) || null : null,
        input.inviteCode?.slice(0, 100) ?? null,
        counted ? 1 : 0,
        joinedAt,
      );
    if (inserted.changes !== 1) {
      return {
        counted: false,
        duplicate: true,
        selfInvite,
        inviteCount: inviter ? inviteCount(db, input.guildId, inviter) : null,
        rewarded: false,
      };
    }

    if (!inviter) {
      return { counted: false, duplicate: false, selfInvite, inviteCount: null, rewarded: false };
    }

    const total = inviteCount(db, input.guildId, inviter);
    const config = getGuildConfig(db, input.guildId);
    recordDiscordActivity(db, {
      guildId: input.guildId,
      actorDiscordId: input.discordUserId,
      action: 'invite.counted',
      summary: `${input.username} joined via @${input.inviterUsername ?? inviter} (${total} invites)`,
      metadata: { inviterDiscordId: inviter, inviteCode: input.inviteCode },
    });
    if (!config.inviteRewardsEnabled) {
      return { counted: true, duplicate: false, selfInvite: false, inviteCount: total, rewarded: false };
    }
    const every = config.inviteRewardEvery;
    if (total % every !== 0) {
      return { counted: true, duplicate: false, selfInvite: false, inviteCount: total, rewarded: false };
    }

    const rewardId = newId('dir');
    const insertedReward = db
      .prepare(
        `INSERT OR IGNORE INTO discord_invite_rewards
           (id, guild_id, inviter_discord_id, inviter_username, threshold_count, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        rewardId,
        input.guildId,
        inviter,
        input.inviterUsername?.slice(0, 100) ?? null,
        total,
        config.inviteRewardAmount,
        nowIso(),
      );
    if (insertedReward.changes !== 1) {
      return { counted: true, duplicate: false, selfInvite: false, inviteCount: total, rewarded: false };
    }
    const reward = db
      .prepare('SELECT * FROM discord_invite_rewards WHERE id = ?')
      .get(rewardId) as InviteRewardRow;
    const link = getLinkForDiscord(db, inviter);
    if (!link) {
      recordDiscordActivity(db, {
        guildId: input.guildId,
        actorDiscordId: inviter,
        action: 'invite.reward_pending',
        summary: `@${input.inviterUsername ?? inviter} reached ${total} invites; reward is waiting for an account link`,
        metadata: { rewardId, amount: reward.amount },
      });
      return { counted: true, duplicate: false, selfInvite: false, inviteCount: total, rewarded: false };
    }
    const user = loadUser(db, link.user_id);
    if (!user || user.status !== 'active' || user.accountHold) {
      return { counted: true, duplicate: false, selfInvite: false, inviteCount: total, rewarded: false };
    }
    return {
      counted: true,
      duplicate: false,
      selfInvite: false,
      inviteCount: total,
      rewarded: payReward(db, reward, user),
    };
  });
  return result;
}

/** Pays every pending threshold once the inviter links or their hold clears. */
export function settlePendingInviteRewards(db: DB, discordUserId: string): number {
  const link = getLinkForDiscord(db, discordUserId);
  if (!link) return 0;
  const user = loadUser(db, link.user_id);
  if (!user || user.status !== 'active' || user.accountHold) return 0;
  const pending = db
    .prepare(
      `SELECT * FROM discord_invite_rewards
        WHERE inviter_discord_id = ? AND status = 'pending'
        ORDER BY created_at ASC`,
    )
    .all(discordUserId) as InviteRewardRow[];
  return inTransaction(db, () => {
    let paid = 0;
    for (const reward of pending) {
      if (payReward(db, reward, user)) paid += 1;
    }
    return paid;
  });
}

export function getInviteStats(
  db: DB,
  guildId: string,
  discordUserId: string,
  username?: string | null,
): DiscordInviteStats {
  const config = getGuildConfig(db, guildId);
  const total = inviteCount(db, guildId, discordUserId);
  const rewardRows = db
    .prepare(
      `SELECT status, amount FROM discord_invite_rewards
        WHERE guild_id = ? AND inviter_discord_id = ?`,
    )
    .all(guildId, discordUserId) as { status: string; amount: number }[];
  const rewardsEarned = rewardRows
    .filter((row) => row.status === 'paid')
    .reduce((sum, row) => sum + row.amount, 0);
  const rewardsPending = rewardRows
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum + row.amount, 0);
  const every = Math.max(1, config.inviteRewardEvery);
  const remainder = total % every;
  const leaderboard = getInviteLeaderboard(db, guildId, 1000);
  const position = leaderboard.findIndex((entry) => entry.discordUserId === discordUserId);
  const link = getLinkForDiscord(db, discordUserId);
  const linkedUser = link ? loadUser(db, link.user_id) : null;
  return {
    discordUserId,
    username:
      username ??
      (db
        .prepare(
          `SELECT username FROM discord_invite_joins WHERE guild_id = ? AND discord_user_id = ?
            ORDER BY joined_at DESC LIMIT 1`,
        )
        .get(guildId, discordUserId) as { username: string } | undefined)?.username ??
      null,
    websiteUsername: linkedUser?.username ?? null,
    linked: Boolean(linkedUser),
    totalInvites: total,
    rewardsEarned,
    rewardsPending,
    rewardEvery: every,
    rewardAmount: config.inviteRewardAmount,
    nextRewardIn: remainder === 0 ? every : every - remainder,
    progress: remainder,
    leaderboardPosition: position >= 0 ? position + 1 : null,
    totalTrackedInvites: (
      db
        .prepare('SELECT COUNT(*) AS count FROM discord_invite_joins WHERE guild_id = ? AND counted = 1')
        .get(guildId) as { count: number }
    ).count,
  };
}

export function getInviteLeaderboard(
  db: DB,
  guildId: string,
  limit = 10,
): DiscordInviteLeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT j.inviter_discord_id AS discordUserId,
              MAX(j.inviter_username) AS username,
              COUNT(*) AS invites,
              COALESCE((
                SELECT SUM(r.amount) FROM discord_invite_rewards r
                 WHERE r.guild_id = j.guild_id
                   AND r.inviter_discord_id = j.inviter_discord_id
                   AND r.status = 'paid'
              ), 0) AS rewards
         FROM discord_invite_joins j
        WHERE j.guild_id = ? AND j.counted = 1 AND j.inviter_discord_id IS NOT NULL
        GROUP BY j.inviter_discord_id
        ORDER BY invites DESC, rewards DESC, j.inviter_discord_id ASC
        LIMIT ?`,
    )
    .all(guildId, Math.min(100, Math.max(1, limit))) as {
    discordUserId: string;
    username: string | null;
    invites: number;
    rewards: number;
  }[];
  return rows.map((row, index) => {
    const link = getLinkForDiscord(db, row.discordUserId);
    const user = link ? loadUser(db, link.user_id) : null;
    return {
      rank: index + 1,
      discordUserId: row.discordUserId,
      username: row.username ?? row.discordUserId,
      websiteUsername: user?.username ?? null,
      invites: row.invites,
      rewards: row.rewards,
    };
  });
}

/** Used by the website dashboard for the same numbers shown in Discord. */
export function inviteOverview(db: DB, guildId: string | null): {
  totalTracked: number;
  totalRewards: number;
  pendingRewards: number;
  top: DiscordInviteLeaderboardEntry[];
} {
  if (!guildId) return { totalTracked: 0, totalRewards: 0, pendingRewards: 0, top: [] };
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending
       FROM discord_invite_rewards WHERE guild_id = ?`,
    )
    .get(guildId) as { paid: number; pending: number };
  return {
    totalTracked: (
      db
        .prepare('SELECT COUNT(*) AS count FROM discord_invite_joins WHERE guild_id = ? AND counted = 1')
        .get(guildId) as { count: number }
    ).count,
    totalRewards: row.paid,
    pendingRewards: row.pending,
    top: getInviteLeaderboard(db, guildId, 10),
  };
}
