import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { Role } from '../../shared/types.ts';
import { ROLE_RANK } from '../../shared/types.ts';
import {
  badRequest,
  clientIp,
  conflict,
  forbidden,
  inTransaction,
  notFound,
  nowIso,
  parseJson,
  parseJson as jsonParse,
} from '../lib/core.ts';
import { parse, pageQuerySchema, emailSchema, usernameSchema } from '../lib/validation.ts';
import { amountSchema } from '../lib/amount.ts';
import { compactAmount } from '../../shared/amount.ts';
import { can, requireAuth, requirePermission } from '../lib/permissions.ts';
import { applyLedger, balanceOf, createWallet, mapLedgerRow, reconcileWallets, type LedgerRow } from '../lib/wallet.ts';
import { hashPassword } from '../lib/crypto.ts';
import { createSession, revokeAllSessions } from '../auth.ts';
import { loadUser } from '../auth.ts';
import { notify } from '../lib/notifications.ts';
import { recordAudit } from '../lib/audit.ts';
import { buildTicketList, ticketCounts, type TicketRow } from '../lib/tickets.ts';
import { staffWorkload } from './staff.ts';

const roleSchema = z.enum(['user', 'support', 'moderator', 'admin', 'owner']);

const usersQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  role: z.string().optional(),
  status: z.string().optional(),
  sort: z.enum(['created', 'balance', 'activity', 'username']).optional(),
});

const statusSchema = z.object({
  status: z.enum(['active', 'restricted', 'suspended']),
  reason: z.string().trim().max(500).optional(),
});

const roleChangeSchema = z.object({
  role: roleSchema,
  reason: z.string().trim().max(500).optional(),
});

const wipeSchema = z.object({
  confirmUsername: z.string().trim().min(1, 'Type the username to confirm.').max(40),
  reason: z.string().trim().max(500).optional(),
});

const adjustSchema = z.object({
  amount: amountSchema({ allowNegative: true, maxAbs: 1_000_000_000_000, label: 'adjustment' }),
  reason: z.string().trim().min(5, 'Record a reason of at least 5 characters.').max(500),
  requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

const staffSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  role: z.enum(['support', 'moderator', 'admin']),
  reason: z.string().trim().max(300).optional(),
});

