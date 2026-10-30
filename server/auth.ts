import type { Request, Response, NextFunction } from 'express';
import type { CookieOptions } from 'express';
import type { DB } from './db/index.ts';
import { config, SESSION_COOKIE } from './config.ts';
import { randomToken, tokenHash } from './lib/crypto.ts';
import { nowIso } from './lib/core.ts';
import { ROLE_PERMISSIONS, type AccountStatus, type Role, type SessionUser } from '../shared/types.ts';
import { isCurrentLegalAcceptance, isSelfExclusionActive, latestLegalAcceptance } from './lib/legal.ts';

interface SessionJoinRow {
  session_id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string;
  username: string;
  email: string;
  role: Role;
  status: AccountStatus;
  email_verified: number;
  email_notifications: number;
  created_at: string;
  last_login_at: string | null;
  self_excluded_until: string | null;
  balance: number;
}

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  };
}

export function createSession(db: DB, userId: string, req: Request): { token: string; sessionId: string; expiresAt: string } {
  const token = randomToken(32);
  const sessionId = `ses_${randomToken(12)}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, tokenHash(token), createdAt, expiresAt, createdAt, req.ip ?? null, req.get('user-agent') ?? null);
  return { token, sessionId, expiresAt };
}

export function revokeSession(db: DB, sessionId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), sessionId);
}

export function revokeAllSessions(db: DB, userId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
}

export function revokeOtherSessions(db: DB, userId: string, keepSessionId: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').run(
    nowIso(),
    userId,
    keepSessionId,
  );
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
}

export function loadUser(db: DB, userId: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.email_verified, u.email_notifications,
              u.created_at, u.last_login_at, u.self_excluded_until, w.balance
       FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?`,
    )
    .get(userId) as
    | {
        id: string;
        username: string;
        email: string;
        role: Role;
        status: AccountStatus;
        email_verified: number;
        email_notifications: number;
        created_at: string;
        last_login_at: string | null;
        self_excluded_until: string | null;
        balance: number;
      }
    | undefined;
  if (!row) return null;
  const acceptance = latestLegalAcceptance(db, row.id);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    emailNotifications: Boolean(row.email_notifications),
    balance: row.balance,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    legalAcceptanceRequired: !isCurrentLegalAcceptance(acceptance),
    legalAcceptedAt: acceptance?.accepted_at ?? null,
    selfExcludedUntil: row.self_excluded_until,
    permissions: ROLE_PERMISSIONS[row.role],
  };
}

export function authMiddleware(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) return next();
    const row = db
      .prepare(
        `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, s.last_used_at,
                u.username, u.email, u.role, u.status, u.email_verified, u.email_notifications,
                u.created_at, u.last_login_at, u.self_excluded_until, w.balance
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN wallets w ON w.user_id = u.id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash(token)) as SessionJoinRow | undefined;
    if (!row) {
      clearSessionCookie(res);
      return next();
    }
    if (
      row.revoked_at ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      row.status === 'suspended' ||
      isSelfExclusionActive(row.self_excluded_until)
    ) {
      if (!row.revoked_at) revokeSession(db, row.session_id);
      clearSessionCookie(res);
      return next();
    }
    const acceptance = latestLegalAcceptance(db, row.user_id);
    req.user = {
      id: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      emailVerified: Boolean(row.email_verified),
      emailNotifications: Boolean(row.email_notifications),
      balance: row.balance,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      legalAcceptanceRequired: !isCurrentLegalAcceptance(acceptance),
      legalAcceptedAt: acceptance?.accepted_at ?? null,
      selfExcludedUntil: row.self_excluded_until,
      permissions: ROLE_PERMISSIONS[row.role],
    };
    req.sessionId = row.session_id;
    const now = Date.now();
    if (now - new Date(row.last_used_at).getTime() > 5 * 60_000) {
      db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(nowIso(), row.session_id);
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.user_id);
    }
    next();
  };
}
