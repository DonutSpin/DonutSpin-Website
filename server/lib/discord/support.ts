import type { DB } from '../../db/index.ts';
import type { CashierRequestKind, CashierRequestStatus, Role, TicketPriority } from '../../../shared/types.ts';
import { newId, nowIso } from '../core.ts';
import { enqueueOutbox } from './outbox.ts';
import { getGuildConfig, getPrimaryGuild } from './core.ts';

const MAX_TRANSCRIPT_CHARS = 400_000;

interface SupportContext {
  guildId: string;
  channelId: string | null;
  transcriptChannelId: string | null;
  roleIds: string[];
}

function supportContext(db: DB, kind: 'ticket' | 'cashier'): SupportContext | null {
  const guild = getPrimaryGuild(db);
  if (!guild) return null;
  const guildConfig = getGuildConfig(db, guild.guild_id);
  const roleIds = Array.from(
    new Set(
      kind === 'ticket'
        ? [...guildConfig.roles.owner, ...guildConfig.roles.admin, ...guildConfig.roles.staff]
        : [],
    ),
  );
  return {
    guildId: guild.guild_id,
    channelId: kind === 'ticket' ? guildConfig.channels.tickets : guildConfig.channels.cashierRequests,
    transcriptChannelId:
      kind === 'ticket' ? guildConfig.channels.ticketTranscripts : guildConfig.channels.cashierTranscripts,
    roleIds,
  };
}

