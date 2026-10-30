import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';
import type { LedgerEntry, LedgerType } from '../../shared/types.ts';
import { ApiError, badRequest, inTransaction, ledgerId, nowIso, parseJson } from './core.ts';

export interface LedgerRow {
  id: string;
  user_id: string;
  type: LedgerType;
  amount: number;
  balance_before: number;
  balance_after: number;
  ref_type: string | null;
  ref_id: string | null;
  actor_id: string | null;
  reason: string | null;
  metadata: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface ApplyLedgerInput {
  userId: string;
  amount: number;
  type: LedgerType;
  actorId?: string | null;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function balanceOf(db: DB, userId: string): number {
  const row = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function mapLedgerRow(row: LedgerRow, username?: string | null, actorName?: string | null): LedgerEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: username ?? undefined,
    type: row.type,
    amount: row.amount,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    refType: row.ref_type,
    refId: row.ref_id,
    actorId: row.actor_id,
    actorName: actorName ?? null,
    reason: row.reason,
    metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
    createdAt: row.created_at,
  };
}

/**
 * Applies a signed ledger entry and wallet balance change atomically.
 * Must be called inside a transaction for multi-step operations.
 * If the idempotency key already exists the original entry is returned
 * without touching the balance, which makes retries safe.
 */
export function applyLedger(db: DB, input: ApplyLedgerInput): LedgerRow {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest('Amount must be a non-zero whole number.', 'INVALID_AMOUNT');
  }
  if (input.idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM ledger WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as LedgerRow | undefined;
    if (existing) {
      if (existing.user_id !== input.userId) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This operation key belongs to another account.');
      }
      return existing;
    }
  }

  const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(input.userId) as
    | { balance: number }
    | undefined;
  if (!wallet) throw badRequest('Wallet not found for this account.', 'WALLET_MISSING');

  const before = wallet.balance;
  const after = before + input.amount;
  if (after < 0) {
    throw new ApiError(400, 'INSUFFICIENT_CREDITS', 'Not enough DonutSMP money for this operation.', {
      balance: before,
      required: Math.abs(input.amount),
    });
  }

  const update = db
    .prepare('UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND balance + ? >= 0')
    .run(input.amount, nowIso(), input.userId, input.amount);
  if (update.changes !== 1) {
    throw new ApiError(409, 'BALANCE_CONFLICT', 'The balance changed concurrently. Please retry.');
  }

  const id = ledgerId();
  db.prepare(
    `INSERT INTO ledger (id, user_id, type, amount, balance_before, balance_after, ref_type, ref_id, actor_id, reason, metadata, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.type,
    input.amount,
    before,
    after,
    input.refType ?? null,
    input.refId ?? null,
    input.actorId ?? null,
    input.reason ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.idempotencyKey ?? null,
    nowIso(),
  );

  return db.prepare('SELECT * FROM ledger WHERE id = ?').get(id) as LedgerRow;
}

/** Creates the wallet plus its first ledger entry for a new account. */
export function createWallet(db: DB, userId: string, startingCredits: number, actorId: string | null): LedgerRow | null {
  return inTransaction(db, () => {
    db.prepare('INSERT INTO wallets (user_id, balance, updated_at) VALUES (?, 0, ?)').run(userId, nowIso());
    if (startingCredits < 0) {
      throw badRequest('Starting money grant cannot be negative.', 'INVALID_STARTING_CREDITS');
    }
    if (startingCredits === 0) return null;
    return applyLedger(db, {
      userId,
      amount: startingCredits,
      type: 'initial_grant',
      actorId,
      reason: 'Welcome grant',
      refType: 'account',
      refId: userId,
      idempotencyKey: `welcome:${userId}`,
      metadata: { source: 'registration' },
    });
  });
}

export interface ReconcileRow {
  userId: string;
  username: string;
  walletBalance: number;
  ledgerTotal: number;
  difference: number;
}

export function reconcileWallets(db: DB): ReconcileRow[] {
  const rows = db
    .prepare(
      `SELECT w.user_id AS userId, u.username AS username, w.balance AS walletBalance,
              COALESCE(SUM(l.amount), 0) AS ledgerTotal
       FROM wallets w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN ledger l ON l.user_id = w.user_id
       GROUP BY w.user_id, u.username, w.balance
       HAVING w.balance <> COALESCE(SUM(l.amount), 0)`,
    )
    .all() as { userId: string; username: string; walletBalance: number; ledgerTotal: number }[];
  return rows.map((row) => ({ ...row, difference: row.walletBalance - row.ledgerTotal }));
}

export function transferIdempotencyKey(scope: string): string {
  return `${scope}:${randomBytes(8).toString('hex')}`;
}
