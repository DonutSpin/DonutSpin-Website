import type { DB } from '../db/index.ts';
import type { Role } from '../../shared/types.ts';
import { newId, nowIso, parseJson } from './core.ts';
import { enqueueEmail } from './email.ts';

/**
 * A signed-in tab is considered present while its session has been used in the
 * last two minutes. The auth middleware refreshes the session at most once
 * every 30 seconds, and the client polls while its tab is visible, so a brief
 * network interruption does not immediately look like an absence.
 */
const ONLINE_WINDOW_MS = 2.5 * 60_000;
const DIGEST_DELAY_MS = 75_000;

interface DigestRow {
  id: string;
  ticket_id: string;
  user_id: string;
  first_message_at: string;
  due_at: string;
  last_message_at: string;
  message_ids: string;
  status: 'pending' | 'sent' | 'skipped';
  created_at: string;
  sent_at: string | null;
}

interface DigestMessageRow {
  id: string;
  body: string;
  created_at: string;
  author_role: string;
  author_name: string | null;
}

export function isUserOnline(db: DB, userId: string, at = Date.now(), windowMs = ONLINE_WINDOW_MS): boolean {
  const cutoff = new Date(at - windowMs).toISOString();
  const now = new Date(at).toISOString();
  const session = db
    .prepare(
      `SELECT 1 FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_used_at >= ?
        LIMIT 1`,
    )
    .get(userId, now, cutoff);
  if (session) return true;
  const user = db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(userId) as
    | { last_seen_at: string | null }
    | undefined;
  return Boolean(user?.last_seen_at && new Date(user.last_seen_at).getTime() >= at - windowMs);
}

function markMessagesNotified(db: DB, ids: string[], at = nowIso()): void {
  const statement = db.prepare('UPDATE ticket_messages SET notified_at = ? WHERE id = ? AND notified_at IS NULL');
  for (const id of ids) statement.run(at, id);
}

/**
 * Opening or replying to the ticket proves the requester has seen the visible
 * staff replies. Marking them notified also cancels a digest that has not been
 * sent yet, which keeps an active conversation quiet.
 */
export function markTicketSeenByRequester(db: DB, ticketId: string, userId: string): void {
  const ticket = db.prepare('SELECT user_id FROM tickets WHERE id = ?').get(ticketId) as
    | { user_id: string }
    | undefined;
  if (!ticket || ticket.user_id !== userId) return;
  const at = nowIso();
  db.prepare(
    `UPDATE ticket_messages SET notified_at = ?
      WHERE ticket_id = ? AND visibility = 'public' AND author_role <> 'user' AND notified_at IS NULL`,
  ).run(at, ticketId);
  db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE ticket_id = ? AND status = 'pending'").run(
    at,
    ticketId,
  );
}

