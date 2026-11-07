import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import {
  assertDatabasePathSafe,
  assertProductionDatabaseAvailable,
  assertRuntimePathSafe,
  resolveDatabasePath,
} from '../server/config.ts';
import { createDatabase, setSetting } from '../server/db/index.ts';
import { migrate, seed } from '../server/db/schema.ts';
import { backupBeforeMigrations } from '../server/db/safety.ts';

const tempDirs: string[] = [];

function tempDir(prefix = 'donutspin-deploy-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('persistent database path resolution', () => {
  it('uses an explicit DATABASE_PATH ahead of every discovered file', () => {
    const appRoot = tempDir();
    const explicit = path.join(appRoot, 'custom', 'casino.db');
    const resolved = resolveDatabasePath(
      { DATABASE_PATH: './custom/casino.db' },
      appRoot,
      (candidate) => candidate === path.join(appRoot, 'app.db'),
    );
    expect(resolved).toMatchObject({
      databasePath: explicit,
      source: 'env',
      exists: false,
      dataDir: path.join(appRoot, 'App_Data'),
    });
  });

  it('finds the long-standing root app.db instead of creating a new database', () => {
    const appRoot = tempDir();
    const rootDatabase = path.join(appRoot, 'app.db');
    const resolved = resolveDatabasePath({}, appRoot, (candidate) => candidate === rootDatabase);
    expect(resolved.databasePath).toBe(rootDatabase);
    expect(resolved.source).toBe('legacy_root');
    expect(resolved.exists).toBe(true);
  });

  it('falls back to the old data/ database when it is the only one present', () => {
    const appRoot = tempDir();
    const legacy = path.join(appRoot, 'data', 'aurum.db');
    const resolved = resolveDatabasePath({}, appRoot, (candidate) => candidate === legacy);
    expect(resolved.databasePath).toBe(legacy);
    expect(resolved.source).toBe('legacy_data');
  });

  it('uses App_Data/aurum.db for a genuinely new installation', () => {
    const appRoot = tempDir();
    const resolved = resolveDatabasePath({}, appRoot, () => false);
    expect(resolved.databasePath).toBe(path.join(appRoot, 'App_Data', 'aurum.db'));
    expect(resolved.source).toBe('default');
    expect(resolved.exists).toBe(false);
    expect(resolved.dataDir).toBe(path.join(appRoot, 'App_Data'));
  });

  it('honours DONUTSPIN_DATA_DIR for data kept outside the site folder', () => {
    const appRoot = tempDir();
    const resolved = resolveDatabasePath({ DONUTSPIN_DATA_DIR: '../private-data' }, appRoot, () => false);
    expect(resolved.dataDir).toBe(path.resolve(appRoot, '../private-data'));
    expect(resolved.databasePath).toBe(path.join(resolved.dataDir, 'aurum.db'));
    expect(resolved.source).toBe('data_dir_env');
  });

  it('keeps existing settings databases ahead of the new default', () => {
    const appRoot = tempDir();
    const existing = new Set([
      path.join(appRoot, 'data', 'aurum.db'),
      path.join(appRoot, 'App_Data', 'aurum.db'),
    ]);
    const resolved = resolveDatabasePath({}, appRoot, (candidate) => existing.has(candidate));
    expect(resolved.databasePath).toBe(path.join(appRoot, 'data', 'aurum.db'));
  });

  it('ignores a zero-byte database and keeps looking for a real one', () => {
    const appRoot = tempDir();
    fs.mkdirSync(path.join(appRoot, 'data'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'app.db'), '');
    fs.writeFileSync(path.join(appRoot, 'data', 'aurum.db'), 'not-empty');
    const resolved = resolveDatabasePath({}, appRoot);
    expect(resolved.databasePath).toBe(path.join(appRoot, 'data', 'aurum.db'));
    expect(resolved.exists).toBe(true);
  });

  it('refuses a database inside a folder replaced by Git or the build', () => {
    const appRoot = tempDir();
    for (const directory of ['dist', 'build', 'src', 'server', 'shared', 'public', 'tests', 'logs']) {
      expect(() => assertDatabasePathSafe(path.join(appRoot, directory, 'app.db'), appRoot)).toThrow(/replaced by Git/);
    }
    expect(() => assertDatabasePathSafe(path.join(appRoot, 'App_Data', 'aurum.db'), appRoot)).not.toThrow();
    expect(() => assertDatabasePathSafe(path.join(appRoot, 'app.db'), appRoot)).not.toThrow();
    expect(() => assertDatabasePathSafe(path.join(appRoot, 'data', 'aurum.db'), appRoot)).not.toThrow();
  });

  it('refuses a runtime data directory inside application code', () => {
    const appRoot = tempDir();
    expect(() => assertRuntimePathSafe(path.join(appRoot, 'src', 'runtime'), appRoot)).toThrow(/replaced by Git/);
    expect(() => assertRuntimePathSafe(path.join(appRoot, 'App_Data'), appRoot)).not.toThrow();
  });

  it('blocks production from silently creating an empty database', () => {
    const options = {
      isProduction: true,
      databaseExists: false,
      allowNewDatabase: false,
      databasePath: '/site/app.db',
      candidates: [{ path: '/site/app.db', exists: false }],
    };
    expect(() => assertProductionDatabaseAvailable(options)).toThrow(/Refusing to start/);
    expect(() => assertProductionDatabaseAvailable({ ...options, allowNewDatabase: true })).not.toThrow();
    expect(() => assertProductionDatabaseAvailable({ ...options, databaseExists: true })).not.toThrow();
    expect(() => assertProductionDatabaseAvailable({ ...options, isProduction: false })).not.toThrow();
    expect(() =>
      assertProductionDatabaseAvailable({
        ...options,
        databasePath: ':memory:',
        allowNewDatabase: true,
      }),
    ).toThrow(/memory/);
  });
});

