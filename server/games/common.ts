import type { DB } from '../db/index.ts';
import type { BaseGameView, GameSessionSummary, SessionUser } from '../../shared/types.ts';
import { applyLedger } from '../lib/wallet.ts';
import { badRequest, newId, nowIso, parseJson } from '../lib/core.ts';
import { randomInt } from 'node:crypto';
import { getSetting } from '../db/index.ts';
import { compactAmount } from '../../shared/amount.ts';

export interface GameRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  min_bet: number;
  max_bet: number;
  config: string;
  updated_at: string;
}

export interface GameSessionRow {
  id: string;
  user_id: string;
  game_id: string;
  bet: number;
  status: 'active' | 'won' | 'lost' | 'push';
  payout: number;
  state: string;
  outcome: string | null;
  idempotency_key: string;
  wager_ledger_id: string | null;
  payout_ledger_id: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface StartContext {
  db: DB;
  user: SessionUser;
  game: GameRow;
  gameConfig: Record<string, unknown>;
  bet: number;
  requestId: string;
  body: Record<string, unknown>;
}

export interface ActionContext {
  db: DB;
  user: SessionUser;
  sessionId: string;
  game: GameRow;
  gameConfig: Record<string, unknown>;
  body: Record<string, unknown>;
  requestId: string;
}

export interface GameModule {
  start: (ctx: StartContext) => BaseGameView;
  action?: (ctx: ActionContext) => BaseGameView;
  resume: (row: GameSessionRow, balance: number) => BaseGameView;
}

export function secureInt(maxExclusive: number): number {
  return randomInt(maxExclusive);
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = secureInt(i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

export function parseGameConfig(game: GameRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(game.config, {});
}

export function numberConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function findReplay(db: DB, userId: string, requestId: string): GameSessionRow | undefined {
  return db
    .prepare('SELECT * FROM game_sessions WHERE user_id = ? AND idempotency_key = ?')
    .get(userId, requestId) as GameSessionRow | undefined;
}

export function getSessionRow(db: DB, sessionId: string): GameSessionRow | undefined {
  return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(sessionId) as GameSessionRow | undefined;
}

/** Debits the initial wager and returns the ledger id. Must run in a transaction. */
export function debitWager(db: DB, userId: string, sessionId: string, bet: number, gameId: string): string {
  const entry = applyLedger(db, {
    userId,
    amount: -bet,
    type: 'game_wager',
    refType: 'game_session',
    refId: sessionId,
    reason: `${gameId} wager`,
    idempotencyKey: `game-wager:${sessionId}`,
    metadata: { game: gameId },
  });
  return entry.id;
}

export function insertSession(
  db: DB,
  input: {
    id: string;
    userId: string;
    gameId: string;
    bet: number;
    status: 'active' | 'won' | 'lost' | 'push';
    payout?: number;
    state: unknown;
    outcome?: unknown;
    requestId: string;
    wagerLedgerId: string | null;
    endedAt?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO game_sessions (id, user_id, game_id, bet, status, payout, state, outcome, idempotency_key, wager_ledger_id, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.userId,
    input.gameId,
    input.bet,
    input.status,
    input.payout ?? 0,
    JSON.stringify(input.state),
    input.outcome === undefined ? null : JSON.stringify(input.outcome),
    input.requestId,
    input.wagerLedgerId,
    nowIso(),
    input.endedAt ?? (input.status === 'active' ? null : nowIso()),
  );
}

export function maxPayout(db: DB): number {
  return getSetting(db, 'economy.max_payout', 1_000_000);
}

/** Credits the payout exactly once for a session. Must run in a transaction. */
export function creditPayout(
  db: DB,
  session: Pick<GameSessionRow, 'id' | 'user_id' | 'game_id'>,
  payout: number,
  reason: string,
): string | null {
  if (payout <= 0) return null;
  const entry = applyLedger(db, {
    userId: session.user_id,
    amount: payout,
    type: 'game_payout',
    refType: 'game_session',
    refId: session.id,
    reason,
    idempotencyKey: `game-payout:${session.id}`,
    metadata: { game: session.game_id },
  });
  return entry.id;
}

export function finishSession(
  db: DB,
  sessionId: string,
  input: {
    status: 'won' | 'lost' | 'push';
    payout: number;
    state: unknown;
    outcome?: unknown;
    payoutLedgerId?: string | null;
  },
): GameSessionRow {
  const now = nowIso();
  db.prepare(
    `UPDATE game_sessions
     SET status = ?, payout = ?, state = ?, outcome = COALESCE(?, outcome), payout_ledger_id = ?, ended_at = ?
     WHERE id = ? AND status = 'active'`,
  ).run(
    input.status,
    input.payout,
    JSON.stringify(input.state),
    input.outcome === undefined ? null : JSON.stringify(input.outcome),
    input.payoutLedgerId ?? null,
    now,
    sessionId,
  );
  const row = getSessionRow(db, sessionId);
  if (!row) throw badRequest('Game session not found.', 'SESSION_NOT_FOUND');
  return row;
}

export function updateSessionState(db: DB, sessionId: string, state: unknown, bet?: number): void {
  if (bet === undefined) {
    db.prepare('UPDATE game_sessions SET state = ? WHERE id = ?').run(JSON.stringify(state), sessionId);
  } else {
    db.prepare('UPDATE game_sessions SET state = ?, bet = ? WHERE id = ?').run(JSON.stringify(state), bet, sessionId);
  }
}

export function sessionSummary(row: GameSessionRow): GameSessionSummary {
  return {
    id: row.id,
    game: row.game_id,
    bet: row.bet,
    payout: row.payout,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

export function baseView(row: GameSessionRow, balance: number): BaseGameView {
  return { session: sessionSummary(row), balance };
}

export function loadGame(db: DB, slug: string): GameRow {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(slug) as GameRow | undefined;
  if (!row) throw badRequest('Unknown game.', 'GAME_NOT_FOUND');
  return row;
}

export function assertWager(game: GameRow, bet: number): void {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw badRequest('Wager must be a positive whole number amount.', 'INVALID_WAGER', {
      fields: { bet: 'Enter a whole number amount.' },
    });
  }
  if (bet < game.min_bet) {
    throw badRequest(`Minimum wager for ${game.name} is ${compactAmount(game.min_bet)} DonutSMP money.`, 'WAGER_TOO_LOW', {
      fields: { bet: `Minimum is ${compactAmount(game.min_bet)}.` },
    });
  }
  if (bet > game.max_bet) {
    throw badRequest(`Maximum wager for ${game.name} is ${compactAmount(game.max_bet)} DonutSMP money.`, 'WAGER_TOO_HIGH', {
      fields: { bet: `Maximum is ${compactAmount(game.max_bet)}.` },
    });
  }
}

export function newSessionId(): string {
  return newId('gs');
}

