import type { DB } from '../db/index.ts';
import type {
  CashierRequestKind,
  CashierRequestStatus,
  SessionUser,
  TicketEvent,
  TicketPriority,
  TicketStatus,
  TranscriptDetail,
  TranscriptKind,
  TranscriptSummary,
} from '../../shared/types.ts';
import { forbidden } from './core.ts';
import { can } from './permissions.ts';
import { canManageCashier, getCashierDetail } from './cashier.ts';
import { canViewAllTickets, getTicketDetail } from './tickets.ts';

export interface TranscriptFilters {
  scope: 'own' | 'all';
  kind?: TranscriptKind;
  search?: string;
  page: number;
  pageSize: number;
}

interface TicketTranscriptListRow {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  user_id: string;
  assignee_id: string | null;
  created_at: string;
  closed_at: string | null;
  updated_at: string;
  category_label: string;
  requester_name: string;
  assignee_name: string | null;
  message_count: number;
}

interface CashierTranscriptListRow {
  id: string;
  reference: string;
  kind: CashierRequestKind;
  amount: number;
  status: CashierRequestStatus;
  user_id: string;
  reviewer_id: string | null;
  created_at: string;
  decided_at: string | null;
  updated_at: string;
  requester_name: string;
  reviewer_name: string | null;
  message_count: number;
}

const MAX_LIST_ROWS = 500;

function cashierKindLabel(kind: CashierRequestKind): string {
  return kind === 'deposit' ? 'Deposit' : 'Withdrawal';
}

function ticketRowToSummary(row: TicketTranscriptListRow): TranscriptSummary {
  return {
    kind: 'ticket',
    id: row.id,
    reference: row.reference,
    title: row.subject,
    categoryLabel: row.category_label,
    status: row.status,
    priority: row.priority,
    amount: null,
    requester: { id: row.user_id, username: row.requester_name },
    assignee: row.assignee_name,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? row.updated_at,
    messageCount: row.message_count,
  };
}

function cashierRowToSummary(row: CashierTranscriptListRow): TranscriptSummary {
  return {
    kind: 'cashier',
    id: row.id,
    reference: row.reference,
    title: `${cashierKindLabel(row.kind)} request`,
    categoryLabel: 'Cashier request',
    status: row.status,
    priority: null,
    amount: row.amount,
    requester: { id: row.user_id, username: row.requester_name },
    assignee: row.reviewer_name,
    createdAt: row.created_at,
    closedAt: row.decided_at ?? row.updated_at,
    messageCount: row.message_count,
  };
}

/**
 * Lists completed conversations the viewer may read. Players only ever see
 * rows they own; staff see every permitted row. Cashier transcripts follow the
 * existing cashier permissions, so support agents without credits.adjust only
 * receive ticket transcripts.
 */
