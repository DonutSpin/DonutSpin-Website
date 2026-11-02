import type { DB } from '../../db/index.ts';
import type {
  RewardCodeRedemptionResponse,
  RewardCodeStatus,
  RewardCodeView,
  SessionUser,
} from '../../../shared/types.ts';
import { compactAmount } from '../../../shared/amount.ts';
import { badRequest, conflict, inTransaction, newId, notFound, nowIso } from '../core.ts';
import { applyLedger, balanceOf } from '../wallet.ts';
import { notify } from '../notifications.ts';
import { recordAudit } from '../audit.ts';
import { getPrimaryGuild, recordDiscordActivity } from './core.ts';
import { queueCodeDelete, queueCodePost } from './events.ts';

const MAX_CODE_AMOUNT = 1_000_000_000_000;
const MAX_REDEMPTIONS = 100_000;
const MAX_EXPIRY_DAYS = 730;

interface CodeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  amount: number;
  max_redemptions: number;
  redeemed_count: number;
  expires_at: string | null;
  disabled_at: string | null;
  created_by: string | null;
  created_via: 'web' | 'discord';
  announcement_message_id: string | null;
  created_at: string;
  created_by_name?: string | null;
}

export interface CreateRewardCodeInput {
  code: string;
  name?: string;
  description?: string;
  amount: number;
  maxRedemptions: number;
  expiresAt?: string | null;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function codeStatus(row: CodeRow, now = Date.now()): RewardCodeStatus {
  if (row.disabled_at) return 'disabled';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  if (row.redeemed_count >= row.max_redemptions) return 'exhausted';
  return 'active';
}

export function mapRewardCode(row: CodeRow, now = Date.now()): RewardCodeView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    amount: row.amount,
    maxRedemptions: row.max_redemptions,
    redeemedCount: row.redeemed_count,
    remaining: Math.max(0, row.max_redemptions - row.redeemed_count),
    expiresAt: row.expires_at,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    createdVia: row.created_via,
    createdBy: row.created_by_name ?? row.created_by,
    status: codeStatus(row, now),
    announcementMessageId: row.announcement_message_id,
  };
}

const CODE_SELECT = `
  SELECT c.*, u.username AS created_by_name
    FROM reward_codes c
    LEFT JOIN users u ON u.id = c.created_by
`;

export function getRewardCodeRow(db: DB, id: string): CodeRow | undefined {
  return db.prepare(`${CODE_SELECT} WHERE c.id = ?`).get(id) as CodeRow | undefined;
}

function findCodeRow(db: DB, code: string): CodeRow | undefined {
  return db.prepare(`${CODE_SELECT} WHERE c.code = ? COLLATE NOCASE`).get(normalizeCode(code)) as
    | CodeRow
    | undefined;
}

export function listRewardCodes(db: DB, limit = 100): RewardCodeView[] {
  const rows = db
    .prepare(`${CODE_SELECT} ORDER BY c.created_at DESC LIMIT ?`)
    .all(Math.min(250, Math.max(1, limit))) as CodeRow[];
  return rows.map((row) => mapRewardCode(row));
}

