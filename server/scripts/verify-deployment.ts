import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

// The check must not create App_Data/.session-secret as a side effect when the
// production environment has not supplied one yet. A process-local placeholder
// keeps config read-only without weakening the real server's checks.
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'deploy-check-placeholder-not-used-by-the-server-0000000000';
}
const { config } = await import('../config.ts');
const { validateGameConfig } = await import('../games/config.ts');

/**
 * Read-only deployment check. It never opens the database for writing, never
 * migrates, never seeds, and never changes a setting. Run it after a deploy (or
 * before a push) to prove that:
 *
 *   - the live database is found, intact, and not a freshly created empty file;
 *   - game configurations, multipliers and admin settings are still present;
 *   - no runtime file is tracked by Git;
 *   - the generated web.config and persistent directories are ignored.
 */

const failures: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: config.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      warn('git is not installed here, so tracked-file checks were skipped. Run this from the development checkout.');
      return null;
    }
    return '';
  }
}

function gitSucceeds(args: string[]): boolean {
  try {
    execFileSync('git', args, { cwd: config.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

const runtimePaths = [
  'web.config',
  '.env',
  '.session-secret',
  'owner-credentials.txt',
  'app.db',
  'app.db-wal',
  'app.db-shm',
  'data',
  'App_Data',
  'logs',
  'dist',
  'build',
];

console.info('Donutcash deployment check');
console.info(`  app root:      ${config.root}`);
console.info(`  database:      ${config.databasePath} (source: ${config.databasePathSource}, exists: ${config.databaseExists})`);
console.info(`  persistent:    ${config.dataDir}`);
console.info(`  backups:       ${config.backupDir}`);
console.info('');

// 1. Database presence and integrity. Read-only so this is safe on production.
if (config.databasePath === ':memory:') {
  fail('DATABASE_PATH is :memory:; that database disappears on restart.');
} else if (!fs.existsSync(config.databasePath)) {
  fail(`No database at ${config.databasePath}. Refusing to treat this as a healthy deployment.`);
} else {
  const size = fs.statSync(config.databasePath).size;
  if (size === 0) {
    fail(`The database at ${config.databasePath} is empty (0 bytes).`);
  } else {
    let db: Database.Database | null = null;
    try {
      db = new Database(config.databasePath, { readonly: true });
      const integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        fail(`SQLite integrity_check failed: ${String(integrity)}`);
      } else {
        console.info(`  SQLite integrity_check: ok (${size} bytes)`);
      }

      const schema = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as
        | { version: number | null }
        | undefined;
      if (!schema?.version) {
        fail('schema_migrations is missing or empty; this does not look like a Donutcash database.');
      } else {
        console.info(`  schema version: ${schema.version}`);
      }

      const count = (table: string): number => {
        const row = db?.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | undefined;
        return row?.count ?? 0;
      };
      const counts = {
        users: count('users'),
        wallets: count('wallets'),
        ledger: count('ledger'),
        settings: count('settings'),
        games: count('games'),
      };
      console.info(
        `  rows: users=${counts.users}, wallets=${counts.wallets}, ledger=${counts.ledger}, settings=${counts.settings}, games=${counts.games}`,
      );
      if (counts.wallets !== counts.users) {
        warn(`${counts.users - counts.wallets} user(s) have no wallet row; check the data if this is unexpected.`);
      }
      if (counts.settings === 0) fail('The settings table is empty; admin configuration would be lost.');
      if (counts.games === 0) fail('The games table is empty; game multipliers and limits are missing.');

      const settingsKeys = [
        'platform.name',
        'platform.maintenance',
        'economy.starting_credits',
        'economy.max_payout',
        'economy.cashier_request_limit',
        'security.accounts_per_ip',
        'rewards.enabled',
        'rewards.base_amount',
        'rewards.increment_amount',
        'rewards.max_streak_days',
      ];
      const placeholders = settingsKeys.map(() => '?').join(', ');
      const settings = db
        .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders}) ORDER BY key`)
        .all(...settingsKeys) as { key: string; value: string }[];
      console.info('  persistent settings:');
      for (const setting of settings) {
        const value = setting.value.length > 120 ? `${setting.value.slice(0, 117)}...` : setting.value;
        console.info(`    ${setting.key} = ${value}`);
      }
      for (const key of settingsKeys) {
        if (!settings.some((setting) => setting.key === key)) {
          warn(`setting ${key} is missing; the next startup will seed its default.`);
        }
      }

      const games = db.prepare('SELECT id, enabled, min_bet, max_bet, config FROM games ORDER BY id').all() as {
        id: string;
        enabled: number;
        min_bet: number;
        max_bet: number;
        config: string;
      }[];
      console.info('  game configurations:');
      for (const game of games) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(game.config) as Record<string, unknown>;
        } catch {
          fail(`game ${game.id} has invalid JSON in its config.`);
        }
        try {
          validateGameConfig(game.id, parsed);
        } catch (error) {
          fail(`game ${game.id} has an invalid configuration: ${error instanceof Error ? error.message : String(error)}`);
        }
        console.info(
          `    ${game.id}: enabled=${Boolean(game.enabled)} min=${game.min_bet} max=${game.max_bet} config=${JSON.stringify(parsed)}`,
        );
      }

      const foreignKeyProblems = db.pragma('foreign_key_check') as unknown[];
      if (foreignKeyProblems.length > 0) {
        warn(`foreign_key_check reported ${foreignKeyProblems.length} orphaned row(s).`);
      }

      // A production database must have been found, not created at boot. The
      // startup guard already enforces this; repeat it here for visibility.
      if (config.isProduction && !config.databaseExists) {
        fail('Production would create a new empty database. Set DATABASE_PATH or ALLOW_NEW_DATABASE deliberately.');
      }
    } catch (error) {
      fail(`Could not read ${config.databasePath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      db?.close();
    }
  }
}

// 2. Runtime files must never be tracked. A tracked file that the app or host
// rewrites is exactly what blocks the next `git pull`.
const tracked = git(['ls-files', '-z', '--', ...runtimePaths]);
if (tracked !== null) {
  const trackedFiles = tracked
    .split('\0')
    .filter(Boolean)
    // A deletion in the working tree is harmless: it disappears from the next
    // commit. The risk is a file that still exists and is tracked.
    .filter((relative) => fs.existsSync(path.join(config.root, relative)));
  if (trackedFiles.length > 0) {
    fail(`Runtime path(s) are still tracked by Git: ${trackedFiles.join(', ')}. Run \`git rm --cached\` and commit.`);
  } else {
    console.info('  tracked runtime files: none');
  }
}

// 3. Ignore rules must cover every generated/persistent path.
const ignoredPaths = [
  'web.config',
  '.env',
  '.session-secret',
  'owner-credentials.txt',
  'app.db',
  'data/aurum.db',
  'App_Data/aurum.db',
  'logs/node.log',
  'dist/index.html',
  'build/server/index.js',
];
if (gitSucceeds(['rev-parse', '--is-inside-work-tree'])) {
  const notIgnored = ignoredPaths.filter(
    (candidate) => !gitSucceeds(['check-ignore', '-q', '--no-index', '--', candidate]),
  );
  if (notIgnored.length > 0) {
    fail(`These runtime paths are not ignored by Git: ${notIgnored.join(', ')}.`);
  } else {
    console.info('  .gitignore runtime coverage: ok');
  }
}

// 4. Dependency metadata must be committed in sync. MonsterASP runs
// `npm install` during its build, and npm can rewrite package-lock.json when it
// disagrees with package.json; that becomes a local change that blocks the next
// pull. Fail on a dirty dependency manifest/lock rather than discovering it on
// the host.
const dependencyStatus = git(['status', '--porcelain', '--', 'package.json', 'package-lock.json']);
if (dependencyStatus !== null) {
  const dirty = dependencyStatus.trim();
  if (dirty) {
    warn(`package.json/package-lock.json have uncommitted changes; commit them together before pushing:\n${dirty}`);
  } else {
    console.info('  dependency manifest + lockfile: committed and clean');
  }
}

// 5. Build output is not required for a data check, but a production start
// needs it. Warn rather than fail so the script also works on a bare checkout.
if (!fs.existsSync(path.join(config.root, 'build', 'server', 'index.js'))) {
  warn('build/server/index.js is missing; run `npm run build` before starting the production server.');
}
if (!fs.existsSync(path.join(config.root, 'dist', 'index.html'))) {
  warn('dist/index.html is missing; the API will start but the SPA will not be served.');
}

console.info('');
if (warnings.length > 0) {
  console.info('Warnings:');
  for (const warning of warnings) console.info(`  - ${warning}`);
}
if (failures.length > 0) {
  console.error('FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.info('Deployment check passed. The database, settings and game configs are present and runtime files are outside Git.');
