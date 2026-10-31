import type { DB } from '../db/index.ts';
import type { RainLimits, RainParticipantView, RainView } from '../../shared/types.ts';
import { RAIN_COUNTDOWN_MAX_SECONDS, RAIN_COUNTDOWN_MIN_SECONDS } from '../../shared/types.ts';
import { getSetting } from '../db/index.ts';
import { applyLedger } from './wallet.ts';
import { badRequest, conflict, inTransaction, newId } from './core.ts';
import { recordAudit } from './audit.ts';

export const RAIN_MIN_SETTING = 'rain.min_amount';
export const RAIN_MAX_SETTING = 'rain.max_amount';
export const RAIN_DEFAULT_MIN = 10_000;
export const RAIN_DEFAULT_MAX = 5_000_000;
const PARTICIPANT_PREVIEW = 12;

interface RainRow {
  id: string;
  creator_id: string;
  total_amount: number;
  status: 'countdown' | 'settled';
  duration_seconds: number;
  ends_at: string;
  settled_at: string | null;
  participant_count: number;
  payout_per_participant: number;
  remainder_distributed: number;
  refunded_amount: number;
  created_at: string;
}

interface ParticipantRow {
  user_id: string;
  username: string;
  joined_at: string;
  payout: number | null;
}

/** Platform-wide limits, editable by moderators and above. */
export function rainLimits(db: DB): RainLimits {
  const rawMin = getSetting<unknown>(db, RAIN_MIN_SETTING, RAIN_DEFAULT_MIN);
  const rawMax = getSetting<unknown>(db, RAIN_MAX_SETTING, RAIN_DEFAULT_MAX);
  const min = typeof rawMin === 'number' && Number.isSafeInteger(rawMin) && rawMin > 0 ? rawMin : RAIN_DEFAULT_MIN;
  const max = typeof rawMax === 'number' && Number.isSafeInteger(rawMax) && rawMax > 0 ? rawMax : RAIN_DEFAULT_MAX;
  return {
    minAmount: Math.min(min, max),
    maxAmount: Math.max(min, max),
    countdownMinSeconds: RAIN_COUNTDOWN_MIN_SECONDS,
    countdownMaxSeconds: RAIN_COUNTDOWN_MAX_SECONDS,
  };
}

export function getActiveRainRow(db: DB): RainRow | undefined {
  return db
    .prepare("SELECT * FROM rain_events WHERE status = 'countdown' ORDER BY created_at ASC LIMIT 1")
    .get() as RainRow | undefined;
}

function getLatestRainRow(db: DB): RainRow | undefined {
  return db
    .prepare('SELECT * FROM rain_events ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get() as RainRow | undefined;
}

function getRainRow(db: DB, id: string): RainRow | undefined {
  return db.prepare('SELECT * FROM rain_events WHERE id = ?').get(id) as RainRow | undefined;
}

function participantRows(db: DB, rainId: string, limit = PARTICIPANT_PREVIEW): ParticipantRow[] {
  return db
    .prepare(
      `SELECT p.user_id, u.username, p.joined_at, p.payout
         FROM rain_participants p
         JOIN users u ON u.id = p.user_id
        WHERE p.rain_id = ?
        ORDER BY p.joined_at ASC, p.user_id ASC
        LIMIT ?`,
    )
    .all(rainId, limit) as ParticipantRow[];
}

function participantCount(db: DB, rainId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM rain_participants WHERE rain_id = ?').get(rainId) as { count: number }
  ).count;
}

function creatorName(db: DB, userId: string): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  return row?.username ?? 'Unknown';
}

/**
 * Builds the public state. Financial amounts are read from the rain row, never
 * from the browser, and the participant preview is capped so a huge rain
 * cannot produce an unbounded response.
 */