describe('seed and migrations preserve production values', () => {
  it('never overwrites game multipliers, economy limits or admin settings on restart', () => {
    const db = createDatabase(':memory:');
    try {
      db.prepare("UPDATE games SET config = ?, min_bet = ?, max_bet = ? WHERE id = 'coinflip'").run(
        JSON.stringify({ winMultiplier: 1.77, winChance: 37.5 }),
        25,
        777,
      );
      setSetting(db, 'economy.max_payout', 42_000, null);
      setSetting(db, 'rewards.base_amount', 123_456, null);
      setSetting(db, 'custom.admin_value', { keep: true }, null);
      db.prepare("DELETE FROM settings WHERE key = 'platform.tagline'").run();

      const beforeGames = db.prepare('SELECT COUNT(*) AS count FROM games').get() as { count: number };
      const beforeSettings = db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number };
      const beforeName = (
        db.prepare("SELECT value FROM settings WHERE key = 'platform.name'").get() as { value: string }
      ).value;

      seed(db, { appName: 'Changed Name', startingCredits: 1, sessionDays: 1 });
      migrate(db);

      const coinflip = db.prepare("SELECT config, min_bet, max_bet FROM games WHERE id = 'coinflip'").get() as {
        config: string;
        min_bet: number;
        max_bet: number;
      };
      expect(JSON.parse(coinflip.config)).toEqual({ winMultiplier: 1.77, winChance: 37.5 });
      expect(coinflip.min_bet).toBe(25);
      expect(coinflip.max_bet).toBe(777);

      const read = (key: string) =>
        JSON.parse(
          (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string }).value,
        ) as unknown;
      expect(read('economy.max_payout')).toBe(42_000);
      expect(read('rewards.base_amount')).toBe(123_456);
      expect(read('custom.admin_value')).toEqual({ keep: true });
      expect(read('platform.name')).toBe(JSON.parse(beforeName));
      expect(read('platform.tagline')).toBe('The casino for DonutSMP money.');

      expect(db.prepare('SELECT COUNT(*) AS count FROM games').get()).toEqual(beforeGames);
      expect(
        (db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count,
      ).toBeGreaterThanOrEqual(beforeSettings.count);
    } finally {
      db.close();
    }
  });

  it('migrates historical brand names and the old sender domain for existing databases', () => {
    const db = createDatabase(':memory:');
    try {
      // Simulate a database created before the DonutSpin rename and before the
      // sender-domain migration; both must be rebranded on the next boot.
      db.prepare('DELETE FROM schema_migrations WHERE version IN (22, 23)').run();
      setSetting(db, 'platform.name', 'DonutCash', null);
      setSetting(db, 'email.from_name', 'Donutcash', null);
      setSetting(db, 'email.from_email', 'no-reply@donutcash.local', null);

      migrate(db);

      const read = (key: string) =>
        JSON.parse(
          (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string }).value,
        ) as unknown;
      expect(read('platform.name')).toBe('DonutSpin');
      expect(read('email.from_name')).toBe('DonutSpin');
      expect(read('email.from_email')).toBe('no-reply@donutspin.local');

      // A name an operator chose is never rewritten by the rebrand migrations.
      setSetting(db, 'platform.name', 'Custom Casino', null);
      db.prepare('DELETE FROM schema_migrations WHERE version = 22').run();
      migrate(db);
      expect(read('platform.name')).toBe('Custom Casino');

      // An email sender stored on the old public origin follows the new domain.
      setSetting(db, 'email.from_email', 'no-reply@donutcash.runasp.net', null);
      db.prepare('DELETE FROM schema_migrations WHERE version = 24').run();
      migrate(db);
      expect(read('email.from_email')).toBe('no-reply@donutspin.runasp.net');
    } finally {
      db.close();
    }
  });

  it('keeps admin values across a real close and reopen of the database file', () => {
    const dir = tempDir();
    const file = path.join(dir, 'app.db');

    const first = createDatabase(file);
    first.prepare("UPDATE games SET config = ? WHERE id = 'mines'").run(
      JSON.stringify({ maxMines: 7, houseEdge: 0.07, winChance: 32 }),
    );
    setSetting(first, 'economy.max_payout', 9_999_999, null);
    first.close();

    const second = createDatabase(file);
    try {
      const mines = second.prepare("SELECT config FROM games WHERE id = 'mines'").get() as { config: string };
      expect(JSON.parse(mines.config)).toEqual({ maxMines: 7, houseEdge: 0.07, winChance: 32 });
      const maxPayout = second
        .prepare("SELECT value FROM settings WHERE key = 'economy.max_payout'")
        .get() as { value: string };
      expect(JSON.parse(maxPayout.value)).toBe(9_999_999);
      expect(second.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      second.close();
    }
  });

  it('takes a verified pre-migration snapshot that contains current settings', () => {
    const dir = tempDir();
    const file = path.join(dir, 'app.db');
    const db = createDatabase(file);
    try {
      setSetting(db, 'economy.max_payout', 12_345_678, null);
      const backupDir = path.join(dir, 'backups');
      const target = backupBeforeMigrations(db, file, [{ version: 999, name: 'test-only' }], {
        backupDir,
        keep: 5,
      });
      expect(target).toBeTruthy();
      expect(fs.existsSync(target as string)).toBe(true);

      const copy = new Database(target as string, { readonly: true });
      try {
        expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
        const row = copy
          .prepare("SELECT value FROM settings WHERE key = 'economy.max_payout'")
          .get() as { value: string };
        expect(JSON.parse(row.value)).toBe(12_345_678);
      } finally {
        copy.close();
      }
    } finally {
      db.close();
    }
  });

  it('does not migrate or seed a database that fails SQLite quick_check', () => {
    const dir = tempDir();
    const file = path.join(dir, 'app.db');
    fs.writeFileSync(file, Buffer.alloc(4096, 0x7a));
    expect(() => createDatabase(file)).toThrow(/quick_check/);
  });
});

describe('runtime files are unreachable over HTTP', () => {
  it('never answers a database, config, secret or credential path with the SPA', async () => {
    const db = createDatabase(':memory:');
    const app = createApp(db);
    try {
      for (const url of [
        '/data/aurum.db',
        '/App_Data/aurum.db',
        '/app_data/aurum.db',
        '/web.config',
        '/deploy/web.config.example',
        '/.session-secret',
        '/owner-credentials.txt',
        '/app.db',
        '/app.db-wal',
        '/logs/node.log',
      ]) {
        const response = await request(app).get(url);
        expect(response.status, url).toBe(404);
        expect(response.text, url).not.toContain('<div id="root">');
      }
      const spa = await request(app).get('/login');
      expect(spa.status).toBe(200);
      expect(spa.text).toContain('<div id="root">');
    } finally {
      db.close();
    }
  });
});
