import Database from 'better-sqlite3';
import { config, ensureDataDir } from '../config.ts';
import { useSharedRateLimitStore } from '../lib/rate-limit.ts';
import { migrate, seed } from './schema.ts';

export type DB = Database.Database;

export function createDatabase(filePath = config.databasePath): DB {
  ensureDataDir(filePath);
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
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
