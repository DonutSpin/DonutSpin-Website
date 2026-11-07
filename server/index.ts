import { createApp } from './app.ts';
import { getDatabase, closeDatabase } from './db/index.ts';
import { assertProductionDatabaseAvailable, config, ensureDataDir } from './config.ts';
import { assertProductionSecrets } from './lib/crypto.ts';
import { processEmailQueue } from './lib/email.ts';
import { processTicketReplyDigests } from './lib/support-notifications.ts';
import { flushPendingSupportTranscripts } from './lib/discord/support.ts';
import { settleDueRain } from './lib/rain.ts';
import { settleDueGiveaways } from './lib/giveaways.ts';
import { ensureBootstrapOwner } from './lib/owner-bootstrap.ts';
import { isSharedRateLimitStoreEnabled } from './lib/rate-limit.ts';

// A production process must never create a brand-new empty database: that is
// how a changed path resets every account, balance, game multiplier and admin
// setting at once. The check runs before getDatabase() touches the filesystem
// and before the session secret is resolved, so a failed boot cannot rotate it.
assertProductionDatabaseAvailable({
  isProduction: config.isProduction,
  databaseExists: config.databaseExists,
  allowNewDatabase: config.allowNewDatabase,
  databasePath: config.databasePath,
  candidates: config.databasePathCandidates,
});
assertProductionSecrets();
ensureDataDir(config.dataDir);
ensureDataDir(config.databasePath);
const db = getDatabase();

// Hosted deployments have no shell to run `npm run owner`, so the owner is
// created here from environment variables, or with a generated password when
// the database has no owner at all.
try {
  ensureBootstrapOwner(db);
} catch (error) {
  console.error('[owner] bootstrap failed:', error instanceof Error ? error.message : error);
}

function maintenance(): void {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').run(cutoff, cutoff);
    db.prepare('DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL').run(cutoff);
    db.prepare('DELETE FROM email_verifications WHERE expires_at < ? OR used_at IS NOT NULL').run(cutoff);
    db.prepare("DELETE FROM email_jobs WHERE status = 'sent' AND sent_at < ?").run(cutoff);
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    console.warn('[maintenance] cleanup skipped:', error instanceof Error ? error.message : error);
  }
}
maintenance();

// Deliver queued mail in the background. A failed delivery is retried with
// exponential backoff and never blocks the request that queued it.
const emailTimer = setInterval(() => {
  void processEmailQueue(db, 10).catch((error) => {
    console.warn('[email] queue tick failed:', error instanceof Error ? error.message : error);
  });
}, 30_000);
emailTimer.unref();
setTimeout(() => {
  void processEmailQueue(db, 10).catch(() => undefined);
}, 4_000).unref();

// Support digests wait out a short grace period so a fast back-and-forth does
// not email every message. Transcript recovery re-queues rows whose outbox
// insert was interrupted; every operation is keyed and idempotent.
const supportTimer = setInterval(() => {
  try {
    processTicketReplyDigests(db, 20);
    flushPendingSupportTranscripts(db);
  } catch (error) {
    console.warn('[support] notification tick failed:', error instanceof Error ? error.message : error);
  }
}, 15_000);
supportTimer.unref();
setTimeout(() => {
  try {
    processTicketReplyDigests(db, 20);
    flushPendingSupportTranscripts(db);
  } catch {
    /* the scheduled tick retries */
  }
}, 8_000).unref();

// Rain countdowns belong to the server, not the creator's browser. This tick
// settles an expired rain even when every tab is closed. Settlement is
// idempotent, so overlapping ticks or workers cannot pay twice.
try {
  settleDueRain(db);
} catch (error) {
  console.warn('[rain] startup settlement skipped:', error instanceof Error ? error.message : error);
}
const rainTimer = setInterval(() => {
  try {
    settleDueRain(db);
  } catch (error) {
    console.warn('[rain] settlement tick failed:', error instanceof Error ? error.message : error);
  }
}, 1000);
rainTimer.unref();

// Giveaway end times are server-owned too. This activates scheduled draws and
// settles expired ones even when every browser is closed. Settlement is
// idempotent, so overlapping ticks cannot select or pay twice.
try {
  settleDueGiveaways(db);
} catch (error) {
  console.warn('[giveaways] startup settlement skipped:', error instanceof Error ? error.message : error);
}
const giveawayTimer = setInterval(() => {
  try {
    settleDueGiveaways(db);
  } catch (error) {
    console.warn('[giveaways] settlement tick failed:', error instanceof Error ? error.message : error);
  }
}, 5000);
giveawayTimer.unref();

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.info(`[donutspin] API listening on http://localhost:${config.port}`);
  console.info(`[donutspin] environment: ${config.isProduction ? 'production' : 'development'}`);
  console.info(`[donutspin] database: ${config.databasePath} (${config.databasePathSource})`);
  console.info(`[donutspin] persistent data: ${config.dataDir}`);
  console.info(`[donutspin] pre-migration backups: ${config.backupDir}`);
  console.info(`[donutspin] client build: ${config.clientDist}`);
  console.info(`[donutspin] public url: ${config.appUrl}${config.appUrlConfigured ? '' : ' (default; set APP_URL to override)'}`);
  console.info(
    `[donutspin] client ip: ${
      config.trustProxyHeaders
        ? `forwarded headers trusted from loopback${config.trustedProxies.length ? ` and ${config.trustedProxies.join(', ')}` : ''}`
        : 'forwarded headers ignored (recorded IPs fall back to unknown)'
    }`,
  );
  console.info(`[donutspin] rate limits: ${isSharedRateLimitStoreEnabled() ? 'shared SQLite windows' : 'in-process windows'}`);
  console.info(`[donutspin] session cookie secure: ${config.cookieSecure}`);
  console.info(
    `[donutspin] turnstile: ${config.turnstile.enabled ? 'enabled' : 'disabled (TURNSTILE_SECRET_KEY not set)'}`,
  );
  if (!config.isProduction) console.info('[donutspin] start the client with `npm run dev:web` (Vite proxies /api here)');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`[donutspin] could not listen on port ${config.port}:`, error.message);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[donutspin] uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[donutspin] unhandled rejection:', reason);
});

function shutdown(signal: string): void {
  console.info(`[donutspin] ${signal} received, closing server`);
  clearInterval(emailTimer);
  clearInterval(supportTimer);
  clearInterval(rainTimer);
  clearInterval(giveawayTimer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
