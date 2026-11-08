import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { Permission, SessionUser, TicketStatus } from '../../shared/types.ts';
import { TICKET_STATUS_LABELS } from '../../shared/types.ts';
import {
  ApiError,
  badRequest,
  clientIp,
  conflict,
  forbidden,
  inTransaction,
  newId,
  nowIso,
  notFound,
} from '../lib/core.ts';
import { parse, pageQuerySchema, ticketPrioritySchema } from '../lib/validation.ts';
import { can, requireActive, requireAuth, requirePermission } from '../lib/permissions.ts';
import { recordAudit } from '../lib/audit.ts';
import { notify } from '../lib/notifications.ts';
import { ticketCreateLimiter } from '../lib/rate-limit.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import {
  addTicketEvent,
  addTicketMessage,
  assertCanViewTicket,
  assertTransition,
  buildTicketList,
  categoryLabel,
  generateTicketReference,
  getTicketDetail,
  isStaffRole,
  loadSupportCategories,
  markTicketRead,
  ticketCounts,
  touchTicket,
  type TicketRow,
} from '../lib/tickets.ts';
import { loadUser } from '../auth.ts';
import { queueTicketNotification, queueTicketTranscript } from '../lib/discord/support.ts';
import {
  markTicketSeenByRequester,
  queueTicketCreatedEmail,
  scheduleTicketReplyDigest,
} from '../lib/support-notifications.ts';

const createSchema = z.object({
  subject: z.string().trim().min(4, 'Use at least 4 characters.').max(140, 'Keep the subject under 140 characters.'),
  category: z.string().trim().min(1, 'Choose a category.'),
  // Priority is assigned from the category configured by Team DonutSpin. The
  // client cannot request a higher priority for its own ticket.
  description: z.string().trim().min(10, 'Describe the issue in at least 10 characters.').max(8000),
});

const messageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message before sending.').max(5000, 'Messages are limited to 5,000 characters.'),
  visibility: z.enum(['public', 'internal']).optional(),
});

const statusSchema = z.object({
  status: z.enum(['new', 'open', 'in_progress', 'on_hold', 'waiting_user', 'resolved', 'closed', 'rejected']),
  reason: z.string().trim().max(500).optional(),
});

const assignSchema = z.object({ assigneeId: z.string().min(1).nullable(), reason: z.string().trim().max(500).optional() });

const prioritySchema = z.object({ priority: ticketPrioritySchema });

