import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.ts';
import { config } from '../config.ts';
import { getSetting } from '../db/index.ts';
import { hashPassword, passwordIssues } from './crypto.ts';
import { createWallet } from './wallet.ts';
import { recordAudit } from './audit.ts';
import { newId, nowIso } from './core.ts';

/**
 * Owner bootstrap for hosted deployments.
 *
 * Never commit an owner password. This runs once at startup and supports two
 * safe paths:
 *
 * 1. `OWNER_EMAIL` + `OWNER_PASSWORD` are set in the host's environment.
 *    Idempotent: creates the owner on first boot, promotes the matching
 *    account on later boots, and never logs the password.
 * 2. Nothing is configured and no owner exists yet. A strong password is
 *    generated, printed once to the process log (HttpPlatform log on IIS),
 *    and written beside the persistent database, which web.config and the
 *    SPA fallback hide from HTTP.
 */

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

function writeCredentialsFile(lines: string[]): void {
  try {
    const file = config.ownerCredentialsPath;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  } catch (error) {
    console.warn('[owner] could not write owner-credentials.txt:', error instanceof Error ? error.message : error);
  }
}

function createOwner(db: DB, username: string, email: string, password: string): string {
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
  return userId;
}

export function ensureBootstrapOwner(db: DB): void {
  const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const username = (process.env.OWNER_USERNAME || 'owner').trim();
  const password = process.env.OWNER_PASSWORD || '';

  // Path 1: configured through the host's environment variables.
  if (email && password) {
    const issues = passwordIssues(password);
    if (issues.length) {
      console.error(`[owner] OWNER_PASSWORD does not meet the password policy: ${issues.join(' ')}`);
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      console.error('[owner] OWNER_USERNAME must be 3-20 letters, numbers, or underscores.');
      return;
    }

    const byEmail = db.prepare('SELECT id, role FROM users WHERE email = ? COLLATE NOCASE').get(email) as
      | { id: string; role: string }
      | undefined;

    if (byEmail) {
      if (byEmail.role !== 'owner') {
        db.prepare("UPDATE users SET role = 'owner', status = 'active', updated_at = ? WHERE id = ?").run(
          nowIso(),
          byEmail.id,
        );
        recordAudit(db, {
          actorId: byEmail.id,
          action: 'owner.bootstrap.promote',
          targetType: 'user',
          targetId: byEmail.id,
          targetLabel: email,
          metadata: { from: byEmail.role },
        });
        console.info(`[owner] promoted existing account ${email} to owner.`);
      }
      // Recovery switch: lets an operator reset a forgotten owner password from
      // the environment. Off by default so a panel edit cannot silently revert
      // a password that was changed in the app.
      if (process.env.OWNER_RESET_PASSWORD === 'true') {
        db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
          hashPassword(password),
          nowIso(),
          byEmail.id,
        );
        recordAudit(db, {
          actorId: byEmail.id,
          action: 'owner.bootstrap.password_reset',
          targetType: 'user',
          targetId: byEmail.id,
          targetLabel: email,
        });
        console.info(`[owner] reset the password for ${email} from OWNER_PASSWORD.`);
      }
      return;
    }

    const clash = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: string } | undefined;
    if (clash) {
      console.error(`[owner] OWNER_USERNAME "${username}" is already taken; set OWNER_USERNAME to a free name.`);
      return;
    }

    createOwner(db, username, email, password);
    console.info(`[owner] created owner account ${username} <${email}> from environment variables.`);
    const others = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as { count: number };
    if (others.count > 1) {
      console.warn(`[owner] ${others.count} owner accounts now exist; the environment owner is independent of them.`);
    }
    return;
  }

  // Path 2: nothing configured, and the database has no owner at all.
  const owners = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as { count: number };
  if (owners.count > 0) return;

  const generated = `Donutcash-${randomBytes(9).toString('base64url')}!9`;
  const ownerUsername = USERNAME_PATTERN.test(username) ? username : 'owner';
  const ownerEmail = email || `owner@${new URL(config.appUrl).hostname}`;

  createOwner(db, ownerUsername, ownerEmail, generated);

  console.info('');
  console.info('==============================================================');
  console.info(' Owner account created (no owner existed in this database).');
  console.info(`   Username: ${ownerUsername}`);
  console.info(`   Email:    ${ownerEmail}`);
  console.info(`   Password: ${generated}`);
  console.info(' Sign in, then change this password immediately.');
  console.info(' This is printed once; it is not stored anywhere in the repository.');
  console.info('==============================================================');
  console.info('');

  writeCredentialsFile([
    `Username: ${ownerUsername}`,
    `Email: ${ownerEmail}`,
    `Password: ${generated}`,
    '',
    'Created at startup because the database had no owner account.',
    'Sign in and change this password, then delete this file.',
  ]);
}
