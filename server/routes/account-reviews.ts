import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type {
  AccountReviewCounts,
  AccountReviewDetail,
  AccountReviewEvent,
  AccountReviewIpHistory,
  AccountReviewRelatedAccount,
  AccountReviewStatus,
  AccountReviewSummary,
  Role,
  AccountStatus,
} from '../../shared/types.ts';
import { clientIp, notFound, nowIso, ApiError } from '../lib/core.ts';
import { parse, pageQuerySchema } from '../lib/validation.ts';
import { requirePermission } from '../lib/permissions.ts';
import { recordAudit } from '../lib/audit.ts';
import { notify } from '../lib/notifications.ts';
import { newId } from '../lib/core.ts';
import { accountsPerIp } from '../lib/account-review.ts';

const reviewStatuses = ['open', 'cleared', 'alt_confirmed', 'resolved'] as const;

interface ReviewRow {
  id: string;
  user_id: string;
  status: AccountReviewStatus;
  reason: string;
  trigger_ip: string | null;
  related_user_ids: string;
  related_count: number;
  flagged_at: string;
  updated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
  hold_released_at: string | null;
  username: string;
  email: string;
  role: Role;
  account_status: AccountStatus;
  account_hold: number;
  registration_ip: string | null;
  user_created_at: string;
  last_login_at: string | null;
  email_verified: number;
  balance: number;
  reviewer_name: string | null;
}

const listSchema = pageQuerySchema.extend({
  status: z.enum(reviewStatuses).optional(),
  q: z.string().trim().max(120).optional(),
});

const decisionSchema = z.object({
  decision: z.enum(['separate_users', 'alt_account', 'release_hold']),
  reason: z.string().trim().min(5, 'Record a reason of at least 5 characters.').max(500),
  applyToRelated: z.boolean().optional().default(false),
});

const reviewSelect = `
  SELECT r.*, u.username, u.email, u.role, u.status AS account_status, u.account_hold, u.registration_ip,
         u.created_at AS user_created_at, u.last_login_at, u.email_verified, w.balance,
         reviewer.username AS reviewer_name
    FROM account_reviews r
    JOIN users u ON u.id = r.user_id
    JOIN wallets w ON w.user_id = u.id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
`;

function parseRelated(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function summary(row: ReviewRow): AccountReviewSummary {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    reason: row.reason,
    triggerIp: row.trigger_ip,
    relatedCount: row.related_count,
    accountHold: Boolean(row.account_hold),
    flaggedAt: row.flagged_at,
    updatedAt: row.updated_at,
    reviewedBy: row.reviewer_name,
    reviewedAt: row.reviewed_at,
    decisionReason: row.decision_reason,
  };
}

