import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { conflict, newId, nowIso } from './core.ts';
import { randomToken, tokenHash } from './crypto.ts';
import { recordAudit } from './audit.ts';

export const ACCOUNT_DELETION_TTL_MS = 30 * 60_000;

export interface DeletionRequestRow {
  id: string;
  user_id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
}

export interface IssuedDeletionRequest {
  token: string;
  path: string;
  expiresAt: string;
}

/**
 * Issues a single-use, short-lived confirmation link. Any older unused link
 * for the account is retired first so an old email cannot delete the account.
 */
export function issueAccountDeletionRequest(db: DB, userId: string, email: string): IssuedDeletionRequest {
  const token = randomToken(32);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + ACCOUNT_DELETION_TTL_MS).toISOString();
  db.transaction(() => {
    db.prepare('UPDATE account_deletion_requests SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now, userId);
    db.prepare(
      `INSERT INTO account_deletion_requests (id, user_id, email, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId('del'), userId, email, tokenHash(token), now, expiresAt);
  })();
  return {
    token,
    path: `/delete-account?token=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export function findAccountDeletionRequest(db: DB, token: string): DeletionRequestRow | undefined {
  return db
    .prepare(
      `SELECT id, user_id, email, expires_at, used_at
         FROM account_deletion_requests
        WHERE token_hash = ?`,
    )
    .get(tokenHash(token)) as DeletionRequestRow | undefined;
}

/**
 * Erases the account's identity and personal records while keeping the
 * immutable ledger under a pseudonymous internal id. Ledger integrity is a
 * legal/accounting obligation, so the id must survive even though nothing in
 * the remaining row identifies the person.
 */
export function deleteAccount(db: DB, userId: string, ip: string | null = null): void {
  db.transaction(() => {
    const target = db
      .prepare('SELECT id, username, email, role FROM users WHERE id = ?')
      .get(userId) as { id: string; username: string; email: string; role: string } | undefined;
    if (!target) throw conflict('This account no longer exists.', 'ACCOUNT_DELETED');

    if (target.role === 'owner') {
      const otherOwners = (
        db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND id <> ?").get(userId) as { count: number }
      ).count;
      if (otherOwners === 0) {
        throw conflict(
          'The last owner account cannot be deleted. Transfer ownership to another account first.',
          'LAST_OWNER',
        );
      }
    }

    const suffix = randomBytes(12).toString('hex');
    const anonymousUsername = `deleted_${suffix}`;
    const anonymousEmail = `deleted_${suffix}@deleted.invalid`;
    const now = nowIso();

    // Remove records that belong to this person or contain their activity.
    db.prepare('DELETE FROM active_rounds WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM game_sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM reward_claims WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM bet_activity_days WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM account_deletion_requests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM email_jobs WHERE user_id = ? OR recipient = ?').run(userId, target.email);
    db.prepare('DELETE FROM legal_acceptances WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM ticket_reads WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM credit_requests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tickets WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM cashier_requests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM account_reviews WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(userId);

    // References from records that belong to other people must not keep the
    // deleted identity attached. The ledger's actor column is append-only and
    // cannot be updated, but it stores only the pseudonymous internal id.
    db.prepare('UPDATE tickets SET assignee_id = NULL WHERE assignee_id = ?').run(userId);
    db.prepare('UPDATE ticket_messages SET author_id = NULL WHERE author_id = ?').run(userId);
    db.prepare('UPDATE ticket_events SET actor_id = NULL WHERE actor_id = ?').run(userId);
    db.prepare('UPDATE credit_requests SET reviewer_id = NULL WHERE reviewer_id = ?').run(userId);
    db.prepare('UPDATE cashier_requests SET reviewer_id = NULL WHERE reviewer_id = ?').run(userId);
    db.prepare('UPDATE cashier_messages SET author_id = NULL WHERE author_id = ?').run(userId);
    db.prepare('UPDATE notifications SET actor_id = NULL WHERE actor_id = ?').run(userId);
    db.prepare("UPDATE chat_messages SET user_id = NULL, username = 'Deleted account' WHERE user_id = ?").run(userId);
    db.prepare('UPDATE account_reviews SET reviewed_by = NULL WHERE reviewed_by = ?').run(userId);
    db.prepare('UPDATE account_review_events SET actor_id = NULL WHERE actor_id = ?').run(userId);
    db.prepare('UPDATE announcements SET created_by = NULL WHERE created_by = ?').run(userId);
    db.prepare('UPDATE settings SET updated_by = NULL WHERE updated_by = ?').run(userId);
    db.prepare('UPDATE games SET updated_by = NULL WHERE updated_by = ?').run(userId);

    // Prior audit history can contain the old username, email, or address.
    db.prepare(
      'DELETE FROM audit_logs WHERE actor_id = ? OR target_id = ? OR target_label = ? OR target_label = ?',
    ).run(userId, userId, target.username, target.email);
    db.prepare('DELETE FROM rate_limits WHERE key IN (?, ?, ?, ?, ?)').run(
      `login:${target.username.toLowerCase()}`,
      `login:${target.email.toLowerCase()}`,
      `forgot-email:${target.email.toLowerCase()}`,
      `verify:${userId}`,
      `chat:user:${userId}`,
    );

    db.prepare(
      `UPDATE users
          SET username = ?, email = ?, password_hash = ?, role = 'user', status = 'suspended',
              email_verified = 0, email_notifications = 0, restriction_reason = NULL,
              account_hold = 0, account_hold_reason = NULL, account_hold_at = NULL,
              self_excluded_at = NULL, self_excluded_until = NULL, self_exclusion_reason = NULL,
              registration_ip = NULL, last_login_at = NULL, last_seen_at = NULL,
              deleted_at = ?, updated_at = ?
        WHERE id = ?`,
    ).run(anonymousUsername, anonymousEmail, `!deleted-${suffix}`, now, now, userId);

    // Keep a non-identifying operational trail that a self-service deletion
    // happened, without linking it back to the erased account.
    recordAudit(db, {
      action: 'account.deleted',
      targetType: 'account',
      targetLabel: 'self-service deletion',
      metadata: { retainedFinancialLedger: true },
      ip,
    });
  }).immediate();
}
