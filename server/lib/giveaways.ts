import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { compactAmount } from '../../shared/amount.ts';
import {
  GIVEAWAY_MAX_AMOUNT,
  GIVEAWAY_MAX_DURATION_SECONDS,
  GIVEAWAY_MAX_WINNERS,
  GIVEAWAY_MIN_AMOUNT,
  GIVEAWAY_MIN_DURATION_SECONDS,
  GIVEAWAY_MIN_SCHEDULE_LEAD_SECONDS,
  GIVEAWAY_MIN_WINNERS,
  type GiveawayClaimStatus,
  type GiveawayClaimTicketResponse,
  type GiveawayClaimView,
  type GiveawayFeaturedResponse,
  type GiveawayFundingKind,
  type GiveawayLimits,
  type GiveawayManageResponse,
  type GiveawayOverviewResponse,
  type GiveawayParticipantView,
  type GiveawaySponsorshipView,
  type GiveawayStatus,
  type GiveawayView,
  type GiveawayWinnerView,
  type DiscordGiveawaySyncItem,
  type SessionUser,
} from '../../shared/types.ts';
import { badRequest, conflict, forbidden, inTransaction, newId, nowIso, notFound } from './core.ts';
import { can } from './permissions.ts';
import { recordAudit } from './audit.ts';
import { applyLedger, balanceOf } from './wallet.ts';
import { notify } from './notifications.ts';
import { enqueueEmail } from './email.ts';
import { addTicketEvent, addTicketMessage, generateTicketReference, touchTicket } from './tickets.ts';
import {
  queueGiveawayCancel,
  queueGiveawayPost,
  queueGiveawayReroll,
  queueGiveawayResult,
} from './discord/events.ts';
import { getGuildConfig, getPrimaryGuild } from './discord/core.ts';

const DRAW_ALGORITHM = 'HMAC-SHA-256 Fisher–Yates (commit–reveal)';
const PARTICIPANT_PREVIEW = 12;
const WINNER_LIMIT = 100;

export const GIVEAWAY_LIMITS: GiveawayLimits = {
  minAmount: GIVEAWAY_MIN_AMOUNT,
  maxAmount: GIVEAWAY_MAX_AMOUNT,
  minWinners: GIVEAWAY_MIN_WINNERS,
  maxWinners: GIVEAWAY_MAX_WINNERS,
  minDurationSeconds: GIVEAWAY_MIN_DURATION_SECONDS,
  maxDurationSeconds: GIVEAWAY_MAX_DURATION_SECONDS,
  minScheduleLeadSeconds: GIVEAWAY_MIN_SCHEDULE_LEAD_SECONDS,
};

interface GiveawayRow {
  id: string;
  reference: string;
  title: string;
  description: string;
  prize_amount: number;
  winner_count: number;
  status: GiveawayStatus;
  starts_at: string;
  ends_at: string;
  created_by: string | null;
  funded_by_user_id: string;
  sponsor_user_id: string | null;
  funding_kind: GiveawayFundingKind;
  sponsorship_id: string | null;
  escrow_ledger_id: string | null;
  refund_ledger_id: string | null;
  draw_commitment: string;
  draw_seed: string;
  drawn_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  banner_url: string | null;
  discord_message_id: string | null;
  discord_channel_id: string | null;
  discord_guild_id: string | null;
}

interface WinnerRow {
  id: string;
  giveaway_id: string;
  user_id: string;
  username_snapshot: string;
  position: number;
  payout_amount: number;
  claim_status: GiveawayClaimStatus;
  claim_ticket_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  payout_ledger_id: string | null;
  selected_at: string;
  username?: string;
  ticket_reference?: string | null;
}

interface SponsorshipRow {
  id: string;
  ticket_id: string;
  sponsor_user_id: string;
  prize_amount: number;
  winner_count: number;
  duration_seconds: number;
  title: string | null;
  description: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'published' | 'cancelled';
  reviewer_id: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  escrow_ledger_id: string | null;
  giveaway_id: string | null;
  created_at: string;
  ticket_reference?: string;
  sponsor_name?: string;
  reviewer_name?: string | null;
  giveaway_reference?: string | null;
}

interface ClaimQueryRow extends WinnerRow {
  giveaway_reference: string;
  giveaway_title: string;
  ticket_reference: string | null;
}

function usernameOf(db: DB, id: string | null | undefined): string {
  if (!id) return 'Deleted user';
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined;
  return row?.username ?? 'Deleted user';
}

export function generateGiveawayReference(db: DB): string {
  const year = new Date().getUTCFullYear();
  const name = `giveaway_${year}`;
  const row = db
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(name) as { value: number };
  return `GV-${year}-${String(row.value).padStart(6, '0')}`;
}

function getGiveawayRow(db: DB, id: string): GiveawayRow | undefined {
  return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as GiveawayRow | undefined;
}

function getGiveawayByReferenceRow(db: DB, reference: string): GiveawayRow | undefined {
  return db.prepare('SELECT * FROM giveaways WHERE reference = ?').get(reference) as GiveawayRow | undefined;
}

function getSponsorshipRow(db: DB, id: string): SponsorshipRow | undefined {
  return db.prepare('SELECT * FROM giveaway_sponsorships WHERE id = ?').get(id) as SponsorshipRow | undefined;
}

function participantCount(db: DB, giveawayId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM giveaway_entries WHERE giveaway_id = ?').get(giveawayId) as {
      count: number;
    }
  ).count;
}

function participantRows(db: DB, giveawayId: string): GiveawayParticipantView[] {
  const rows = db
    .prepare(
      `SELECT e.user_id, u.username, e.joined_at
         FROM giveaway_entries e JOIN users u ON u.id = e.user_id
        WHERE e.giveaway_id = ?
        ORDER BY e.joined_at ASC, e.user_id ASC
        LIMIT ?`,
    )
    .all(giveawayId, PARTICIPANT_PREVIEW) as { user_id: string; username: string; joined_at: string }[];
  return rows.map((row) => ({ userId: row.user_id, username: row.username, joinedAt: row.joined_at }));
}

function getWinnerRows(db: DB, giveawayId: string): WinnerRow[] {
  return db
    .prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY position ASC LIMIT ?')
    .all(giveawayId, WINNER_LIMIT) as WinnerRow[];
}

export function mapGiveaway(db: DB, row: GiveawayRow, viewerId: string | null, now = Date.now()): GiveawayView {
  const endsAt = new Date(row.ends_at).getTime();
  const startsAt = new Date(row.starts_at).getTime();
  const winners = getWinnerRows(db, row.id).map<GiveawayWinnerView>((winner) => ({
    id: winner.id,
    userId: winner.user_id,
    username: winner.username_snapshot,
    position: winner.position,
    payoutAmount: winner.payout_amount,
    claimStatus: winner.claim_status,
    claimTicketId: winner.claim_ticket_id,
    selectedAt: winner.selected_at,
    approvedAt: winner.approved_at,
  }));
  const joined = viewerId
    ? Boolean(
        db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').get(row.id, viewerId),
      )
    : false;
  const yourWin = viewerId ? (winners.find((winner) => winner.userId === viewerId) ?? null) : null;

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    status: row.status,
    fundingKind: row.funding_kind,
    creator: row.created_by ? { id: row.created_by, username: usernameOf(db, row.created_by) } : null,
    sponsor: row.sponsor_user_id ? { id: row.sponsor_user_id, username: usernameOf(db, row.sponsor_user_id) } : null,
    prizeAmount: row.prize_amount,
    winnerCount: row.winner_count,
    participantCount: participantCount(db, row.id),
    joined,
    isCreator: viewerId !== null && row.created_by === viewerId,
    isFunder: viewerId !== null && row.funded_by_user_id === viewerId,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    secondsRemaining: row.status === 'active' ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0,
    secondsUntilStart: row.status === 'scheduled' ? Math.max(0, Math.ceil((startsAt - now) / 1000)) : 0,
    participants: participantRows(db, row.id),
    winners,
    drawCommitment: row.draw_commitment,
    drawSeed: row.status === 'completed' ? row.draw_seed : null,
    drawAlgorithm: DRAW_ALGORITHM,
    yourWin,
    bannerUrl: row.banner_url,
  };
}

function mapClaimRow(row: ClaimQueryRow): GiveawayClaimView {
  return {
    id: row.id,
    giveawayId: row.giveaway_id,
    giveawayReference: row.giveaway_reference,
    giveawayTitle: row.giveaway_title,
    userId: row.user_id,
    username: row.username_snapshot,
    payoutAmount: row.payout_amount,
    claimStatus: row.claim_status,
    ticketReference: row.ticket_reference ?? null,
    ticketId: row.claim_ticket_id,
    selectedAt: row.selected_at,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
  };
}

const CLAIM_SELECT = `
  SELECT w.*, g.reference AS giveaway_reference, g.title AS giveaway_title, t.reference AS ticket_reference
    FROM giveaway_winners w
    JOIN giveaways g ON g.id = w.giveaway_id
    LEFT JOIN tickets t ON t.id = w.claim_ticket_id
`;

