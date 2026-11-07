import type { DB } from '../../db/index.ts';
import type {
  DiscordAnnouncementView,
  DiscordGuildConfig,
  DiscordPanelView,
  GiveawayView,
  RewardCodeView,
} from '../../../shared/types.ts';
import { getGuildConfig, getPrimaryGuild, isDiscordSnowflake } from './core.ts';
import { completeOutbox, enqueueOutbox, type ClaimedOutboxEvent } from './outbox.ts';
import { markCashierTranscriptSent, markTicketTranscriptSent } from './support.ts';

/**
 * Website-originated events use the primary Discord guild. Bot-originated
 * events carry their own guild ID. The channel is resolved when the event is
 * written, so changing a channel later never rewrites historical publications.
 */
function primaryContext(db: DB): { guildId: string | null; config: DiscordGuildConfig | null } {
  const guild = getPrimaryGuild(db);
  if (!guild) return { guildId: null, config: null };
  return { guildId: guild.guild_id, config: getGuildConfig(db, guild.guild_id) };
}

function channelFor(
  db: DB,
  guildId: string | null,
  pick: (config: DiscordGuildConfig) => string | null,
): string | null {
  if (!guildId) return null;
  return pick(getGuildConfig(db, guildId));
}

export function giveawayPayload(
  db: DB,
  giveaway: GiveawayView,
  channelId: string | null,
  messageId: string | null = null,
): Record<string, unknown> {
  const link = db.prepare('SELECT discord_user_id FROM discord_links WHERE user_id = ?');
  const winnerLinks = giveaway.winners.map((winner) => {
    const row = link.get(winner.userId) as { discord_user_id: string } | undefined;
    return row?.discord_user_id ?? null;
  });
  const winnerDiscordIds = winnerLinks.filter((id): id is string => Boolean(id));
  return {
    channelId,
    discordMessageId: messageId,
    giveaway: {
      id: giveaway.id,
      reference: giveaway.reference,
      title: giveaway.title,
      description: giveaway.description,
      bannerUrl: giveaway.bannerUrl,
      prizeAmount: giveaway.prizeAmount,
      winnerCount: giveaway.winnerCount,
      participantCount: giveaway.participantCount,
      status: giveaway.status,
      startsAt: giveaway.startsAt,
      endsAt: giveaway.endsAt,
      secondsRemaining: giveaway.secondsRemaining,
      secondsUntilStart: giveaway.secondsUntilStart,
      sponsor: giveaway.sponsor,
      fundingKind: giveaway.fundingKind,
      winners: giveaway.winners.map((winner, index) => ({
        username: winner.username,
        payoutAmount: winner.payoutAmount,
        claimStatus: winner.claimStatus,
        discordId: winnerLinks[index] ?? null,
      })),
      winnerDiscordIds,
      drawCommitment: giveaway.drawCommitment,
      drawSeed: giveaway.drawSeed,
      drawAlgorithm: giveaway.drawAlgorithm,
    },
  };
}

export function queueGiveawayPost(
  db: DB,
  giveaway: GiveawayView,
  guildId?: string | null,
  channelId?: string | null,
): void {
  const primary = primaryContext(db);
  const guild = guildId ?? primary.guildId;
  const channel =
    channelId ??
    (guild ? channelFor(db, guild, (config) => config.channels.giveaways) : null);
  enqueueOutbox(db, {
    guildId: guild,
    eventType: 'giveaway_post',
    payload: giveawayPayload(db, giveaway, channel),
    dedupeKey: `giveaway-post:${giveaway.id}`,
  });
}

export function queueGiveawayResult(
  db: DB,
  giveaway: GiveawayView,
  guildId?: string | null,
  channelId?: string | null,
  messageId?: string | null,
): void {
  const primary = primaryContext(db);
  const guild = guildId ?? primary.guildId;
  const channel =
    channelId ??
    (guild ? channelFor(db, guild, (config) => config.channels.giveaways) : null);
  enqueueOutbox(db, {
    guildId: guild,
    eventType: 'giveaway_result',
    payload: giveawayPayload(db, giveaway, channel, messageId ?? null),
    dedupeKey: `giveaway-result:${giveaway.id}`,
  });
}

export function queueGiveawayReroll(
  db: DB,
  giveaway: GiveawayView,
  guildId?: string | null,
  channelId?: string | null,
  messageId?: string | null,
): void {
  const primary = primaryContext(db);
  const guild = guildId ?? primary.guildId;
  const channel =
    channelId ??
    (guild ? channelFor(db, guild, (config) => config.channels.giveaways) : null);
  // A reroll can happen more than once, so the timestamp is part of the key.
  enqueueOutbox(db, {
    guildId: guild,
    eventType: 'giveaway_reroll',
    payload: giveawayPayload(db, giveaway, channel, messageId ?? null),
    dedupeKey: `giveaway-reroll:${giveaway.id}:${giveaway.winners.map((winner) => winner.id).join(',')}`,
  });
}

