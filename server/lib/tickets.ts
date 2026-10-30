import type { DB } from '../db/index.ts';
import {
  ACTIVE_TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_TRANSITIONS,
  type CreditRequest,
  type CreditRequestKind,
  type CreditRequestStatus,
  type Permission,
  type Role,
  type SessionUser,
  type SupportCategory,
  type TicketCounts,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
  type TicketMessageVisibility,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from '../../shared/types.ts';
import { badRequest, forbidden, newId, notFound, nowIso, parseJson } from './core.ts';
import { can } from './permissions.ts';

export interface TicketRow {
  id: string;
  reference: string;
  user_id: string;
  subject: string;
  description: string;
  category: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  hold_reason: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  closed_at: string | null;
  category_label?: string;
  requester_name?: string;
  assignee_name?: string | null;
  last_read_at?: string | null;
  last_public_message_at?: string | null;
  last_sender_role?: string | null;
  credit_request_id?: string | null;
}

export function generateTicketReference(db: DB): string {
  const year = new Date().getUTCFullYear();
  const name = `ticket_${year}`;
  const row = db
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(name) as { value: number };
  return `TKT-${year}-${String(row.value).padStart(6, '0')}`;
}

export function loadSupportCategories(db: DB, enabledOnly = false): SupportCategory[] {
  // The legacy money-request category stays in the database so historical
  // tickets can resolve it, but it is never offered for creation or editing.
  const rows = db
    .prepare(
      `SELECT key, label, description, enabled, default_priority, sort_order
       FROM support_categories
       WHERE key <> 'credit_request' ${enabledOnly ? 'AND enabled = 1' : ''}
       ORDER BY sort_order, label`,
    )
    .all() as {
    key: string;
    label: string;
    description: string;
    enabled: number;
    default_priority: TicketPriority;
    sort_order: number;
  }[];
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    enabled: Boolean(row.enabled),
    defaultPriority: row.default_priority,
    sortOrder: row.sort_order,
  }));
}

export function categoryLabel(db: DB, key: string): string {
  const row = db.prepare('SELECT label FROM support_categories WHERE key = ?').get(key) as { label: string } | undefined;
  return row?.label ?? key;
}

export function canViewAllTickets(user: SessionUser): boolean {
  return can(user.role, 'tickets.read_all');
}

export function assertCanViewTicket(user: SessionUser, ticketUserId: string): void {
  if (canViewAllTickets(user)) return;
  if (ticketUserId !== user.id) throw forbidden('This ticket belongs to another account.');
}

export function isStaffRole(role: Role): boolean {
  return role !== 'user';
}

const LIST_SELECT = `
  SELECT t.*, c.label AS category_label, req.username AS requester_name, ag.username AS assignee_name,
         r.last_read_at,
         (SELECT m.created_at FROM ticket_messages m
          WHERE m.ticket_id = t.id AND m.visibility = 'public'
          ORDER BY m.created_at DESC LIMIT 1) AS last_public_message_at,
         (SELECT m.author_role FROM ticket_messages m
          WHERE m.ticket_id = t.id AND m.visibility = 'public'
          ORDER BY m.created_at DESC LIMIT 1) AS last_sender_role,
         (SELECT cr.id FROM credit_requests cr WHERE cr.ticket_id = t.id) AS credit_request_id
  FROM tickets t
  JOIN support_categories c ON c.key = t.category
  JOIN users req ON req.id = t.user_id
  LEFT JOIN users ag ON ag.id = t.assignee_id
  LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = @viewerId
`;

export interface TicketListFilters {
  scope?: string;
  status?: string;
  category?: string;
  priority?: string;
  assigneeId?: string;
  requesterId?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: 'activity' | 'created' | 'priority';
  direction?: 'asc' | 'desc';
  ownOnly?: boolean;
  page: number;
  pageSize: number;
}

