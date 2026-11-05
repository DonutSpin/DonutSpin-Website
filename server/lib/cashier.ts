import type { DB } from '../db/index.ts';
import type {
  AccountStatus,
  CashierCounts,
  CashierMessage,
  CashierRequestDetail,
  CashierRequestKind,
  CashierRequestStatus,
  CashierRequestSummary,
  Role,
  SessionUser,
} from '../../shared/types.ts';
import { forbidden, newId, notFound, nowIso } from './core.ts';
import { can } from './permissions.ts';
import { notify } from './notifications.ts';

export interface CashierRow {
  id: string;
  reference: string;
  user_id: string;
  kind: CashierRequestKind;
  amount: number;
  status: CashierRequestStatus;
  reviewer_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  ledger_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  requester_name?: string;
  requester_email?: string;
  requester_status?: AccountStatus;
  requester_created_at?: string;
  requester_balance?: number;
  reviewer_name?: string | null;
  message_count?: number;
}

interface CashierMessageRow {
  id: string;
  author_id: string | null;
  author_role: string;
  visibility: 'public' | 'system';
  body: string;
  created_at: string;
  author_name: string | null;
}

const LIST_SELECT = `
  SELECT r.*, u.username AS requester_name, u.email AS requester_email, w.balance AS requester_balance,
         rev.username AS reviewer_name,
         (SELECT COUNT(*) FROM cashier_messages m WHERE m.request_id = r.id) AS message_count
  FROM cashier_requests r
  JOIN users u ON u.id = r.user_id
  JOIN wallets w ON w.user_id = r.user_id
  LEFT JOIN users rev ON rev.id = r.reviewer_id
`;

export function canManageCashier(user: SessionUser): boolean {
  return can(user.role, 'credits.adjust');
}

export function generateCashierReference(db: DB, kind: CashierRequestKind): string {
  const year = new Date().getUTCFullYear();
  const name = `cashier_${kind}_${year}`;
  const row = db
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(name) as { value: number };
  const prefix = kind === 'deposit' ? 'DEP' : 'WDR';
  return `${prefix}-${year}-${String(row.value).padStart(6, '0')}`;
}

export function loadCashierRow(db: DB, reference: string): CashierRow | undefined {
  return db.prepare(`${LIST_SELECT} WHERE r.reference = ?`).get(reference) as CashierRow | undefined;
}

function mapSummary(row: CashierRow): CashierRequestSummary {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    requester: {
      id: row.user_id,
      username: row.requester_name ?? 'Unknown',
      ...(typeof row.requester_balance === 'number' ? { balance: row.requester_balance } : {}),
    },
    reviewer: row.reviewer_id
      ? { id: row.reviewer_id, username: row.reviewer_name ?? 'Unknown' }
      : null,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    ledgerId: row.ledger_id,
    messageCount: row.message_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

export interface CashierListFilters {
  status?: string;
  kind?: string;
  search?: string;
  requesterId?: string;
  pendingFirst?: boolean;
  page: number;
  pageSize: number;
}

export function buildCashierList(db: DB, filters: CashierListFilters): { items: CashierRequestSummary[]; total: number } {
  const params: Record<string, unknown> = {};
  const clauses: string[] = [];
  if (filters.requesterId) {
    params.requesterId = filters.requesterId;
    clauses.push('r.user_id = @requesterId');
  }
  if (filters.status && filters.status !== 'all') {
    params.status = filters.status;
    clauses.push('r.status = @status');
  }
  if (filters.kind) {
    params.kind = filters.kind;
    clauses.push('r.kind = @kind');
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    clauses.push('(r.reference LIKE @search OR u.username LIKE @search)');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = filters.pendingFirst
    ? "CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.last_activity_at DESC"
    : 'r.last_activity_at DESC';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM cashier_requests r JOIN users u ON u.id = r.user_id ${where}`,
      )
      .get(params) as { count: number }
  ).count;
  const rows = db
    .prepare(`${LIST_SELECT} ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize }) as CashierRow[];
  return { items: rows.map(mapSummary), total };
}