export function queueGiveawayCancel(
  db: DB,
  giveaway: GiveawayView,
  guildId?: string | null,
  channelId?: string | null,
  messageId?: string | null,
): void {
  const primary = primaryContext(db);
  const guild = guildId ?? primary.guildId;
  const channel =
    channelId ??
    (guild ? channelFor(db, guild, (config) => config.channels.giveaways) : null);
  enqueueOutbox(db, {
    guildId: guild,
    eventType: 'giveaway_cancel',
    payload: {
      ...giveawayPayload(db, giveaway, channel, messageId ?? null),
      cancellationReason: giveaway.cancellationReason,
    },
    dedupeKey: `giveaway-cancel:${giveaway.id}`,
  });
}

export interface VouchEventPayload {
  vouch: {
    id: string;
    type: 'positive' | 'scam';
    voucherDiscordId: string;
    voucherUsername: string;
    targetDiscordId: string;
    targetUsername: string;
    targetWebsiteUsername: string | null;
    reason: string;
    createdAt: string;
  };
  channelId: string | null;
}

export function queueVouchPost(db: DB, guildId: string, vouch: VouchEventPayload['vouch']): void {
  const config = getGuildConfig(db, guildId);
  const channel = vouch.type === 'scam'
    ? (config.channels.scamVouches ?? config.channels.vouches)
    : config.channels.vouches;
  enqueueOutbox(db, {
    guildId,
    eventType: 'vouch_post',
    payload: { vouch, channelId: channel },
    dedupeKey: `vouch-post:${vouch.id}`,
  });
}

export function queueCodePost(
  db: DB,
  guildId: string,
  code: RewardCodeView,
  channelId?: string | null,
): void {
  const channel =
    channelId ?? channelFor(db, guildId, (config) => config.channels.codes);
  enqueueOutbox(db, {
    guildId,
    eventType: 'code_post',
    payload: { code, channelId: channel, mentionEveryone: true },
    dedupeKey: `code-post:${code.id}`,
  });
}

export function queueCodeDelete(db: DB, guildId: string, code: RewardCodeView): void {
  enqueueOutbox(db, {
    guildId,
    eventType: 'code_delete',
    payload: { code, channelId: channelFor(db, guildId, (config) => config.channels.codes) },
    dedupeKey: `code-delete:${code.id}`,
  });
}

export function queueAnnouncementPost(
  db: DB,
  guildId: string,
  announcement: DiscordAnnouncementView,
): void {
  const config = getGuildConfig(db, guildId);
  const channel =
    announcement.kind === 'news' ? config.channels.news : config.channels.changelog;
  enqueueOutbox(db, {
    guildId,
    eventType: 'announcement_post',
    payload: {
      announcement,
      channelId: announcement.channelId ?? channel,
      mentionEveryone: announcement.mentionEveryone,
    },
    dedupeKey: `announcement-post:${announcement.id}`,
  });
}

export function queueAnnouncementEdit(
  db: DB,
  guildId: string,
  announcement: DiscordAnnouncementView,
): void {
  const config = getGuildConfig(db, guildId);
  const channel =
    announcement.kind === 'news' ? config.channels.news : config.channels.changelog;
  enqueueOutbox(db, {
    guildId,
    eventType: 'announcement_edit',
    payload: {
      announcement,
      channelId: announcement.channelId ?? channel,
      mentionEveryone: announcement.mentionEveryone,
    },
    dedupeKey: `announcement-edit:${announcement.id}:${announcement.updatedAt}`,
  });
}

export function queueAnnouncementDelete(
  db: DB,
  guildId: string,
  announcement: DiscordAnnouncementView,
): void {
  enqueueOutbox(db, {
    guildId,
    eventType: 'announcement_delete',
    payload: {
      announcementId: announcement.id,
      channelId: announcement.channelId,
      messageId: announcement.messageId,
    },
    dedupeKey: `announcement-delete:${announcement.id}`,
  });
}

export function queuePanelPost(db: DB, guildId: string, panel: DiscordPanelView): void {
  enqueueOutbox(db, {
    guildId,
    eventType: 'panel_post',
    payload: {
      panel,
      channelId: panel.channelId,
      mentionEveryone: panel.mentionEveryone,
    },
    dedupeKey: `panel-post:${panel.id}:${panel.updatedAt}`,
  });
}