function scopeClause(scope: string | undefined, viewer: SessionUser, params: Record<string, unknown>): string | null {
  if (scope === 'mine' || scope === 'assigned') {
    params.mineId = viewer.id;
    return 't.assignee_id = @mineId';
  }
  if (scope === 'unassigned') return 't.assignee_id IS NULL';
  if (scope === 'open') return "t.status IN ('open','new','in_progress')";
  if (scope && ['new', 'in_progress', 'on_hold', 'waiting_user', 'resolved', 'closed', 'rejected'].includes(scope)) {
    params.scopeStatus = scope;
    return 't.status = @scopeStatus';
  }
  return null;
}

export function buildTicketList(
  db: DB,
  viewer: SessionUser,
  filters: TicketListFilters,
): { items: TicketSummary[]; total: number } {
  const params: Record<string, unknown> = { viewerId: viewer.id };
  const clauses: string[] = [];
  if (filters.ownOnly || !canViewAllTickets(viewer)) {
    params.ownerId = viewer.id;
    clauses.push('t.user_id = @ownerId');
  }
  const scoped = scopeClause(filters.scope, viewer, params);
  if (scoped) clauses.push(scoped);
  if (filters.status && filters.status !== 'all') {
    params.status = filters.status;
    clauses.push('t.status = @status');
  }
  if (filters.category) {
    params.category = filters.category;
    clauses.push('t.category = @category');
  }
  if (filters.priority) {
    params.priority = filters.priority;
    clauses.push('t.priority = @priority');
  }
  if (filters.assigneeId) {
    params.assigneeId = filters.assigneeId;
    clauses.push('t.assignee_id = @assigneeId');
  }
  if (filters.requesterId) {
    params.requesterId = filters.requesterId;
    clauses.push('t.user_id = @requesterId');
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    clauses.push('(t.reference LIKE @search OR t.subject LIKE @search OR req.username LIKE @search)');
  }
  if (filters.from) {
    params.from = filters.from;
    clauses.push('t.created_at >= @from');
  }
  if (filters.to) {
    params.to = filters.to;
    clauses.push('t.created_at <= @to');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const direction = filters.direction === 'asc' ? 'ASC' : 'DESC';
  const orderBy =
    filters.sort === 'created'
      ? `t.created_at ${direction}`
      : filters.sort === 'priority'
        ? `CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END ${direction}, t.last_activity_at DESC`
        : `t.last_activity_at ${direction}`;

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM (${LIST_SELECT.replace('@viewerId', '@viewerId')} ${where})`).get(params) as
    | { count: number }
    | undefined;
  const rows = db
    .prepare(`${LIST_SELECT} ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize }) as TicketRow[];

  return { items: rows.map((row) => mapTicketSummary(row, viewer)), total: totalRow?.count ?? 0 };
}

function unreadFor(row: TicketRow, viewer: SessionUser): boolean {
  if (!row.last_public_message_at) return false;
  if (!row.last_read_at) return row.last_sender_role !== viewer.role && row.last_sender_role !== null;
  if (row.last_public_message_at <= row.last_read_at) return false;
  if (canViewAllTickets(viewer)) return row.last_sender_role === 'user';
  return row.last_sender_role !== 'user';
}

export function mapTicketSummary(row: TicketRow, viewer: SessionUser): TicketSummary {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    category: row.category,
    categoryLabel: row.category_label ?? row.category,
    status: row.status,
    priority: row.priority,
    requester: { id: row.user_id, username: row.requester_name ?? 'Unknown' },
    assignee: row.assignee_id ? { id: row.assignee_id, username: row.assignee_name ?? 'Unknown' } : null,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    unread: unreadFor(row, viewer),
    hasArchivedMoneyRequest: Boolean(row.credit_request_id),
  };
}

