import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config, ensureDataDir } from '../config.ts';
import { useSharedRateLimitStore } from '../lib/rate-limit.ts';
import { backupBeforeMigrations } from './safety.ts';
import { migrate, pendingMigrations, seed } from './schema.ts';

export type DB = Database.Database;

export function createDatabase(filePath = config.databasePath): DB {
  ensureDataDir(filePath);
  const existed = filePath !== ':memory:' && fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  const db = new Database(filePath);
  if (existed) {
    // Never migrate a file that SQLite cannot read cleanly. This is cheap,
    // read-only, and happens before the backup and before any schema change.
    let integrity: unknown;
    try {
      integrity = db.pragma('quick_check', { simple: true });
    } catch (error) {
      db.close();
      throw new Error(
        `The database at ${filePath} failed SQLite quick_check (${error instanceof Error ? error.message : String(error)}). ` +
          'Restore a verified backup before starting the server; no migration was attempted.',
      );
    }
    if (integrity !== 'ok') {
      db.close();
      throw new Error(
        `The database at ${filePath} failed SQLite quick_check (${String(integrity)}). ` +
          'Restore a verified backup before starting the server; no migration was attempted.',
      );
    }
    let pending;
    try {
      pending = pendingMigrations(db);
    } catch (error) {
      db.close();
      throw error;
    }
    if (pending.length > 0) {
      try {
        backupBeforeMigrations(db, filePath, pending);
      } catch (error) {
        db.close();
        throw error;
      }
    }
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  // Seed only fills missing rows (ON CONFLICT DO NOTHING). It never updates an
  // existing game configuration, multiplier, economy limit, reward rule, or
  // admin setting, so a restart or code deploy cannot reset production values.
  seed(db, {
    appName: config.appName,
    startingCredits: config.startingCredits,
    sessionDays: config.sessionDays,
  });
  // A file database is shared by every worker on the host, so rate-limit
  // windows are counted there too. In-memory databases (tests) stay local.
  useSharedRateLimitStore(filePath === ':memory:' ? null : db);
  return db;
}

let singleton: DB | null = null;

export function getDatabase(): DB {
  if (!singleton) singleton = createDatabase();
  return singleton;
}

export function closeDatabase(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown, actorId: string | null): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(key, JSON.stringify(value), new Date().toISOString(), actorId);
}