export function buildTranscriptList(
  db: DB,
  viewer: SessionUser,
  filters: TranscriptFilters,
): { items: TranscriptSummary[]; total: number; page: number; pageSize: number; totalPages: number; canViewAll: boolean } {
  const all = filters.scope === 'all';
  if (all && !canViewAllTickets(viewer) && !canManageCashier(viewer)) {
    throw forbidden('Your role cannot view every transcript.');
  }

  const params: Record<string, unknown> = { limit: MAX_LIST_ROWS };
  const ticketClauses = ["t.status IN ('closed','rejected')"];
  const cashierClauses = ["r.status IN ('approved','rejected','cancelled')"];
  if (!all) {
    params.viewerId = viewer.id;
    ticketClauses.push('t.user_id = @viewerId');
    cashierClauses.push('r.user_id = @viewerId');
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    ticketClauses.push(
      '(t.reference LIKE @search OR t.subject LIKE @search OR req.username LIKE @search)',
    );
    cashierClauses.push('(r.reference LIKE @search OR u.username LIKE @search)');
  }

  const items: TranscriptSummary[] = [];

  const wantsTickets = filters.kind !== 'cashier' && (!all || canViewAllTickets(viewer));
  if (wantsTickets) {
    const rows = db
      .prepare(
        `SELECT t.id, t.reference, t.subject, t.status, t.priority, t.user_id, t.assignee_id,
                t.created_at, t.closed_at, t.updated_at,
                c.label AS category_label, req.username AS requester_name,
                ag.username AS assignee_name,
                (SELECT COUNT(*) FROM ticket_messages m
                  WHERE m.ticket_id = t.id AND m.visibility <> 'internal') AS message_count
           FROM tickets t
           JOIN support_categories c ON c.key = t.category
           JOIN users req ON req.id = t.user_id
           LEFT JOIN users ag ON ag.id = t.assignee_id
          WHERE ${ticketClauses.join(' AND ')}
          ORDER BY COALESCE(t.closed_at, t.updated_at) DESC
          LIMIT @limit`,
      )
      .all(params) as TicketTranscriptListRow[];
    items.push(...rows.map(ticketRowToSummary));
  }

  const wantsCashier = filters.kind !== 'ticket' && (!all || canManageCashier(viewer));
  if (wantsCashier) {
    const rows = db
      .prepare(
        `SELECT r.id, r.reference, r.kind, r.amount, r.status, r.user_id, r.reviewer_id,
                r.created_at, r.decided_at, r.updated_at,
                u.username AS requester_name, rev.username AS reviewer_name,
                (SELECT COUNT(*) FROM cashier_messages m
                  WHERE m.request_id = r.id AND m.visibility <> 'internal') AS message_count
           FROM cashier_requests r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN users rev ON rev.id = r.reviewer_id
          WHERE ${cashierClauses.join(' AND ')}
          ORDER BY COALESCE(r.decided_at, r.updated_at) DESC
          LIMIT @limit`,
      )
      .all(params) as CashierTranscriptListRow[];
    items.push(...rows.map(cashierRowToSummary));
  }

  items.sort((left, right) => {
    const a = new Date(left.closedAt ?? left.createdAt).getTime();
    const b = new Date(right.closedAt ?? right.createdAt).getTime();
    return b - a;
  });

  const total = items.length;
  const start = (filters.page - 1) * filters.pageSize;
  return {
    items: items.slice(start, start + filters.pageSize),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    canViewAll: all,
  };
}

interface CashierEventRow {
  id: string;
  type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
  actor_name: string | null;
}

export function getTranscriptDetail(db: DB, viewer: SessionUser, kind: TranscriptKind, reference: string): TranscriptDetail {
  if (kind === 'ticket') {
    const detail = getTicketDetail(db, viewer, reference);
    return {
      kind: 'ticket',
      id: detail.id,
      reference: detail.reference,
      title: detail.subject,
      categoryLabel: detail.categoryLabel,
      status: detail.status,
      priority: detail.priority,
      amount: detail.creditRequest?.amount ?? null,
      requester: { id: detail.requester.id, username: detail.requester.username },
      assignee: detail.assignee?.username ?? null,
      createdAt: detail.createdAt,
      closedAt: detail.closedAt,
      messageCount: detail.messages.filter((message) => message.visibility !== 'internal').length,
      description: detail.description,
      messages: detail.messages,
      events: detail.events,
      canSeeInternalNotes: detail.canNote,
    };
  }

  const detail = getCashierDetail(db, viewer, reference);
  const events = db
    .prepare(
      `SELECT e.id, e.type, e.from_value, e.to_value, e.note, e.created_at,
              u.username AS actor_name
         FROM cashier_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.request_id = ? ORDER BY e.created_at ASC, e.rowid ASC`,
    )
    .all(detail.id) as CashierEventRow[];

  return {
    kind: 'cashier',
    id: detail.id,
    reference: detail.reference,
    title: `${cashierKindLabel(detail.kind)} request`,
    categoryLabel: 'Cashier request',
    status: detail.status,
    priority: null,
    amount: detail.amount,
    requester: { id: detail.requester.id, username: detail.requester.username },
    assignee: detail.reviewer?.username ?? null,
    createdAt: detail.createdAt,
    closedAt: detail.decidedAt ?? detail.updatedAt,
    messageCount: detail.messages.length,
    description: `${cashierKindLabel(detail.kind)} request for ${detail.amount.toLocaleString('en-US')} DonutSMP money.`,
    messages: detail.messages,
    events: events.map<TicketEvent>((event) => ({
      id: event.id,
      actorName: event.actor_name ?? 'System',
      type: event.type,
      fromValue: event.from_value,
      toValue: event.to_value,
      note: event.note,
      createdAt: event.created_at,
    })),
    canSeeInternalNotes: can(viewer.role, 'credits.adjust'),
  };
}
