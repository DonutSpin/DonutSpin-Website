import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import type { LedgerType, NotificationItem, Paginated } from '../../shared/types.ts';
import { getSetting } from '../db/index.ts';
import { ApiError, badRequest, clientIp, conflict, newId, notFound, nowIso, pagination as _pagination } from '../lib/core.ts';
import { verifyPassword } from '../lib/crypto.ts';
import { resetLimiter } from '../lib/rate-limit.ts';
import { deleteAccount, findAccountDeletionRequest, issueAccountDeletionRequest } from '../lib/account-deletion.ts';
import { parse, pageQuerySchema, emailSchema, usernameSchema } from '../lib/validation.ts';
import { requireAuth } from '../lib/permissions.ts';
import { balanceOf, mapLedgerRow, type LedgerRow } from '../lib/wallet.ts';
import { clearSessionCookie, loadUser, revokeAllSessions, revokeOtherSessions, revokeSession } from '../auth.ts';
import { isSelfExclusionActive } from '../lib/legal.ts';
import { SELF_EXCLUSION_DURATIONS, type SelfExclusionDuration } from '../../shared/legal.ts';
import { recordAudit } from '../lib/audit.ts';
import { mapNotification, notify, unreadNotificationCount } from '../lib/notifications.ts';
import { ticketCounts, type TicketRow } from '../lib/tickets.ts';
import { config } from '../config.ts';
import { enqueueEmail, getEmailConfig } from '../lib/email.ts';
import { createEmailVerification } from '../lib/email-verification.ts';

const profileSchema = z.object({
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
  emailNotifications: z.boolean().optional(),
});

const selfExclusionSchema = z.object({
  duration: z.enum(SELF_EXCLUSION_DURATIONS),
  reason: z.string().trim().max(500).optional(),
});

const deleteAccountRequestSchema = z.object({
  password: z.string().min(1, 'Enter your current password.').max(200),
});

const deleteAccountConfirmSchema = z.object({
  token: z.string().trim().min(20, 'This deletion link is invalid.').max(500),
});

function guardDeleteRate(limit: { allowed: boolean; retryAfterSeconds: number }): void {
  if (limit.allowed) return;
  throw new ApiError(429, 'RATE_LIMITED', 'Too many deletion attempts. Please try again later.', {
    retryAfterSeconds: limit.retryAfterSeconds,
  });
}

function selfExclusionUntil(duration: SelfExclusionDuration, now: number): string {
  if (duration === 'permanent') return '9999-12-31T23:59:59.999Z';
  const days = duration === '24h' ? 1 : duration === '7d' ? 7 : 30;
  return new Date(now + days * 24 * 60 * 60_000).toISOString();
}