export function mapRain(db: DB, row: RainRow, viewerId: string | null): RainView {
  const limits = rainLimits(db);
  const count = row.status === 'countdown' ? participantCount(db, row.id) : row.participant_count;
  const joinedRow = viewerId
    ? (db
        .prepare('SELECT payout FROM rain_participants WHERE rain_id = ? AND user_id = ?')
        .get(row.id, viewerId) as { payout: number | null } | undefined)
    : undefined;
  const base =
    row.status === 'settled'
      ? row.participant_count > 0
        ? row.payout_per_participant
        : null
      : count > 0
        ? Math.floor(row.total_amount / count)
        : null;
  const remainder =
    row.status === 'settled' ? row.remainder_distributed : count > 0 && base !== null ? row.total_amount - base * count : 0;
  const endsAt = new Date(row.ends_at).getTime();
  const participants: RainParticipantView[] = participantRows(db, row.id).map((participant) => ({
    id: participant.user_id,
    username: participant.username,
    joinedAt: participant.joined_at,
    payout: participant.payout,
  }));

  return {
    id: row.id,
    status: row.status,
    creator: { id: row.creator_id, username: creatorName(db, row.creator_id) },
    totalAmount: row.total_amount,
    participantCount: count,
    countdownEndsAt: row.ends_at,
    secondsRemaining: row.status === 'countdown' ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0,
    joined: Boolean(joinedRow),
    isCreator: viewerId !== null && row.creator_id === viewerId,
    payoutPerParticipant: base,
    yourPayout: row.status === 'settled' ? (joinedRow?.payout ?? null) : null,
    remainder,
    participants,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    minAmount: limits.minAmount,
    maxAmount: limits.maxAmount,
    countdownMinSeconds: limits.countdownMinSeconds,
    countdownMaxSeconds: limits.countdownMaxSeconds,
  };
}

/**
 * Settles one due rain. Must run inside a write transaction. The conditional
 * status update, the unique ledger idempotency keys and the primary-key lock
 * on the rain row make a second concurrent settlement a no-op.
 */