export function queuePanelEdit(db: DB, guildId: string, panel: DiscordPanelView): void {
  enqueueOutbox(db, {
    guildId,
    eventType: 'panel_edit',
    payload: {
      panel,
      channelId: panel.channelId,
      mentionEveryone: panel.mentionEveryone,
    },
    dedupeKey: `panel-edit:${panel.id}:${panel.updatedAt}`,
  });
}

export function queuePanelDelete(db: DB, guildId: string, panel: DiscordPanelView): void {
  enqueueOutbox(db, {
    guildId,
    eventType: 'panel_delete',
    payload: {
      panelId: panel.id,
      channelId: panel.channelId,
      messageId: panel.messageId,
    },
    // A panel can be moved (delete old message, post a new one) and later
    // deleted for real, so the delete key includes the revision it targets.
    dedupeKey: `panel-delete:${panel.id}:${panel.updatedAt}`,
  });
}

/**
 * Attaches the Discord message ID returned by the bot. This runs after the
 * bot acknowledges the event, so a crash between posting and acknowledgement
 * reuses the same outbox row on retry and the bot can search by reference.
 */
export function attachOutboxMessage(db: DB, event: ClaimedOutboxEvent, messageId: string | null): void {
  if (messageId && !/^\d{15,22}$/.test(messageId)) messageId = null;
  switch (event.eventType) {
    case 'giveaway_post': {
      const giveaway = event.payload.giveaway as { id?: string } | undefined;
      const channelId = event.payload.channelId;
      if (giveaway?.id && isDiscordSnowflake(event.guildId)) {
        db.prepare(
          `UPDATE giveaways SET discord_message_id = ?, discord_channel_id = ?, discord_guild_id = ?
            WHERE id = ?`,
        ).run(messageId, typeof channelId === 'string' ? channelId : null, event.guildId, giveaway.id);
      }
      break;
    }
    case 'code_post': {
      const code = event.payload.code as { id?: string } | undefined;
      if (code?.id) {
        db.prepare('UPDATE reward_codes SET announcement_message_id = ? WHERE id = ?').run(messageId, code.id);
      }
      break;
    }
    case 'vouch_post': {
      const vouch = event.payload.vouch as { id?: string } | undefined;
      if (vouch?.id) {
        db.prepare('UPDATE discord_vouches SET message_id = ? WHERE id = ?').run(messageId, vouch.id);
      }
      break;
    }
    case 'code_delete': {
      // The bot deletes the announcement it previously sent; nothing to attach.
      break;
    }
    case 'announcement_post':
    case 'announcement_edit': {
      const announcement = event.payload.announcement as { id?: string } | undefined;
      const channelId = event.payload.channelId;
      if (announcement?.id) {
        db.prepare(
          `UPDATE discord_announcements
              SET message_id = COALESCE(?, message_id), channel_id = COALESCE(?, channel_id)
            WHERE id = ?`,
        ).run(messageId, typeof channelId === 'string' ? channelId : null, announcement.id);
      }
      break;
    }
    case 'announcement_delete': {
      const id = event.payload.announcementId;
      if (typeof id === 'string') {
        db.prepare("UPDATE discord_announcements SET message_id = NULL, status = 'deleted' WHERE id = ?").run(id);
      }
      break;
    }
    case 'panel_post':
    case 'panel_edit': {
      const panel = event.payload.panel as { id?: string } | undefined;
      const channelId = event.payload.channelId;
      if (panel?.id) {
        db.prepare(
          `UPDATE discord_panels
              SET message_id = COALESCE(?, message_id), channel_id = COALESCE(?, channel_id)
            WHERE id = ?`,
        ).run(messageId, typeof channelId === 'string' ? channelId : null, panel.id);
      }
      break;
    }
    case 'panel_delete': {
      const id = event.payload.panelId;
      // A move queues a delete for the old message while the panel itself stays
      // published, so only a genuinely deleted panel is touched here.
      if (typeof id === 'string') {
        db.prepare("UPDATE discord_panels SET message_id = NULL WHERE id = ? AND status = 'deleted'").run(id);
      }
      break;
    }
    case 'ticket_transcript': {
      const id = event.payload.transcriptId;
      if (typeof id === 'string') markTicketTranscriptSent(db, id, messageId);
      break;
    }
    case 'cashier_transcript': {
      const id = event.payload.transcriptId;
      if (typeof id === 'string') markCashierTranscriptSent(db, id, messageId);
      break;
    }
    case 'ticket_notification':
    case 'cashier_notification': {
      // Fire-and-forget log messages; there is no website record to attach.
      break;
    }
    default:
      break;
  }
  completeOutbox(db, event.id, messageId);
}