export function listClaimsForUser(db: DB, userId: string): GiveawayClaimView[] {
  const rows = db
    .prepare(`${CLAIM_SELECT} WHERE w.user_id = ? ORDER BY w.selected_at DESC LIMIT 25`)
    .all(userId) as ClaimQueryRow[];
  return rows.map(mapClaimRow);
}

export function listClaims(db: DB, limit = 100): GiveawayClaimView[] {
  const rows = db
    .prepare(`${CLAIM_SELECT} ORDER BY w.selected_at DESC LIMIT ?`)
    .all(limit) as ClaimQueryRow[];
  return rows.map(mapClaimRow);
}

function mapSponsorship(db: DB, row: SponsorshipRow): GiveawaySponsorshipView {
  const ticket = db.prepare('SELECT reference FROM tickets WHERE id = ?').get(row.ticket_id) as
    | { reference: string }
    | undefined;
  const giveaway = row.giveaway_id
    ? (db.prepare('SELECT reference FROM giveaways WHERE id = ?').get(row.giveaway_id) as
        | { reference: string }
        | undefined)
    : undefined;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    ticketReference: row.ticket_reference ?? ticket?.reference ?? '—',
    sponsor: { id: row.sponsor_user_id, username: row.sponsor_name ?? usernameOf(db, row.sponsor_user_id) },
    prizeAmount: row.prize_amount,
    winnerCount: row.winner_count,
    durationSeconds: row.duration_seconds,
    title: row.title,
    description: row.description,
    status: row.status,
    reviewer: row.reviewer_id
      ? { id: row.reviewer_id, username: row.reviewer_name ?? usernameOf(db, row.reviewer_id) }
      : null,
    reviewReason: row.review_reason,
    reviewedAt: row.reviewed_at,
    giveawayId: row.giveaway_id,
    giveawayReference: row.giveaway_reference ?? giveaway?.reference ?? null,
    createdAt: row.created_at,
  };
}

export function listSponsorships(db: DB, limit = 100): GiveawaySponsorshipView[] {
  const rows = db
    .prepare(
      `SELECT s.*, t.reference AS ticket_reference, sp.username AS sponsor_name, rv.username AS reviewer_name,
              g.reference AS giveaway_reference
         FROM giveaway_sponsorships s
         JOIN tickets t ON t.id = s.ticket_id
         JOIN users sp ON sp.id = s.sponsor_user_id
         LEFT JOIN users rv ON rv.id = s.reviewer_id
         LEFT JOIN giveaways g ON g.id = s.giveaway_id
        ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(limit) as SponsorshipRow[];
  return rows.map((row) => mapSponsorship(db, row));
}

function listAllRows(db: DB): GiveawayRow[] {
  return db.prepare('SELECT * FROM giveaways ORDER BY created_at DESC LIMIT 250').all() as GiveawayRow[];
}

export function giveawayLimits(): GiveawayLimits {
  return GIVEAWAY_LIMITS;
}

/* ------------------------------- settlement ------------------------------ */

function drawOrder(seed: string, giveawayId: string, userIds: string[], count: number): string[] {
  const pool = [...userIds];
  let counter = 0;
  const nextBelow = (bound: number): number => {
    const limit = Math.floor(0x1_0000_0000 / bound) * bound;
    for (;;) {
      const digest = createHmac('sha256', seed).update(`${giveawayId}:${counter}`).digest();
      counter += 1;
      const value = digest.readUInt32BE(0);
      if (value < limit) return value % bound;
    }
  };
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = nextBelow(index + 1);
    const current = pool[index]!;
    pool[index] = pool[swap]!;
    pool[swap] = current;
  }
  return pool.slice(0, count);
}

function notifyStaff(
  db: DB,
  input: { title: string; body: string; link: string; actorId: string | null; excludeUserId?: string },
): void {
  const staff = db.prepare("SELECT id FROM users WHERE role <> 'user' AND status = 'active'").all() as { id: string }[];
  for (const member of staff) {
    if (member.id === input.excludeUserId) continue;
    notify(db, {
      userId: member.id,
      type: 'giveaway',
      title: input.title,
      body: input.body,
      link: input.link,
      actorId: input.actorId,
    });
  }
}

function refundPool(db: DB, row: GiveawayRow, reason: string, actorId: string | null): void {
  if (!row.escrow_ledger_id) return;
  applyLedger(db, {
    userId: row.funded_by_user_id,
    amount: row.prize_amount,
    type: 'credit_request',
    actorId,
    reason,
    refType: 'giveaway',
    refId: row.id,
    idempotencyKey: `giveaway-refund:${row.id}`,
    metadata: { kind: 'giveaway_refund', giveawayId: row.id },
  });
}

/**
 * Draws and completes one giveaway. Must run inside a write transaction.
 * The conditional status update, the unique `(giveaway_id, user_id)` constraint
 * and the ledger idempotency keys make a repeated draw or payout impossible.
 */
function settleGiveawayRow(db: DB, row: GiveawayRow, now: number): GiveawayRow {
  const fresh = getGiveawayRow(db, row.id);
  if (!fresh || !['scheduled', 'active'].includes(fresh.status)) return fresh ?? row;
  const endsAt = new Date(fresh.ends_at).getTime();
  if (endsAt > now) return fresh;

  const settledAt = nowIso();
  const entries = db
    .prepare(
      `SELECT e.user_id, u.username
         FROM giveaway_entries e
         JOIN users u ON u.id = e.user_id
         JOIN wallets w ON w.user_id = e.user_id
        WHERE e.giveaway_id = ?
        ORDER BY e.joined_at ASC, e.user_id ASC`,
    )
    .all(fresh.id) as { user_id: string; username: string }[];

  const drawn = drawOrder(
    fresh.draw_seed,
    fresh.id,
    entries.map((entry) => entry.user_id),
    Math.min(fresh.winner_count, entries.length),
  );
  const byId = new Map(entries.map((entry) => [entry.user_id, entry]));
  const choiceCount = drawn.length;
  const base = choiceCount > 0 ? Math.floor(fresh.prize_amount / choiceCount) : 0;
  const remainder = choiceCount > 0 ? fresh.prize_amount - base * choiceCount : 0;

  const update = db
    .prepare(
      `UPDATE giveaways
          SET status = 'completed', drawn_at = ?, completed_at = ?
        WHERE id = ? AND status IN ('scheduled','active') AND ends_at <= ?`,
    )
    .run(settledAt, settledAt, fresh.id, settledAt);
  if (update.changes !== 1) {
    throw conflict('This giveaway was already settled.', 'GIVEAWAY_ALREADY_SETTLED');
  }

  if (choiceCount === 0) {
    refundPool(db, fresh, `Giveaway refund — no eligible entries in ${fresh.reference}`, null);
    db.prepare('UPDATE giveaways SET refund_ledger_id = ? WHERE id = ?').run(
      (db.prepare('SELECT id FROM ledger WHERE idempotency_key = ?').get(`giveaway-refund:${fresh.id}`) as
        | { id: string }
        | undefined)?.id ?? null,
      fresh.id,
    );
    recordAudit(db, {
      action: 'giveaway.settle',
      targetType: 'giveaway',
      targetId: fresh.id,
      targetLabel: fresh.reference,
      metadata: { prizeAmount: fresh.prize_amount, winners: 0, refunded: true },
    });
    const refunded = getGiveawayRow(db, fresh.id) ?? fresh;
    queueGiveawayResult(
      db,
      mapGiveaway(db, refunded, null),
      refunded.discord_guild_id,
      refunded.discord_channel_id,
      refunded.discord_message_id,
    );
    return refunded;
  }

  drawn.forEach((userId, index) => {
    const entry = byId.get(userId);
    if (!entry) return;
    const payout = base + (index < remainder ? 1 : 0);
    const winnerId = newId('gvw');
    db.prepare(
      `INSERT INTO giveaway_winners
         (id, giveaway_id, user_id, username_snapshot, position, payout_amount, claim_status, selected_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unclaimed', ?)`,
    ).run(winnerId, fresh.id, userId, entry.username, index + 1, payout, settledAt);

    notify(db, {
      userId,
      type: 'giveaway',
      title: `You won ${compactAmount(payout)} money`,
      body: `You won "${fresh.title}". Open a Giveaway Claim ticket to receive your prize.`,
      link: `/giveaways?claim=${encodeURIComponent(fresh.id)}`,
    });
    enqueueEmail(db, {
      userId,
      recipient: (
        db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
      )?.email ?? '',
      template: 'giveaway-winner',
      payload: {
        username: entry.username,
        title: fresh.title,
        reference: fresh.reference,
        prizeAmount: fresh.prize_amount,
        payoutAmount: payout,
        winners: choiceCount,
        claimUrl: `/giveaways?claim=${encodeURIComponent(fresh.id)}`,
        giveawayUrl: '/giveaways',
      },
      dedupeKey: `giveaway-winner:${fresh.id}:${userId}`,
    });
  });

  recordAudit(db, {
    action: 'giveaway.settle',
    targetType: 'giveaway',
    targetId: fresh.id,
    targetLabel: fresh.reference,
    metadata: {
      prizeAmount: fresh.prize_amount,
      winners: choiceCount,
      drawCommitment: fresh.draw_commitment,
      algorithm: DRAW_ALGORITHM,
    },
  });

  const settled = getGiveawayRow(db, fresh.id) ?? fresh;
  queueGiveawayResult(
    db,
    mapGiveaway(db, settled, null),
    settled.discord_guild_id,
    settled.discord_channel_id,
    settled.discord_message_id,
  );
  return settled;
}

