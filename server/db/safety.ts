import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import type { DB } from './index.ts';

export interface PendingMigration {
  version: number;
  name: string;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function uniqueBackupPath(backupDir: string, pending: PendingMigration[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const version = pending.at(-1)?.version ?? 'next';
  const base = path.join(backupDir, `pre-migration-${stamp}-v${version}`);
  let target = `${base}.db`;
  let counter = 1;
  while (fs.existsSync(target)) {
    target = `${base}-${counter}.db`;
    counter += 1;
  }
  return target;
}

function pruneOldBackups(backupDir: string, keep: number): void {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((name) => name.startsWith('pre-migration-') && name.endsWith('.db'))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      fs.rmSync(path.join(backupDir, name), { force: true });
    }
  } catch {
    /* pruning is housekeeping; a failed delete must not block startup */
  }
}

/**
 * Takes a verified snapshot before a schema migration runs. The copy is made
 * with SQLite's VACUUM INTO, which includes committed WAL pages and produces a
 * single self-contained file. If the snapshot or its integrity check fails,
 * startup aborts before the migration can touch the live database.
 */
export function backupBeforeMigrations(
  db: DB,
  databasePath: string,
  pending: PendingMigration[],
  options: { backupDir?: string; keep?: number } = {},
): string | null {
  if (databasePath === ':memory:' || pending.length === 0) return null;
  if (!config.databaseBackupBeforeMigration) {
    console.warn(
      `[db] DB_BACKUP_BEFORE_MIGRATION=false; running ${pending.length} pending migration(s) without a safety snapshot.`,
    );
    return null;
  }
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return null;

  const backupDir = options.backupDir ?? config.backupDir;
  const keep = options.keep ?? config.databaseBackupKeep;
  fs.mkdirSync(backupDir, { recursive: true });
  const target = uniqueBackupPath(backupDir, pending);
  try {
    db.exec(`VACUUM INTO ${sqlLiteral(target)}`);
    const copy = new Database(target, { readonly: true });
    const integrity = copy.pragma('integrity_check', { simple: true });
    copy.close();
    if (integrity !== 'ok') {
      throw new Error(`integrity_check returned ${String(integrity)}`);
    }
    pruneOldBackups(backupDir, keep);
    console.info(
      `[db] pre-migration backup: ${target} (pending ${pending.map((migration) => `v${migration.version}`).join(', ')})`,
    );
    return target;
  } catch (error) {
    fs.rmSync(target, { force: true });
    throw new Error(
      `Could not create a verified pre-migration backup at ${target}; refusing to migrate. ` +
        `Free disk space or set DB_BACKUP_BEFORE_MIGRATION=false only after taking a manual backup. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