const ledgerQuerySchema = pageQuerySchema.extend({
  type: z
    .enum(['initial_grant', 'admin_adjustment', 'game_wager', 'game_payout', 'game_refund', 'credit_request', 'reversal'])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

type LedgerQueryRow = LedgerRow & { username: string; actor_name: string | null };

function ledgerSelect(db: DB, where: string, params: unknown[], limit: number, offset: number) {
  const rows = db
    .prepare(
      `SELECT l.*, u.username AS username, a.username AS actor_name
       FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
       ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as LedgerQueryRow[];
  return rows.map((row) => mapLedgerRow(row, row.username, row.actor_name));
}

export function createMeRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.json({ user: loadUser(db, user.id), unreadNotifications: unreadNotificationCount(db, user.id) });
  });

  router.patch('/', (req, res) => {
    const user = requireAuth(req);
    const body = parse(profileSchema, req.body);
    if (!body.username && !body.email && body.emailNotifications === undefined) {
      throw badRequest('Nothing to update.', 'NO_CHANGES');
    }
    if (body.username && body.username.toLowerCase() !== user.username.toLowerCase()) {
      const taken = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(body.username);
      if (taken) {
        throw conflict('That username is already taken.', 'USERNAME_TAKEN', {
          fields: { username: 'That username is already taken.' },
        });
      }
    }
    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      const taken = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(body.email);
      if (taken) {
        throw conflict('That email is already in use.', 'EMAIL_TAKEN', {
          fields: { email: 'An account already uses this email.' },
        });
      }
    }
    const now = nowIso();
    const oldEmail = user.email;
    const emailChanged = Boolean(body.email && body.email.toLowerCase() !== user.email.toLowerCase());
    const nextEmail = body.email ?? user.email;
    db.prepare(
      `UPDATE users SET username = ?, email = ?, email_verified = CASE WHEN ? THEN 0 ELSE email_verified END,
              email_notifications = ?, updated_at = ? WHERE id = ?`,
    ).run(
      body.username ?? user.username,
      nextEmail,
      emailChanged ? 1 : 0,
      (body.emailNotifications ?? user.emailNotifications) ? 1 : 0,
      now,
      user.id,
    );
    recordAudit(db, {
      actorId: user.id,
      action: 'profile.update',
      targetType: 'user',
      targetId: user.id,
      targetLabel: body.username ?? user.username,
      metadata: {
        usernameChanged: Boolean(body.username),
        emailChanged,
        emailNotifications: body.emailNotifications,
      },
      ip: clientIp(req),
    });
    if (emailChanged) {
      // A deletion link is tied to the email that received it. A changed
      // address must not leave an old link able to erase the account.
      db.prepare('DELETE FROM account_deletion_requests WHERE user_id = ? AND used_at IS NULL').run(user.id);
      const emailSettings = getEmailConfig(db);
      if (emailSettings.securityNotifications) {
        enqueueEmail(db, {
          userId: user.id,
          recipient: oldEmail,
          template: 'email-changed',
          payload: { username: body.username ?? user.username, newEmail: nextEmail },
          dedupeKey: `email-changed:${user.id}:${now}`,
        });
      }
      const verification = createEmailVerification(db, user.id, nextEmail);
      enqueueEmail(db, {
        userId: user.id,
        recipient: nextEmail,
        template: 'verify-email',
        payload: {
          username: body.username ?? user.username,
          verifyUrl: verification.path,
          expiresAt: verification.expiresAt,
        },
        dedupeKey: `verify-email:${user.id}:${now}`,
      });
      notify(db, {
        userId: user.id,
        type: 'security',
        title: 'Email address pending verification',
        body: `Confirm ${nextEmail} to finish updating your account. Your previous address was notified.`,
        link: '/settings',
      });
    }
    res.json({ user: loadUser(db, user.id) });
  });

  router.post('/delete-account/request', (req, res) => {
    const user = requireAuth(req);
    const body = parse(deleteAccountRequestSchema, req.body);
    guardDeleteRate(resetLimiter.consume(`delete-account:${user.id}`));

    const row = db
      .prepare('SELECT username, email, password_hash, deleted_at FROM users WHERE id = ?')
      .get(user.id) as
      | { username: string; email: string; password_hash: string; deleted_at: string | null }
      | undefined;
    if (!row || row.deleted_at) {
      throw conflict('This account has already been deleted.', 'ACCOUNT_DELETED');
    }
    if (!verifyPassword(body.password, row.password_hash)) {
      throw new ApiError(400, 'INVALID_PASSWORD', 'Your current password is incorrect.', {
        fields: { password: 'Incorrect password.' },
      });
    }

    const deletion = issueAccountDeletionRequest(db, user.id, row.email);
    const queued = enqueueEmail(db, {
      userId: user.id,
      recipient: row.email,
      template: 'account-deletion',
      payload: { username: row.username, deleteUrl: deletion.path, expiresAt: deletion.expiresAt },
      dedupeKey: `account-deletion:${user.id}:${deletion.expiresAt}`,
    });

    if (!queued && !config.exposeResetToken) {
      db.prepare('DELETE FROM account_deletion_requests WHERE user_id = ? AND used_at IS NULL').run(user.id);
      throw new ApiError(
        503,
        'EMAIL_UNAVAILABLE',
        'Email delivery is not configured, so we cannot verify this deletion by email. Contact support for help deleting your account.',
      );
    }

    recordAudit(db, {
      actorId: user.id,
      action: 'account.deletion_requested',
      targetType: 'user',
      targetId: user.id,
      targetLabel: row.username,
      ip: clientIp(req),
    });

    res.json({
      ok: true,
      sent: Boolean(queued),
      expiresAt: deletion.expiresAt,
      message: queued
        ? 'A confirmation link is on its way to your email address. Open it to finish deleting your account.'
        : 'Email delivery is unavailable in this environment. Use the local confirmation link below.',
      ...(config.exposeResetToken ? { deletePath: deletion.path } : {}),
    });
  });

  router.post('/delete-account/confirm', (req, res) => {
    const user = requireAuth(req);
    const body = parse(deleteAccountConfirmSchema, req.body);
    guardDeleteRate(resetLimiter.consume(`delete-account-confirm:${user.id}`));

    const request = findAccountDeletionRequest(db, body.token);
    if (
      !request ||
      request.user_id !== user.id ||
      request.used_at ||
      new Date(request.expires_at).getTime() <= Date.now()
    ) {
      throw badRequest(
        'This deletion link is invalid, has expired, or belongs to another account. Request a new link from your security settings.',
        'INVALID_DELETION_TOKEN',
      );
    }
    if (request.email.toLowerCase() !== user.email.toLowerCase()) {
      throw badRequest(
        'The email on this account changed after this link was issued. Request a new deletion link.',
        'EMAIL_CHANGED',
      );
    }

    deleteAccount(db, user.id, clientIp(req));
    clearSessionCookie(res, req);
    res.json({
      ok: true,
      message: 'Your account and personal data have been deleted. Financial ledger entries are retained without your identity where the law requires it.',
    });
  });

  router.get('/wallet', (req, res) => {
    const user = requireAuth(req);
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END), 0) AS wagered,
           COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END), 0) AS won,
           COALESCE(SUM(CASE WHEN type IN ('initial_grant','admin_adjustment','reversal','credit_request') THEN amount ELSE 0 END), 0) AS granted
         FROM ledger WHERE user_id = ?`,
      )
      .get(user.id) as { wagered: number; won: number; granted: number };
    const pendingCashier = (
      db
        .prepare("SELECT COUNT(*) AS count FROM cashier_requests WHERE user_id = ? AND status = 'pending'")
        .get(user.id) as { count: number }
    ).count;
    res.json({
      balance: balanceOf(db, user.id),
      lifetimeWagered: row.wagered,
      lifetimeWon: row.won,
      lifetimeGranted: row.granted,
      net: row.won - row.wagered,
      pendingCashier,
      payoutCap: getSetting(db, 'economy.max_payout', 1_000_000),
    });
  });

  router.get('/transactions', (req, res) => {
    const user = requireAuth(req);
    const query = parse(ledgerQuerySchema, req.query);
    const clauses = ['l.user_id = ?'];
    const params: unknown[] = [user.id];
    if (query.type) {
      clauses.push('l.type = ?');
      params.push(query.type);
    }
    if (query.from) {
      clauses.push('l.created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      clauses.push('l.created_at <= ?');
      params.push(query.to);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM ledger l ${where}`).get(...params) as { count: number }
    ).count;
    const items = ledgerSelect(db, where, params, query.pageSize, (query.page - 1) * query.pageSize);
    const response: Paginated<unknown> & { balance: number } = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      balance: balanceOf(db, user.id),
    };
    res.json(response);
  });

  router.get('/notifications', (req, res) => {
    const user = requireAuth(req);
    const query = parse(pageQuerySchema.extend({ filter: z.enum(['all', 'unread']).optional() }), req.query);
    const onlyUnread = query.filter === 'unread';
    const where = `WHERE user_id = ? ${onlyUnread ? 'AND read_at IS NULL' : ''}`;
    const total = (
      db.prepare(`SELECT COUNT(*) AS count FROM notifications ${where}`).get(user.id) as { count: number }
    ).count;
    const rows = db
      .prepare(
        `SELECT id, type, title, body, link, read_at, created_at FROM notifications ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(user.id, query.pageSize, (query.page - 1) * query.pageSize) as Parameters<typeof mapNotification>[0][];
    const response = {
      items: rows.map(mapNotification) as NotificationItem[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      unread: unreadNotificationCount(db, user.id),
    };
    res.json(response);
  });

  router.post('/notifications/read-all', (req, res) => {
    const user = requireAuth(req);
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), user.id);
    res.json({ ok: true, unread: 0 });
  });

  router.post('/notifications/:id/read', (req, res) => {
    const user = requireAuth(req);
    const result = db
      .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?')
      .run(nowIso(), req.params.id ?? '', user.id);
    if (result.changes !== 1) throw notFound('Notification not found.');
    res.json({ ok: true, unread: unreadNotificationCount(db, user.id) });
  });

  router.get('/sessions', (req, res) => {
    const user = requireAuth(req);
    const rows = db
      .prepare(
        `SELECT id, created_at, expires_at, last_used_at, ip, user_agent, revoked_at
         FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC`,
      )
      .all(user.id, nowIso()) as {
      id: string;
      created_at: string;
      expires_at: string;
      last_used_at: string;
      ip: string | null;
      user_agent: string | null;
    }[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === req.sessionId,
      })),
    });
  });

  router.delete('/sessions/:id', (req, res) => {
    const user = requireAuth(req);
    const row = db
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .get(req.params.id ?? '', user.id) as { id: string } | undefined;
    if (!row) throw notFound('Session not found.');
    revokeSession(db, row.id);
    recordAudit(db, {
      actorId: user.id,
      action: 'auth.session_revoked',
      targetType: 'session',
      targetId: row.id,
      ip: clientIp(req),
    });
    res.json({ ok: true });
  });

  router.post('/sessions/revoke-others', (req, res) => {
    const user = requireAuth(req);
    if (!req.sessionId) throw badRequest('No active session.', 'NO_SESSION');
    revokeOtherSessions(db, user.id, req.sessionId);
    recordAudit(db, {
      actorId: user.id,
      action: 'auth.sessions_revoked',
      targetType: 'session',
      targetId: req.sessionId,
      ip: clientIp(req),
    });
    res.json({ ok: true });
  });

  router.post('/self-exclusion', (req, res) => {
    const user = requireAuth(req);
    const body = parse(selfExclusionSchema, req.body);
    if (isSelfExclusionActive(user.selfExcludedUntil)) {
      throw conflict('This account is already self-excluded.', 'ALREADY_SELF_EXCLUDED');
    }

    const now = nowIso();
    const until = selfExclusionUntil(body.duration, Date.now());
    db.transaction(() => {
      db.prepare(
        `UPDATE users
         SET self_excluded_at = ?, self_excluded_until = ?, self_exclusion_reason = ?, updated_at = ?
         WHERE id = ?`,
      ).run(now, until, body.reason ?? null, now, user.id);
      revokeAllSessions(db, user.id);
      recordAudit(db, {
        actorId: user.id,
        action: 'account.self_exclusion',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.username,
        reason: body.reason ?? null,
        metadata: { duration: body.duration, until },
        ip: clientIp(req),
      });
    })();
    clearSessionCookie(res, req);
    res.json({
      ok: true,
      until,
      permanent: body.duration === 'permanent',
      message:
        body.duration === 'permanent'
          ? 'Your account is permanently self-excluded. Contact support if you need help.'
          : `Your account is self-excluded until ${until.slice(0, 10)}. You have been signed out.`,
    });
  });

  router.get('/overview', (req, res) => {
    const user = requireAuth(req);
    const tickets = ticketCounts(db, user, { ownOnly: true });
    const recentLedger = ledgerSelect(db, 'WHERE l.user_id = ?', [user.id], 6, 0);
    const recentSessions = db
      .prepare(
        `SELECT id, game_id, bet, status, payout, created_at, ended_at FROM game_sessions
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`,
      )
      .all(user.id) as {
      id: string;
      game_id: string;
      bet: number;
      status: string;
      payout: number;
      created_at: string;
      ended_at: string | null;
    }[];
    const gameStats = db
      .prepare(
        `SELECT COUNT(*) AS played, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout),0) AS won
         FROM game_sessions WHERE user_id = ?`,
      )
      .get(user.id) as { played: number; wagered: number; won: number };
    const activeTickets = (
      db
        .prepare(
          `SELECT reference, subject, status, priority, last_activity_at FROM tickets
           WHERE user_id = ? AND status NOT IN ('closed','rejected') ORDER BY last_activity_at DESC LIMIT 3`,
        )
        .all(user.id) as TicketRow[]
    ).map((row) => ({
      reference: row.reference,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      lastActivityAt: row.last_activity_at,
    }));
    res.json({
      balance: balanceOf(db, user.id),
      tickets,
      gamesPlayed: gameStats.played,
      lifetimeWagered: gameStats.wagered,
      lifetimeWon: gameStats.won,
      activeTickets,
      unreadNotifications: unreadNotificationCount(db, user.id),
      recentTransactions: recentLedger,
      recentGames: recentSessions.map((row) => ({
        id: row.id,
        game: row.game_id,
        bet: row.bet,
        status: row.status,
        payout: row.payout,
        createdAt: row.created_at,
        endedAt: row.ended_at,
        gameLabel: row.game_id.charAt(0).toUpperCase() + row.game_id.slice(1),
      })),
      startingCredits: getSetting(db, 'economy.starting_credits', config.startingCredits),
      maxPayout: getSetting(db, 'economy.max_payout', 1_000_000),
      platformName: getSetting(db, 'platform.name', config.appName),
    });
  });

  return router;
}