function settleDueInside(db: DB, now: number): void {
  const rows = db
    .prepare(
      `SELECT * FROM giveaways
        WHERE (status = 'scheduled' AND starts_at <= ?)
           OR (status IN ('scheduled','active') AND ends_at <= ?)`,
    )
    .all(new Date(now).toISOString(), new Date(now).toISOString()) as GiveawayRow[];
  for (const row of rows) {
    if (new Date(row.ends_at).getTime() <= now) {
      settleGiveawayRow(db, row, now);
      continue;
    }
    const activated = db
      .prepare("UPDATE giveaways SET status = 'active' WHERE id = ? AND status = 'scheduled'")
      .run(row.id);
    if (activated.changes === 1 && row.funding_kind === 'sponsor' && row.sponsor_user_id) {
      notify(db, {
        userId: row.sponsor_user_id,
        type: 'giveaway',
        title: `Your giveaway is live: ${compactAmount(row.prize_amount)} money`,
        body: `“${row.title}” (${row.reference}) is now open for entries.`,
        link: '/giveaways',
      });
      enqueueEmail(db, {
        userId: row.sponsor_user_id,
        recipient: (
          db.prepare('SELECT email FROM users WHERE id = ?').get(row.sponsor_user_id) as
            | { email: string }
            | undefined
        )?.email ?? '',
        template: 'giveaway-sponsor',
        payload: {
          username: usernameOf(db, row.sponsor_user_id),
          title: row.title,
          reference: row.reference,
          prizeAmount: row.prize_amount,
          winners: row.winner_count,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          giveawayUrl: '/giveaways',
        },
        dedupeKey: `giveaway-sponsor-live:${row.id}`,
      });
    }
  }
}

/**
 * Lazy settlement used by every read and mutation and by the background tick.
 * It activates scheduled giveaways and draws every expired one, so correctness
 * never depends on a browser staying open.
 */
export function settleDueGiveaways(db: DB, now = Date.now()): void {
  const nowIsoValue = new Date(now).toISOString();
  const due = db
    .prepare(
      `SELECT 1 FROM giveaways
        WHERE (status = 'scheduled' AND starts_at <= ?)
           OR (status IN ('scheduled','active') AND ends_at <= ?)
        LIMIT 1`,
    )
    .get(nowIsoValue, nowIsoValue);
  if (!due) return;
  inTransaction(db, () => settleDueInside(db, now));
}

/* -------------------------------- overview -------------------------------- */

export function giveawayOverview(db: DB, viewer: SessionUser): GiveawayOverviewResponse {
  settleDueGiveaways(db);
  const now = Date.now();
  const rows = listAllRows(db);
  const view = (row: GiveawayRow) => mapGiveaway(db, row, viewer.id, now);
  return {
    serverTime: new Date(now).toISOString(),
    active: rows.filter((row) => row.status === 'active').map(view),
    upcoming: rows.filter((row) => row.status === 'scheduled').map(view),
    completed: rows.filter((row) => row.status === 'completed').map(view),
    myClaims: listClaimsForUser(db, viewer.id),
    canManage: can(viewer.role, 'giveaways.manage'),
    limits: giveawayLimits(),
  };
}

export function featuredGiveaways(db: DB, viewerId: string | null): GiveawayFeaturedResponse {
  settleDueGiveaways(db);
  const now = Date.now();
  const active = db
    .prepare("SELECT * FROM giveaways WHERE status = 'active' ORDER BY ends_at ASC LIMIT 5")
    .all() as GiveawayRow[];
  const upcoming = db
    .prepare("SELECT * FROM giveaways WHERE status = 'scheduled' ORDER BY starts_at ASC LIMIT 1")
    .get() as GiveawayRow | undefined;
  const latest = db
    .prepare("SELECT * FROM giveaways WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1")
    .get() as GiveawayRow | undefined;
  return {
    serverTime: new Date(now).toISOString(),
    active: active.map((row) => mapGiveaway(db, row, viewerId, now)),
    upcoming: upcoming ? mapGiveaway(db, upcoming, viewerId, now) : null,
    latest: latest ? mapGiveaway(db, latest, viewerId, now) : null,
  };
}

/**
 * Active and upcoming giveaways for the bot's message synchroniser. It returns
 * the exact participant count and winner snapshots from the shared database so
 * the Discord message and website can never disagree.
 */
