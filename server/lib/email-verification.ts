import type { DB } from '../db/index.ts';
import { tokenHash, randomToken } from './crypto.ts';
import { ApiError, badRequest, newId, nowIso } from './core.ts';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export interface EmailVerification {
  token: string;
  path: string;
  expiresAt: string;
}

export function createEmailVerification(db: DB, userId: string, address: string): EmailVerification {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFY_TTL_MS).toISOString();
  db.prepare(
    `UPDATE email_verifications SET used_at = ?
     WHERE user_id = ? AND used_at IS NULL`,
  ).run(now.toISOString(), userId);
  db.prepare(
    `INSERT INTO email_verifications (id, user_id, email, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId('evf'), userId, address, tokenHash(token), now.toISOString(), expiresAt);
  return {
    token,
    path: `/verify-email?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export function verifyEmailToken(db: DB, token: string): { userId: string; email: string } {
  const row = db
    .prepare('SELECT * FROM email_verifications WHERE token_hash = ?')
    .get(tokenHash(token)) as
    | {
        id: string;
        user_id: string;
        email: string;
        expires_at: string;
        used_at: string | null;
      }
    | undefined;
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest('This verification link is invalid or has expired. Request a new one.', 'INVALID_VERIFICATION_TOKEN');
  }
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(row.user_id) as
    | { id: string; email: string }
    | undefined;
  if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) {
    throw new ApiError(409, 'EMAIL_CHANGED', 'The email on this account changed after this link was issued. Request a new link.');
  }
  const now = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now, user.id);
    db.prepare('UPDATE email_verifications SET used_at = ? WHERE id = ?').run(now, row.id);
  })();
  return { userId: user.id, email: user.email };
}
