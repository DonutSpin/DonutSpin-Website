import type { DB } from '../db/index.ts';
import { newId, nowIso } from './core.ts';
import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from '../../shared/legal.ts';

export interface LegalAcceptanceRow {
  id: string;
  user_id: string;
  terms_version: string;
  privacy_version: string;
  age_confirmed: number;
  tos_accepted: number;
  donut_rules_acknowledged: number;
  accepted_at: string;
  ip: string | null;
  user_agent: string | null;
}

export function latestLegalAcceptance(db: DB, userId: string): LegalAcceptanceRow | undefined {
  return db
    .prepare(
      `SELECT * FROM legal_acceptances
       WHERE user_id = ?
       ORDER BY accepted_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(userId) as LegalAcceptanceRow | undefined;
}

export function isCurrentLegalAcceptance(row: LegalAcceptanceRow | undefined): boolean {
  return Boolean(row && row.terms_version === LEGAL_TERMS_VERSION && row.privacy_version === LEGAL_PRIVACY_VERSION);
}

export function legalAcceptanceRequired(db: DB, userId: string): boolean {
  return !isCurrentLegalAcceptance(latestLegalAcceptance(db, userId));
}

export function recordLegalAcceptance(
  db: DB,
  input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
    acceptedAt?: string;
  },
): string {
  const id = newId('leg');
  db.prepare(
    `INSERT INTO legal_acceptances
       (id, user_id, terms_version, privacy_version, age_confirmed, tos_accepted, donut_rules_acknowledged, accepted_at, ip, user_agent)
     VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    LEGAL_TERMS_VERSION,
    LEGAL_PRIVACY_VERSION,
    input.acceptedAt ?? nowIso(),
    input.ip ?? null,
    input.userAgent?.slice(0, 500) ?? null,
  );
  return id;
}

export function isSelfExclusionActive(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false;
  const expiresAt = new Date(until).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}