export function listGiveawaySyncItems(db: DB, limit = 50): DiscordGiveawaySyncItem[] {
  settleDueGiveaways(db);
  const now = Date.now();
  const rows = db
    .prepare(
      `SELECT * FROM giveaways
        WHERE status IN ('scheduled','active')
           OR (status IN ('completed','cancelled') AND completed_at IS NOT NULL AND completed_at >= ?)
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(new Date(now - 24 * 60 * 60 * 1000).toISOString(), Math.min(100, Math.max(1, limit))) as GiveawayRow[];
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    title: row.title,
    description: row.description,
    bannerUrl: row.banner_url,
    status: row.status,
    prizeAmount: row.prize_amount,
    winnerCount: row.winner_count,
    participantCount: participantCount(db, row.id),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    secondsRemaining: Math.max(0, Math.ceil((new Date(row.ends_at).getTime() - now) / 1000)),
    winners: getWinnerRows(db, row.id).map((winner) => ({
      username: winner.username_snapshot,
      payoutAmount: winner.payout_amount,
      claimStatus: winner.claim_status,
    })),
    discordMessageId: row.discord_message_id,
    discordChannelId: row.discord_channel_id,
  }));
}

export function manageGiveaways(db: DB, viewer: SessionUser): GiveawayManageResponse {
  settleDueGiveaways(db);
  const now = Date.now();
  return {
    serverTime: new Date(now).toISOString(),
    giveaways: listAllRows(db).map((row) => mapGiveaway(db, row, viewer.id, now)),
    claims: listClaims(db),
    sponsorships: listSponsorships(db),
    limits: giveawayLimits(),
  };
}

/* -------------------------------- creation -------------------------------- */

export interface CreateGiveawayInput {
  title: string;
  description: string;
  prizeAmount: number;
  winnerCount: number;
  startsAt: string;
  endsAt: string;
  bannerUrl?: string | null;
}

/** Banners are optional public HTTPS images; reject anything else. */
function normalizeBannerUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length > 500) throw badRequest('Keep the banner URL under 500 characters.', 'INVALID_BANNER', {
    fields: { bannerUrl: 'Use a shorter URL.' },
  });
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') throw new Error('not https');
  } catch {
    throw badRequest('Banner links must be public HTTPS images.', 'INVALID_BANNER', {
      fields: { bannerUrl: 'Use an https:// image URL.' },
    });
  }
  return trimmed;
}

function validateWindow(input: { startsAt: string; endsAt: string }): { startsMs: number; endsMs: number } {
  const startsMs = new Date(input.startsAt).getTime();
  const endsMs = new Date(input.endsAt).getTime();
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
    throw badRequest('Choose a valid start and end time.', 'INVALID_GIVEAWAY_WINDOW');
  }
  if (endsMs <= startsMs) {
    throw badRequest('The end time must be after the start time.', 'INVALID_GIVEAWAY_WINDOW', {
      fields: { endsAt: 'The end time must be after the start time.' },
    });
  }
  const duration = Math.round((endsMs - startsMs) / 1000);
  if (duration < GIVEAWAY_MIN_DURATION_SECONDS || duration > GIVEAWAY_MAX_DURATION_SECONDS) {
    throw badRequest(
      `Giveaways must run between ${Math.round(GIVEAWAY_MIN_DURATION_SECONDS / 60)} minutes and ${Math.round(
        GIVEAWAY_MAX_DURATION_SECONDS / 86400,
      )} days.`,
      'INVALID_GIVEAWAY_DURATION',
      { fields: { endsAt: 'Choose a duration within the allowed range.' } },
    );
  }
  return { startsMs, endsMs };
}

function validatePrize(prizeAmount: number, winnerCount: number): void {
  if (!Number.isSafeInteger(prizeAmount) || prizeAmount < GIVEAWAY_MIN_AMOUNT || prizeAmount > GIVEAWAY_MAX_AMOUNT) {
    throw badRequest('Enter a valid giveaway prize amount.', 'INVALID_GIVEAWAY_AMOUNT', {
      fields: { prizeAmount: `Use an amount between ${compactAmount(GIVEAWAY_MIN_AMOUNT)} and ${compactAmount(GIVEAWAY_MAX_AMOUNT)}.` },
    });
  }
  if (!Number.isInteger(winnerCount) || winnerCount < GIVEAWAY_MIN_WINNERS || winnerCount > GIVEAWAY_MAX_WINNERS) {
    throw badRequest('Choose a valid number of winners.', 'INVALID_WINNER_COUNT', {
      fields: { winnerCount: `Choose between ${GIVEAWAY_MIN_WINNERS} and ${GIVEAWAY_MAX_WINNERS} winners.` },
    });
  }
}

interface InsertGiveawayOptions {
  createdBy: string;
  fundedBy: string;
  sponsorUserId: string | null;
  fundingKind: GiveawayFundingKind;
  sponsorshipId: string | null;
  escrowLedgerId: string | null;
  status: 'scheduled' | 'active';
  now: number;
}

function insertGiveawayRow(
  db: DB,
  id: string,
  reference: string,
  input: CreateGiveawayInput,
  options: InsertGiveawayOptions,
): GiveawayRow {
  const seed = randomBytes(32).toString('hex');
  const commitment = createHash('sha256').update(seed).digest('hex');
  db.prepare(
    `INSERT INTO giveaways
       (id, reference, title, description, prize_amount, winner_count, status, starts_at, ends_at,
        created_by, funded_by_user_id, sponsor_user_id, funding_kind, sponsorship_id, escrow_ledger_id,
        draw_commitment, draw_seed, created_at, banner_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    reference,
    input.title,
    input.description,
    input.prizeAmount,
    input.winnerCount,
    options.status,
    input.startsAt,
    input.endsAt,
    options.createdBy,
    options.fundedBy,
    options.sponsorUserId,
    options.fundingKind,
    options.sponsorshipId,
    options.escrowLedgerId,
    commitment,
    seed,
    new Date(options.now).toISOString(),
    input.bannerUrl ?? null,
  );
  const row = getGiveawayRow(db, id);
  if (!row) throw new Error('Giveaway disappeared after creation');
  return row;
}

export function createGiveaway(
  db: DB,
  actor: SessionUser,
  input: CreateGiveawayInput,
  options: { guildId?: string | null; channelId?: string | null } = {},
): GiveawayView {
  const now = Date.now();
  validatePrize(input.prizeAmount, input.winnerCount);
  const bannerUrl = normalizeBannerUrl(input.bannerUrl);
  const { startsMs, endsMs } = validateWindow(input);
  if (startsMs > now && startsMs - now < GIVEAWAY_MIN_SCHEDULE_LEAD_SECONDS * 1000) {
    throw badRequest(
      `Schedule the start at least ${GIVEAWAY_MIN_SCHEDULE_LEAD_SECONDS} seconds ahead, or start it now.`,
      'INVALID_GIVEAWAY_WINDOW',
      { fields: { startsAt: 'Choose a start time at least one minute ahead, or publish now.' } },
    );
  }
  if (endsMs <= Math.max(startsMs, now)) {
    throw badRequest('The end time must be in the future.', 'INVALID_GIVEAWAY_WINDOW');
  }
  const startsAt = new Date(Math.max(startsMs, now)).toISOString();
  const endsAt = new Date(endsMs).toISOString();
  const status: 'scheduled' | 'active' = startsMs > now + 1000 ? 'scheduled' : 'active';
  const id = newId('gvw');

  settleDueGiveaways(db, now);

  inTransaction(db, () => {
    const reference = generateGiveawayReference(db);
    const entry = applyLedger(db, {
      userId: actor.id,
      amount: -input.prizeAmount,
      type: 'admin_adjustment',
      actorId: actor.id,
      reason: `Giveaway escrow — ${input.title}`,
      refType: 'giveaway',
      refId: id,
      idempotencyKey: `giveaway-escrow:${id}`,
      metadata: { kind: 'giveaway_escrow', giveawayId: id, reference, winnerCount: input.winnerCount },
    });
    insertGiveawayRow(
      db,
      id,
      reference,
      { ...input, startsAt, endsAt, bannerUrl },
      {
        createdBy: actor.id,
        fundedBy: actor.id,
        sponsorUserId: null,
        fundingKind: 'staff',
        sponsorshipId: null,
        escrowLedgerId: entry.id,
        status,
        now,
      },
    );
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.create',
      targetType: 'giveaway',
      targetId: id,
      targetLabel: reference,
      metadata: {
        prizeAmount: input.prizeAmount,
        winnerCount: input.winnerCount,
        startsAt,
        endsAt,
        fundingKind: 'staff',
      },
    });
  });

  const row = getGiveawayRow(db, id);
  if (!row) throw new Error('Giveaway disappeared after creation');
  const view = mapGiveaway(db, row, actor.id);
  const guildId = options.guildId ?? row.discord_guild_id ?? getPrimaryGuild(db)?.guild_id ?? null;
  const channelId =
    options.channelId ??
    row.discord_channel_id ??
    (guildId ? getGuildConfig(db, guildId).channels.giveaways : null);
  if (guildId) {
    // Store the destination before the outbox delivers, so an early end or a
    // reroll knows where to edit the original message even if delivery is slow.
    db.prepare('UPDATE giveaways SET discord_guild_id = ?, discord_channel_id = ? WHERE id = ?').run(
      guildId,
      channelId,
      id,
    );
  }
  queueGiveawayPost(db, view, guildId, channelId);
  return view;
}

/* --------------------------------- joining -------------------------------- */

export function joinGiveaway(db: DB, user: SessionUser, giveawayId: string): GiveawayView {
  const now = Date.now();
  settleDueGiveaways(db, now);
  const row = inTransaction(db, () => {
    const giveaway = getGiveawayRow(db, giveawayId);
    if (!giveaway) throw notFound('Giveaway not found.');
    if (giveaway.status === 'scheduled') {
      throw conflict('This giveaway has not started yet.', 'GIVEAWAY_NOT_STARTED');
    }
    if (giveaway.status !== 'active') {
      throw conflict('This giveaway has already ended.', 'GIVEAWAY_ENDED');
    }
    if (new Date(giveaway.ends_at).getTime() <= now) {
      throw conflict('This giveaway has already ended.', 'GIVEAWAY_ENDED');
    }
    // The funder already paid the whole pool. Entering their own draw would pay
    // part of it straight back and turn a sponsored giveaway into a no-op.
    if (giveaway.funded_by_user_id === user.id) {
      throw conflict('You funded this giveaway, so you cannot enter it.', 'GIVEAWAY_SELF_JOIN');
    }
    db.prepare(
      'INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, joined_at) VALUES (?, ?, ?)',
    ).run(giveaway.id, user.id, new Date(now).toISOString());
    return giveaway;
  });
  return mapGiveaway(db, row, user.id, now);
}

/* ------------------------------ prize claims ------------------------------ */

function winnerRow(db: DB, giveawayId: string, userId: string): WinnerRow | undefined {
  return db
    .prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? AND user_id = ?')
    .get(giveawayId, userId) as WinnerRow | undefined;
}

function claimView(db: DB, winner: WinnerRow): GiveawayClaimView {
  const row = db
    .prepare(`${CLAIM_SELECT} WHERE w.id = ?`)
    .get(winner.id) as ClaimQueryRow | undefined;
  if (!row) throw notFound('Winner record not found.');
  return mapClaimRow(row);
}

