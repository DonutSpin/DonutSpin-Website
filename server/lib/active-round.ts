import type { DB } from '../db/index.ts';
import type { ActiveRound, BaseGameView } from '../../shared/types.ts';
import { conflict, nowIso } from './core.ts';
import { getSessionRow, maxPayout } from '../games/common.ts';
import { getGameModule } from '../games/index.ts';
import { balanceOf } from './wallet.ts';

/** Games whose result arrives with the start response and play out visually on the client. */
export const INSTANT_GAMES = new Set(['coinflip', 'roulette', 'plinko']);

// An unfinished multi-step round must keep the slot until the player resumes
// and finishes it. Settled results stay retrievable for a day, but only block
// new wagers for a short grace period while their animation is fresh.
const PLAYING_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SETTLED_TTL_MS = 24 * 60 * 60 * 1000;
const SETTLED_BLOCK_MS = 5 * 60 * 1000;

export interface ActiveRoundRow {
  user_id: string;
  session_id: string;
  game_id: string;
  status: 'playing' | 'settled';
  created_at: string;
  expires_at: string;
}

function expiryFor(status: 'playing' | 'settled', from = Date.now()): string {
  return new Date(from + (status === 'playing' ? PLAYING_TTL_MS : SETTLED_TTL_MS)).toISOString();
}

function readRow(db: DB, userId: string): ActiveRoundRow | undefined {
  const row = db.prepare('SELECT * FROM active_rounds WHERE user_id = ?').get(userId) as ActiveRoundRow | undefined;
  if (!row) return undefined;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    db.prepare('DELETE FROM active_rounds WHERE user_id = ?').run(userId);
    return undefined;
  }
  return row;
}

export function clearActiveRound(db: DB, userId: string): void {
  db.prepare('DELETE FROM active_rounds WHERE user_id = ?').run(userId);
}

export function clearActiveRoundForSession(db: DB, userId: string, sessionId: string): void {
  db.prepare('DELETE FROM active_rounds WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
}

/** Throws a 409 when the player already has a pending or recently settled round. */
export function assertNoActiveRound(db: DB, userId: string): void {
  const row = readRow(db, userId);
  if (row) {
    if (row.status === 'settled') {
      const settledAt = Date.parse(row.created_at);
      // A settled result is no longer an active bet once its animation window
      // has passed, but it stays available for a later restore.
      if (!Number.isFinite(settledAt) || Date.now() - settledAt <= SETTLED_BLOCK_MS) {
        throw conflict('Finish your current game first.', 'ACTIVE_ROUND', {
          activeRound: { game: row.game_id, sessionId: row.session_id, status: row.status },
        });
      }
    } else {
      throw conflict('Finish your current game first.', 'ACTIVE_ROUND', {
        activeRound: { game: row.game_id, sessionId: row.session_id, status: row.status },
      });
    }
  }

  // Databases upgraded from before the lock existed can still contain an
  // unfinished session. Treat the newest one as the active bet.
  const legacy = newestLegacySession(db, userId);
  if (!legacy) return;
  throw conflict('Finish your current game first.', 'ACTIVE_ROUND', {
    activeRound: { game: legacy.game_id, sessionId: legacy.id, status: 'playing' },
  });
}

function newestLegacySession(db: DB, userId: string): { id: string; game_id: string } | undefined {
  return db
    .prepare(
      "SELECT id, game_id FROM game_sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId) as { id: string; game_id: string } | undefined;
}

/**
 * Persists the lock for a pre-migration session after a failed start attempt.
 * Must run outside the failed start transaction, because that transaction rolls
 * back along with anything written inside it.
 */
export function adoptLegacyActiveRound(db: DB, userId: string): void {
  const legacy = newestLegacySession(db, userId);
  if (!legacy) return;
  const existing = db.prepare('SELECT expires_at FROM active_rounds WHERE user_id = ?').get(userId) as
    | { expires_at: string }
    | undefined;
  if (existing) {
    const expires = Date.parse(existing.expires_at);
    // The failed transaction rolled back the expired row's deletion, so clear
    // it here before adopting the session it was hiding.
    if (Number.isFinite(expires) && expires > Date.now()) return;
    db.prepare('DELETE FROM active_rounds WHERE user_id = ?').run(userId);
  }
  db.prepare(
    `INSERT INTO active_rounds (user_id, session_id, game_id, status, created_at, expires_at)
     VALUES (?, ?, ?, 'playing', ?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
  ).run(userId, legacy.id, legacy.game_id, nowIso(), expiryFor('playing'));
}

/**
 * Records the round that owns this player's single active-bet slot.
 * Instant games keep the slot until the client acknowledges the result;
 * multi-step games release it when they settle.
 */
export function recordActiveRound(db: DB, userId: string, gameId: string, view: BaseGameView): void {
  if (!INSTANT_GAMES.has(gameId) && view.session.status !== 'active') {
    clearActiveRound(db, userId);
    return;
  }
  const status: 'playing' | 'settled' = view.session.status === 'active' ? 'playing' : 'settled';
  db.prepare(
    `INSERT INTO active_rounds (user_id, session_id, game_id, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       session_id = excluded.session_id,
       game_id = excluded.game_id,
       status = excluded.status,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
  ).run(userId, view.session.id, gameId, status, nowIso(), expiryFor(status));
}

/** Releases the slot when a multi-step round finishes. */
export function settleActiveRound(db: DB, userId: string, sessionId: string): void {
  clearActiveRoundForSession(db, userId, sessionId);
}

export function loadActiveRound(db: DB, userId: string): ActiveRound | null {
  let row = readRow(db, userId);
  if (!row) {
    // A pre-migration database may have an unfinished session but no lock.
    // Adopt it here so a page load can restore it before a wager is attempted.
    adoptLegacyActiveRound(db, userId);
    row = readRow(db, userId);
  }
  if (!row) return null;
  const session = getSessionRow(db, row.session_id);
  if (!session || session.user_id !== userId) {
    clearActiveRound(db, userId);
    return null;
  }
  const module = getGameModule(session.game_id);
  if (!module) {
    clearActiveRound(db, userId);
    return null;
  }
  let status: 'playing' | 'settled' = session.status === 'active' ? 'playing' : 'settled';
  if (status !== row.status) {
    db.prepare('UPDATE active_rounds SET status = ?, expires_at = ? WHERE user_id = ?').run(
      status,
      expiryFor(status),
      userId,
    );
  }
  return {
    game: session.game_id,
    status,
    view: module.resume(session, balanceOf(db, userId), maxPayout(db)),
  };
}