function settleRainRow(db: DB, row: RainRow, now: number): RainRow {
  const fresh = getRainRow(db, row.id);
  if (!fresh || fresh.status !== 'countdown') return fresh ?? row;
  if (new Date(fresh.ends_at).getTime() > now) return fresh;

  const settledAt = new Date(now).toISOString();
  // Settlement must never fail because an account was deleted while the
  // countdown was running. Deleted accounts no longer have a wallet, so they
  // are not eligible for a payout and the pool is split among the remaining
  // participants instead of being blocked for everyone.
  const participants = db
    .prepare(
      `SELECT p.user_id, u.username, p.joined_at, p.payout
         FROM rain_participants p
         JOIN users u ON u.id = p.user_id
         JOIN wallets w ON w.user_id = p.user_id
        WHERE p.rain_id = ? ORDER BY p.joined_at ASC, p.user_id ASC`,
    )
    .all(fresh.id) as ParticipantRow[];
  const count = participants.length;
  const creator = creatorName(db, fresh.creator_id);

  let base = 0;
  let remainder = 0;
  let refunded = 0;

  if (count === 0) {
    // Nobody eligible joined. Return the whole pool to the creator; no money is
    // lost. A deleted creator has no wallet left, so the historical transfer
    // stays recorded without a refund target.
    const creatorHasWallet = Boolean(
      db.prepare('SELECT 1 FROM wallets WHERE user_id = ?').get(fresh.creator_id),
    );
    if (creatorHasWallet) {
      refunded = fresh.total_amount;
      applyLedger(db, {
        userId: fresh.creator_id,
        amount: refunded,
        type: 'credit_request',
        reason: `Rain refund — no participants joined @${creator}'s rain`,
        refType: 'rain',
        refId: fresh.id,
        idempotencyKey: `rain-refund:${fresh.id}`,
        metadata: { kind: 'rain_refund', rainId: fresh.id },
      });
    }
  } else {
    base = Math.floor(fresh.total_amount / count);
    remainder = fresh.total_amount - base * count;
    participants.forEach((participant, index) => {
      // Remainder units are assigned one per participant in join order so the
      // configured total is distributed to the last unit, never silently kept.
      const payout = base + (index < remainder ? 1 : 0);
      if (payout <= 0) {
        db.prepare('UPDATE rain_participants SET payout = 0, payout_ledger_id = NULL WHERE rain_id = ? AND user_id = ?').run(
          fresh.id,
          participant.user_id,
        );
        return;
      }
      const entry = applyLedger(db, {
        userId: participant.user_id,
        amount: payout,
        type: 'credit_request',
        reason: `Rain payout from @${creator}`,
        refType: 'rain',
        refId: fresh.id,
        idempotencyKey: `rain-payout:${fresh.id}:${participant.user_id}`,
        metadata: { kind: 'rain_payout', rainId: fresh.id, creatorId: fresh.creator_id },
      });
      db.prepare('UPDATE rain_participants SET payout = ?, payout_ledger_id = ? WHERE rain_id = ? AND user_id = ?').run(
        payout,
        entry.id,
        fresh.id,
        participant.user_id,
      );
    });
  }

  const update = db
    .prepare(
      `UPDATE rain_events
          SET status = 'settled', settled_at = ?, participant_count = ?, payout_per_participant = ?,
              remainder_distributed = ?, refunded_amount = ?
        WHERE id = ? AND status = 'countdown'`,
    )
    .run(settledAt, count, base, remainder, refunded, fresh.id);
  if (update.changes !== 1) {
    // Another worker won the settlement race. The surrounding transaction is
    // aborted so this one's ledger reads/writes cannot disagree with it.
    throw conflict('This rain was already settled.', 'RAIN_ALREADY_SETTLED');
  }

  recordAudit(db, {
    action: 'rain.settle',
    targetType: 'rain',
    targetId: fresh.id,
    targetLabel: `@${creator}`,
    metadata: {
      totalAmount: fresh.total_amount,
      participants: count,
      payoutPerParticipant: base,
      remainderDistributed: remainder,
      refunded,
    },
  });

  return getRainRow(db, fresh.id) ?? fresh;
}

/** Runs inside an existing write transaction. */
function settleDueInside(db: DB, now: number): void {
  const active = getActiveRainRow(db);
  if (!active) return;
  if (new Date(active.ends_at).getTime() > now) return;
  settleRainRow(db, active, now);
}

/**
 * Lazy settlement used by every read and mutation and by the background timer.
 * It is safe to call when nothing is due.
 */
export function settleDueRain(db: DB, now = Date.now()): void {
  const active = getActiveRainRow(db);
  if (!active || new Date(active.ends_at).getTime() > now) return;
  inTransaction(db, () => settleDueInside(db, now));
}

export function rainState(db: DB, viewerId: string): RainView | null {
  settleDueRain(db);
  const row = getActiveRainRow(db) ?? getLatestRainRow(db);
  return row ? mapRain(db, row, viewerId) : null;
}

export function rainHistory(db: DB, viewerId: string, limit = 10): RainView[] {
  settleDueRain(db);
  const rows = db
    .prepare("SELECT * FROM rain_events WHERE status = 'settled' ORDER BY settled_at DESC, created_at DESC LIMIT ?")
    .all(Math.min(50, Math.max(1, limit))) as RainRow[];
  return rows.map((row) => mapRain(db, row, viewerId));
}

export interface CreateRainInput {
  amount: number;
  countdownSeconds: number;
}