export function openClaimTicket(
  db: DB,
  user: SessionUser,
  giveawayId: string,
  message: string,
): GiveawayClaimTicketResponse {
  const now = Date.now();
  settleDueGiveaways(db, now);
  const result = inTransaction(db, () => {
    const giveaway = getGiveawayRow(db, giveawayId);
    if (!giveaway) throw notFound('Giveaway not found.');
    if (giveaway.status !== 'completed') {
      throw conflict('The giveaway has not been drawn yet.', 'GIVEAWAY_NOT_DRAWN');
    }
    const winner = winnerRow(db, giveaway.id, user.id);
    if (!winner) throw forbidden('You did not win this giveaway.', 'NOT_A_WINNER');
    if (winner.claim_status === 'approved') {
      throw conflict('This prize has already been paid.', 'CLAIM_ALREADY_PAID');
    }
    if (winner.claim_status === 'rejected') {
      throw conflict('This claim was rejected. Contact support if you believe it was a mistake.', 'CLAIM_REJECTED');
    }
    if (winner.claim_status === 'pending' && winner.claim_ticket_id) {
      const ticket = db.prepare('SELECT reference FROM tickets WHERE id = ?').get(winner.claim_ticket_id) as
        | { reference: string }
        | undefined;
      throw conflict(
        `You already opened a claim ticket${ticket ? ` (${ticket.reference})` : ''}.`,
        'CLAIM_ALREADY_OPEN',
        { ticketReference: ticket?.reference ?? null },
      );
    }

    const ticketId = newId('tkt');
    const reference = generateTicketReference(db);
    const subject = `Giveaway claim — ${giveaway.reference}`;
    const description = [
      `Prize: ${compactAmount(winner.payout_amount)} money`,
      `Giveaway: ${giveaway.title} (${giveaway.reference})`,
      `Winners: ${giveaway.winner_count}`,
      '',
      message.trim() || 'Please verify my win and release the prize.',
    ].join('\n');
    db.prepare(
      `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, 'giveaway_claim', 'new', 'high', ?, ?, ?)`,
    ).run(ticketId, reference, user.id, subject, description, nowIso(), nowIso(), nowIso());
    addTicketEvent(db, { ticketId, actorId: user.id, type: 'created', toValue: 'new' });
    addTicketMessage(db, {
      ticketId,
      authorId: null,
      authorRole: 'system',
      visibility: 'system',
      body: `Prize held in escrow: ${compactAmount(winner.payout_amount)} money. Staff must verify the winner before paying.`,
    });
    const linked = db
      .prepare(
        "UPDATE giveaway_winners SET claim_status = 'pending', claim_ticket_id = ? WHERE id = ? AND claim_status = 'unclaimed'",
      )
      .run(ticketId, winner.id);
    if (linked.changes !== 1) {
      throw conflict('This claim changed while the ticket was being opened. Please retry.', 'CLAIM_CONFLICT');
    }
    notifyStaff(db, {
      title: `Giveaway claim ${reference}`,
      body: `@${user.username} opened a claim for ${compactAmount(winner.payout_amount)} money in ${giveaway.reference}.`,
      link: `/staff/tickets/${reference}`,
      actorId: user.id,
      excludeUserId: user.id,
    });
    notify(db, {
      userId: user.id,
      type: 'giveaway',
      title: `Claim ticket ${reference} opened`,
      body: 'Staff can now verify your win and release the prize.',
      link: `/tickets/${reference}`,
    });
    recordAudit(db, {
      actorId: user.id,
      action: 'giveaway.claim.open',
      targetType: 'giveaway_winner',
      targetId: winner.id,
      targetLabel: giveaway.reference,
      metadata: { ticketReference: reference, payoutAmount: winner.payout_amount },
    });
    return { ticketReference: reference, claim: claimView(db, winnerRow(db, giveaway.id, user.id) ?? winner) };
  });
  return result;
}

export function approveClaim(db: DB, actor: SessionUser, winnerId: string): GiveawayClaimView {
  const now = nowIso();
  inTransaction(db, () => {
    const winner = db
      .prepare(
        `SELECT w.*, g.reference AS giveaway_reference, g.id AS giveaway_id, g.title AS giveaway_title,
                t.reference AS ticket_reference
           FROM giveaway_winners w
           JOIN giveaways g ON g.id = w.giveaway_id
           LEFT JOIN tickets t ON t.id = w.claim_ticket_id
          WHERE w.id = ?`,
      )
      .get(winnerId) as ClaimQueryRow | undefined;
    if (!winner) throw notFound('Claim not found.');
    if (winner.claim_status === 'approved') throw conflict('This prize was already paid.', 'CLAIM_ALREADY_PAID');
    if (winner.claim_status === 'rejected') throw conflict('This claim was rejected.', 'CLAIM_REJECTED');
    if (winner.user_id === actor.id) {
      throw forbidden('You cannot approve your own giveaway claim.', 'SELF_APPROVAL');
    }
    if (!winner.claim_ticket_id) {
      throw badRequest('The winner must open a Giveaway Claim ticket first.', 'CLAIM_TICKET_REQUIRED');
    }
    const update = db
      .prepare(
        `UPDATE giveaway_winners
            SET claim_status = 'approved', approved_by = ?, approved_at = ?
          WHERE id = ? AND claim_status = 'pending'`,
      )
      .run(actor.id, now, winnerId);
    if (update.changes !== 1) throw conflict('This claim is no longer pending.', 'CLAIM_NOT_PENDING');

    const entry = applyLedger(db, {
      userId: winner.user_id,
      amount: winner.payout_amount,
      type: 'credit_request',
      actorId: actor.id,
      reason: `Giveaway prize — ${winner.giveaway_reference}`,
      refType: 'giveaway',
      refId: winner.giveaway_id,
      idempotencyKey: `giveaway-payout:${winnerId}`,
      metadata: {
        kind: 'giveaway_payout',
        giveawayId: winner.giveaway_id,
        winnerId,
        ticketId: winner.claim_ticket_id,
      },
    });
    db.prepare('UPDATE giveaway_winners SET payout_ledger_id = ? WHERE id = ?').run(entry.id, winnerId);
    if (winner.claim_ticket_id) {
      db.prepare(
        "UPDATE tickets SET status = 'resolved', updated_at = ?, last_activity_at = ? WHERE id = ?",
      ).run(now, now, winner.claim_ticket_id);
      addTicketMessage(db, {
        ticketId: winner.claim_ticket_id,
        authorId: null,
        authorRole: 'system',
        visibility: 'system',
        body: `Prize approved and paid: ${compactAmount(winner.payout_amount)} money.`,
      });
      addTicketEvent(db, {
        ticketId: winner.claim_ticket_id,
        actorId: actor.id,
        type: 'status',
        fromValue: 'new',
        toValue: 'resolved',
        note: `Paid by ${actor.username}`,
      });
      touchTicket(db, winner.claim_ticket_id, now);
    }
    notify(db, {
      userId: winner.user_id,
      type: 'giveaway',
      title: `Prize paid: ${compactAmount(winner.payout_amount)} money`,
      body: `${winner.giveaway_reference} was approved. The money is in your wallet.`,
      link: '/wallet',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.claim.approve',
      targetType: 'giveaway_winner',
      targetId: winnerId,
      targetLabel: winner.giveaway_reference,
      metadata: { payoutAmount: winner.payout_amount, ticketReference: winner.ticket_reference ?? null },
    });
  });
  const row = db.prepare(`${CLAIM_SELECT} WHERE w.id = ?`).get(winnerId) as ClaimQueryRow;
  return mapClaimRow(row);
}

export function rejectClaim(db: DB, actor: SessionUser, winnerId: string, reason: string): GiveawayClaimView {
  const now = nowIso();
  inTransaction(db, () => {
    const winner = db.prepare(`${CLAIM_SELECT} WHERE w.id = ?`).get(winnerId) as ClaimQueryRow | undefined;
    if (!winner) throw notFound('Claim not found.');
    if (winner.claim_status === 'approved') throw conflict('This prize was already paid.', 'CLAIM_ALREADY_PAID');
    if (winner.claim_status === 'rejected') throw conflict('This claim was already rejected.', 'CLAIM_ALREADY_REJECTED');
    if (!winner.claim_ticket_id) {
      throw badRequest('The winner must open a Giveaway Claim ticket first.', 'CLAIM_TICKET_REQUIRED');
    }
    const update = db
      .prepare(
        `UPDATE giveaway_winners
            SET claim_status = 'rejected', rejected_at = ?, rejection_reason = ?
          WHERE id = ? AND claim_status = 'pending'`,
      )
      .run(now, reason, winnerId);
    if (update.changes !== 1) throw conflict('This claim is no longer pending.', 'CLAIM_NOT_PENDING');
    db.prepare(
      "UPDATE tickets SET status = 'rejected', rejection_reason = ?, updated_at = ?, last_activity_at = ? WHERE id = ?",
    ).run(reason, now, now, winner.claim_ticket_id);
    addTicketMessage(db, {
      ticketId: winner.claim_ticket_id,
      authorId: null,
      authorRole: 'system',
      visibility: 'system',
      body: `Claim rejected. Reason: ${reason}`,
    });
    addTicketEvent(db, {
      ticketId: winner.claim_ticket_id,
      actorId: actor.id,
      type: 'rejected',
      fromValue: 'new',
      toValue: 'rejected',
      note: reason,
    });
    touchTicket(db, winner.claim_ticket_id, now);
    notify(db, {
      userId: winner.user_id,
      type: 'giveaway',
      title: `Giveaway claim rejected`,
      body: `${winner.giveaway_reference}: ${reason}`,
      link: '/giveaways',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.claim.reject',
      targetType: 'giveaway_winner',
      targetId: winnerId,
      targetLabel: winner.giveaway_reference,
      reason,
      metadata: { ticketReference: winner.ticket_reference ?? null },
    });
  });
  const row = db.prepare(`${CLAIM_SELECT} WHERE w.id = ?`).get(winnerId) as ClaimQueryRow;
  return mapClaimRow(row);
}

/* ------------------------------- editing/cancel --------------------------- */