const listQuerySchema = pageQuerySchema.extend({
  scope: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  requesterId: z.string().optional(),
  q: z.string().trim().max(140).optional(),
  own: z.enum(['true', 'false']).optional(),
  sort: z.enum(['activity', 'created', 'priority']).optional(),
  direction: z.enum(['asc', 'desc']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function loadTicketByReference(db: DB, reference: string): TicketRow {
  const row = db.prepare('SELECT * FROM tickets WHERE reference = ?').get(reference) as TicketRow | undefined;
  if (!row) throw notFound('Ticket not found.');
  return row;
}

function getRequesterName(db: DB, userId: string): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  return row?.username ?? 'Unknown';
}

function userNotificationLink(db: DB, userId: string, reference: string): string {
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return user && user.role !== 'user' ? `/staff/tickets/${reference}` : `/tickets/${reference}`;
}

function notifyStaff(
  db: DB,
  input: { title: string; body: string; link: string; actorId: string | null; excludeUserId?: string },
): void {
  const staff = db
    .prepare("SELECT id FROM users WHERE role <> 'user' AND status = 'active'")
    .all() as { id: string }[];
  for (const member of staff) {
    if (member.id === input.excludeUserId) continue;
    notify(db, {
      userId: member.id,
      type: 'ticket',
      title: input.title,
      body: input.body,
      link: input.link,
      actorId: input.actorId,
    });
  }
}

function ensureReason(reason: string | undefined, status: TicketStatus): void {
  if (['on_hold', 'rejected'].includes(status) && (!reason || reason.trim().length < 3)) {
    throw badRequest(`A reason is required when moving a ticket to ${TICKET_STATUS_LABELS[status]}.`, 'REASON_REQUIRED', {
      fields: { reason: 'Provide a short reason.' },
    });
  }
}

function applyStatusChange(
  db: DB,
  input: {
    ticket: TicketRow;
    actor: SessionUser;
    next: TicketStatus;
    reason?: string;
    ip?: string | null;
    source?: 'staff' | 'user_reply' | 'reopen';
  },
): void {
  const { ticket, actor, next } = input;
  if (ticket.status === next) return;
  if (next === 'rejected' && !can(actor.role, 'tickets.reject')) {
    throw forbidden('Your role cannot reject tickets.');
  }
  const now = nowIso();
  const reason = input.reason?.trim() || null;
  const updated = db
    .prepare(
      `UPDATE tickets SET status = ?, hold_reason = ?, rejection_reason = ?, closed_at = ?, updated_at = ?, last_activity_at = ?
       WHERE id = ? AND status = ?`,
    )
    .run(
      next,
      next === 'on_hold' ? reason : null,
      next === 'rejected' ? reason : ticket.rejection_reason,
      next === 'closed' ? now : null,
      now,
      now,
      ticket.id,
      ticket.status,
    );
  if (updated.changes !== 1) {
    throw conflict('Another staff member changed this ticket first. Refresh and try again.', 'TICKET_CHANGED');
  }
  const eventType =
    next === 'rejected' ? 'rejected' : next === 'on_hold' ? 'hold' : ticket.status === 'closed' ? 'reopened' : 'status';
  const eventId = addTicketEvent(db, {
    ticketId: ticket.id,
    actorId: actor.id,
    type: eventType,
    fromValue: ticket.status,
    toValue: next,
    note: reason,
  });
  if (['on_hold', 'rejected', 'closed', 'resolved', 'waiting_user', 'open'].includes(next)) {
    addTicketMessage(db, {
      ticketId: ticket.id,
      authorId: null,
      authorRole: 'system',
      visibility: 'system',
      body:
        `Ticket moved to ${TICKET_STATUS_LABELS[next].toLowerCase()}` +
        (reason ? `. Reason: ${reason}` : '.'),
    });
  }
  const requesterLink = `/tickets/${ticket.reference}`;
  notify(db, {
    userId: ticket.user_id,
    type: 'ticket_status',
    title: `Ticket ${ticket.reference} — ${TICKET_STATUS_LABELS[next]}`,
    body: reason
      ? `Your ticket is now ${TICKET_STATUS_LABELS[next].toLowerCase()}. Reason: ${reason}`
      : `Your ticket is now ${TICKET_STATUS_LABELS[next].toLowerCase()}.`,
    link: requesterLink,
    actorId: actor.id,
  });
  recordAudit(db, {
    actorId: actor.id,
    action: 'ticket.status',
    targetType: 'ticket',
    targetId: ticket.id,
    targetLabel: ticket.reference,
    reason,
    metadata: { from: ticket.status, to: next, source: input.source ?? 'staff' },
    ip: input.ip ?? null,
  });
  // A ticket produces exactly one Discord transcript embed, when it closes.
  // Reopening and later closure produce no additional transcript messages.
  if (next === 'closed') {
    queueTicketTranscript(db, {
      ticketId: ticket.id,
      kind: 'closed',
      eventId,
      actorId: actor.id,
      note: reason,
    });
  }
}

function assertStaffEligible(db: DB, assigneeId: string): { id: string; username: string; role: string; status: string } {
  const target = db
    .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
    .get(assigneeId) as { id: string; username: string; role: string; status: string } | undefined;
  if (!target) throw badRequest('Choose an existing staff member.', 'INVALID_ASSIGNEE');
  if (target.role === 'user') throw badRequest('Tickets can only be assigned to staff.', 'INVALID_ASSIGNEE');
  if (target.status === 'suspended') throw badRequest('That staff account is suspended.', 'INVALID_ASSIGNEE');
  return target;
}

export function createTicketsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    const query = parse(listQuerySchema, req.query);
    const ownOnly = query.own === 'true';
    const { items, total } = buildTicketList(db, user, {
      ownOnly,
      scope: query.scope,
      status: query.status,
      category: query.category,
      priority: query.priority,
      assigneeId: query.assigneeId,
      requesterId: query.requesterId,
      search: query.q,
      sort: query.sort,
      direction: query.direction,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: ticketCounts(db, user, { ownOnly }),
    });
  });

  router.get('/categories', (req, res) => {
    requireAuth(req);
    res.json({ categories: loadSupportCategories(db, true) });
  });

  router.post('/', (req, res) => {
    const user = requireActive(req);
    requirePermission(req, 'tickets.create');
    const limit = ticketCreateLimiter.consume(user.id);
    if (!limit.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'You have created several tickets recently. Please wait before opening another.');
    }
    const body = parse(createSchema, req.body);
    assertNotInMaintenance(db);
    if (body.category === 'credit_request') {
      throw badRequest(
        'Money requests are handled in the Cashier. Open a cashier request instead of a support ticket.',
        'USE_CASHIER',
        { fields: { category: 'Use the Cashier for every money request.' } },
      );
    }
    if (body.category === 'giveaway_claim') {
      throw badRequest(
        'Open a claim from the Giveaways page so the win can be verified automatically.',
        'USE_GIVEAWAY_CLAIM',
        { fields: { category: 'Use the Claim prize button on the Giveaways page.' } },
      );
    }
    if (body.category === 'giveaway_sponsorship') {
      throw badRequest(
        'Sponsorship requests are created from the Giveaways page.',
        'USE_GIVEAWAY_SPONSORSHIP',
        { fields: { category: 'Use the Sponsor a giveaway form on the Giveaways page.' } },
      );
    }
    const categories = loadSupportCategories(db, true);
    const category = categories.find((entry) => entry.key === body.category);
    if (!category) {
      throw badRequest('Choose an available ticket category.', 'INVALID_CATEGORY', {
        fields: { category: 'That category is not available.' },
      });
    }

    const ticketId = newId('tkt');
    const createdAt = nowIso();
    const reference = inTransaction(db, () => {
      const ref = generateTicketReference(db);
      const now = createdAt;
      db.prepare(
        `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      ).run(ticketId, ref, user.id, body.subject, body.description, category.key, category.defaultPriority, now, now, now);
      addTicketEvent(db, { ticketId, actorId: user.id, type: 'created', toValue: 'new' });
      notify(db, {
        userId: user.id,
        type: 'ticket',
        title: `Ticket ${ref} received`,
        body: 'Your request is in the queue. You can follow its progress from My tickets.',
        link: `/tickets/${ref}`,
      });
      notifyStaff(db, {
        title: `New ticket ${ref}`,
        body: `${body.subject} — ${category.label}`,
        link: `/staff/tickets/${ref}`,
        actorId: user.id,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'ticket.create',
        targetType: 'ticket',
        targetId: ticketId,
        targetLabel: ref,
        metadata: { category: category.key },
        ip: clientIp(req),
      });
      return ref;
    });

    queueTicketCreatedEmail(db, {
      userId: user.id,
      email: user.email,
      username: user.username,
      ticketId,
      reference,
      subject: body.subject,
      category: category.label,
      createdAt,
    });
    queueTicketNotification(db, {
      kind: 'created',
      ticketId,
      reference,
      subject: body.subject,
      requester: user.username,
      category: category.label,
      priority: category.defaultPriority,
      status: 'new',
      preview: body.description.slice(0, 300),
    });

    res.status(201).json({ ticket: getTicketDetail(db, user, reference) });
  });

  router.get('/:reference', (req, res) => {
    const user = requireAuth(req);
    const detail = getTicketDetail(db, user, req.params.reference ?? '');
    markTicketRead(db, detail.id, user.id);
    markTicketSeenByRequester(db, detail.id, user.id);
    res.json({ ticket: detail });
  });

  router.post('/:reference/messages', (req, res) => {
    const user = requireAuth(req);
    const body = parse(messageSchema, req.body);
    const ticket = loadTicketByReference(db, req.params.reference ?? '');
    assertCanViewTicket(user, ticket.user_id);
    const staff = isStaffRole(user.role);
    if (staff) requirePermission(req, 'tickets.reply');
    if (body.visibility === 'internal' && (!staff || !can(user.role, 'tickets.note'))) {
      throw forbidden('Internal notes are restricted to staff.');
    }
    if (['closed', 'rejected'].includes(ticket.status) && !staff) {
      throw badRequest('This ticket is closed. Open a new ticket if you need more help.', 'TICKET_CLOSED');
    }
    if (['closed', 'rejected'].includes(ticket.status) && staff) {
      throw badRequest('Reopen this ticket before replying.', 'TICKET_CLOSED');
    }

    const internal = body.visibility === 'internal';
    let messageId = '';
    let replyStatus = ticket.status;

    inTransaction(db, () => {
      messageId = addTicketMessage(db, {
        ticketId: ticket.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: internal ? 'internal' : 'public',
        body: body.body,
      });
      touchTicket(db, ticket.id);
      if (internal) {
        addTicketEvent(db, { ticketId: ticket.id, actorId: user.id, type: 'internal_note' });
        recordAudit(db, {
          actorId: user.id,
          action: 'ticket.internal_note',
          targetType: 'ticket',
          targetId: ticket.id,
          targetLabel: ticket.reference,
          ip: clientIp(req),
        });
      } else if (staff) {
        const from = ticket.status;
        const next: TicketStatus | null =
          from === 'new' || from === 'waiting_user' ? 'in_progress' : from === 'on_hold' ? 'open' : null;
        scheduleTicketReplyDigest(db, {
          ticketId: ticket.id,
          userId: ticket.user_id,
          messageId,
          authorName: user.username,
          authorRole: user.role,
          body: body.body,
        });
        if (next) {
          db.prepare('UPDATE tickets SET status = ?, hold_reason = NULL WHERE id = ?').run(next, ticket.id);
          addTicketEvent(db, {
            ticketId: ticket.id,
            actorId: user.id,
            type: 'status',
            fromValue: from,
            toValue: next,
            note: 'Staff replied',
          });
          notify(db, {
            userId: ticket.user_id,
            type: 'ticket_status',
            title: `Ticket ${ticket.reference} — ${TICKET_STATUS_LABELS[next]}`,
            body: 'A support agent replied to your ticket.',
            link: `/tickets/${ticket.reference}`,
            actorId: user.id,
          });
        } else {
          notify(db, {
            userId: ticket.user_id,
            type: 'ticket_reply',
            title: `New reply on ${ticket.reference}`,
            body: 'Support replied to your ticket.',
            link: `/tickets/${ticket.reference}`,
            actorId: user.id,
          });
        }
        recordAudit(db, {
          actorId: user.id,
          action: 'ticket.reply',
          targetType: 'ticket',
          targetId: ticket.id,
          targetLabel: ticket.reference,
          ip: clientIp(req),
        });
      } else {
        // Requester replied: waiting tickets return to the queue, resolved tickets reopen.
        if (ticket.status === 'waiting_user' || ticket.status === 'resolved') {
          const next: TicketStatus = 'open';
          replyStatus = next;
          db.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(next, nowIso(), ticket.id);
          addTicketEvent(db, {
            ticketId: ticket.id,
            actorId: user.id,
            type: 'status',
            fromValue: ticket.status,
            toValue: next,
            note: 'Requester replied',
          });
        }
        if (ticket.assignee_id) {
          notify(db, {
            userId: ticket.assignee_id,
            type: 'ticket_reply',
            title: `New reply on ${ticket.reference}`,
            body: `${user.username}: ${body.body.slice(0, 120)}`,
            link: `/staff/tickets/${ticket.reference}`,
            actorId: user.id,
          });
        } else {
          notifyStaff(db, {
            title: `Requester replied on ${ticket.reference}`,
            body: `${user.username}: ${body.body.slice(0, 120)}`,
            link: `/staff/tickets/${ticket.reference}`,
            actorId: user.id,
            excludeUserId: user.id,
          });
        }
      }
    });

    // The Discord #tickets channel is for the requester's side of the
    // conversation. Staff replies stay on the website so the channel does not
    // echo every internal answer; a new requester message is the signal the
    // support team needs to look at the ticket again.
    if (!staff) {
      queueTicketNotification(db, {
        kind: 'requester_reply',
        ticketId: ticket.id,
        messageId,
        reference: ticket.reference,
        subject: ticket.subject,
        requester: getRequesterName(db, ticket.user_id),
        category: categoryLabel(db, ticket.category),
        priority: ticket.priority,
        status: replyStatus,
        preview: body.body.slice(0, 300),
      });
    }

    markTicketRead(db, ticket.id, user.id);
    markTicketSeenByRequester(db, ticket.id, user.id);
    res.status(201).json({ ticket: getTicketDetail(db, user, ticket.reference) });
  });

  router.post('/:reference/status', (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, 'tickets.status');
    const body = parse(statusSchema, req.body);
    const ticket = loadTicketByReference(db, req.params.reference ?? '');
    assertTransition(ticket.status, body.status, { reject: can(user.role, 'tickets.reject') });
    ensureReason(body.reason, body.status);
    inTransaction(db, () => {
      applyStatusChange(db, { ticket, actor: user, next: body.status, reason: body.reason, ip: clientIp(req) });
    });
    res.json({ ticket: getTicketDetail(db, user, ticket.reference) });
  });

  router.post('/:reference/priority', (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, 'tickets.priority');
    const body = parse(prioritySchema, req.body);
    const ticket = loadTicketByReference(db, req.params.reference ?? '');
    if (ticket.priority === body.priority) throw badRequest('Priority is unchanged.', 'NO_CHANGE');
    inTransaction(db, () => {
      db.prepare('UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?').run(body.priority, nowIso(), ticket.id);
      addTicketEvent(db, {
        ticketId: ticket.id,
        actorId: user.id,
        type: 'priority',
        fromValue: ticket.priority,
        toValue: body.priority,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'ticket.priority',
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: ticket.reference,
        metadata: { from: ticket.priority, to: body.priority },
        ip: clientIp(req),
      });
    });
    res.json({ ticket: getTicketDetail(db, user, ticket.reference) });
  });

  router.post('/:reference/assign', (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, 'tickets.assign');
    const body = parse(assignSchema, req.body);
    const ticket = loadTicketByReference(db, req.params.reference ?? '');
    const assignee = body.assigneeId ? assertStaffEligible(db, body.assigneeId) : null;
    if (ticket.assignee_id === (assignee?.id ?? null)) {
      throw badRequest(assignee ? 'That agent already owns this ticket.' : 'This ticket is already unassigned.', 'NO_CHANGE');
    }
    inTransaction(db, () => {
      db.prepare('UPDATE tickets SET assignee_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ?').run(
        assignee?.id ?? null,
        nowIso(),
        nowIso(),
        ticket.id,
      );
      addTicketEvent(db, {
        ticketId: ticket.id,
        actorId: user.id,
        type: 'assignment',
        fromValue: ticket.assignee_id,
        toValue: assignee?.id ?? null,
        note: assignee ? `Assigned to ${assignee.username}` : 'Unassigned',
      });
      if (assignee) {
        notify(db, {
          userId: assignee.id,
          type: 'ticket_assignment',
          title: `Ticket ${ticket.reference} assigned to you`,
          body: ticket.subject,
          link: `/staff/tickets/${ticket.reference}`,
          actorId: user.id,
        });
      }
      if (ticket.assignee_id && ticket.assignee_id !== assignee?.id) {
        notify(db, {
          userId: ticket.assignee_id,
          type: 'ticket_assignment',
          title: `Ticket ${ticket.reference} reassigned`,
          body: assignee ? `Now owned by ${assignee.username}.` : 'The ticket is unassigned.',
          link: `/staff/tickets/${ticket.reference}`,
          actorId: user.id,
        });
      }
      recordAudit(db, {
        actorId: user.id,
        action: 'ticket.assign',
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: ticket.reference,
        reason: body.reason ?? null,
        metadata: { from: ticket.assignee_id, to: assignee?.id ?? null },
        ip: clientIp(req),
      });
    });
    res.json({ ticket: getTicketDetail(db, user, ticket.reference) });
  });

  router.post('/:reference/claim', (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, 'tickets.assign');
    if (user.role === 'user') throw forbidden();
    const ticket = loadTicketByReference(db, req.params.reference ?? '');
    const result = db
      .prepare('UPDATE tickets SET assignee_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ? AND assignee_id IS NULL')
      .run(user.id, nowIso(), nowIso(), ticket.id);
    if (result.changes !== 1) {
      throw conflict('This ticket was already claimed by another agent.', 'ALREADY_CLAIMED');
    }
    inTransaction(db, () => {
      addTicketEvent(db, {
        ticketId: ticket.id,
        actorId: user.id,
        type: 'assignment',
        fromValue: null,
        toValue: user.id,
        note: `Claimed by ${user.username}`,
      });
      recordAudit(db, {
        actorId: user.id,
        action: 'ticket.claim',
        targetType: 'ticket',
        targetId: ticket.id,
        targetLabel: ticket.reference,
        ip: clientIp(req),
      });
    });
    res.json({ ticket: getTicketDetail(db, user, ticket.reference) });
  });

  return router;
}

export function canAccessStaffWorkspace(user: SessionUser): boolean {
  return can(user.role, 'staff.access' as Permission);
}

export function loadTicketOrThrow(db: DB, reference: string): TicketRow {
  return loadTicketByReference(db, reference);
}

export function userPortfolio(db: DB, userId: string): ReturnType<typeof loadUser> {
  return loadUser(db, userId);
}