export function createRewardCode(
  db: DB,
  actor: SessionUser,
  input: CreateRewardCodeInput,
  options: { via: 'web' | 'discord'; guildId?: string | null },
): RewardCodeView {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) {
    throw badRequest(
      'Use 3–32 letters, numbers, underscores or hyphens; the code must start with a letter or number.',
      'INVALID_CODE',
      { fields: { code: 'Use 3–32 letters, numbers, underscores or hyphens.' } },
    );
  }
  const amount = Math.trunc(input.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CODE_AMOUNT) {
    throw badRequest('Enter a valid reward amount.', 'INVALID_AMOUNT', {
      fields: { amount: 'Use a whole amount between 1 and 1,000,000,000,000.' },
    });
  }
  const maxRedemptions = Math.trunc(input.maxRedemptions);
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > MAX_REDEMPTIONS) {
    throw badRequest('Choose a valid redemption limit.', 'INVALID_REDEMPTIONS', {
      fields: { maxRedemptions: `Choose between 1 and ${MAX_REDEMPTIONS.toLocaleString('en-US')} redemptions.` },
    });
  }
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (!Number.isFinite(parsed.getTime())) {
      throw badRequest('Choose a valid expiration date.', 'INVALID_EXPIRY', {
        fields: { expiresAt: 'Choose a valid date and time.' },
      });
    }
    if (parsed.getTime() <= Date.now() + 60_000) {
      throw badRequest('The expiration must be at least a minute in the future.', 'INVALID_EXPIRY', {
        fields: { expiresAt: 'Choose a future date and time.' },
      });
    }
    if (parsed.getTime() > Date.now() + MAX_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
      throw badRequest('Codes can expire at most two years from now.', 'INVALID_EXPIRY', {
        fields: { expiresAt: 'Choose a date within two years.' },
      });
    }
    expiresAt = parsed.toISOString();
  }
  if (findCodeRow(db, code)) {
    throw conflict('That code already exists.', 'CODE_TAKEN', {
      fields: { code: 'That code already exists. Pick another one.' },
    });
  }

  const id = newId('code');
  const createdAt = nowIso();
  const name = (input.name?.trim() || code).slice(0, 100);
  const description = input.description?.trim().slice(0, 500) || null;
  db.prepare(
    `INSERT INTO reward_codes
       (id, code, name, description, amount, max_redemptions, redeemed_count, expires_at, created_by, created_via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  ).run(id, code, name, description, amount, maxRedemptions, expiresAt, actor.id, options.via, createdAt);

  recordAudit(db, {
    actorId: actor.id,
    action: 'code.create',
    targetType: 'reward_code',
    targetId: id,
    targetLabel: code,
    metadata: {
      amount,
      maxRedemptions,
      expiresAt,
      via: options.via,
      guildId: options.guildId ?? null,
    },
  });
  recordDiscordActivity(db, {
    guildId: options.guildId ?? null,
    actorUserId: actor.id,
    action: 'code.created',
    summary: `${actor.username} created code ${code} for ${compactAmount(amount)} money`,
    metadata: { codeId: id, maxRedemptions, via: options.via },
  });

  const row = getRewardCodeRow(db, id);
  if (!row) throw notFound('Code disappeared after creation.');
  const view = mapRewardCode(row);
  const guildId = options.guildId ?? getPrimaryGuild(db)?.guild_id ?? null;
  if (guildId) queueCodePost(db, guildId, view);
  return view;
}

export function setRewardCodeDisabled(
  db: DB,
  actor: SessionUser,
  id: string,
  disabled: boolean,
): RewardCodeView {
  const row = getRewardCodeRow(db, id);
  if (!row) throw notFound('Code not found.');
  const disabledAt = disabled ? (row.disabled_at ?? nowIso()) : null;
  db.prepare('UPDATE reward_codes SET disabled_at = ? WHERE id = ?').run(disabledAt, id);
  recordAudit(db, {
    actorId: actor.id,
    action: disabled ? 'code.disable' : 'code.enable',
    targetType: 'reward_code',
    targetId: id,
    targetLabel: row.code,
    metadata: { amount: row.amount, redeemedCount: row.redeemed_count },
  });
  recordDiscordActivity(db, {
    actorUserId: actor.id,
    action: disabled ? 'code.disabled' : 'code.enabled',
    summary: `${actor.username} ${disabled ? 'disabled' : 're-enabled'} code ${row.code}`,
  });
  const updated = getRewardCodeRow(db, id);
  if (!updated) throw notFound('Code not found.');
  return mapRewardCode(updated);
}

/** A code with redemptions is kept forever for ledger history; disable it instead. */
export function deleteRewardCode(db: DB, actor: SessionUser, id: string): void {
  const row = getRewardCodeRow(db, id);
  if (!row) throw notFound('Code not found.');
  const redemptions = (
    db.prepare('SELECT COUNT(*) AS count FROM reward_code_redemptions WHERE code_id = ?').get(id) as {
      count: number;
    }
  ).count;
  if (redemptions > 0) {
    throw conflict(
      'This code has already been redeemed and must stay for the ledger history. Disable it instead.',
      'CODE_HAS_REDEMPTIONS',
    );
  }
  const view = mapRewardCode(row);
  const guild = getPrimaryGuild(db)?.guild_id ?? null;
  db.prepare('DELETE FROM reward_codes WHERE id = ?').run(id);
  recordAudit(db, {
    actorId: actor.id,
    action: 'code.delete',
    targetType: 'reward_code',
    targetId: id,
    targetLabel: row.code,
    metadata: { amount: row.amount },
  });
  recordDiscordActivity(db, {
    actorUserId: actor.id,
    action: 'code.deleted',
    summary: `${actor.username} deleted code ${row.code}`,
  });
  if (guild && view.announcementMessageId) queueCodeDelete(db, guild, view);
}

export function redeemRewardCode(
  db: DB,
  user: SessionUser,
  rawCode: string,
  source: 'web' | 'discord',
  actorDiscordId?: string | null,
): RewardCodeRedemptionResponse {
  if (user.accountHold) {
    throw conflict('This account is under review and cannot redeem codes right now.', 'ACCOUNT_UNDER_REVIEW');
  }
  const code = normalizeCode(rawCode);
  if (!code) throw badRequest('Enter a code.', 'CODE_REQUIRED', { fields: { code: 'Enter a code.' } });
  const now = Date.now();
  const result = inTransaction(db, () => {
    const row = findCodeRow(db, code);
    if (!row) throw notFound('That code is not valid.', 'CODE_NOT_FOUND');
    if (row.disabled_at) throw conflict('This code has been disabled.', 'CODE_DISABLED');
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
      throw conflict('This code has expired.', 'CODE_EXPIRED');
    }
    if (row.redeemed_count >= row.max_redemptions) {
      throw conflict('This code has reached its redemption limit.', 'CODE_EXHAUSTED');
    }
    const already = db
      .prepare('SELECT 1 FROM reward_code_redemptions WHERE code_id = ? AND user_id = ?')
      .get(row.id, user.id);
    if (already) throw conflict('You have already redeemed this code.', 'CODE_ALREADY_REDEEMED');

    const updated = db
      .prepare(
        `UPDATE reward_codes SET redeemed_count = redeemed_count + 1
          WHERE id = ? AND disabled_at IS NULL AND redeemed_count < max_redemptions`,
      )
      .run(row.id);
    if (updated.changes !== 1) {
      throw conflict('This code has just reached its redemption limit.', 'CODE_EXHAUSTED');
    }
    const redemptionId = newId('cdr');
    const redeemedAt = nowIso();
    db.prepare(
      `INSERT INTO reward_code_redemptions (id, code_id, user_id, amount, source, redeemed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(redemptionId, row.id, user.id, row.amount, source, redeemedAt);
    const ledger = applyLedger(db, {
      userId: user.id,
      amount: row.amount,
      type: 'credit_request',
      actorId: null,
      reason: `Reward code ${row.code}`,
      refType: 'reward_code',
      refId: row.id,
      idempotencyKey: `code-redeem:${row.id}:${user.id}`,
      metadata: { kind: 'reward_code', code: row.code, source, redemptionId },
    });
    db.prepare('UPDATE reward_code_redemptions SET ledger_id = ? WHERE id = ?').run(ledger.id, redemptionId);

    notify(db, {
      userId: user.id,
      type: 'wallet',
      title: `Code redeemed: ${compactAmount(row.amount)} money`,
      body: `${row.code} was added to your wallet${source === 'discord' ? ' from Discord' : ''}.`,
      link: '/wallet',
    });
    recordAudit(db, {
      actorId: user.id,
      action: 'code.redeem',
      targetType: 'reward_code',
      targetId: row.id,
      targetLabel: row.code,
      metadata: { amount: row.amount, source, ledgerId: ledger.id },
    });
    recordDiscordActivity(db, {
      actorDiscordId: actorDiscordId ?? null,
      actorUserId: user.id,
      action: 'code.redeemed',
      summary: `@${user.username} redeemed code ${row.code} for ${compactAmount(row.amount)} money`,
      metadata: { codeId: row.id, source },
    });
    const fresh = getRewardCodeRow(db, row.id);
    if (!fresh) throw notFound('Code not found.');
    return {
      code: mapRewardCode(fresh),
      amount: row.amount,
      balance: balanceOf(db, user.id),
      redeemedAt,
    };
  });
  return result;
}

export interface RewardCodeRedemptionRow {
  id: string;
  code: string;
  amount: number;
  source: 'web' | 'discord';
  redeemedAt: string;
}

export function listUserCodeRedemptions(db: DB, userId: string, limit = 25): RewardCodeRedemptionRow[] {
  const rows = db
    .prepare(
      `SELECT r.id, c.code, r.amount, r.source, r.redeemed_at
         FROM reward_code_redemptions r JOIN reward_codes c ON c.id = r.code_id
        WHERE r.user_id = ? ORDER BY r.redeemed_at DESC LIMIT ?`,
    )
    .all(userId, Math.min(100, Math.max(1, limit))) as {
    id: string;
    code: string;
    amount: number;
    source: 'web' | 'discord';
    redeemed_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    amount: row.amount,
    source: row.source,
    redeemedAt: row.redeemed_at,
  }));
}
