import { randomBytes } from 'node:crypto';
import { getDatabase } from '../db/index.ts';
import { getSetting } from '../db/index.ts';
import { hashPassword, passwordIssues } from '../lib/crypto.ts';
import { createWallet } from '../lib/wallet.ts';
import { recordAudit } from '../lib/audit.ts';
import { newId, nowIso } from '../lib/core.ts';
import { assertProductionDatabaseAvailable, config } from '../config.ts';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

assertProductionDatabaseAvailable({
  isProduction: config.isProduction,
  databaseExists: config.databaseExists,
  allowNewDatabase: config.allowNewDatabase,
  databasePath: config.databasePath,
  candidates: config.databasePathCandidates,
});

const db = getDatabase();
const username = (arg('username') ?? 'owner').trim();
const email = (arg('email') ?? '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run owner -- --email owner@example.com [--username owner] [--password <secret>]');
  console.error('If --password is omitted, a strong temporary password is generated and printed once.');
  process.exit(1);
}
if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
  console.error('Username must be 3–20 letters, numbers, or underscores.');
  process.exit(1);
}
const owners = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as { count: number }).count;
if (owners > 0 && !process.argv.includes('--force')) {
  console.error('An owner already exists. Use the admin panel to manage roles, or pass --force to create another owner.');
  process.exit(1);
}
const existing = db
  .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
  .get(username, email);
if (existing) {
  console.error('That username or email is already registered.');
  process.exit(1);
}

const supplied = arg('password') ?? process.env.OWNER_PASSWORD;
const password = supplied ?? `DonutSpin-${randomBytes(8).toString('base64url')}!9`;
const issues = passwordIssues(password);
if (issues.length) {
  console.error(`Password does not meet policy: ${issues.join(' ')}`);
  process.exit(1);
}

const startingCredits = getSetting(db, 'economy.starting_credits', config.startingCredits);
const userId = newId('usr');
const now = nowIso();
db.transaction(() => {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`,
  ).run(userId, username, email, hashPassword(password), now, now);
  createWallet(db, userId, startingCredits, userId);
})();
recordAudit(db, {
  actorId: userId,
  action: 'owner.bootstrap',
  targetType: 'user',
  targetId: userId,
  targetLabel: username,
});

console.info('Owner account created.');
console.info(`  Username: ${username}`);
console.info(`  Email:    ${email}`);
if (!supplied) {
  console.info(`  Temporary password: ${password}`);
  console.info('  Store this password securely and change it after the first sign-in.');
} else {
  console.info('  Password: the value you supplied (not printed).');
}
db.close();
