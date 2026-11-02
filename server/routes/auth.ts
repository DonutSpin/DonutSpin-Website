import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { config } from '../config.ts';
import {
  clearSessionCookie,
  createSession,
  loadUser,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession,
  setSessionCookie,
} from '../auth.ts';
import { hashPassword, resetToken, tokenHash, verifyPassword } from '../lib/crypto.ts';
import { ApiError, badRequest, clientIp, conflict, newId, nowIso, parseJson } from '../lib/core.ts';
import { parse, emailSchema, passwordSchema, usernameSchema } from '../lib/validation.ts';
import { getSetting } from '../db/index.ts';
import { createWallet } from '../lib/wallet.ts';
import { recordAudit } from '../lib/audit.ts';
import { notify, unreadNotificationCount } from '../lib/notifications.ts';
import { enqueueEmail, getEmailConfig } from '../lib/email.ts';
import { createEmailVerification, verifyEmailToken } from '../lib/email-verification.ts';
import {
  clientAddress,
  loginIpLimiter,
  loginLimiter,
  registerGlobalLimiter,
  registerLimiter,
  resetLimiter,
} from '../lib/rate-limit.ts';
import { createTurnstileVerifier, type TurnstileVerifier } from '../lib/turnstile.ts';
import { flagSharedIpAccounts } from '../lib/account-review.ts';
import { requireAuth } from '../lib/permissions.ts';
import { assertNotInMaintenance } from '../lib/maintenance.ts';
import { compactAmount } from '../../shared/amount.ts';
import { recordLegalAcceptance } from '../lib/legal.ts';
import { isSelfExclusionActive } from '../lib/legal.ts';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '../../shared/legal.ts';

const requiredConsent = (message: string) =>
  z.boolean().refine((value) => value === true, { message });

const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  ageConfirmed: requiredConsent('You must confirm that you are 18 years or older.'),
  acceptTerms: requiredConsent('You must agree to the Terms of Service and Privacy Policy.'),
  acknowledgeDonutRules: requiredConsent('You must acknowledge the DonutSMP risk.'),
  turnstileToken: z.string().trim().max(2048).optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
  turnstileToken: z.string().trim().max(2048).optional(),
});

const forgotSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().trim().max(2048).optional(),
});

const resetSchema = z.object({
  token: z.string().min(10, 'Reset link is invalid.'),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordSchema,
});

const verifyEmailSchema = z.object({ token: z.string().min(10, 'Verification link is invalid.').max(200) });