export interface UpdateGiveawayInput {
  title?: string;
  description?: string;
  prizeAmount?: number;
  winnerCount?: number;
  startsAt?: string;
  endsAt?: string;
  bannerUrl?: string | null;
}

export function updateGiveaway(
  db: DB,
  actor: SessionUser,
  giveawayId: string,
  input: UpdateGiveawayInput,
): GiveawayView {
  const now = Date.now();
  settleDueGiveaways(db, now);
  inTransaction(db, () => {
    const row = getGiveawayRow(db, giveawayId);
    if (!row) throw notFound('Giveaway not found.');
    if (row.status === 'completed' || row.status === 'cancelled') {
      throw conflict('Completed or cancelled giveaways cannot be edited.', 'GIVEAWAY_LOCKED');
    }
    const prizeAmount = input.prizeAmount ?? row.prize_amount;
    const winnerCount = input.winnerCount ?? row.winner_count;
    const bannerUrl = input.bannerUrl === undefined ? row.banner_url : normalizeBannerUrl(input.bannerUrl);
    validatePrize(prizeAmount, winnerCount);
    const startsAt = input.startsAt ?? row.starts_at;
    const endsAt = input.endsAt ?? row.ends_at;
    const { endsMs } = validateWindow({ startsAt, endsAt });
    if (row.status === 'active' && prizeAmount !== row.prize_amount) {
      throw badRequest('The prize is locked once a giveaway is active.', 'PRIZE_LOCKED');
    }
    if (row.status === 'active' && winnerCount !== row.winner_count) {
      throw badRequest('The winner count is locked once a giveaway is active.', 'WINNERS_LOCKED');
    }
    // A sponsor approved a specific prize and winner count. Staff may still
    // rename or reschedule it, but they cannot charge the sponsor more than the
    // request the sponsor agreed to.
    if (
      row.funding_kind === 'sponsor' &&
      (prizeAmount !== row.prize_amount || winnerCount !== row.winner_count)
    ) {
      throw badRequest(
        'A sponsored giveaway keeps the prize and winner count the sponsor approved.',
        'SPONSOR_TERMS_LOCKED',
      );
    }
    if (row.status === 'active' && new Date(startsAt).getTime() !== new Date(row.starts_at).getTime()) {
      throw badRequest('An active giveaway cannot be moved back to a start time.', 'START_LOCKED');
    }
    if (endsMs <= now) throw badRequest('The end time must be in the future.', 'INVALID_GIVEAWAY_WINDOW');

    const difference = prizeAmount - row.prize_amount;
    if (difference !== 0) {
      applyLedger(db, {
        userId: row.funded_by_user_id,
        amount: -difference,
        type: 'admin_adjustment',
        actorId: actor.id,
        reason: `Giveaway escrow adjustment — ${row.reference}`,
        refType: 'giveaway',
        refId: row.id,
        // The pair of old and new amounts makes a retried PATCH harmless: the
        // second attempt sees difference 0 and never reaches the ledger.
        idempotencyKey: `giveaway-adjust:${row.id}:${row.prize_amount}:${prizeAmount}`,
        metadata: { kind: 'giveaway_adjustment', giveawayId: row.id },
      });
    }
    const nextStart = new Date(startsAt);
    const status: GiveawayStatus =
      row.status === 'active' || nextStart.getTime() <= now ? 'active' : 'scheduled';
    db.prepare(
      `UPDATE giveaways SET title = ?, description = ?, prize_amount = ?, winner_count = ?,
              starts_at = ?, ends_at = ?, status = ?, banner_url = ? WHERE id = ?`,
    ).run(
      input.title ?? row.title,
      input.description ?? row.description,
      prizeAmount,
      winnerCount,
      startsAt,
      endsAt,
      status,
      bannerUrl,
      row.id,
    );
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.update',
      targetType: 'giveaway',
      targetId: row.id,
      targetLabel: row.reference,
      metadata: {
        previousPrize: row.prize_amount,
        prizeAmount,
        previousWinners: row.winner_count,
        winnerCount,
        startsAt,
        endsAt,
        escrowAdjustment: difference,
        bannerUrl,
      },
    });
  });
  const row = getGiveawayRow(db, giveawayId);
  if (!row) throw notFound('Giveaway not found.');
  return mapGiveaway(db, row, actor.id);
}

export function cancelGiveaway(
  db: DB,
  actor: SessionUser,
  giveawayId: string,
  reason: string,
): GiveawayView {
  settleDueGiveaways(db);
  inTransaction(db, () => {
    const row = getGiveawayRow(db, giveawayId);
    if (!row) throw notFound('Giveaway not found.');
    if (row.status !== 'scheduled' && row.status !== 'active') {
      throw conflict('Only upcoming or active giveaways can be cancelled.', 'GIVEAWAY_NOT_CANCELLABLE');
    }
    refundPool(db, row, `Giveaway cancelled — ${row.reference}`, actor.id);
    const refund = db.prepare('SELECT id FROM ledger WHERE idempotency_key = ?').get(`giveaway-refund:${row.id}`) as
      | { id: string }
      | undefined;
    db.prepare(
      `UPDATE giveaways SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?,
              refund_ledger_id = ? WHERE id = ? AND status IN ('scheduled','active')`,
    ).run(nowIso(), reason, refund?.id ?? null, row.id);
    const participants = db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?').all(row.id) as {
      user_id: string;
    }[];
    for (const participant of participants) {
      notify(db, {
        userId: participant.user_id,
        type: 'giveaway',
        title: `Giveaway cancelled: ${row.title}`,
        body: `The prize was refunded to the funder. Reason: ${reason}`,
        link: '/giveaways',
        actorId: actor.id,
      });
    }
    notify(db, {
      userId: row.funded_by_user_id,
      type: 'giveaway',
      title: `Giveaway refunded: ${compactAmount(row.prize_amount)} money`,
      body: `${row.reference} was cancelled and the full prize pool returned to your balance.`,
      link: '/wallet',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.cancel',
      targetType: 'giveaway',
      targetId: row.id,
      targetLabel: row.reference,
      reason,
      metadata: { prizeAmount: row.prize_amount, participants: participants.length },
    });
  });
  const row = getGiveawayRow(db, giveawayId);
  if (!row) throw notFound('Giveaway not found.');
  const view = mapGiveaway(db, row, actor.id);
  queueGiveawayCancel(db, view, row.discord_guild_id, row.discord_channel_id, row.discord_message_id);
  return view;
}

/* ----------------------------- early end / reroll ------------------------- */

/**
 * Ends an active or scheduled giveaway now. The committed draw seed is still
 * used, so ending early cannot change the selection algorithm or hide the proof.
 */
export function endGiveawayEarly(db: DB, actor: SessionUser, giveawayId: string): GiveawayView {
  settleDueGiveaways(db);
  const now = Date.now();
  inTransaction(db, () => {
    const row = getGiveawayRow(db, giveawayId);
    if (!row) throw notFound('Giveaway not found.');
    if (row.status !== 'active' && row.status !== 'scheduled') {
      throw conflict('Only upcoming or active giveaways can be ended early.', 'GIVEAWAY_NOT_ACTIVE');
    }
    const startsAt = new Date(Math.min(new Date(row.starts_at).getTime(), now - 1000)).toISOString();
    const endsAt = new Date(now).toISOString();
    const updated = db
      .prepare(
        `UPDATE giveaways SET status = 'active', starts_at = ?, ends_at = ?
          WHERE id = ? AND status IN ('scheduled','active')`,
      )
      .run(startsAt, endsAt, row.id);
    if (updated.changes !== 1) throw conflict('This giveaway changed while it was ending.', 'GIVEAWAY_CONFLICT');
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.end_early',
      targetType: 'giveaway',
      targetId: row.id,
      targetLabel: row.reference,
      metadata: { previousEndsAt: row.ends_at, endedAt: endsAt },
    });
  });
  settleDueGiveaways(db, now + 1000);
  const row = getGiveawayRow(db, giveawayId);
  if (!row) throw notFound('Giveaway not found.');
  return mapGiveaway(db, row, actor.id);
}

/**
 * Replaces one unclaimed winner with the next deterministic entrant. Winners
 * who already opened a claim ticket are never silently removed: staff must
 * reject that claim first, which keeps the payout ledger unambiguous.
 */