const transactionsQuerySchema = pageQuerySchema.extend({
  type: z.string().optional(),
  userId: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

function daysSeries(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return out;
}

function assertCanModerate(actor: { id: string; role: Role }, target: { id: string; role: Role; status: string }): void {
  if (target.id === actor.id) throw forbidden('You cannot change your own access.', 'SELF_MODERATION');
  if (target.role === 'owner' && actor.role !== 'owner') {
    throw forbidden('Only an owner can modify another owner.', 'OWNER_PROTECTED');
  }
  if (actor.role !== 'owner' && ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) {
    throw forbidden('You can only manage accounts with a lower role.', 'ROLE_RANK');
  }
}

function lastActiveOwner(db: DB, userId: string): boolean {
  const count = (
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND status = 'active'").get() as {
      count: number;
    }
  ).count;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  return count <= 1 && target?.role === 'owner';
}

export function createAdminRouter(db: DB): Router {
  const router = Router();

  router.get('/overview', (req, res) => {
    requirePermission(req, 'admin.access');
    const daysRaw = Number(req.query.days ?? 14);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.floor(daysRaw))) : 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const users = db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'restricted' THEN 1 ELSE 0 END) AS restricted,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users
         FROM users`,
      )
      .get(since) as Record<string, number | null>;

    const tickets = db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
          SUM(CASE WHEN status IN ('new','open','in_progress') THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold,
          SUM(CASE WHEN status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_user,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN assignee_id IS NULL AND status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned
         FROM tickets`,
      )
      .get() as Record<string, number | null>;

    const economy = db
      .prepare(
        `SELECT
          (SELECT COALESCE(SUM(balance),0) FROM wallets) AS circulating,
          COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END),0) AS wagered,
          COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END),0) AS payouts,
          COALESCE(SUM(CASE WHEN type = 'credit_request' THEN amount ELSE 0 END),0) AS credit_granted,
          COALESCE(SUM(CASE WHEN type = 'admin_adjustment' THEN amount ELSE 0 END),0) AS adjusted,
          COALESCE(SUM(CASE WHEN type = 'initial_grant' THEN amount ELSE 0 END),0) AS initial_grants
         FROM ledger`,
      )
      .get() as Record<string, number>;

    const pendingCashier = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM cashier_requests WHERE status = 'pending'`,
      )
      .get() as { count: number; amount: number };

    const gamesAgg = db
      .prepare(
        `SELECT COUNT(*) AS total_sessions,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_sessions,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions
         FROM game_sessions`,
      )
      .get(since) as Record<string, number | null>;

    const registrationRows = db
      .prepare('SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day')
      .all(since) as { day: string; count: number }[];
    const volumeRows = db
      .prepare(
        `SELECT substr(created_at,1,10) AS day,
                COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END),0) AS wagers,
                COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END),0) AS payouts
         FROM ledger WHERE created_at >= ? AND type IN ('game_wager','game_payout') GROUP BY day`,
      )
      .all(since) as { day: string; wagers: number; payouts: number }[];
    const regMap = new Map(registrationRows.map((row) => [row.day, row.count]));
    const volMap = new Map(volumeRows.map((row) => [row.day, row]));

    const byGame = db
      .prepare(
        `SELECT g.id, g.name, g.enabled,
                COUNT(gs.id) AS sessions,
                COALESCE(SUM(gs.bet),0) AS wagers,
                COALESCE(SUM(gs.payout),0) AS payouts
         FROM games g LEFT JOIN game_sessions gs ON gs.game_id = g.id AND gs.created_at >= ?
         GROUP BY g.id ORDER BY sessions DESC`,
      )
      .all(since) as { id: string; name: string; enabled: number; sessions: number; wagers: number; payouts: number }[];

    const recentAudit = db
      .prepare(
        `SELECT a.id, a.action, a.target_type, a.target_label, a.reason, a.created_at, u.username AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 8`,
      )
      .all() as {
      id: string;
      action: string;
      target_type: string | null;
      target_label: string | null;
      reason: string | null;
      created_at: string;
      actor_name: string | null;
    }[];

    const pendingCashierRequests = db
      .prepare(
        `SELECT r.id, r.reference, r.amount, r.kind, r.created_at, u.username
         FROM cashier_requests r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 5`,
      )
      .all() as { id: string; reference: string; amount: number; kind: string; created_at: string; username: string }[];

    const unassignedTickets = db
      .prepare(
        `SELECT t.reference, t.subject, t.priority, t.status, t.created_at, c.label AS category
         FROM tickets t JOIN support_categories c ON c.key = t.category
         WHERE t.assignee_id IS NULL AND t.status NOT IN ('closed','rejected')
         ORDER BY CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
                  t.created_at ASC LIMIT 5`,
      )
      .all() as { reference: string; subject: string; priority: string; status: string; created_at: string; category: string }[];

    const reconcile = reconcileWallets(db);

    res.json({
      rangeDays: days,
      generatedAt: nowIso(),
      users: {
        total: users.total ?? 0,
        active: users.active ?? 0,
        restricted: users.restricted ?? 0,
        suspended: users.suspended ?? 0,
        new: users.new_users ?? 0,
      },
      tickets: {
        total: tickets.total ?? 0,
        new: tickets.new_count ?? 0,
        open: tickets.open_count ?? 0,
        inProgress: tickets.in_progress ?? 0,
        onHold: tickets.on_hold ?? 0,
        waitingUser: tickets.waiting_user ?? 0,
        resolved: tickets.resolved ?? 0,
        closed: tickets.closed ?? 0,
        rejected: tickets.rejected ?? 0,
        unassigned: tickets.unassigned ?? 0,
        pendingCashier: pendingCashier.count,
      },
      economy: {
        circulating: economy.circulating ?? 0,
        lifetimeWagered: economy.wagered ?? 0,
        lifetimePayouts: economy.payouts ?? 0,
        gameNet: (economy.wagered ?? 0) - (economy.payouts ?? 0),
        creditGranted: economy.credit_granted ?? 0,
        adminAdjusted: economy.adjusted ?? 0,
        initialGrants: economy.initial_grants ?? 0,
        pendingCashierAmount: pendingCashier.amount,
        mismatchedWallets: reconcile.length,
      },
      games: {
        totalSessions: gamesAgg.total_sessions ?? 0,
        recentSessions: gamesAgg.recent_sessions ?? 0,
        activeSessions: gamesAgg.active_sessions ?? 0,
        byGame,
      },
      series: daysSeries(days).map((day) => ({
        date: day,
        registrations: regMap.get(day) ?? 0,
        wagers: volMap.get(day)?.wagers ?? 0,
        payouts: volMap.get(day)?.payouts ?? 0,
      })),
      recentAudit,
      pendingCashierRequests,
      unassignedTickets,
    });
  });

  router.get('/users', (req, res) => {
    requirePermission(req, 'users.read');
    const query = parse(usersQuerySchema, req.query);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.q) {
      clauses.push('(u.username LIKE ? OR u.email LIKE ? OR u.id LIKE ?)');
      const term = `%${query.q}%`;
      params.push(term, term, term);
    }
    if (query.role) {
      clauses.push('u.role = ?');
      params.push(query.role);
    }
    if (query.status) {
      clauses.push('u.status = ?');
      params.push(query.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sort =
      query.sort === 'balance'
        ? 'w.balance DESC'
        : query.sort === 'activity'
          ? 'u.last_seen_at DESC'
          : query.sort === 'username'
            ? 'u.username ASC'
            : 'u.created_at DESC';
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.role, u.status, u.created_at, u.last_login_at, u.last_seen_at,
                w.balance,
                (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id AND t.status NOT IN ('closed','rejected')) AS open_tickets
         FROM users u JOIN wallets w ON w.user_id = u.id
         ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as {
      id: string;
      username: string;
      email: string;
      role: Role;
      status: string;
      created_at: string;
      last_login_at: string | null;
      last_seen_at: string | null;
      balance: number;
      open_tickets: number;
    }[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        status: row.status,
        balance: row.balance,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        lastSeenAt: row.last_seen_at,
        openTickets: row.open_tickets,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  });

  router.get('/users/:id', (req, res) => {
    const admin = requirePermission(req, 'users.read');
    const userId = req.params.id ?? '';
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.role, u.status, u.email_verified, u.created_at, u.updated_at,
                u.last_login_at, u.last_seen_at, u.restriction_reason, w.balance
         FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?`,
      )
      .get(userId) as
      | {
          id: string;
          username: string;
          email: string;
          role: Role;
          status: string;
          email_verified: number;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
          last_seen_at: string | null;
          restriction_reason: string | null;
          balance: number;
        }
      | undefined;
    if (!user) throw notFound('User not found.');

    const ledgerRows = db
      .prepare(
        `SELECT l.*, u.username AS username, a.username AS actor_name
         FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
         WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 12`,
      )
      .all(userId) as (LedgerRow & { username: string; actor_name: string | null })[];

    const tickets = buildTicketList(db, admin, {
      requesterId: userId,
      page: 1,
      pageSize: 10,
      sort: 'activity',
    });

    const gameSessions = db
      .prepare(
        `SELECT id, game_id, bet, payout, status, created_at FROM game_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
      )
      .all(userId) as { id: string; game_id: string; bet: number; payout: number; status: string; created_at: string }[];

    const stats = db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout),0) AS won
         FROM game_sessions WHERE user_id = ?`,
      )
      .get(userId) as { sessions: number; wagered: number; won: number };

    const creditRequests = db
      .prepare(
        `SELECT cr.id, cr.amount, cr.kind, cr.status, cr.created_at, cr.decided_at, t.reference,
                rev.username AS reviewer
         FROM credit_requests cr JOIN tickets t ON t.id = cr.ticket_id
         LEFT JOIN users rev ON rev.id = cr.reviewer_id
         WHERE cr.user_id = ? ORDER BY cr.created_at DESC LIMIT 10`,
      )
      .all(userId) as {
      id: string;
      amount: number;
      kind: string;
      status: string;
      created_at: string;
      decided_at: string | null;
      reference: string;
      reviewer: string | null;
    }[];

    const audit = db
      .prepare(
        `SELECT a.id, a.action, a.target_label, a.reason, a.created_at, u.username AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.target_id = ? OR a.actor_id = ? ORDER BY a.created_at DESC LIMIT 15`,
      )
      .all(userId, userId) as {
      id: string;
      action: string;
      target_label: string | null;
      reason: string | null;
      created_at: string;
      actor_name: string | null;
    }[];

    const activeSessions = (
      db
        .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?')
        .get(userId, nowIso()) as { count: number }
    ).count;

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: Boolean(user.email_verified),
        balance: user.balance,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login_at,
        lastSeenAt: user.last_seen_at,
        restrictionReason: user.restriction_reason,
      },
      stats: { sessions: stats.sessions, wagered: stats.wagered, won: stats.won },
      ledger: ledgerRows.map((row) => mapLedgerRow(row, row.username, row.actor_name)),
      tickets: tickets.items,
      gameSessions: gameSessions.map((row) => ({
        id: row.id,
        game: row.game_id,
        bet: row.bet,
        payout: row.payout,
        status: row.status,
        createdAt: row.created_at,
      })),
      creditRequests,
      audit,
      activeSessions,
    });
  });

  router.patch('/users/:id/status', (req, res) => {
    const admin = requirePermission(req, 'users.restrict');
    const userId = req.params.id ?? '';
    const body = parse(statusSchema, req.body);
    const target = db
      .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; role: Role; status: string } | undefined;
    if (!target) throw notFound('User not found.');
    assertCanModerate(admin, target);
    if (body.status !== 'active' && (!body.reason || body.reason.trim().length < 5)) {
      throw badRequest('Provide a reason of at least 5 characters.', 'REASON_REQUIRED', {
        fields: { reason: 'Explain the restriction.' },
      });
    }
    if (body.status !== 'active' && lastActiveOwner(db, userId)) {
      throw forbidden('The last active owner cannot be restricted.', 'LAST_OWNER');
    }
    if (target.status === body.status) throw badRequest('Account status is unchanged.', 'NO_CHANGE');

    const now = nowIso();
    db.prepare('UPDATE users SET status = ?, restriction_reason = ?, updated_at = ? WHERE id = ?').run(
      body.status,
      body.status === 'active' ? null : (body.reason ?? null),
      now,
      userId,
    );
    if (body.status === 'suspended') revokeAllSessions(db, userId);
    notify(db, {
      userId,
      type: 'account_status',
      title: `Account ${body.status}`,
      body:
        body.status === 'active'
          ? 'Your account access has been restored.'
          : `Your account is now ${body.status}. Reason: ${body.reason ?? 'Contact support for details.'}`,
      link: '/settings',
      actorId: admin.id,
    });
    recordAudit(db, {
      actorId: admin.id,
      action: 'user.status',
      targetType: 'user',
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason ?? null,
      metadata: { from: target.status, to: body.status },
      ip: clientIp(req),
    });
    res.json({ user: loadUser(db, userId) });
  });

  router.patch('/users/:id/role', (req, res) => {
    const admin = requirePermission(req, 'roles.manage');
    const userId = req.params.id ?? '';
    const body = parse(roleChangeSchema, req.body);
    const target = db
      .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; role: Role; status: string } | undefined;
    if (!target) throw notFound('User not found.');
    if (target.id === admin.id) throw forbidden('You cannot change your own role.', 'SELF_MODERATION');
    if (target.role === body.role) throw badRequest('Role is unchanged.', 'NO_CHANGE');
    if (body.role === 'owner' && admin.role !== 'owner') {
      throw forbidden('Only an owner can assign the owner role.', 'ROLE_RANK');
    }
    if (admin.role !== 'owner' && ROLE_RANK[target.role] >= ROLE_RANK[admin.role]) {
      throw forbidden('You can only manage accounts with a lower role.', 'ROLE_RANK');
    }
    if (admin.role !== 'owner' && ROLE_RANK[body.role] >= ROLE_RANK[admin.role]) {
      throw forbidden('You cannot promote an account to your own role or higher.', 'ROLE_RANK');
    }
    if (target.role === 'owner' && body.role !== 'owner' && lastActiveOwner(db, userId)) {
      throw forbidden('The last active owner cannot be demoted.', 'LAST_OWNER');
    }

    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(body.role, nowIso(), userId);
    notify(db, {
      userId,
      type: 'account_role',
      title: 'Your role changed',
      body: `Your account role is now ${body.role}.`,
      link: '/settings',
      actorId: admin.id,
    });
    recordAudit(db, {
      actorId: admin.id,
      action: 'user.role',
      targetType: 'user',
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason ?? null,
      metadata: { from: target.role, to: body.role },
      ip: clientIp(req),
    });
    res.json({ user: loadUser(db, userId) });
  });

  /**
   * Wipes progression for one account: balance to zero, reward streak and claim
   * history removed, unfinished rounds aborted, active-bet slot released. The
   * account, its ledger history and its tickets stay intact, so the player can
   * still sign in and start over from the intended initial state.
   */
  router.post('/users/:id/wipe', (req, res) => {
    const admin = requirePermission(req, 'users.manage');
    const userId = req.params.id ?? '';
    const body = parse(wipeSchema, req.body);
    const target = db
      .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; role: Role; status: string } | undefined;
    if (!target) throw notFound('User not found.');
    if (target.id === admin.id) throw forbidden('You cannot wipe your own account.', 'SELF_MODERATION');
    assertCanModerate(admin, target);
    if (target.username.toLowerCase() !== body.confirmUsername.trim().toLowerCase()) {
      throw badRequest('Type the exact username to confirm this wipe.', 'CONFIRMATION_MISMATCH', {
        fields: { confirmUsername: 'Does not match the username.' },
      });
    }

    const summary = inTransaction(db, () => {
      const balanceBefore = balanceOf(db, userId);

      const aborted = db
        .prepare(
          `UPDATE game_sessions
              SET status = 'lost', payout = 0, ended_at = ?, outcome = COALESCE(outcome, ?)
            WHERE user_id = ? AND status = 'active'`,
        )
        .run(nowIso(), JSON.stringify({ aborted: 'account wiped' }), userId).changes;
      db.prepare('DELETE FROM active_rounds WHERE user_id = ?').run(userId);

      const claimsRemoved = db.prepare('DELETE FROM reward_claims WHERE user_id = ?').run(userId).changes;

      if (balanceBefore > 0) {
        applyLedger(db, {
          userId,
          amount: -balanceBefore,
          type: 'admin_adjustment',
          actorId: admin.id,
          reason: 'Account progression wiped',
          refType: 'user',
          refId: userId,
          idempotencyKey: `wipe:${userId}:${randomBytes(8).toString('hex')}`,
          metadata: { action: 'user.wipe', admin: admin.username },
        });
      }

      const balanceAfter = balanceOf(db, userId);
      if (balanceAfter !== 0) {
        throw conflict('The balance could not be reset. Nothing was changed.', 'WIPE_INCOMPLETE');
      }

      recordAudit(db, {
        actorId: admin.id,
        action: 'user.wipe',
        targetType: 'user',
        targetId: userId,
        targetLabel: target.username,
        reason: body.reason ?? null,
        metadata: { balanceBefore, balanceAfter, abortedRounds: aborted, rewardClaimsRemoved: claimsRemoved },
        ip: clientIp(req),
      });

      return { balanceBefore, abortedRounds: aborted, rewardClaimsRemoved: claimsRemoved };
    });

    notify(db, {
      userId,
      type: 'account_wipe',
      title: 'Your progression was reset',
      body: 'An administrator reset your balance and reward streak. Your account is still active.',
      link: '/rewards',
      actorId: admin.id,
    });

    res.json({ ok: true, balance: balanceOf(db, userId), ...summary, user: loadUser(db, userId) });
  });

  router.post('/users/:id/adjust', (req, res) => {
    const admin = requirePermission(req, 'credits.adjust');
    const userId = req.params.id ?? '';
    const body = parse(adjustSchema, req.body);
    if (userId === admin.id) throw forbidden('Administrators cannot adjust their own balance.', 'SELF_ADJUSTMENT');
    const target = db
      .prepare('SELECT id, username, role, status FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; role: Role; status: string } | undefined;
    if (!target) throw notFound('User not found.');
    if (target.role === 'owner' && admin.role !== 'owner') {
      throw forbidden('Only an owner can adjust another owner.', 'OWNER_PROTECTED');
    }
    const idempotencyKey = `admin-adjust:${body.requestId}`;
    const existing = db.prepare('SELECT * FROM ledger WHERE idempotency_key = ?').get(idempotencyKey) as
      | LedgerRow
      | undefined;
    if (existing) {
      if (existing.user_id !== userId) throw conflict('This request id belongs to another adjustment.', 'IDEMPOTENCY_CONFLICT');
      res.json({ balance: balanceOf(db, userId), transaction: existing, duplicate: true });
      return;
    }

    const entry = inTransaction(db, () =>
      applyLedger(db, {
        userId,
        amount: body.amount,
        type: 'admin_adjustment',
        actorId: admin.id,
        reason: body.reason,
        refType: 'admin_action',
        refId: body.requestId,
        idempotencyKey,
        metadata: { requestId: body.requestId },
      }),
    );
    notify(db, {
      userId,
      type: 'wallet_adjustment',
      title: `${body.amount > 0 ? 'Money added' : 'Money removed'}`,
      body: `${body.amount > 0 ? '+' : ''}${compactAmount(body.amount)} DonutSMP money. Reason: ${body.reason}. Transaction ${entry.id}.`,
      link: '/wallet',
      actorId: admin.id,
    });
    recordAudit(db, {
      actorId: admin.id,
      action: 'credits.admin_adjustment',
      targetType: 'user',
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason,
      metadata: { amount: body.amount, ledgerId: entry.id, balanceAfter: entry.balance_after },
      ip: clientIp(req),
    });
    res.json({ balance: entry.balance_after, transaction: entry, duplicate: false });
  });

  router.get('/transactions', (req, res) => {
    requirePermission(req, 'economy.read');
    const query = parse(transactionsQuerySchema, req.query);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.type) {
      clauses.push('l.type = ?');
      params.push(query.type);
    }
    if (query.userId) {
      clauses.push('l.user_id = ?');
      params.push(query.userId);
    }
    if (query.q) {
      clauses.push('(u.username LIKE ? OR l.id LIKE ? OR l.ref_id LIKE ?)');
      const term = `%${query.q}%`;
      params.push(term, term, term);
    }
    if (query.from) {
      clauses.push('l.created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      clauses.push('l.created_at <= ?');
      params.push(query.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const base = `FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id ${where}`;
    const total = (db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params) as { count: number }).count;
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END),0) AS inflow,
                COALESCE(SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END),0) AS outflow
         ${base}`,
      )
      .get(...params) as { inflow: number; outflow: number };
    const rows = db
      .prepare(
        `SELECT l.*, u.username AS username, a.username AS actor_name ${base}
         ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as (LedgerRow & {
      username: string;
      actor_name: string | null;
    })[];
    res.json({
      items: rows.map((row) => mapLedgerRow(row, row.username, row.actor_name)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.inflow - totals.outflow },
    });
  });

  router.get('/economy', (req, res) => {
    requirePermission(req, 'economy.read');
    const byType = db
      .prepare(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM ledger GROUP BY type ORDER BY type`,
      )
      .all() as { type: string; count: number; total: number }[];
    const recentAdjustments = db
      .prepare(
        `SELECT l.id, l.amount, l.reason, l.created_at, l.balance_after, t.username AS target, a.username AS actor
         FROM ledger l JOIN users t ON t.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
         WHERE l.type = 'admin_adjustment' ORDER BY l.created_at DESC LIMIT 12`,
      )
      .all() as {
      id: string;
      amount: number;
      reason: string | null;
      created_at: string;
      balance_after: number;
      target: string;
      actor: string | null;
    }[];
    res.json({
      circulation: balanceOfAll(db),
      byType,
      reconcile: reconcileWallets(db),
      recentAdjustments: recentAdjustments.map((row) => ({
        id: row.id,
        amount: row.amount,
        reason: row.reason,
        createdAt: row.created_at,
        balanceAfter: row.balance_after,
        target: row.target,
        actor: row.actor,
      })),
    });
  });

  router.get('/staff', (req, res) => {
    requirePermission(req, 'staff.manage');
    const staff = staffWorkload(db).map((member) => {
      const resolved = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM tickets WHERE assignee_id = ? AND status IN ('resolved','closed')
             AND last_activity_at >= ?`,
          )
          .get(member.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) as { count: number }
      ).count;
      const handled = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
             WHERE e.actor_id = ? AND e.created_at >= ?`,
          )
          .get(member.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) as { count: number }
      ).count;
      return { ...member, resolvedLast7Days: resolved, actionsLast7Days: handled };
    });
    res.json({ staff });
  });

  router.post('/staff', (req, res) => {
    const admin = requirePermission(req, 'staff.manage');
    const body = parse(staffSchema, req.body);
    if (admin.role !== 'owner' && ROLE_RANK[body.role] >= ROLE_RANK[admin.role]) {
      throw forbidden('You cannot create a staff account at or above your own role.', 'ROLE_RANK');
    }
    const existing = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(body.username, body.email) as { id: string } | undefined;
    if (existing) throw conflict('That username or email is already in use.', 'ACCOUNT_EXISTS');
    const temporaryPassword = `Donutcash-${randomBytes(6).toString('hex')}!`;
    const userId = `usr_${randomBytes(10).toString('hex')}`;
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      ).run(userId, body.username, body.email, hashPassword(temporaryPassword), body.role, now, now);
      createWallet(db, userId, 0, admin.id);
    })();
    notify(db, {
      userId,
      type: 'account',
      title: 'Staff account created',
      body: `You have been added as ${body.role}. Change your temporary password from Settings after signing in.`,
      link: '/settings',
      actorId: admin.id,
    });
    recordAudit(db, {
      actorId: admin.id,
      action: 'staff.created',
      targetType: 'user',
      targetId: userId,
      targetLabel: body.username,
      reason: body.reason ?? null,
      metadata: { role: body.role },
      ip: clientIp(req),
    });
    res.status(201).json({
      user: loadUser(db, userId),
      temporaryPassword,
      note: 'This temporary password is shown once. Deliver it through a secure channel and ask the agent to change it.',
    });
  });

  return router;
}

function balanceOfAll(db: DB): number {
  return (db.prepare('SELECT COALESCE(SUM(balance),0) AS total FROM wallets').get() as { total: number }).total;
}

export function adminSessionMetadata(db: DB, userId: string): { ip: string | null } {
  const row = db.prepare('SELECT ip FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as
    | { ip: string | null }
    | undefined;
  return { ip: row?.ip ?? null };
}

export function parseAuditMetadata(raw: string | null): Record<string, unknown> | null {
  return jsonParse<Record<string, unknown> | null>(raw, null);
}