function limiterGuard(result: { allowed: boolean; retryAfterSeconds: number }): void {
  if (!result.allowed) {
    throw new ApiError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${result.retryAfterSeconds} seconds.`);
  }
}

export function createAuthRouter(
  db: DB,
  turnstile: TurnstileVerifier = createTurnstileVerifier(config.turnstile),
): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const body = parse(registerSchema, req.body);
    // Per-address registration limit when the real address is known; without
    // one, a platform-wide ceiling stops scripted sign-ups from running wild.
    const registerAddress = clientAddress(req);
    const registrationIp = registerAddress;
    if (registerAddress) limiterGuard(registerLimiter.consume(`register:ip:${registerAddress}`));
    else limiterGuard(registerGlobalLimiter.consume('register:global'));
    if (!getSetting(db, 'platform.registration_open', true)) {
      throw new ApiError(403, 'REGISTRATION_CLOSED', 'Registration is currently closed.');
    }
    assertNotInMaintenance(db);
    await turnstile.verify(body.turnstileToken, 'register', clientAddress(req));

    const existing = db
      .prepare('SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
      .get(body.username, body.email) as { id: string; username: string; email: string } | undefined;
    if (existing) {
      const fields: Record<string, string> = {};
      if (existing.username.toLowerCase() === body.username.toLowerCase()) fields.username = 'That username is already taken.';
      if (existing.email.toLowerCase() === body.email.toLowerCase()) fields.email = 'An account with this email already exists.';
      throw new ApiError(409, 'ACCOUNT_EXISTS', 'Choose a different username or email.', { fields });
    }

    const userId = newId('usr');
    const now = nowIso();
    const startingCredits = getSetting(db, 'economy.starting_credits', config.startingCredits);
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO users (id, username, email, password_hash, role, status, registration_ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'user', 'active', ?, ?, ?)`,
        ).run(userId, body.username, body.email, hashPassword(body.password), registrationIp, now, now);
        createWallet(db, userId, startingCredits, userId);
        recordLegalAcceptance(db, {
          userId,
          ip: clientIp(req),
          userAgent: req.get('user-agent') ?? null,
          acceptedAt: now,
        });
      })();
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw conflict('That username or email is already in use.', 'ACCOUNT_EXISTS');
      }
      throw error;
    }

    // Detection is deliberately best-effort: an IP lookup or review write must
    // never turn a successful registration into an error. The regular flow is
    // protected server-side even if the background review cannot be recorded.
    try {
      flagSharedIpAccounts(db, userId, registrationIp);
    } catch (error) {
      console.warn('[account-review] registration check failed:', error instanceof Error ? error.message : error);
    }

    notify(db, {
      userId,
      type: 'account',
      title: 'Welcome to Donutcash',
      body: `${compactAmount(startingCredits)} DonutSMP money was added to your wallet. Verify your email before your first bet.`,
      link: '/settings#email',
    });
    const verification = createEmailVerification(db, userId, body.email);
    enqueueEmail(db, {
      userId,
      recipient: body.email,
      template: 'welcome',
      payload: {
        username: body.username,
        startingCredits,
        verifyUrl: verification.path,
      },
      dedupeKey: `welcome:${userId}`,
    });
    recordAudit(db, {
      actorId: userId,
      action: 'auth.register',
      targetType: 'user',
      targetId: userId,
      targetLabel: body.username,
      ip: clientIp(req),
      metadata: {
        startingCredits,
        legalTermsVersion: LEGAL_TERMS_VERSION,
        legalPrivacyVersion: LEGAL_PRIVACY_VERSION,
      },
    });

    const { token } = createSession(db, userId, req);
    setSessionCookie(res, token, req);
    res.status(201).json({ user: loadUser(db, userId), startingCredits });
  });

  router.post('/login', async (req, res) => {
    const body = parse(loginSchema, req.body);
    // Always bound attempts per account, independent of the address. A per-IP
    // limit is added only when a trustworthy address exists, because behind IIS
    // the socket is the proxy and a shared bucket would lock every player out.
    const ipKey = `login:${body.identifier.toLowerCase()}`;
    limiterGuard(loginLimiter.consume(ipKey));
    const loginAddress = clientAddress(req);
    if (loginAddress) limiterGuard(loginIpLimiter.consume(`login-ip:${loginAddress}`));
    await turnstile.verify(body.turnstileToken, 'login', loginAddress);

    const row = db
      .prepare(
        `SELECT id, username, email, role, status, password_hash, self_excluded_until, registration_ip FROM users
         WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE`,
      )
      .get(body.identifier, body.identifier) as
      | {
          id: string;
          username: string;
          email: string;
          role: string;
          status: string;
          password_hash: string;
          self_excluded_until: string | null;
          registration_ip: string | null;
        }
      | undefined;

    if (!row || !verifyPassword(body.password, row.password_hash)) {
      recordAudit(db, {
        action: 'auth.login_failed',
        targetType: 'user',
        targetLabel: body.identifier,
        ip: clientIp(req),
      });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect username, email, or password.');
    }
    if (isSelfExclusionActive(row.self_excluded_until)) {
      recordAudit(db, {
        actorId: row.id,
        action: 'auth.login_blocked',
        targetType: 'user',
        targetId: row.id,
        targetLabel: row.username,
        reason: 'Self-exclusion active',
        ip: clientIp(req),
      });
      const permanent = (row.self_excluded_until ?? '').startsWith('9999');
      throw new ApiError(
        403,
        'SELF_EXCLUDED',
        permanent
          ? 'This account is permanently self-excluded and cannot sign in.'
          : `This account is self-excluded until ${row.self_excluded_until?.slice(0, 10)} and cannot sign in.`,
        { selfExcludedUntil: row.self_excluded_until },
      );
    }
    if (row.status === 'suspended') {
      recordAudit(db, {
        actorId: row.id,
        action: 'auth.login_blocked',
        targetType: 'user',
        targetId: row.id,
        targetLabel: row.username,
        reason: 'Account suspended',
        ip: clientIp(req),
      });
      throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support for help.');
    }

    loginLimiter.reset(ipKey);
    if (!row.registration_ip && loginAddress) {
      db.prepare('UPDATE users SET registration_ip = ?, updated_at = ? WHERE id = ?').run(
        loginAddress,
        nowIso(),
        row.id,
      );
    }
    const previousSession = db
      .prepare('SELECT ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(row.id) as { ip: string | null; user_agent: string | null } | undefined;
    const now = nowIso();
    db.prepare('UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?').run(now, now, row.id);
    const { token } = createSession(db, row.id, req);
    setSessionCookie(res, token, req);
    const email = getEmailConfig(db);
    const newDevice =
      previousSession &&
      (previousSession.ip !== clientIp(req) || previousSession.user_agent !== (req.get('user-agent') ?? null));
    if (newDevice && email.securityNotifications) {
      enqueueEmail(db, {
        userId: row.id,
        recipient: row.email,
        template: 'new-login',
        payload: {
          username: row.username,
          at: now,
          ip: clientIp(req) ?? 'Unknown',
          device: (req.get('user-agent') ?? 'Unknown device').slice(0, 160),
        },
        dedupeKey: `new-login:${row.id}:${now.slice(0, 13)}`,
      });
    }
    recordAudit(db, {
      actorId: row.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: row.id,
      targetLabel: row.username,
      ip: clientIp(req),
    });
    res.json({ user: loadUser(db, row.id) });
  });

  router.post('/logout', (req, res) => {
    if (req.user && req.sessionId) {
      revokeSession(db, req.sessionId);
      recordAudit(db, {
        actorId: req.user.id,
        action: 'auth.logout',
        targetType: 'session',
        targetId: req.sessionId,
        ip: clientIp(req),
      });
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    // The client polls this endpoint for balance changes. Returning the unread
    // count here lets the bell badge update on the same tick instead of waiting
    // for a reload or for the notification menu to be opened.
    res.json({
      user: req.user ?? null,
      unreadNotifications: req.user ? unreadNotificationCount(db, req.user.id) : 0,
    });
  });

  router.post('/forgot-password', async (req, res) => {
    const body = parse(forgotSchema, req.body);
    const forgotAddress = clientAddress(req);
    if (forgotAddress) limiterGuard(resetLimiter.consume(`forgot:ip:${forgotAddress}`));
    limiterGuard(resetLimiter.consume(`forgot-email:${body.email}`));
    await turnstile.verify(body.turnstileToken, 'forgot-password', forgotAddress);

    const user = db
      .prepare('SELECT id, username, email, status FROM users WHERE email = ? COLLATE NOCASE')
      .get(body.email) as { id: string; username: string; email: string; status: string } | undefined;

    let resetPath: string | undefined;
    if (user && user.status !== 'suspended') {
      const { token, hash } = resetToken();
      const now = nowIso();
      const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
      db.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(newId('prs'), user.id, hash, now, expiresAt);
      recordAudit(db, {
        actorId: user.id,
        action: 'auth.password_reset_requested',
        targetType: 'user',
        targetId: user.id,
        targetLabel: user.username,
        ip: clientIp(req),
      });
      const path = `/reset-password?token=${encodeURIComponent(token)}`;
      const queued = enqueueEmail(db, {
        userId: user.id,
        recipient: user.email,
        template: 'password-reset',
        payload: { username: user.username, resetUrl: path },
        dedupeKey: `password-reset:${user.id}:${now}`,
      });
      if (!queued && (!config.isProduction || config.exposeResetToken)) {
        console.info(`[auth] Password reset link for ${user.email}: ${config.appUrl}${path}`);
      }
      if (config.exposeResetToken) resetPath = path;
    }

    res.json({
      message: 'If an account matches that email, a password reset link has been issued. It expires in one hour.',
      ...(resetPath ? { resetPath, devNote: 'EXPOSE_RESET_TOKEN is enabled. Disable it outside local development.' } : {}),
    });
  });

  router.post('/reset-password', async (req, res) => {
    const body = parse(resetSchema, req.body);
    const resetAddress = clientAddress(req);
    if (resetAddress) limiterGuard(resetLimiter.consume(`reset:ip:${resetAddress}`));
    const row = db
      .prepare(
        `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.username, u.email
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = ?`,
      )
      .get(tokenHash(body.token)) as
      | { id: string; user_id: string; expires_at: string; used_at: string | null; username: string; email: string }
      | undefined;
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest('This reset link is invalid or has expired. Request a new one.', 'INVALID_RESET_TOKEN');
    }
    const now = nowIso();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hashPassword(body.password),
        now,
        row.user_id,
      );
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, row.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, row.user_id);
      db.prepare('DELETE FROM account_deletion_requests WHERE user_id = ? AND used_at IS NULL').run(row.user_id);
    })();
    revokeAllSessions(db, row.user_id);
    recordAudit(db, {
      actorId: row.user_id,
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: row.user_id,
      ip: clientIp(req),
    });
    if (getEmailConfig(db).securityNotifications) {
      enqueueEmail(db, {
        userId: row.user_id,
        recipient: row.email,
        template: 'password-changed',
        payload: { username: row.username, changedAt: nowIso() },
        dedupeKey: `password-changed:${row.user_id}:${row.id}`,
      });
    }
    res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  });

  router.post('/change-password', async (req, res) => {
    const user = requireAuth(req);
    const body = parse(changePasswordSchema, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string };
    if (!verifyPassword(body.currentPassword, row.password_hash)) {
      throw new ApiError(400, 'INVALID_PASSWORD', 'Your current password is incorrect.', {
        fields: { currentPassword: 'Incorrect password.' },
      });
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(body.newPassword),
      nowIso(),
      user.id,
    );
    db.prepare('DELETE FROM account_deletion_requests WHERE user_id = ? AND used_at IS NULL').run(user.id);
    if (req.sessionId) revokeOtherSessions(db, user.id, req.sessionId);
    recordAudit(db, {
      actorId: user.id,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      targetLabel: user.username,
      ip: clientIp(req),
    });
    notify(db, {
      userId: user.id,
      type: 'security',
      title: 'Password changed',
      body: 'Your password was changed. If this was not you, contact support immediately.',
      link: '/settings',
    });
    if (getEmailConfig(db).securityNotifications) {
      enqueueEmail(db, {
        userId: user.id,
        recipient: user.email,
        template: 'password-changed',
        payload: { username: user.username, changedAt: nowIso() },
        dedupeKey: `password-changed:${user.id}:${nowIso()}`,
      });
    }
    res.json({ ok: true });
  });

  router.post('/verify-email', (req, res) => {
    const body = parse(verifyEmailSchema, req.body);
    const verified = verifyEmailToken(db, body.token);
    recordAudit(db, {
      actorId: verified.userId,
      action: 'auth.email_verified',
      targetType: 'user',
      targetId: verified.userId,
      ip: clientIp(req),
    });
    res.json({ ok: true, message: 'Email verified. Your account is now fully secured.' });
  });

  router.post('/resend-verification', (req, res) => {
    const user = requireAuth(req);
    if (user.emailVerified) {
      return res.json({ ok: true, alreadyVerified: true, message: 'Your email is already verified.' });
    }
    limiterGuard(resetLimiter.consume(`verify:${user.id}`));
    const verification = createEmailVerification(db, user.id, user.email);
    const queued = enqueueEmail(db, {
      userId: user.id,
      recipient: user.email,
      template: 'verify-email',
      payload: {
        username: user.username,
        verifyUrl: verification.path,
        expiresAt: verification.expiresAt,
      },
      dedupeKey: `verify-email:${user.id}:${Date.now()}`,
    });
    recordAudit(db, {
      actorId: user.id,
      action: 'auth.verification_requested',
      targetType: 'user',
      targetId: user.id,
      ip: clientIp(req),
    });
    res.json({
      ok: true,
      sent: Boolean(queued),
      message: queued
        ? 'A new verification email is on its way.'
        : 'Email delivery is not configured yet. Ask an administrator to enable it.',
      ...(config.exposeResetToken ? { verifyPath: verification.path } : {}),
    });
  });

  return router;
}

export function parseStoredJson<T>(raw: string | null, fallback: T): T {
  return parseJson<T>(raw, fallback);
}