export function rerollGiveaway(db: DB, actor: SessionUser, giveawayId: string): GiveawayView {
  settleDueGiveaways(db);
  const now = Date.now();
  const result = inTransaction(db, () => {
    const row = getGiveawayRow(db, giveawayId);
    if (!row) throw notFound('Giveaway not found.');
    if (row.status !== 'completed') {
      throw conflict('Only a completed giveaway can be rerolled.', 'GIVEAWAY_NOT_COMPLETED');
    }
    const winners = getWinnerRows(db, row.id);
    if (winners.length === 0) throw conflict('This giveaway has no winners to reroll.', 'NO_WINNERS');
    const oldWinner = winners.find((winner) => winner.claim_status === 'unclaimed' && !winner.claim_ticket_id);
    if (!oldWinner) {
      throw conflict(
        'Every winner already has a pending or approved claim. Reject a pending claim before rerolling it.',
        'CLAIM_ALREADY_OPEN',
      );
    }
    const winnerIds = new Set(winners.map((winner) => winner.user_id));
    const entries = db
      .prepare(
        `SELECT e.user_id, u.username
           FROM giveaway_entries e JOIN users u ON u.id = e.user_id
          WHERE e.giveaway_id = ?
          ORDER BY e.joined_at ASC, e.user_id ASC`,
      )
      .all(row.id) as { user_id: string; username: string }[];
    const candidates = entries.filter((entry) => !winnerIds.has(entry.user_id));
    if (candidates.length === 0) {
      throw conflict('There are no other entrants available for a reroll.', 'NO_REROLL_CANDIDATE');
    }
    const pickedId = drawOrder(
      row.draw_seed,
      `${row.id}:reroll:${oldWinner.id}`,
      candidates.map((entry) => entry.user_id),
      1,
    )[0];
    const picked = candidates.find((entry) => entry.user_id === pickedId);
    if (!picked) throw conflict('The reroll could not pick a replacement.', 'REROLL_FAILED');
    const updated = db
      .prepare(
        `UPDATE giveaway_winners
            SET user_id = ?, username_snapshot = ?, claim_status = 'unclaimed', claim_ticket_id = NULL,
                approved_by = NULL, approved_at = NULL, rejected_at = NULL, rejection_reason = NULL,
                payout_ledger_id = NULL, selected_at = ?
          WHERE id = ? AND claim_status = 'unclaimed' AND claim_ticket_id IS NULL`,
      )
      .run(picked.user_id, picked.username, nowIso(), oldWinner.id);
    if (updated.changes !== 1) throw conflict('The winner changed while rerolling.', 'REROLL_CONFLICT');

    notify(db, {
      userId: oldWinner.user_id,
      type: 'giveaway',
      title: 'Giveaway selection updated',
      body: `${row.reference} was rerolled before your claim was opened. You are no longer a winner.`,
      link: '/giveaways',
      actorId: actor.id,
    });
    notify(db, {
      userId: picked.user_id,
      type: 'giveaway',
      title: `You won ${compactAmount(oldWinner.payout_amount)} money`,
      body: `You are the rerolled winner of "${row.title}". Open a Giveaway Claim ticket to receive your prize.`,
      link: `/giveaways?claim=${encodeURIComponent(row.id)}`,
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.reroll',
      targetType: 'giveaway',
      targetId: row.id,
      targetLabel: row.reference,
      metadata: {
        replacedWinnerId: oldWinner.id,
        previousUserId: oldWinner.user_id,
        newUserId: picked.user_id,
        position: oldWinner.position,
      },
    });
    return getGiveawayRow(db, row.id) ?? row;
  });
  const view = mapGiveaway(db, result, actor.id);
  queueGiveawayReroll(db, view, result.discord_guild_id, result.discord_channel_id, result.discord_message_id);
  return view;
}

export interface CreateSponsorshipInput {
  prizeAmount: number;
  winnerCount: number;
  durationSeconds: number;
  title?: string;
  description?: string;
  message?: string;
}

export function requestSponsorship(
  db: DB,
  user: SessionUser,
  input: CreateSponsorshipInput,
): GiveawaySponsorshipView {
  validatePrize(input.prizeAmount, input.winnerCount);
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < GIVEAWAY_MIN_DURATION_SECONDS ||
    input.durationSeconds > GIVEAWAY_MAX_DURATION_SECONDS
  ) {
    throw badRequest('Choose a valid giveaway duration.', 'INVALID_GIVEAWAY_DURATION', {
      fields: { durationSeconds: 'Choose a duration within the allowed range.' },
    });
  }
  if (balanceOf(db, user.id) < input.prizeAmount) {
    throw badRequest('Your balance is too low for that prize amount.', 'INSUFFICIENT_CREDITS', {
      fields: { prizeAmount: 'Reduce the prize or deposit more money first.' },
    });
  }
  const id = newId('gvs');
  const ticketId = newId('tkt');
  inTransaction(db, () => {
    const reference = generateTicketReference(db);
    const titleLine = input.title?.trim() || 'Community giveaway';
    const subject = `Giveaway sponsorship — ${compactAmount(input.prizeAmount)} · ${input.winnerCount} winner${
      input.winnerCount === 1 ? '' : 's'
    }`;
    const description = [
      `Requested prize: ${compactAmount(input.prizeAmount)} money`,
      `Winners: ${input.winnerCount}`,
      `Preferred duration: ${Math.round(input.durationSeconds / 60)} minutes`,
      `Title: ${titleLine}`,
      '',
      input.description?.trim() || 'No extra description provided.',
      input.message?.trim() ? `\nSponsor note:\n${input.message.trim()}` : '',
    ].join('\n');
    db.prepare(
      `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, 'giveaway_sponsorship', 'new', 'normal', ?, ?, ?)`,
    ).run(ticketId, reference, user.id, subject, description, nowIso(), nowIso(), nowIso());
    addTicketEvent(db, { ticketId, actorId: user.id, type: 'created', toValue: 'new' });
    db.prepare(
      `INSERT INTO giveaway_sponsorships
         (id, ticket_id, sponsor_user_id, prize_amount, winner_count, duration_seconds, title, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      ticketId,
      user.id,
      input.prizeAmount,
      input.winnerCount,
      input.durationSeconds,
      input.title?.trim() || null,
      input.description?.trim() || null,
      nowIso(),
    );
    notifyStaff(db, {
      title: `Giveaway sponsorship ${reference}`,
      body: `@${user.username} wants to sponsor ${compactAmount(input.prizeAmount)} money for ${input.winnerCount} winner${
        input.winnerCount === 1 ? '' : 's'
      }.`,
      link: '/staff/giveaways',
      actorId: user.id,
      excludeUserId: user.id,
    });
    notify(db, {
      userId: user.id,
      type: 'giveaway',
      title: `Sponsorship request ${reference} received`,
      body: 'Staff will review your request. The prize is only deducted after approval.',
      link: `/tickets/${reference}`,
    });
    recordAudit(db, {
      actorId: user.id,
      action: 'giveaway.sponsorship.request',
      targetType: 'giveaway_sponsorship',
      targetId: id,
      targetLabel: reference,
      metadata: {
        prizeAmount: input.prizeAmount,
        winnerCount: input.winnerCount,
        durationSeconds: input.durationSeconds,
      },
    });
  });
  const row = db
    .prepare(
      `SELECT s.*, t.reference AS ticket_reference, sp.username AS sponsor_name
         FROM giveaway_sponsorships s JOIN tickets t ON t.id = s.ticket_id
         JOIN users sp ON sp.id = s.sponsor_user_id WHERE s.id = ?`,
    )
    .get(id) as SponsorshipRow;
  return mapSponsorship(db, row);
}

function sponsorshipTicket(db: DB, ticketId: string): { reference: string; id: string } | undefined {
  return db.prepare('SELECT id, reference FROM tickets WHERE id = ?').get(ticketId) as
    | { reference: string; id: string }
    | undefined;
}

function closeSponsorshipTicket(
  db: DB,
  ticketId: string,
  actorId: string | null,
  status: string,
  body: string,
  note?: string,
): void {
  db.prepare("UPDATE tickets SET status = ?, updated_at = ?, last_activity_at = ? WHERE id = ?").run(
    status,
    nowIso(),
    nowIso(),
    ticketId,
  );
  addTicketMessage(db, {
    ticketId,
    authorId: null,
    authorRole: 'system',
    visibility: 'system',
    body,
  });
  addTicketEvent(db, {
    ticketId,
    actorId,
    type: 'status',
    fromValue: 'new',
    toValue: status,
    note: note ?? null,
  });
  touchTicket(db, ticketId);
}

export function approveSponsorship(
  db: DB,
  actor: SessionUser,
  sponsorshipId: string,
): GiveawaySponsorshipView {
  inTransaction(db, () => {
    const row = getSponsorshipRow(db, sponsorshipId);
    if (!row) throw notFound('Sponsorship request not found.');
    if (row.status !== 'pending') throw conflict('This request is no longer pending.', 'SPONSORSHIP_NOT_PENDING');
    if (balanceOf(db, row.sponsor_user_id) < row.prize_amount) {
      throw badRequest('The sponsor no longer has enough balance for this prize.', 'INSUFFICIENT_CREDITS');
    }
    const entry = applyLedger(db, {
      userId: row.sponsor_user_id,
      amount: -row.prize_amount,
      type: 'admin_adjustment',
      actorId: actor.id,
      reason: `Giveaway sponsorship escrow — ${row.id}`,
      refType: 'giveaway_sponsorship',
      refId: row.id,
      idempotencyKey: `giveaway-sponsor-escrow:${row.id}`,
      metadata: { kind: 'giveaway_sponsor_escrow', sponsorshipId: row.id },
    });
    db.prepare(
      "UPDATE giveaway_sponsorships SET status = 'approved', reviewer_id = ?, reviewed_at = ?, escrow_ledger_id = ? WHERE id = ? AND status = 'pending'",
    ).run(actor.id, nowIso(), entry.id, row.id);
    const ticket = sponsorshipTicket(db, row.ticket_id);
    closeSponsorshipTicket(
      db,
      row.ticket_id,
      actor.id,
      'in_progress',
      `Sponsorship approved. ${compactAmount(row.prize_amount)} money was deducted from the sponsor's balance and is held in escrow until the giveaway is published.`,
      `Approved by ${actor.username}`,
    );
    notify(db, {
      userId: row.sponsor_user_id,
      type: 'giveaway',
      title: 'Sponsorship approved',
      body: `${compactAmount(row.prize_amount)} money is in escrow. Staff will publish your giveaway shortly.`,
      link: ticket ? `/tickets/${ticket.reference}` : '/giveaways',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.sponsorship.approve',
      targetType: 'giveaway_sponsorship',
      targetId: row.id,
      targetLabel: ticket?.reference ?? row.id,
      metadata: { prizeAmount: row.prize_amount, sponsorId: row.sponsor_user_id },
    });
  });
  return listSponsorships(db).find((entry) => entry.id === sponsorshipId)!;
}