function safeQueue(
  db: DB,
  input: Parameters<typeof enqueueOutbox>[1],
): string | null {
  try {
    return enqueueOutbox(db, input);
  } catch (error) {
    console.warn(
      `[discord] could not queue ${input.eventType}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function clip(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  return `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated at ${MAX_TRANSCRIPT_CHARS.toLocaleString(
    'en-US',
  )} characters.]`;
}

function stamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function roleLabel(role: string): string {
  return role === 'user' ? 'PLAYER' : role.toUpperCase();
}

export interface TicketNotificationInput {
  kind: 'created' | 'reply';
  ticketId: string;
  messageId?: string;
  reference: string;
  subject: string;
  requester: string;
  category: string;
  priority: TicketPriority;
  status: string;
  preview?: string;
  staffName?: string;
}

/** Queues a small, safe embed payload. The bot resolves channels and mentions. */
export function queueTicketNotification(db: DB, input: TicketNotificationInput): string | null {
  try {
    const ctx = supportContext(db, 'ticket');
    if (!ctx) return null;
    const eventKey = input.kind === 'created' ? 'created' : (input.messageId ?? nowIso());
    return safeQueue(db, {
      guildId: ctx.guildId,
      eventType: 'ticket_notification',
      dedupeKey: `ticket-notify:${input.ticketId}:${eventKey}`,
      payload: {
        kind: input.kind,
        reference: input.reference,
        subject: input.subject,
        requester: input.requester,
        category: input.category,
        priority: input.priority,
        status: input.status,
        preview: input.preview ?? '',
        staffName: input.staffName ?? null,
        url: `/tickets/${encodeURIComponent(input.reference)}`,
        channelId: ctx.channelId,
        roleIds: ctx.roleIds,
      },
    });
  } catch (error) {
    console.warn('[tickets] could not queue a Discord notification:', error instanceof Error ? error.message : error);
    return null;
  }
}

export interface CashierNotificationInput {
  event:
    | 'created'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'amount_changed'
    | 'on_hold'
    | 'resumed';
  eventKey: string;
  requestId: string;
  reference: string;
  username: string;
  userId: string;
  kind: CashierRequestKind;
  amount: number;
  previousAmount?: number | null;
  status: CashierRequestStatus;
  onHold: boolean;
  staffName?: string | null;
  reason?: string | null;
  createdAt: string;
  decidedAt?: string | null;
}

export function queueCashierNotification(db: DB, input: CashierNotificationInput): string | null {
  try {
    const ctx = supportContext(db, 'cashier');
    if (!ctx) return null;
    return safeQueue(db, {
      guildId: ctx.guildId,
      eventType: 'cashier_notification',
      dedupeKey: `cashier-notify:${input.requestId}:${input.eventKey}`,
      payload: {
        event: input.event,
        reference: input.reference,
        username: input.username,
        userId: input.userId,
        kind: input.kind,
        amount: input.amount,
        previousAmount: input.previousAmount ?? null,
        status: input.status,
        onHold: input.onHold,
        staffName: input.staffName ?? null,
        reason: input.reason ?? null,
        createdAt: input.createdAt,
        decidedAt: input.decidedAt ?? null,
        url: `/admin/cashier/${encodeURIComponent(input.reference)}`,
        channelId: ctx.channelId,
      },
    });
  } catch (error) {
    console.warn('[cashier] could not queue a Discord notification:', error instanceof Error ? error.message : error);
    return null;
  }
}

interface TicketTranscriptRow {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  category_label: string;
  requester_name: string;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  description: string;
  user_id: string;
}

function buildTicketTranscript(
  db: DB,
  ticketId: string,
  kind: 'closed' | 'reopened' | 'manual',
  actorId: string | null,
  note: string | null,
): { ticket: TicketTranscriptRow; content: string; filename: string } | null {
  const ticket = db
    .prepare(
      `SELECT t.id, t.reference, t.subject, t.status, t.priority, c.label AS category_label,
              req.username AS requester_name, ag.username AS assignee_name,
              t.created_at, t.updated_at, t.closed_at, t.description, t.user_id
         FROM tickets t
         JOIN support_categories c ON c.key = t.category
         JOIN users req ON req.id = t.user_id
         LEFT JOIN users ag ON ag.id = t.assignee_id
        WHERE t.id = ?`,
    )
    .get(ticketId) as TicketTranscriptRow | undefined;
  if (!ticket) return null;

  const messages = db
    .prepare(
      `SELECT m.author_role, m.visibility, m.body, m.created_at, u.username AS author_name
         FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = ? ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all(ticketId) as {
    author_role: string;
    visibility: string;
    body: string;
    created_at: string;
    author_name: string | null;
  }[];

  const events = db
    .prepare(
      `SELECT e.type, e.from_value, e.to_value, e.note, e.created_at, u.username AS actor_name
         FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.ticket_id = ? ORDER BY e.created_at ASC, e.rowid ASC`,
    )
    .all(ticketId) as {
    type: string;
    from_value: string | null;
    to_value: string | null;
    note: string | null;
    created_at: string;
    actor_name: string | null;
  }[];

  const actor = actorId
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(actorId) as { username: string } | undefined)
    : undefined;

  const lines: string[] = [
    'DONUTSPIN SUPPORT TICKET TRANSCRIPT',
    '==================================',
    `Ticket ID: ${ticket.reference}`,
    `Subject: ${ticket.subject}`,
    `Category: ${ticket.category_label}`,
    `Priority: ${ticket.priority}`,
    `Status: ${ticket.status}`,
    `Requester: ${ticket.requester_name}`,
    `Assigned staff: ${ticket.assignee_name ?? 'Unassigned'}`,
    `Created: ${stamp(ticket.created_at)}`,
    `Last activity: ${stamp(ticket.updated_at)}`,
    `Closed: ${stamp(ticket.closed_at)}`,
    `Transcript kind: ${kind}`,
    `Generated: ${stamp(nowIso())}`,
    ...(kind === 'closed'
      ? [`Closed by: ${actor?.username ?? 'Staff'}`, `Closing note: ${note ?? 'No reason recorded.'}`]
      : []),
    ...(kind === 'reopened' ? [`Reopened by: ${actor?.username ?? 'Staff'}`] : []),
    ...(kind === 'manual' ? [`Requested by: ${actor?.username ?? 'Staff'}`] : []),
    '',
    '--- ORIGINAL REQUEST ---',
    ticket.description,
    '',
    '--- CONVERSATION ---',
  ];

  for (const message of messages) {
    const visibility =
      message.visibility === 'internal' ? 'INTERNAL NOTE' : message.visibility === 'system' ? 'SYSTEM' : 'PUBLIC';
    lines.push(
      `[${stamp(message.created_at)}] ${message.author_name ?? 'DonutSpin'} (${roleLabel(
        message.author_role,
      )}) [${visibility}]`,
      message.body,
      '',
    );
  }

  lines.push('--- EVENT HISTORY ---');
  for (const event of events) {
    lines.push(
      `[${stamp(event.created_at)}] ${event.type.toUpperCase()} · ${event.actor_name ?? 'System'}${
        event.from_value || event.to_value ? ` · ${event.from_value ?? '—'} -> ${event.to_value ?? '—'}` : ''
      }${event.note ? ` · ${event.note}` : ''}`,
    );
  }

  lines.push(
    '',
    '--- ATTACHMENTS ---',
    'No file attachments are supported by the ticket system at this time.',
    '',
    '--- END OF TRANSCRIPT ---',
  );

  return {
    ticket,
    content: clip(lines.join('\n')),
    filename: `${ticket.reference.replace(/[^A-Za-z0-9._-]/g, '_')}-${kind}.txt`,
  };
}