function countReviews(db: DB): AccountReviewCounts {
  const reviewRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
         SUM(CASE WHEN status = 'cleared' THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN status = 'alt_confirmed' THEN 1 ELSE 0 END) AS alt_confirmed,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
       FROM account_reviews`,
    )
    .get() as Record<string, number | null>;
  const holds = db.prepare('SELECT COUNT(*) AS count FROM users WHERE account_hold = 1').get() as { count: number };
  return {
    total: reviewRow.total ?? 0,
    open: reviewRow.open ?? 0,
    onHold: holds.count,
    cleared: reviewRow.cleared ?? 0,
    altConfirmed: reviewRow.alt_confirmed ?? 0,
    resolved: reviewRow.resolved ?? 0,
  };
}

function relatedIdsFor(db: DB, row: ReviewRow): string[] {
  const ids = new Set(parseRelated(row.related_user_ids));
  if (row.trigger_ip) {
    const rows = db
      .prepare('SELECT id FROM users WHERE registration_ip = ? AND role = \'user\'')
      .all(row.trigger_ip) as { id: string }[];
    for (const entry of rows) ids.add(entry.id);
  }
  ids.add(row.user_id);
  return [...ids];
}

function buildIpHistory(db: DB, userIds: string[]): { history: AccountReviewIpHistory[]; shared: Map<string, Set<string>> } {
  const shared = new Map<string, Set<string>>();
  const map = new Map<string, { accounts: Set<string>; sessions: number; registrations: number; first: string; last: string }>();
  if (userIds.length === 0) return { history: [], shared };
  const placeholders = userIds.map(() => '?').join(',');
  const add = (ip: string, userId: string, at: string) => {
    let entry = map.get(ip);
    if (!entry) {
      entry = { accounts: new Set(), sessions: 0, registrations: 0, first: at, last: at };
      map.set(ip, entry);
    }
    entry.accounts.add(userId);
    if (at < entry.first) entry.first = at;
    if (at > entry.last) entry.last = at;
    const perUser = shared.get(userId) ?? new Set<string>();
    perUser.add(ip);
    shared.set(userId, perUser);
  };

  const registrations = db
    .prepare(
      `SELECT id, registration_ip AS ip, created_at
         FROM users WHERE id IN (${placeholders}) AND registration_ip IS NOT NULL`,
    )
    .all(...userIds) as { id: string; ip: string; created_at: string }[];
  for (const row of registrations) {
    add(row.ip, row.id, row.created_at);
    const entry = map.get(row.ip);
    if (entry) entry.registrations += 1;
  }

  const sessions = db
    .prepare(
      `SELECT user_id, ip, COUNT(*) AS sessions, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
         FROM sessions WHERE user_id IN (${placeholders}) AND ip IS NOT NULL
         GROUP BY user_id, ip`,
    )
    .all(...userIds) as { user_id: string; ip: string; sessions: number; first_seen: string; last_seen: string }[];
  for (const row of sessions) {
    add(row.ip, row.user_id, row.last_seen);
    const entry = map.get(row.ip);
    if (entry) {
      entry.sessions += row.sessions;
      if (row.first_seen < entry.first) entry.first = row.first_seen;
    }
  }

  const history = [...map.entries()]
    .map(([ip, entry]) => ({
      ip,
      accounts: entry.accounts.size,
      registrations: entry.registrations,
      sessions: entry.sessions,
      firstSeen: entry.first,
      lastSeen: entry.last,
    }))
    .sort((a, b) => b.accounts - a.accounts || b.lastSeen.localeCompare(a.lastSeen));
  return { history, shared };
}

function detail(db: DB, id: string): AccountReviewDetail {
  const row = db.prepare(`${reviewSelect} WHERE r.id = ?`).get(id) as ReviewRow | undefined;
  if (!row) throw notFound('Account review not found.');
  const ids = relatedIdsFor(db, row);
  const { history, shared } = buildIpHistory(db, ids);
  const placeholders = ids.map(() => '?').join(',');
  const relatedRows = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.account_hold, u.registration_ip,
              u.created_at, u.last_login_at, r.status AS review_status
         FROM users u LEFT JOIN account_reviews r ON r.user_id = u.id
        WHERE u.id IN (${placeholders})
        ORDER BY u.created_at ASC`,
    )
    .all(...ids) as {
    id: string;
    username: string;
    email: string;
    role: Role;
    status: AccountStatus;
    account_hold: number;
    registration_ip: string | null;
    created_at: string;
    last_login_at: string | null;
    review_status: AccountReviewStatus | null;
  }[];
  const relatedAccounts: AccountReviewRelatedAccount[] = relatedRows.map((entry) => ({
    id: entry.id,
    username: entry.username,
    email: entry.email,
    role: entry.role,
    status: entry.status,
    accountHold: Boolean(entry.account_hold),
    registrationIp: entry.registration_ip,
    createdAt: entry.created_at,
    lastLoginAt: entry.last_login_at,
    reviewStatus: entry.review_status,
    sharedIps: [...(shared.get(entry.id) ?? [])],
  }));

  const events = db
    .prepare(
      `SELECT e.id, e.action, e.from_status, e.to_status, e.reason, e.created_at, a.username AS actor_name
         FROM account_review_events e LEFT JOIN users a ON a.id = e.actor_id
        WHERE e.review_id = ? ORDER BY e.created_at ASC`,
    )
    .all(row.id) as {
    id: string;
    action: string;
    from_status: AccountReviewStatus | null;
    to_status: AccountReviewStatus | null;
    reason: string | null;
    created_at: string;
    actor_name: string | null;
  }[];

  return {
    ...summary(row),
    reviewNote: row.reason,
    user: {
      id: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.account_status,
      accountHold: Boolean(row.account_hold),
      accountHoldReason: null,
      accountHoldAt: null,
      registrationIp: row.registration_ip,
      emailVerified: Boolean(row.email_verified),
      createdAt: row.user_created_at,
      lastLoginAt: row.last_login_at,
      balance: row.balance,
    },
    relatedAccounts,
    ipHistory: history,
    events: events.map(
      (event): AccountReviewEvent => ({
        id: event.id,
        action: event.action,
        actorName: event.actor_name,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        reason: event.reason,
        createdAt: event.created_at,
      }),
    ),
  };
}

