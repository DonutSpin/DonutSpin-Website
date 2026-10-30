import type { DB } from '../db/index.ts';
import type { AccountReviewStatus } from '../../shared/types.ts';
import { getSetting } from '../db/index.ts';
import { recordAudit } from './audit.ts';
import { newId, nowIso } from './core.ts';

export const ACCOUNTS_PER_IP_SETTING = 'security.accounts_per_ip';
export const DEFAULT_ACCOUNTS_PER_IP = 3;

export function accountsPerIp(db: DB): number {
  const value = Number(getSetting(db, ACCOUNTS_PER_IP_SETTING, DEFAULT_ACCOUNTS_PER_IP));
  if (!Number.isFinite(value)) return DEFAULT_ACCOUNTS_PER_IP;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

interface CandidateRow {
  id: string;
  username: string;
  role: string;
  status: string;
  registration_ip: string | null;
}

/**
 * Runs after a successful registration. Once the number of player accounts on
 * this address exceeds the configured allowance, every related player account
 * is flagged and held for support review. Staff accounts are never auto-held.
 */
export function flagSharedIpAccounts(
  db: DB,
  actorUserId: string,
  ip: string | null,
): { flagged: number; related: number } {
  if (!ip) return { flagged: 0, related: 0 };
  const limit = accountsPerIp(db);
  const candidates = db
    .prepare(
      `SELECT id, username, role, status, registration_ip
         FROM users
        WHERE registration_ip = ? AND role = 'user'
        ORDER BY created_at ASC`,
    )
    .all(ip) as CandidateRow[];
  if (candidates.length <= limit) return { flagged: 0, related: candidates.length };

  const now = nowIso();
  const relatedIds = candidates.map((row) => row.id);
  const reason = `Automatic review: ${candidates.length} player accounts registered from the same network (allowance ${limit}).`;
  const related = JSON.stringify(relatedIds);
  let flagged = 0;

  db.transaction(() => {
    for (const candidate of candidates) {
      const existing = db
        .prepare('SELECT id, status FROM account_reviews WHERE user_id = ?')
        .get(candidate.id) as { id: string; status: AccountReviewStatus } | undefined;
      const nextStatus: AccountReviewStatus = existing?.status === 'alt_confirmed' ? 'alt_confirmed' : 'open';
      const reviewId = existing?.id ?? newId('rev');
      const shouldReopen = !existing || existing.status === 'cleared' || existing.status === 'resolved';
      if (!existing) {
        db.prepare(
          `INSERT INTO account_reviews
             (id, user_id, status, reason, trigger_ip, related_user_ids, related_count, flagged_at, updated_at)
           VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
        ).run(reviewId, candidate.id, reason, ip, related, relatedIds.length, now, now);
        flagged += 1;
      } else {
        db.prepare(
          `UPDATE account_reviews
              SET status = ?, reason = ?, trigger_ip = ?, related_user_ids = ?, related_count = ?, updated_at = ?,
                  reviewed_by = CASE WHEN ? THEN NULL ELSE reviewed_by END,
                  reviewed_at = CASE WHEN ? THEN NULL ELSE reviewed_at END,
                  decision_reason = CASE WHEN ? THEN NULL ELSE decision_reason END,
                  hold_released_at = CASE WHEN ? THEN NULL ELSE hold_released_at END
            WHERE id = ?`,
        ).run(
          nextStatus,
          reason,
          ip,
          related,
          relatedIds.length,
          now,
          shouldReopen ? 1 : 0,
          shouldReopen ? 1 : 0,
          shouldReopen ? 1 : 0,
          shouldReopen ? 1 : 0,
          reviewId,
        );
        if (shouldReopen) flagged += 1;
      }

      if (shouldReopen) {
        db.prepare(
          `INSERT INTO account_review_events
             (id, review_id, actor_id, action, from_status, to_status, reason, created_at)
           VALUES (?, ?, NULL, 'auto_flag', ?, 'open', ?, ?)`,
        ).run(newId('rev_ev'), reviewId, existing?.status ?? null, reason, now);
        recordAudit(db, {
          action: 'account_review.auto_flag',
          targetType: 'account_review',
          targetId: reviewId,
          targetLabel: candidate.username,
          reason,
          metadata: { triggerIp: ip, relatedAccounts: relatedIds.length, allowance: limit, sourceUserId: actorUserId },
        });
      }

      // The hold is deliberately independent of the normal account status, so
      // support can release it without changing a player's role or access tier.
      db.prepare(
        `UPDATE users
            SET account_hold = 1,
                account_hold_reason = ?,
                account_hold_at = COALESCE(account_hold_at, ?),
                updated_at = ?
          WHERE id = ?`,
      ).run(reason, now, now, candidate.id);
    }
  })();

  return { flagged, related: candidates.length };
}