export function cashierCounts(db: DB, requesterId?: string): CashierCounts {
  const where = requesterId ? 'WHERE user_id = ?' : '';
  const params = requesterId ? [requesterId] : [];
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS all_count,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
         COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
         COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
         COALESCE(SUM(CASE WHEN kind = 'deposit' THEN 1 ELSE 0 END), 0) AS deposit_count,
         COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN 1 ELSE 0 END), 0) AS withdrawal_count
       FROM cashier_requests ${where}`,
    )
    .get(...params) as Record<string, number>;
  return {
    all: row.all_count ?? 0,
    pending: row.pending_count ?? 0,
    approved: row.approved_count ?? 0,
    rejected: row.rejected_count ?? 0,
    cancelled: row.cancelled_count ?? 0,
    deposits: row.deposit_count ?? 0,
    withdrawals: row.withdrawal_count ?? 0,
  };
}

export function getCashierDetail(db: DB, viewer: SessionUser, reference: string): CashierRequestDetail {
  const row = db
    .prepare(
      `SELECT r.*, u.username AS requester_name, u.email AS requester_email,
              u.status AS requester_status, u.created_at AS requester_created_at,
              w.balance AS requester_balance, rev.username AS reviewer_name,
              (SELECT COUNT(*) FROM cashier_messages m WHERE m.request_id = r.id) AS message_count
       FROM cashier_requests r
       JOIN users u ON u.id = r.user_id
       JOIN wallets w ON w.user_id = r.user_id
       LEFT JOIN users rev ON rev.id = r.reviewer_id
       WHERE r.reference = ?`,
    )
    .get(reference) as CashierRow | undefined;
  if (!row) throw notFound('Cashier request not found.');

  const canManage = canManageCashier(viewer);
  if (!canManage && row.user_id !== viewer.id) {
    throw forbidden('This cashier request belongs to another account.');
  }

  const messages = (
    db
      .prepare(
        `SELECT m.id, m.author_id, m.author_role, m.visibility, m.body, m.created_at,
                u.username AS author_name
         FROM cashier_messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.request_id = ? ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(row.id) as CashierMessageRow[]
  ).map<CashierMessage>((message) => ({
    id: message.id,
    authorId: message.author_id,
    authorName: message.author_role === 'system' ? 'DonutSpin' : (message.author_name ?? 'Deleted user'),
    authorRole: (message.author_role as Role | 'system') ?? 'system',
    visibility: message.visibility,
    body: message.body,
    createdAt: message.created_at,
  }));

  const summary = mapSummary({ ...row, message_count: messages.length });
  return {
    ...summary,
    requester: {
      id: row.user_id,
      username: row.requester_name ?? 'Unknown',
      ...(canManage
        ? {
            email: row.requester_email,
            status: row.requester_status,
            createdAt: row.requester_created_at,
          }
        : {}),
      ...(typeof row.requester_balance === 'number' ? { balance: row.requester_balance } : {}),
    },
    messages,
    canDecide: canManage && row.status === 'pending',
    canCancel: row.user_id === viewer.id && row.status === 'pending',
    canMessage: row.status !== 'cancelled',
  };
}

export function addCashierMessage(
  db: DB,
  input: {
    requestId: string;
    authorId: string | null;
    authorRole: Role | 'system';
    visibility: 'public' | 'system';
    body: string;
  },
): string {
  const id = newId('cmsg');
  const now = nowIso();
  db.prepare(
    `INSERT INTO cashier_messages (id, request_id, author_id, author_role, visibility, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.requestId, input.authorId, input.authorRole, input.visibility, input.body, now);
  db.prepare('UPDATE cashier_requests SET last_activity_at = ? WHERE id = ?').run(now, input.requestId);
  return id;
}

export function notifyCashierAdmins(
  db: DB,
  input: { title: string; body: string; link: string; actorId?: string | null; excludeUserId?: string | null },
): void {
  const admins = db
    .prepare("SELECT id FROM users WHERE role IN ('admin','owner') AND status = 'active'")
    .all() as { id: string }[];
  for (const admin of admins) {
    if (admin.id === input.excludeUserId) continue;
    notify(db, {
      userId: admin.id,
      type: 'cashier',
      title: input.title,
      body: input.body,
      link: input.link,
      actorId: input.actorId ?? null,
    });
  }
}