function applyDecision(
  db: DB,
  review: ReviewRow,
  actor: { id: string; username: string },
  decision: 'separate_users' | 'alt_account' | 'release_hold',
  reason: string,
  applyToRelated: boolean,
  ip: string | null,
): number {
  const related = applyToRelated
    ? (db
        .prepare(
          `SELECT r.id FROM account_reviews r
            WHERE r.trigger_ip = ? AND r.status IN ('open','alt_confirmed')`,
        )
        .all(review.trigger_ip) as { id: string }[]).map((entry) => entry.id)
    : [review.id];
  const targets = [...new Set(related)];
  const now = nowIso();
  for (const reviewId of targets) {
    const current = db
      .prepare(
        `SELECT r.*, u.username FROM account_reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
      )
      .get(reviewId) as ReviewRow | undefined;
    if (!current) continue;
    const nextStatus: AccountReviewStatus =
      decision === 'alt_account' ? 'alt_confirmed' : decision === 'separate_users' ? 'cleared' : 'resolved';
    const releaseHold = decision !== 'alt_account';
    db.prepare(
      `UPDATE account_reviews
          SET status = ?, reviewed_by = ?, reviewed_at = ?, decision_reason = ?,
              hold_released_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(nextStatus, actor.id, now, reason, releaseHold ? now : current.hold_released_at, now, reviewId);
    if (releaseHold) {
      db.prepare(
        `UPDATE users SET account_hold = 0, account_hold_reason = NULL, account_hold_at = NULL, updated_at = ?
          WHERE id = ?`,
      ).run(now, current.user_id);
    }
    db.prepare(
      `INSERT INTO account_review_events
         (id, review_id, actor_id, action, from_status, to_status, reason, created_at)
       VALUES (?, ?, ?, 'decision', ?, ?, ?, ?)`,
    ).run(newId('rev_ev'), reviewId, actor.id, current.status, nextStatus, reason, now);
    recordAudit(db, {
      actorId: actor.id,
      action: 'account_review.decision',
      targetType: 'account_review',
      targetId: reviewId,
      targetLabel: current.username,
      reason,
      metadata: { decision, from: current.status, to: nextStatus, applyToRelated },
      ip,
    });
    if (releaseHold) {
      notify(db, {
        userId: current.user_id,
        type: 'account_review',
        title: 'Account review completed',
        body: 'Your account hold has been removed. You can use the platform normally again.',
        link: '/',
        actorId: actor.id,
      });
    }
  }
  return targets.length;
}

export function createAccountReviewRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    requirePermission(req, 'accounts.review');
    const query = parse(listSchema, req.query);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      clauses.push('r.status = ?');
      params.push(query.status);
    }
    if (query.q) {
      clauses.push('(u.username LIKE ? OR u.email LIKE ? OR u.id LIKE ?)');
      const term = `%${query.q}%`;
      params.push(term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM account_reviews r JOIN users u ON u.id = r.user_id ${where}`)
        .get(...params) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `${reviewSelect} ${where}
         ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'alt_confirmed' THEN 1 ELSE 2 END,
                  r.flagged_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as ReviewRow[];
    res.json({
      items: rows.map(summary),
      counts: countReviews(db),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      accountsPerIp: accountsPerIp(db),
    });
  });

  router.get('/:id', (req, res) => {
    requirePermission(req, 'accounts.review');
    res.json(detail(db, req.params.id ?? ''));
  });

  router.post('/:id/decision', (req, res) => {
    const actor = requirePermission(req, 'accounts.review');
    const id = req.params.id ?? '';
    const body = parse(decisionSchema, req.body);
    const review = db.prepare(`${reviewSelect} WHERE r.id = ?`).get(id) as ReviewRow | undefined;
    if (!review) throw notFound('Account review not found.');
    if (review.role !== 'user') {
      throw new ApiError(400, 'STAFF_REVIEW_NOT_ALLOWED', 'Staff accounts are not subject to automatic player holds.');
    }
    const changed = db.transaction(() =>
      applyDecision(db, review, actor, body.decision, body.reason, body.applyToRelated, clientIp(req)),
    )();
    res.json({ ok: true, changed, detail: detail(db, id) });
  });

  return router;
}