export function queueTicketTranscript(
  db: DB,
  input: {
    ticketId: string;
    kind: 'closed' | 'reopened' | 'manual';
    eventId: string;
    actorId: string | null;
    note?: string | null;
  },
): string | null {
  try {
    // Exactly one Discord transcript embed is published per ticket, when it is
    // closed. Reopening or transcript requests must never create another one.
    if (input.kind !== 'closed') return null;
    const existing = db
      .prepare('SELECT id FROM ticket_transcripts WHERE ticket_id = ? AND kind = ? AND event_id = ?')
      .get(input.ticketId, input.kind, input.eventId) as { id: string } | undefined;
    if (existing) return existing.id;

    const built = buildTicketTranscript(db, input.ticketId, input.kind, input.actorId, input.note ?? null);
    if (!built) return null;
    const ctx = supportContext(db, 'ticket');
    const id = newId('ttr');
    db.prepare(
      `INSERT INTO ticket_transcripts
         (id, ticket_id, reference, kind, event_id, content, filename, guild_id, channel_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    ).run(
      id,
      input.ticketId,
      built.ticket.reference,
      input.kind,
      input.eventId,
      built.content,
      built.filename,
      ctx?.guildId ?? null,
      ctx?.transcriptChannelId ?? null,
      input.actorId,
      nowIso(),
    );
    if (ctx) {
      safeQueue(db, {
        guildId: ctx.guildId,
        eventType: 'ticket_transcript',
        dedupeKey: `ticket-transcript:${id}`,
        payload: {
          transcriptId: id,
          reference: built.ticket.reference,
          channelId: ctx.transcriptChannelId,
        },
      });
    }
    return id;
  } catch (error) {
    console.warn('[tickets] could not queue transcript:', error instanceof Error ? error.message : error);
    return null;
  }
}

interface CashierTranscriptRequestRow {
  id: string;
  reference: string;
  user_id: string;
  kind: CashierRequestKind;
  amount: number;
  status: CashierRequestStatus;
  decision_reason: string | null;
  decided_at: string | null;
  ledger_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  held_at: string | null;
  hold_reason: string | null;
  requester_name: string;
  reviewer_name: string | null;
  held_by_name: string | null;
}

function buildCashierTranscript(
  db: DB,
  requestId: string,
): { request: CashierTranscriptRequestRow; content: string; filename: string } | null {
  const request = db
    .prepare(
      `SELECT r.id, r.reference, r.user_id, r.kind, r.amount, r.status, r.decision_reason, r.decided_at,
              r.ledger_id, r.created_at, r.updated_at, r.last_activity_at, r.held_at, r.hold_reason,
              u.username AS requester_name,
              rev.username AS reviewer_name, held.username AS held_by_name
         FROM cashier_requests r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN users rev ON rev.id = r.reviewer_id
         LEFT JOIN users held ON held.id = r.held_by
        WHERE r.id = ?`,
    )
    .get(requestId) as CashierTranscriptRequestRow | undefined;
  if (!request) return null;

  const events = db
    .prepare(
      `SELECT e.type, e.from_value, e.to_value, e.note, e.created_at, u.username AS actor_name
         FROM cashier_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.request_id = ? ORDER BY e.created_at ASC, e.rowid ASC`,
    )
    .all(requestId) as {
    type: string;
    from_value: string | null;
    to_value: string | null;
    note: string | null;
    created_at: string;
    actor_name: string | null;
  }[];

  const messages = db
    .prepare(
      `SELECT m.author_role, m.visibility, m.body, m.created_at, u.username AS author_name
         FROM cashier_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.request_id = ? ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all(requestId) as {
    author_role: string;
    visibility: string;
    body: string;
    created_at: string;
    author_name: string | null;
  }[];

  const lines: string[] = [
    'DONUTSPIN CASHIER REQUEST TRANSCRIPT',
    '====================================',
    `Request ID: ${request.reference}`,
    `Type: ${request.kind}`,
    `Amount: ${request.amount.toLocaleString('en-US')} money`,
    `Status: ${request.status}${request.held_at ? ' (on hold)' : ''}`,
    `Requester: ${request.requester_name} (${request.user_id})`,
    `Reviewer: ${request.reviewer_name ?? 'Not assigned'}`,
    `On hold by: ${request.held_by_name ?? '—'}`,
    `Hold reason: ${request.hold_reason ?? '—'}`,
    `Created: ${stamp(request.created_at)}`,
    `Last activity: ${stamp(request.last_activity_at)}`,
    `Decided: ${stamp(request.decided_at)}`,
    `Decision reason: ${request.decision_reason ?? '—'}`,
    `Ledger entry: ${request.ledger_id ?? '—'}`,
    `Generated: ${stamp(nowIso())}`,
    '',
    '--- AUDIT EVENTS ---',
  ];

  for (const event of events) {
    lines.push(
      `[${stamp(event.created_at)}] ${event.type.toUpperCase()} · ${event.actor_name ?? 'System'}${
        event.from_value || event.to_value ? ` · ${event.from_value ?? '—'} -> ${event.to_value ?? '—'}` : ''
      }${event.note ? ` · ${event.note}` : ''}`,
    );
  }

  lines.push('', '--- CONVERSATION ---');
  for (const message of messages) {
    const visibility = message.visibility === 'system' ? 'SYSTEM' : 'PUBLIC';
    lines.push(
      `[${stamp(message.created_at)}] ${message.author_name ?? 'DonutSpin'} (${roleLabel(
        message.author_role,
      )}) [${visibility}]`,
      message.body,
      '',
    );
  }

  lines.push(
    '--- ATTACHMENTS ---',
    'No file attachments are supported by the cashier system at this time.',
    '',
    '--- END OF TRANSCRIPT ---',
  );

  return {
    request,
    content: clip(lines.join('\n')),
    filename: `${request.reference.replace(/[^A-Za-z0-9._-]/g, '_')}-transcript.txt`,
  };
}

/**
 * Keeps one transcript row per request and edits the same Discord message as
 * the audit grows. Every revision is still durable in SQLite.
 */
export function queueCashierTranscript(
  db: DB,
  input: { requestId: string; eventKey: string; actorId: string | null },
): string | null {
  try {
    const built = buildCashierTranscript(db, input.requestId);
    if (!built) return null;
    // Cashier requests only publish a transcript once they reach a final
    // decision. Earlier events are covered by the live request log, and the
    // closed transcript contains the complete audit anyway.
    if (!['approved', 'rejected', 'cancelled'].includes(built.request.status)) return null;
    const ctx = supportContext(db, 'cashier');
    const existing = db
      .prepare('SELECT id, revision, message_id FROM cashier_transcripts WHERE request_id = ?')
      .get(input.requestId) as { id: string; revision: number; message_id: string | null } | undefined;
    const id = existing?.id ?? newId('ctr');
    const now = nowIso();
    let revision = 1;
    if (existing) {
      const result = db
        .prepare(
          `UPDATE cashier_transcripts
              SET content = ?, filename = ?, guild_id = ?, channel_id = ?,
                  revision = revision + 1, status = 'queued', error = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          built.content,
          built.filename,
          ctx?.guildId ?? null,
          ctx?.transcriptChannelId ?? null,
          now,
          id,
        );
      revision = result.changes === 1 ? existing.revision + 1 : existing.revision;
    } else {
      db.prepare(
        `INSERT INTO cashier_transcripts
           (id, request_id, reference, content, filename, guild_id, channel_id, revision, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'queued', ?, ?)`,
      ).run(
        id,
        input.requestId,
        built.request.reference,
        built.content,
        built.filename,
        ctx?.guildId ?? null,
        ctx?.transcriptChannelId ?? null,
        now,
        now,
      );
    }

    if (ctx) {
      safeQueue(db, {
        guildId: ctx.guildId,
        eventType: 'cashier_transcript',
        dedupeKey: `cashier-transcript:${id}:${revision}:${input.eventKey}`,
        payload: {
          transcriptId: id,
          reference: built.request.reference,
          channelId: ctx.transcriptChannelId,
        },
      });
      db.prepare("UPDATE cashier_transcripts SET status = 'queued' WHERE id = ?").run(id);
    }
    return id;
  } catch (error) {
    console.warn('[cashier] could not queue transcript:', error instanceof Error ? error.message : error);
    return null;
  }
}

export interface TicketTranscriptForBot {
  id: string;
  reference: string;
  kind: 'closed' | 'reopened' | 'manual';
  content: string;
  filename: string;
  channelId: string | null;
  messageId: string | null;
  createdAt: string;
  subject: string;
  requesterName: string;
  assigneeName: string | null;
  status: string;
  priority: string;
  category: string;
  closedAt: string | null;
  url: string;
}

export function getTicketTranscriptForBot(db: DB, id: string): TicketTranscriptForBot | null {
  const row = db
    .prepare(
      `SELECT tr.id, tr.reference, tr.kind, tr.content, tr.filename, tr.channel_id, tr.message_id,
              tr.created_at, t.subject, t.status, t.priority, t.closed_at,
              c.label AS category, req.username AS requester_name, ag.username AS assignee_name
         FROM ticket_transcripts tr
         JOIN tickets t ON t.id = tr.ticket_id
         JOIN support_categories c ON c.key = t.category
         JOIN users req ON req.id = t.user_id
         LEFT JOIN users ag ON ag.id = t.assignee_id
        WHERE tr.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        reference: string;
        kind: 'closed' | 'reopened' | 'manual';
        content: string;
        filename: string;
        channel_id: string | null;
        message_id: string | null;
        created_at: string;
        subject: string;
        status: string;
        priority: string;
        closed_at: string | null;
        category: string;
        requester_name: string;
        assignee_name: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    content: row.content,
    filename: row.filename,
    channelId: row.channel_id,
    messageId: row.message_id,
    createdAt: row.created_at,
    subject: row.subject,
    requesterName: row.requester_name,
    assigneeName: row.assignee_name,
    status: row.status,
    priority: row.priority,
    category: row.category,
    closedAt: row.closed_at,
    url: `/transcripts/ticket/${encodeURIComponent(row.reference)}`,
  };
}

export interface CashierTranscriptForBot {
  id: string;
  reference: string;
  content: string;
  filename: string;
  channelId: string | null;
  messageId: string | null;
  revision: number;
  updatedAt: string;
  requesterName: string;
  reviewerName: string | null;
  kind: CashierRequestKind;
  amount: number;
  status: CashierRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  url: string;
}

export function getCashierTranscriptForBot(db: DB, id: string): CashierTranscriptForBot | null {
  const row = db
    .prepare(
      `SELECT tr.id, tr.reference, tr.content, tr.filename, tr.channel_id, tr.message_id,
              tr.revision, tr.updated_at,
              r.kind, r.amount, r.status, r.created_at, r.decided_at,
              req.username AS requester_name, rev.username AS reviewer_name
         FROM cashier_transcripts tr
         JOIN cashier_requests r ON r.id = tr.request_id
         JOIN users req ON req.id = r.user_id
         LEFT JOIN users rev ON rev.id = r.reviewer_id
        WHERE tr.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        reference: string;
        content: string;
        filename: string;
        channel_id: string | null;
        message_id: string | null;
        revision: number;
        updated_at: string;
        kind: CashierRequestKind;
        amount: number;
        status: CashierRequestStatus;
        created_at: string;
        decided_at: string | null;
        requester_name: string;
        reviewer_name: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    content: row.content,
    filename: row.filename,
    channelId: row.channel_id,
    messageId: row.message_id,
    revision: row.revision,
    updatedAt: row.updated_at,
    requesterName: row.requester_name,
    reviewerName: row.reviewer_name,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    url: `/transcripts/cashier/${encodeURIComponent(row.reference)}`,
  };
}

export function markTicketTranscriptSent(db: DB, id: string, messageId: string | null): void {
  db.prepare(
    `UPDATE ticket_transcripts
        SET status = 'sent', message_id = COALESCE(?, message_id), sent_at = ?
      WHERE id = ?`,
  ).run(messageId, nowIso(), id);
}

export function markCashierTranscriptSent(db: DB, id: string, messageId: string | null): void {
  db.prepare(
    `UPDATE cashier_transcripts
        SET status = 'sent', message_id = COALESCE(?, message_id), sent_at = ?
      WHERE id = ?`,
  ).run(messageId, nowIso(), id);
}

/**
 * Recovers transcripts whose outbox insert was interrupted. It is safe to call
 * repeatedly: an existing outbox row with the same dedupe key blocks duplicates.
 */
export function flushPendingSupportTranscripts(db: DB): void {
  try {
    const tickets = db
      .prepare(
        `SELECT id, reference, channel_id FROM ticket_transcripts
          WHERE status = 'queued' AND kind = 'closed' ORDER BY created_at ASC LIMIT 25`,
      )
      .all() as { id: string; reference: string; channel_id: string | null }[];
    const ticketCtx = supportContext(db, 'ticket');
    if (ticketCtx) {
      const queued = db.prepare('SELECT 1 FROM discord_outbox WHERE dedupe_key = ?');
      for (const row of tickets) {
        if (queued.get(`ticket-transcript:${row.id}`)) continue;
        db.prepare('UPDATE ticket_transcripts SET guild_id = ?, channel_id = ? WHERE id = ?').run(
          ticketCtx.guildId,
          ticketCtx.transcriptChannelId,
          row.id,
        );
        safeQueue(db, {
          guildId: ticketCtx.guildId,
          eventType: 'ticket_transcript',
          dedupeKey: `ticket-transcript:${row.id}`,
          payload: {
            transcriptId: row.id,
            reference: row.reference,
            channelId: ticketCtx.transcriptChannelId,
          },
        });
      }
    }

    const cashierCtx = supportContext(db, 'cashier');
    if (!cashierCtx) return;
    const cashierRows = db
      .prepare(
        `SELECT tr.id, tr.reference, tr.revision FROM cashier_transcripts tr
           JOIN cashier_requests r ON r.id = tr.request_id
          WHERE tr.status = 'queued' AND r.status IN ('approved','rejected','cancelled')
          ORDER BY tr.updated_at ASC LIMIT 25`,
      )
      .all() as { id: string; reference: string; revision: number }[];
    for (const row of cashierRows) {
      const key = `cashier-transcript:${row.id}:${row.revision}:recovery`;
      if (db.prepare('SELECT 1 FROM discord_outbox WHERE dedupe_key = ?').get(key)) continue;
      db.prepare('UPDATE cashier_transcripts SET guild_id = ?, channel_id = ? WHERE id = ?').run(
        cashierCtx.guildId,
        cashierCtx.transcriptChannelId,
        row.id,
      );
      safeQueue(db, {
        guildId: cashierCtx.guildId,
        eventType: 'cashier_transcript',
        dedupeKey: key,
        payload: {
          transcriptId: row.id,
          reference: row.reference,
          channelId: cashierCtx.transcriptChannelId,
        },
      });
    }
  } catch (error) {
    console.warn('[transcripts] recovery tick failed:', error instanceof Error ? error.message : error);
  }
}