export function rejectSponsorship(
  db: DB,
  actor: SessionUser,
  sponsorshipId: string,
  reason: string,
): GiveawaySponsorshipView {
  inTransaction(db, () => {
    const row = getSponsorshipRow(db, sponsorshipId);
    if (!row) throw notFound('Sponsorship request not found.');
    if (row.status !== 'pending') throw conflict('This request is no longer pending.', 'SPONSORSHIP_NOT_PENDING');
    db.prepare(
      "UPDATE giveaway_sponsorships SET status = 'rejected', reviewer_id = ?, reviewed_at = ?, review_reason = ? WHERE id = ? AND status = 'pending'",
    ).run(actor.id, nowIso(), reason, row.id);
    closeSponsorshipTicket(db, row.ticket_id, actor.id, 'rejected', `Sponsorship rejected. Reason: ${reason}`);
    notify(db, {
      userId: row.sponsor_user_id,
      type: 'giveaway',
      title: 'Sponsorship request rejected',
      body: reason,
      link: '/giveaways',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.sponsorship.reject',
      targetType: 'giveaway_sponsorship',
      targetId: row.id,
      targetLabel: row.id,
      reason,
    });
  });
  return listSponsorships(db).find((entry) => entry.id === sponsorshipId)!;
}

export interface PublishSponsorshipInput {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
}

export function publishSponsorship(
  db: DB,
  actor: SessionUser,
  sponsorshipId: string,
  input: PublishSponsorshipInput,
): GiveawayView {
  const now = Date.now();
  const id = newId('gvw');
  inTransaction(db, () => {
    const row = getSponsorshipRow(db, sponsorshipId);
    if (!row) throw notFound('Sponsorship request not found.');
    if (row.status !== 'approved') throw conflict('Approve the sponsorship first.', 'SPONSORSHIP_NOT_APPROVED');
    if (row.giveaway_id) throw conflict('This sponsorship already has a giveaway.', 'SPONSORSHIP_PUBLISHED');
    const startsAt = input.startsAt ?? new Date(now).toISOString();
    const endsAt =
      input.endsAt ?? new Date(new Date(startsAt).getTime() + row.duration_seconds * 1000).toISOString();
    const prizeAmount = row.prize_amount;
    const winnerCount = row.winner_count;
    validatePrize(prizeAmount, winnerCount);
    validateWindow({ startsAt, endsAt });
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    if (endMs <= now) throw badRequest('The end time must be in the future.', 'INVALID_GIVEAWAY_WINDOW');
    const reference = generateGiveawayReference(db);
    insertGiveawayRow(
      db,
      id,
      reference,
      {
        title: input.title?.trim() || row.title || 'Sponsored giveaway',
        description:
          input.description?.trim() ||
          row.description ||
          `A community giveaway sponsored by @${usernameOf(db, row.sponsor_user_id)}.`,
        prizeAmount,
        winnerCount,
        startsAt: new Date(Math.max(startMs, now)).toISOString(),
        endsAt: new Date(endMs).toISOString(),
      },
      {
        createdBy: actor.id,
        fundedBy: row.sponsor_user_id,
        sponsorUserId: row.sponsor_user_id,
        fundingKind: 'sponsor',
        sponsorshipId: row.id,
        escrowLedgerId: row.escrow_ledger_id,
        status: startMs > now + 1000 ? 'scheduled' : 'active',
        now,
      },
    );
    db.prepare(
      "UPDATE giveaway_sponsorships SET status = 'published', giveaway_id = ? WHERE id = ? AND status = 'approved'",
    ).run(id, row.id);
    closeSponsorshipTicket(
      db,
      row.ticket_id,
      actor.id,
      'resolved',
      `Giveaway published as ${reference}. Sponsor confirmation sent.`,
      `Published by ${actor.username}`,
    );
    notify(db, {
      userId: row.sponsor_user_id,
      type: 'giveaway',
      title: `Your giveaway is live: ${compactAmount(prizeAmount)} money`,
      body: `“${input.title?.trim() || row.title || 'Sponsored giveaway'}” is now ${startMs > now ? 'scheduled' : 'live'} as ${reference}.`,
      link: '/giveaways',
      actorId: actor.id,
    });
    enqueueEmail(db, {
      userId: row.sponsor_user_id,
      recipient: (
        db.prepare('SELECT email FROM users WHERE id = ?').get(row.sponsor_user_id) as { email: string } | undefined
      )?.email ?? '',
      template: 'giveaway-sponsor',
      payload: {
        username: usernameOf(db, row.sponsor_user_id),
        title: input.title?.trim() || row.title || 'Sponsored giveaway',
        reference,
        prizeAmount,
        winners: winnerCount,
        startsAt: new Date(Math.max(startMs, now)).toISOString(),
        endsAt: new Date(endMs).toISOString(),
        giveawayUrl: '/giveaways',
      },
      dedupeKey: `giveaway-sponsor-published:${row.id}`,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.sponsorship.publish',
      targetType: 'giveaway',
      targetId: id,
      targetLabel: reference,
      metadata: { sponsorshipId: row.id, sponsorId: row.sponsor_user_id, prizeAmount },
    });
  });
  const row = getGiveawayRow(db, id);
  if (!row) throw notFound('Giveaway not found.');
  return mapGiveaway(db, row, actor.id);
}

export function cancelSponsorship(db: DB, actor: SessionUser, sponsorshipId: string): GiveawaySponsorshipView {
  inTransaction(db, () => {
    const row = getSponsorshipRow(db, sponsorshipId);
    if (!row) throw notFound('Sponsorship request not found.');
    if (row.status !== 'approved' || row.giveaway_id) {
      throw conflict('Only approved sponsorships without a published giveaway can be cancelled.', 'SPONSORSHIP_NOT_CANCELLABLE');
    }
    applyLedger(db, {
      userId: row.sponsor_user_id,
      amount: row.prize_amount,
      type: 'credit_request',
      actorId: actor.id,
      reason: `Giveaway sponsorship refund — ${row.id}`,
      refType: 'giveaway_sponsorship',
      refId: row.id,
      idempotencyKey: `giveaway-sponsor-refund:${row.id}`,
      metadata: { kind: 'giveaway_sponsor_refund', sponsorshipId: row.id },
    });
    db.prepare("UPDATE giveaway_sponsorships SET status = 'cancelled', review_reason = ? WHERE id = ?").run(
      'Sponsorship cancelled and refunded',
      row.id,
    );
    closeSponsorshipTicket(
      db,
      row.ticket_id,
      actor.id,
      'resolved',
      `Sponsorship cancelled. ${compactAmount(row.prize_amount)} money was refunded to the sponsor.`,
    );
    notify(db, {
      userId: row.sponsor_user_id,
      type: 'giveaway',
      title: 'Sponsorship refunded',
      body: `${compactAmount(row.prize_amount)} money returned to your balance.`,
      link: '/wallet',
      actorId: actor.id,
    });
    recordAudit(db, {
      actorId: actor.id,
      action: 'giveaway.sponsorship.refund',
      targetType: 'giveaway_sponsorship',
      targetId: row.id,
      targetLabel: row.id,
      metadata: { prizeAmount: row.prize_amount },
    });
  });
  return listSponsorships(db).find((entry) => entry.id === sponsorshipId)!;
}

/* ------------------------------- test helpers ----------------------------- */

export const giveawayInternals = {
  drawOrder,
  getGiveawayRow,
  getGiveawayByReferenceRow,
};