export function createRain(db: DB, user: { id: string; username: string }, input: CreateRainInput): RainView {
  const now = Date.now();
  const limits = rainLimits(db);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw badRequest('Enter a valid rain amount.', 'INVALID_RAIN_AMOUNT', {
      fields: { amount: 'Enter a whole number amount.' },
    });
  }
  if (input.amount < limits.minAmount || input.amount > limits.maxAmount) {
    throw badRequest(
      `Rain amounts must be between ${limits.minAmount} and ${limits.maxAmount} money.`,
      'RAIN_AMOUNT_OUT_OF_RANGE',
      { fields: { amount: `Use an amount between ${limits.minAmount} and ${limits.maxAmount}.` } },
    );
  }
  if (
    !Number.isInteger(input.countdownSeconds) ||
    input.countdownSeconds < limits.countdownMinSeconds ||
    input.countdownSeconds > limits.countdownMaxSeconds
  ) {
    throw badRequest(
      `Choose a countdown between ${limits.countdownMinSeconds} and ${limits.countdownMaxSeconds} seconds.`,
      'INVALID_RAIN_COUNTDOWN',
      { fields: { countdownSeconds: 'Choose a valid countdown.' } },
    );
  }

  const id = newId('rain');
  const endsAt = new Date(now + input.countdownSeconds * 1000).toISOString();
  const createdAt = new Date(now).toISOString();

  // Commit a due settlement before the write transaction so a later conflict
  // cannot roll that settlement back.
  settleDueRain(db, now);

  inTransaction(db, () => {
    const active = getActiveRainRow(db);
    if (active) {
      throw conflict('A rain is already running. Join it or wait for it to settle.', 'RAIN_ACTIVE');
    }

    applyLedger(db, {
      userId: user.id,
      amount: -input.amount,
      type: 'admin_adjustment',
      actorId: user.id,
      reason: 'Rain prize pool',
      refType: 'rain',
      refId: id,
      idempotencyKey: `rain-escrow:${id}`,
      metadata: { kind: 'rain_escrow', rainId: id, countdownSeconds: input.countdownSeconds },
    });

    db.prepare(
      `INSERT INTO rain_events
         (id, creator_id, total_amount, status, duration_seconds, ends_at, participant_count,
          payout_per_participant, remainder_distributed, refunded_amount, created_at)
       VALUES (?, ?, ?, 'countdown', ?, ?, 0, 0, 0, 0, ?)`,
    ).run(id, user.id, input.amount, input.countdownSeconds, endsAt, createdAt);

    recordAudit(db, {
      actorId: user.id,
      action: 'rain.create',
      targetType: 'rain',
      targetId: id,
      targetLabel: `@${user.username}`,
      metadata: { totalAmount: input.amount, countdownSeconds: input.countdownSeconds },
    });
  });

  const row = getRainRow(db, id);
  if (!row) throw new Error('Rain disappeared after creation');
  return mapRain(db, row, user.id);
}

export function joinRain(db: DB, user: { id: string; username: string }): RainView {
  const now = Date.now();
  settleDueRain(db, now);
  const row = inTransaction(db, () => {
    const active = getActiveRainRow(db);
    if (!active) throw conflict('There is no rain to join right now.', 'NO_ACTIVE_RAIN');
    if (new Date(active.ends_at).getTime() <= now) {
      throw conflict('This rain has already ended.', 'RAIN_ENDED');
    }
    db.prepare(
      'INSERT OR IGNORE INTO rain_participants (rain_id, user_id, joined_at) VALUES (?, ?, ?)',
    ).run(active.id, user.id, new Date(now).toISOString());
    return active;
  });
  return mapRain(db, row, user.id);
}

export function leaveRain(db: DB, user: { id: string }): RainView {
  const now = Date.now();
  settleDueRain(db, now);
  const row = inTransaction(db, () => {
    const active = getActiveRainRow(db);
    if (!active) throw conflict('There is no active rain to leave.', 'NO_ACTIVE_RAIN');
    if (new Date(active.ends_at).getTime() <= now) {
      throw conflict('This rain has already ended.', 'RAIN_ENDED');
    }
    db.prepare('DELETE FROM rain_participants WHERE rain_id = ? AND user_id = ?').run(active.id, user.id);
    return active;
  });
  return mapRain(db, row, user.id);
}

