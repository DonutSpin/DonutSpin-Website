import type { DB } from '../../db/index.ts';
import type { GiveawayView, SessionUser } from '../../../shared/types.ts';
import {
  GIVEAWAY_MAX_DURATION_SECONDS,
  GIVEAWAY_MAX_AMOUNT,
  GIVEAWAY_MAX_WINNERS,
  GIVEAWAY_MIN_AMOUNT,
  GIVEAWAY_MIN_DURATION_SECONDS,
  GIVEAWAY_MIN_WINNERS,
} from '../../../shared/types.ts';
import { badRequest, forbidden } from '../core.ts';
import { can } from '../permissions.ts';
import {
  cancelGiveaway,
  createGiveaway,
  endGiveawayEarly,
  joinGiveaway,
  listGiveawaySyncItems,
  rerollGiveaway,
} from '../giveaways.ts';
import type { DiscordMemberContext } from './core.ts';
import { getGuildConfig, recordDiscordActivity } from './core.ts';
import { queueGiveawayPost } from './events.ts';

export interface DiscordCreateGiveawayInput {
  title: string;
  description: string;
  prizeAmount: number;
  winnerCount: number;
  durationSeconds: number;
  bannerUrl?: string | null;
}

/** Creating from Discord uses the same escrow, seed commitment and validation. */
export function createDiscordGiveaway(
  db: DB,
  context: DiscordMemberContext,
  input: DiscordCreateGiveawayInput,
): GiveawayView {
  const config = getGuildConfig(db, context.config.guildId);
  const channelId = config.channels.giveaways;
  if (!channelId) {
    throw badRequest(
      'Set a giveaway channel in /setup before creating giveaways from Discord.',
      'DISCORD_CHANNEL_NOT_CONFIGURED',
    );
  }
  const duration = Math.trunc(input.durationSeconds);
  if (
    !Number.isInteger(duration) ||
    duration < GIVEAWAY_MIN_DURATION_SECONDS ||
    duration > GIVEAWAY_MAX_DURATION_SECONDS
  ) {
    throw badRequest('Choose a duration between 5 minutes and 30 days.', 'INVALID_GIVEAWAY_DURATION');
  }
  if (
    !Number.isInteger(input.prizeAmount) ||
    input.prizeAmount < GIVEAWAY_MIN_AMOUNT ||
    input.prizeAmount > GIVEAWAY_MAX_AMOUNT
  ) {
    throw badRequest('Choose a valid prize amount.', 'INVALID_GIVEAWAY_AMOUNT');
  }
  if (
    !Number.isInteger(input.winnerCount) ||
    input.winnerCount < GIVEAWAY_MIN_WINNERS ||
    input.winnerCount > GIVEAWAY_MAX_WINNERS
  ) {
    throw badRequest('Choose a valid winner count.', 'INVALID_WINNER_COUNT');
  }
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + duration * 1000).toISOString();
  const giveaway = createGiveaway(
    db,
    context.user,
    {
      title: input.title,
      description: input.description,
      prizeAmount: input.prizeAmount,
      winnerCount: input.winnerCount,
      startsAt,
      endsAt,
      bannerUrl: input.bannerUrl ?? null,
    },
    { guildId: context.config.guildId, channelId },
  );
  recordDiscordActivity(db, {
    guildId: context.config.guildId,
    actorDiscordId: context.link.discord_user_id,
    actorUserId: context.user.id,
    action: 'giveaway.created',
    summary: `${context.user.username} created giveaway ${giveaway.reference} for ${giveaway.prizeAmount} money`,
    metadata: { giveawayId: giveaway.id, durationSeconds: duration },
  });
  // `createGiveaway` already queued the post using this guild and channel; the
  // duplicate is ignored by the dedupe key and makes this function safe if the
  // underlying service changes.
  queueGiveawayPost(db, giveaway, context.config.guildId, channelId);
  return giveaway;
}

export function joinDiscordGiveaway(db: DB, user: SessionUser, giveawayId: string): GiveawayView {
  if (!can(user.role, 'giveaways.join')) {
    throw forbidden('Your account cannot join giveaways.', 'GIVEAWAY_JOIN_DENIED');
  }
  const giveaway = joinGiveaway(db, user, giveawayId);
  recordDiscordActivity(db, {
    actorDiscordId: undefined,
    actorUserId: user.id,
    action: 'giveaway.joined',
    summary: `${user.username} joined giveaway ${giveaway.reference}`,
    metadata: { giveawayId },
  });
  return giveaway;
}

export function endDiscordGiveaway(db: DB, context: DiscordMemberContext, giveawayId: string): GiveawayView {
  const giveaway = endGiveawayEarly(db, context.user, giveawayId);
  recordDiscordActivity(db, {
    guildId: context.config.guildId,
    actorDiscordId: context.link.discord_user_id,
    actorUserId: context.user.id,
    action: 'giveaway.ended',
    summary: `${context.user.username} ended giveaway ${giveaway.reference} early`,
    metadata: { giveawayId },
  });
  return giveaway;
}

export function rerollDiscordGiveaway(
  db: DB,
  context: DiscordMemberContext,
  giveawayId: string,
): GiveawayView {
  const giveaway = rerollGiveaway(db, context.user, giveawayId);
  recordDiscordActivity(db, {
    guildId: context.config.guildId,
    actorDiscordId: context.link.discord_user_id,
    actorUserId: context.user.id,
    action: 'giveaway.rerolled',
    summary: `${context.user.username} rerolled giveaway ${giveaway.reference}`,
    metadata: { giveawayId },
  });
  return giveaway;
}

export function cancelDiscordGiveaway(
  db: DB,
  context: DiscordMemberContext,
  giveawayId: string,
  reason: string,
): GiveawayView {
  const giveaway = cancelGiveaway(db, context.user, giveawayId, reason.trim());
  recordDiscordActivity(db, {
    guildId: context.config.guildId,
    actorDiscordId: context.link.discord_user_id,
    actorUserId: context.user.id,
    action: 'giveaway.cancelled',
    summary: `${context.user.username} cancelled giveaway ${giveaway.reference}`,
    metadata: { giveawayId, reason },
  });
  return giveaway;
}

export function listDiscordGiveaways(db: DB): ReturnType<typeof listGiveawaySyncItems> {
  return listGiveawaySyncItems(db, 50);
}