export function ticketCounts(db: DB, viewer: SessionUser, options?: { ownOnly?: boolean }): TicketCounts {
  const params: Record<string, unknown> = { viewerId: viewer.id };
  let scope = '';
  if (options?.ownOnly || !canViewAllTickets(viewer)) {
    params.ownerId = viewer.id;
    scope = 'WHERE t.user_id = @ownerId';
  }
  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN t.status = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN t.assignee_id IS NULL AND t.status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned_count,
        SUM(CASE WHEN t.assignee_id = @viewerId AND t.status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS assigned_count,
        SUM(CASE WHEN t.status IN ('new','open','in_progress') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold_count,
        SUM(CASE WHEN t.status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
        SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
       FROM tickets t ${scope}`,
    )
    .get(params) as Record<string, number | null>;
  return {
    all: row.all_count ?? 0,
    new: row.new_count ?? 0,
    unassigned: row.unassigned_count ?? 0,
    assignedToMe: row.assigned_count ?? 0,
    open: row.open_count ?? 0,
    inProgress: row.in_progress_count ?? 0,
    onHold: row.on_hold_count ?? 0,
    waitingUser: row.waiting_count ?? 0,
    resolved: row.resolved_count ?? 0,
    closed: row.closed_count ?? 0,
    rejected: row.rejected_count ?? 0,
  };
}

interface MessageRow {
  id: string;
  author_id: string | null;
  author_role: string;
  visibility: TicketMessageVisibility;
  body: string;
  created_at: string;
  author_name: string | null;
}

interface EventRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
}

interface CreditRequestRow {
  id: string;
  kind: CreditRequestKind;
  amount: number;
  status: CreditRequestStatus;
  user_id: string;
  requester_name: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  ledger_id: string | null;
  created_at: string;
}

export function mapCreditRequest(row: CreditRequestRow): CreditRequest {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    requesterId: row.user_id,
    requesterName: row.requester_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    ledgerId: row.ledger_id,
    createdAt: row.created_at,
  };
}

export function getTicketDetail(db: DB, viewer: SessionUser, reference: string): TicketDetail {
  const ticket = db
    .prepare(
      `SELECT t.*, c.label AS category_label, req.username AS requester_name, req.email AS requester_email,
              req.created_at AS requester_created_at, req.status AS requester_status,
              w.balance AS requester_balance,
              ag.username AS assignee_name
       FROM tickets t
       JOIN support_categories c ON c.key = t.category
       JOIN users req ON req.id = t.user_id
       JOIN wallets w ON w.user_id = req.id
       LEFT JOIN users ag ON ag.id = t.assignee_id
       WHERE t.reference = ?`,
    )
    .get(reference) as
    | (TicketRow & {
        requester_email: string;
        requester_created_at: string;
        requester_status: string;
        requester_balance: number;
      })
    | undefined;
  if (!ticket) throw notFound('Ticket not found.');
  assertCanViewTicket(viewer, ticket.user_id);

  const staff = canViewAllTickets(viewer);
  const canSeeInternal = staff && can(viewer.role, 'tickets.note');

  const messages = (
    db
      .prepare(
        `SELECT m.id, m.author_id, m.author_role, m.visibility, m.body, m.created_at, u.username AS author_name
         FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.ticket_id = ? ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(ticket.id) as MessageRow[]
  )
    .filter((row) => canSeeInternal || row.visibility !== 'internal')
    .map<TicketMessage>((row) => ({
      id: row.id,
      authorId: row.author_id,
      authorName: row.author_role === 'system' ? 'Donutcash' : (row.author_name ?? 'Deleted user'),
      authorRole: (row.author_role as Role | 'system') ?? 'system',
      visibility: row.visibility,
      body: row.body,
      createdAt: row.created_at,
    }));

  const events = (
    db
      .prepare(
        `SELECT e.id, e.actor_id, u.username AS actor_name, e.type, e.from_value, e.to_value, e.note, e.created_at
         FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.ticket_id = ? ORDER BY e.created_at ASC, e.rowid ASC`,
      )
      .all(ticket.id) as EventRow[]
  )
    .filter((event) => staff || ['status', 'priority', 'reopened', 'rejected', 'hold'].includes(event.type))
    .map<TicketEvent>((event) => ({
      id: event.id,
      actorName: event.actor_id ? (event.actor_name ?? 'Deleted user') : 'System',
      type: event.type,
      fromValue: event.from_value,
      toValue: event.to_value,
      note: event.note,
      createdAt: event.created_at,
    }));

  const creditRow = db
    .prepare(
      `SELECT cr.*, req.username AS requester_name, rev.username AS reviewer_name
       FROM credit_requests cr
       JOIN users req ON req.id = cr.user_id
       LEFT JOIN users rev ON rev.id = cr.reviewer_id
       WHERE cr.ticket_id = ?`,
    )
    .get(ticket.id) as CreditRequestRow | undefined;

  const allowedTransitions = can(viewer.role, 'tickets.status')
    ? TICKET_TRANSITIONS[ticket.status].filter((next) => next !== 'rejected' || can(viewer.role, 'tickets.reject'))
    : [];

  const userCanReply = ticket.user_id === viewer.id && !['closed', 'rejected'].includes(ticket.status);
  const staffCanReply = staff && can(viewer.role, 'tickets.reply') && !['closed', 'rejected'].includes(ticket.status);

  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    categoryLabel: ticket.category_label ?? ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    requester: {
      id: ticket.user_id,
      username: ticket.requester_name ?? 'Unknown',
      ...(staff
        ? {
            email: ticket.requester_email,
            createdAt: ticket.requester_created_at,
            status: ticket.requester_status as SessionUser['status'],
            balance: ticket.requester_balance,
          }
        : {}),
    },
    assignee: ticket.assignee_id
      ? { id: ticket.assignee_id, username: ticket.assignee_name ?? 'Unknown' }
      : null,
    holdReason: ticket.hold_reason,
    rejectionReason: ticket.rejection_reason,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    lastActivityAt: ticket.last_activity_at,
    closedAt: ticket.closed_at,
    messages,
    events,
    creditRequest: creditRow ? mapCreditRequest(creditRow) : null,
    allowedTransitions,
    canReply: userCanReply || staffCanReply,
    canNote: staff && can(viewer.role, 'tickets.note'),
    canAssign: staff && can(viewer.role, 'tickets.assign'),
  };
}

export function addTicketEvent(
  db: DB,
  input: {
    ticketId: string;
    actorId: string | null;
    type: string;
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO ticket_events (id, ticket_id, actor_id, type, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('tev'),
    input.ticketId,
    input.actorId,
    input.type,
    input.fromValue ?? null,
    input.toValue ?? null,
    input.note ?? null,
    nowIso(),
  );
}

export function addTicketMessage(
  db: DB,
  input: {
    ticketId: string;
    authorId: string | null;
    authorRole: string;
    visibility: TicketMessageVisibility;
    body: string;
    createdAt?: string;
  },
): string {
  const id = newId('tmsg');
  db.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, visibility, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.ticketId, input.authorId, input.authorRole, input.visibility, input.body, input.createdAt ?? nowIso());
  return id;
}

export function touchTicket(db: DB, ticketId: string, at = nowIso()): void {
  db.prepare('UPDATE tickets SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(at, at, ticketId);
}

export function assertTransition(from: TicketStatus, to: TicketStatus, permissions: { reject: boolean }): void {
  if (from === to) throw badRequest(`Ticket is already ${TICKET_STATUS_LABELS[to].toLowerCase()}.`, 'NO_STATUS_CHANGE');
  if (!TICKET_TRANSITIONS[from].includes(to)) {
    throw badRequest(`Cannot move a ticket from ${TICKET_STATUS_LABELS[from]} to ${TICKET_STATUS_LABELS[to]}.`, 'INVALID_TRANSITION');
  }
  if (to === 'rejected' && !permissions.reject) {
    throw forbidden('Your role cannot reject tickets.', 'FORBIDDEN');
  }
}

export function markTicketRead(db: DB, ticketId: string, userId: string): void {
  db.prepare(
    `INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
  ).run(ticketId, userId, nowIso());
}

export const ACTIVE_STATUSES = ACTIVE_TICKET_STATUSES;
