import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.ts';
import { getDatabase } from '../db/index.ts';

const dbPath = config.databasePath;
if (dbPath === ':memory:') {
  console.error('In-memory databases cannot be backed up.');
  process.exit(1);
}
const dirArgIndex = process.argv.indexOf('--out');
const outDir = dirArgIndex !== -1 ? (process.argv[dirArgIndex + 1] ?? 'data/backups') : 'data/backups';
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(outDir, `donutcash-${stamp}.db`);

const db = getDatabase();
await db.backup(target);
const check = new Database(target, { readonly: true });
const integrity = check.pragma('integrity_check', { simple: true });
const users = (check.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
const ledger = (check.prepare('SELECT COUNT(*) AS c FROM ledger').get() as { c: number }).c;
check.close();
db.close();

// Opening a WAL-mode copy for the integrity check can leave empty sidecars
// beside the backup. Keep the backup directory clean so operators restore a
// single, self-contained .db file.
for (const suffix of ['-wal', '-shm']) {
  try {
    fs.rmSync(`${target}${suffix}`, { force: true });
  } catch {
    /* non-fatal cleanup */
  }
}

if (integrity !== 'ok') {
  console.error(`Backup failed integrity check: ${String(integrity)}`);
  process.exit(1);
}
console.info(`Backup written to ${target}`);
console.info(`  integrity_check: ok, users: ${users}, ledger entries: ${ledger}`);
console.info('Restore: stop the server, keep a copy of the current database, replace data/aurum.db with this file,');
console.info('remove stale aurum.db-wal / aurum.db-shm files, then start the server and run `npm run db:migrate`.');
