import type { DB } from '../../db/index.ts';
import { newId, nowIso, parseJson } from '../core.ts';

/**
 * Durable outbound queue between the website and the separately hosted bot.
 *
 * The website never talks to Discord directly. It writes an event here, and
 * the bot claims events over the authenticated bot API. Claiming is
 * transactional and leases events, so two bot workers cannot publish the same
 * event twice and a crashed worker's lease is recovered automatically.
 */

export type DiscordEventType =
  | 'giveaway_post'
  | 'giveaway_result'
  | 'giveaway_cancel'
  | 'giveaway_reroll'
  | 'vouch_post'
  | 'code_post'
  | 'code_delete'
  | 'announcement_post'
  | 'announcement_edit'
  | 'announcement_delete';

export interface ClaimedOutboxEvent {
  id: string;
  guildId: string | null;
  eventType: DiscordEventType;
  payload: Record<string, unknown>;
  attempts: number;
}

interface OutboxRow {
  id: string;
  guild_id: string | null;
  event_type: DiscordEventType;
  payload: string;
  attempts: number;
}

export interface EnqueueOutboxInput {
  guildId?: string | null;
  eventType: DiscordEventType;
  payload: Record<string, unknown>;
  /** Makes retries and accidental double enqueues harmless. */
  dedupeKey?: string | null;
  availableAt?: string;
}

/** Inserts an event once. A duplicate dedupe key is silently ignored. */
export function enqueueOutbox(db: DB, input: EnqueueOutboxInput): string | null {
  const id = newId('dco');
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO discord_outbox
         (id, guild_id, event_type, payload, dedupe_key, status, attempts, available_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    )
    .run(
      id,
      input.guildId ?? null,
      input.eventType,
      JSON.stringify(input.payload),
      input.dedupeKey ?? null,
      input.availableAt ?? nowIso(),
      nowIso(),
    );
  return result.changes === 1 ? id : null;
}

/**
 * Leases pending events to one bot worker. Stale leases are returned to the
 * queue first. The caller should always acknowledge or fail each event.
 */
export function claimOutbox(db: DB, limit = 20, leaseSeconds = 90): ClaimedOutboxEvent[] {
  const now = Date.now();
  const nowValue = new Date(now).toISOString();
  const lockUntil = new Date(now + leaseSeconds * 1000).toISOString();
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)));

  const run = db.transaction((): ClaimedOutboxEvent[] => {
    db.prepare(
      `UPDATE discord_outbox
          SET status = 'pending', locked_until = NULL
        WHERE status = 'processing' AND locked_until IS NOT NULL AND locked_until < ?`,
    ).run(nowValue);

    const rows = db
      .prepare(
        `SELECT id, guild_id, event_type, payload, attempts
           FROM discord_outbox
          WHERE status = 'pending' AND available_at <= ?
          ORDER BY created_at ASC
          LIMIT ?`,
      )
      .all(nowValue, boundedLimit) as OutboxRow[];

    const claimed: ClaimedOutboxEvent[] = [];
    const lease = db.prepare(
      `UPDATE discord_outbox
          SET status = 'processing', attempts = attempts + 1, locked_until = ?
        WHERE id = ? AND status = 'pending'`,
    );
    for (const row of rows) {
      if (lease.run(lockUntil, row.id).changes !== 1) continue;
      claimed.push({
        id: row.id,
        guildId: row.guild_id,
        eventType: row.event_type,
        payload: parseJson<Record<string, unknown>>(row.payload, {}),
        attempts: row.attempts + 1,
      });
    }
    return claimed;
  });

  return run.immediate();
}

export function completeOutbox(db: DB, id: string, messageId: string | null): boolean {
  const result = db
    .prepare(
      `UPDATE discord_outbox
          SET status = 'sent', message_id = ?, sent_at = ?, locked_until = NULL, last_error = NULL
        WHERE id = ? AND status = 'processing'`,
    )
    .run(messageId, nowIso(), id);
  return result.changes === 1;
}

/** Failed delivery is retried with exponential backoff, then parked for staff. */
export function failOutbox(db: DB, id: string, error: string): boolean {
  const row = db.prepare('SELECT attempts FROM discord_outbox WHERE id = ?').get(id) as
    | { attempts: number }
    | undefined;
  if (!row) return false;
  const attempts = row.attempts;
  const terminal = attempts >= 5;
  const delaySeconds = Math.min(900, 15 * 2 ** Math.max(0, attempts - 1));
  const result = db
    .prepare(
      `UPDATE discord_outbox
          SET status = ?, last_error = ?, locked_until = NULL, available_at = ?
        WHERE id = ? AND status = 'processing'`,
    )
    .run(
      terminal ? 'failed' : 'pending',
      error.slice(0, 1000),
      new Date(Date.now() + delaySeconds * 1000).toISOString(),
      id,
    );
  return result.changes === 1;
}

/** Marks an event that cannot be delivered (for example a deleted channel). */
export function skipOutbox(db: DB, id: string, reason: string): boolean {
  const result = db
    .prepare(
      `UPDATE discord_outbox
          SET status = 'skipped', last_error = ?, locked_until = NULL
        WHERE id = ? AND status = 'processing'`,
    )
    .run(reason.slice(0, 1000), id);
  return result.changes === 1;
}

export function outboxCounts(db: DB): { pending: number; failed: number } {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM discord_outbox
        WHERE status IN ('pending','processing','failed')
        GROUP BY status`,
    )
    .all() as { status: string; count: number }[];
  const byStatus = new Map(rows.map((row) => [row.status, row.count]));
  return {
    pending: (byStatus.get('pending') ?? 0) + (byStatus.get('processing') ?? 0),
    failed: byStatus.get('failed') ?? 0,
  };
}
