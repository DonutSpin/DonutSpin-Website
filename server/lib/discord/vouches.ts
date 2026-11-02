import type { DB } from '../../db/index.ts';
import type {
  DiscordVouchStats,
  DiscordVouchView,
  SessionUser,
} from '../../../shared/types.ts';
import { badRequest, conflict, newId, nowIso } from '../core.ts';
import { recordAudit } from '../audit.ts';
import { getLinkForDiscord, isDiscordSnowflake, recordDiscordActivity } from './core.ts';
import { queueVouchPost } from './events.ts';

const VOUCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REASON_MIN = 3;
const REASON_MAX = 500;

interface VouchRow {
  id: string;
  guild_id: string;
  voucher_discord_id: string;
  voucher_username: string;
  target_discord_id: string;
  target_username: string;
  target_user_id: string | null;
  type: 'positive' | 'scam';
  reason: string;
  message_id: string | null;
  created_at: string;
  target_website_username?: string | null;
}

function mapVouch(row: VouchRow): DiscordVouchView {
  return {
    id: row.id,
    type: row.type,
    voucherDiscordId: row.voucher_discord_id,
    voucherUsername: row.voucher_username,
    targetDiscordId: row.target_discord_id,
    targetUsername: row.target_username,
    targetWebsiteUsername: row.target_website_username ?? null,
    reason: row.reason,
    messageId: row.message_id,
    createdAt: row.created_at,
  };
}

const VOUCH_SELECT = `
  SELECT v.*, u.username AS target_website_username
    FROM discord_vouches v
    LEFT JOIN discord_links l ON l.discord_user_id = v.target_discord_id
    LEFT JOIN users u ON u.id = l.user_id
`;

export interface CreateVouchInput {
  guildId: string;
  voucherDiscordId: string;
  voucherUsername: string;
  targetDiscordId: string;
  targetUsername: string;
  type: 'positive' | 'scam';
  reason: string;
}

export function createVouch(
  db: DB,
  user: SessionUser,
  input: CreateVouchInput,
): DiscordVouchView {
  if (!isDiscordSnowflake(input.guildId) || !isDiscordSnowflake(input.targetDiscordId)) {
    throw badRequest('Choose a valid Discord member.', 'INVALID_DISCORD_USER');
  }
  if (input.targetDiscordId === input.voucherDiscordId) {
    throw badRequest('You cannot vouch for yourself.', 'SELF_VOUCH');
  }
  const reason = input.reason.trim();
  if (reason.length < REASON_MIN) {
    throw badRequest(`Write at least ${REASON_MIN} characters explaining the vouch.`, 'VOUCH_REASON_REQUIRED', {
      fields: { reason: 'Add a short reason.' },
    });
  }
  if (reason.length > REASON_MAX) {
    throw badRequest(`Keep the reason under ${REASON_MAX} characters.`, 'VOUCH_REASON_TOO_LONG');
  }

  const recent = db
    .prepare(
      `SELECT created_at FROM discord_vouches
        WHERE guild_id = ? AND voucher_discord_id = ? AND target_discord_id = ? AND type = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(input.guildId, input.voucherDiscordId, input.targetDiscordId, input.type) as
    | { created_at: string }
    | undefined;
  if (recent && Date.now() - new Date(recent.created_at).getTime() < VOUCH_COOLDOWN_MS) {
    throw conflict(
      `You already left a ${input.type === 'scam' ? 'scam ' : ''}vouch for this member in the last 24 hours.`,
      'VOUCH_COOLDOWN',
    );
  }

  const targetLink = getLinkForDiscord(db, input.targetDiscordId);
  const id = newId('vch');
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO discord_vouches
       (id, guild_id, voucher_discord_id, voucher_username, target_discord_id, target_username,
        target_user_id, type, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.guildId,
    input.voucherDiscordId,
    input.voucherUsername.slice(0, 100),
    input.targetDiscordId,
    input.targetUsername.slice(0, 100),
    targetLink?.user_id ?? null,
    input.type,
    reason,
    createdAt,
  );
  recordAudit(db, {
    actorId: user.id,
    action: input.type === 'scam' ? 'discord.vouch.scam' : 'discord.vouch.positive',
    targetType: 'discord_user',
    targetId: input.targetDiscordId,
    targetLabel: input.targetUsername,
    metadata: { reason, guildId: input.guildId },
  });
  recordDiscordActivity(db, {
    guildId: input.guildId,
    actorDiscordId: input.voucherDiscordId,
    actorUserId: user.id,
    action: input.type === 'scam' ? 'vouch.scam' : 'vouch.positive',
    summary: `@${input.voucherUsername} vouched ${input.type === 'scam' ? 'against' : 'for'} @${input.targetUsername}`,
    metadata: { vouchId: id, reason },
  });
  const row = db.prepare(`${VOUCH_SELECT} WHERE v.id = ?`).get(id) as VouchRow;
  const view = mapVouch(row);
  queueVouchPost(db, input.guildId, view);
  return view;
}

export function getVouchStats(
  db: DB,
  guildId: string,
  discordUserId: string,
  username?: string | null,
): DiscordVouchStats {
  const rows = db
    .prepare(`${VOUCH_SELECT} WHERE v.guild_id = ? AND v.target_discord_id = ? ORDER BY v.created_at DESC LIMIT 10`)
    .all(guildId, discordUserId) as VouchRow[];
  const counts = db
    .prepare(
      `SELECT type, COUNT(*) AS count FROM discord_vouches
        WHERE guild_id = ? AND target_discord_id = ? GROUP BY type`,
    )
    .all(guildId, discordUserId) as { type: 'positive' | 'scam'; count: number }[];
  const positive = counts.find((row) => row.type === 'positive')?.count ?? 0;
  const scam = counts.find((row) => row.type === 'scam')?.count ?? 0;
  const link = getLinkForDiscord(db, discordUserId);
  const linkedUsername = link
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(link.user_id) as
        | { username: string }
        | undefined)?.username ?? null
    : null;
  return {
    discordUserId,
    username:
      username ??
      (db
        .prepare(
          `SELECT target_username AS username FROM discord_vouches WHERE guild_id = ? AND target_discord_id = ?
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(guildId, discordUserId) as { username: string } | undefined)?.username ??
      null,
    websiteUsername: linkedUsername,
    positive,
    scam,
    reputation: scam > 0 ? 'negative' : positive > 0 ? 'positive' : 'neutral',
    recent: rows.map(mapVouch),
  };
}

export function listRecentVouches(db: DB, limit = 25): DiscordVouchView[] {
  const rows = db
    .prepare(`${VOUCH_SELECT} ORDER BY v.created_at DESC LIMIT ?`)
    .all(Math.min(100, Math.max(1, limit))) as VouchRow[];
  return rows.map(mapVouch);
}
