import type { DB } from '../db/index.ts';
import { newId, nowIso } from './core.ts';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  reason: string | null;
  metadata: string | null;
  ip: string | null;
  created_at: string;
}

export function recordAudit(db: DB, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, target_label, reason, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId('aud'),
    input.actorId ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.targetLabel ?? null,
    input.reason ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.ip ?? null,
    nowIso(),
  );
}

export function listAuditRows(
  db: DB,
  filters: { actorId?: string; action?: string; search?: string; from?: string; to?: string; limit: number; offset: number },
): { rows: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.actorId) {
    where.push('a.actor_id = ?');
    params.push(filters.actorId);
  }
  if (filters.action) {
    where.push('a.action = ?');
    params.push(filters.action);
  }
  if (filters.search) {
    where.push('(a.action LIKE ? OR a.target_label LIKE ? OR u.username LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }
  if (filters.from) {
    where.push('a.created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.created_at <= ?');
    params.push(filters.to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${clause}`;
  const total = (db.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params) as { count: number }).count;
  const rows = db
    .prepare(
      `SELECT a.id, a.actor_id, u.username AS actor_name, a.action, a.target_type, a.target_id,
              a.target_label, a.reason, a.metadata, a.ip, a.created_at
       ${base} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit, filters.offset) as AuditRow[];
  return { rows, total };
}