/** Confirmation for the ticket creator. Failures never block ticket creation. */
export function queueTicketCreatedEmail(
  db: DB,
  input: {
    userId: string;
    email: string;
    username: string;
    ticketId: string;
    reference: string;
    subject: string;
    category: string;
    createdAt: string;
  },
): string | null {
  try {
    return enqueueEmail(db, {
      userId: input.userId,
      recipient: input.email,
      template: 'ticket-created',
      payload: {
        username: input.username,
        reference: input.reference,
        subject: input.subject,
        category: input.category,
        createdAt: input.createdAt,
        ticketUrl: `/tickets/${encodeURIComponent(input.reference)}`,
      },
      dedupeKey: `ticket-created:${input.ticketId}`,
      // The creation receipt is transactional: it confirms that support has
      // the request even when optional community emails are switched off.
      respectPreference: false,
    });
  } catch (error) {
    console.warn('[tickets] could not queue the creation email:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Queues staff replies into one delayed digest. If the requester is actively
 * present the reply is marked as seen and a previously pending digest is
 * cancelled, so an active conversation never produces an email per message.
 */
export function scheduleTicketReplyDigest(
  db: DB,
  input: {
    ticketId: string;
    userId: string;
    messageId: string;
    authorName: string;
    authorRole: Role;
    body: string;
    createdAt?: string;
  },
): void {
  try {
    const createdAt = input.createdAt ?? nowIso();
    const pending = db
      .prepare("SELECT * FROM ticket_reply_digests WHERE ticket_id = ? AND status = 'pending'")
      .get(input.ticketId) as DigestRow | undefined;

    // Every staff reply joins a delayed digest. Whether it is actually emailed
    // is decided when the digest is due, using presence and the requester's
    // last read of this exact ticket. That tolerates a short network blip and
    // cancels cleanly when the requester is watching the conversation.
    if (pending) {
      const ids = parseJson<string[]>(pending.message_ids, []);
      if (!ids.includes(input.messageId)) ids.push(input.messageId);
      db.prepare(
        `UPDATE ticket_reply_digests
            SET message_ids = ?, last_message_at = ?
          WHERE id = ? AND status = 'pending'`,
      ).run(JSON.stringify(ids), createdAt, pending.id);
      return;
    }

    const dueAt = new Date(Date.parse(createdAt) + DIGEST_DELAY_MS).toISOString();
    // The table keeps one live digest per ticket. Upserting also covers a
    // database created before the schema was widened: the previous sent row is
    // replaced with a fresh pending window instead of silently dropping the
    // next staff reply.
    db.prepare(
      `INSERT INTO ticket_reply_digests
         (id, ticket_id, user_id, first_message_at, due_at, last_message_at, message_ids, status, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
       ON CONFLICT(ticket_id) DO UPDATE SET
         id = excluded.id,
         user_id = excluded.user_id,
         first_message_at = excluded.first_message_at,
         due_at = excluded.due_at,
         last_message_at = excluded.last_message_at,
         message_ids = excluded.message_ids,
         status = 'pending',
         created_at = excluded.created_at,
         sent_at = NULL`,
    ).run(
      newId('trd'),
      input.ticketId,
      input.userId,
      createdAt,
      dueAt,
      createdAt,
      JSON.stringify([input.messageId]),
      createdAt,
    );
  } catch (error) {
    console.warn('[tickets] could not schedule a reply digest:', error instanceof Error ? error.message : error);
  }
}

/**
 * Sends one email containing every still-unseen staff reply on the ticket.
 * Called by the background maintenance loop, never on the request path.
 */
export function processTicketReplyDigests(db: DB, limit = 20): number {
  let sent = 0;
  const due = db
    .prepare(
      `SELECT * FROM ticket_reply_digests
        WHERE status = 'pending' AND due_at <= ?
        ORDER BY due_at ASC LIMIT ?`,
    )
    .all(nowIso(), Math.min(50, Math.max(1, limit))) as DigestRow[];

  for (const digest of due) {
    try {
      const ids = parseJson<string[]>(digest.message_ids, []);
      if (ids.length === 0) {
        db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE id = ?").run(
          nowIso(),
          digest.id,
        );
        continue;
      }
      const read = db
        .prepare('SELECT last_read_at FROM ticket_reads WHERE ticket_id = ? AND user_id = ?')
        .get(digest.ticket_id, digest.user_id) as { last_read_at: string } | undefined;
      const latestMessageAt = digest.last_message_at;
      const hasSeenLatest = Boolean(read && read.last_read_at >= latestMessageAt);
      if (isUserOnline(db, digest.user_id) && hasSeenLatest) {
        markMessagesNotified(db, ids);
        db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE id = ?").run(
          nowIso(),
          digest.id,
        );
        continue;
      }

      const placeholders = ids.map(() => '?').join(',');
      const messages = db
        .prepare(
          `SELECT m.id, m.body, m.created_at, m.author_role, u.username AS author_name
             FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
            WHERE m.id IN (${placeholders}) AND m.notified_at IS NULL
            ORDER BY m.created_at ASC, m.rowid ASC`,
        )
        .all(...ids) as DigestMessageRow[];
      if (messages.length === 0) {
        db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE id = ?").run(
          nowIso(),
          digest.id,
        );
        continue;
      }

      const ticket = db
        .prepare(
          `SELECT t.reference, t.subject, u.email, u.username, u.email_notifications
             FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
        )
        .get(digest.ticket_id) as
        | { reference: string; subject: string; email: string; username: string; email_notifications: number }
        | undefined;
      if (!ticket) {
        db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE id = ?").run(
          nowIso(),
          digest.id,
        );
        continue;
      }
      if (!ticket.email_notifications) {
        markMessagesNotified(db, messages.map((message) => message.id));
        db.prepare("UPDATE ticket_reply_digests SET status = 'skipped', sent_at = ? WHERE id = ?").run(
          nowIso(),
          digest.id,
        );
        continue;
      }

      const dedupeKey = `ticket-reply-digest:${digest.id}`;
      const existingJob = db.prepare('SELECT id FROM email_jobs WHERE dedupe_key = ?').get(dedupeKey);
      if (!existingJob) {
        const job = enqueueEmail(db, {
          userId: digest.user_id,
          recipient: ticket.email,
          template: 'ticket-reply',
          payload: {
            username: ticket.username,
            reference: ticket.reference,
            subject: ticket.subject,
            count: messages.length,
            messages: messages.map((message) => ({
              author: message.author_name ?? 'Support',
              role: message.author_role,
              body: message.body.slice(0, 1_200),
              createdAt: message.created_at,
            })),
            ticketUrl: `/tickets/${encodeURIComponent(ticket.reference)}`,
          },
          dedupeKey,
          respectPreference: false,
        });
        if (!job) continue;
      }

      markMessagesNotified(db, messages.map((message) => message.id));
      db.prepare("UPDATE ticket_reply_digests SET status = 'sent', sent_at = ? WHERE id = ?").run(nowIso(), digest.id);
      sent += 1;
    } catch (error) {
      console.warn('[tickets] reply digest failed:', error instanceof Error ? error.message : error);
    }
  }
  return sent;
}
