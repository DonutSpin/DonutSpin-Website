import { createApp } from './app.ts';
import { getDatabase, closeDatabase } from './db/index.ts';
import { config } from './config.ts';
import { assertProductionSecrets } from './lib/crypto.ts';
import { processEmailQueue } from './lib/email.ts';
import { ensureBootstrapOwner } from './lib/owner-bootstrap.ts';
import { isSharedRateLimitStoreEnabled } from './lib/rate-limit.ts';

assertProductionSecrets();
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

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.info(`[donutcash] API listening on http://localhost:${config.port}`);
  console.info(`[donutcash] environment: ${config.isProduction ? 'production' : 'development'}`);
  console.info(`[donutcash] database: ${config.databasePath}`);
  console.info(`[donutcash] client build: ${config.clientDist}`);
  console.info(`[donutcash] public url: ${config.appUrl}${config.appUrlConfigured ? '' : ' (APP_URL not set; same-origin requests are trusted)'}`);
  console.info(
    `[donutcash] client ip: ${
      config.trustProxyHeaders
        ? `forwarded headers trusted from loopback${config.trustedProxies.length ? ` and ${config.trustedProxies.join(', ')}` : ''}`
        : 'forwarded headers ignored (recorded IPs fall back to unknown)'
    }`,
  );
  console.info(`[donutcash] rate limits: ${isSharedRateLimitStoreEnabled() ? 'shared SQLite windows' : 'in-process windows'}`);
  console.info(`[donutcash] session cookie secure: ${config.cookieSecure}`);
  console.info(
    `[donutcash] turnstile: ${config.turnstile.enabled ? 'enabled' : 'disabled (TURNSTILE_SECRET_KEY not set)'}`,
  );
  if (!config.isProduction) console.info('[donutcash] start the client with `npm run dev:web` (Vite proxies /api here)');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(`[donutcash] could not listen on port ${config.port}:`, error.message);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[donutcash] uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[donutcash] unhandled rejection:', reason);
});

function shutdown(signal: string): void {
  console.info(`[donutcash] ${signal} received, closing server`);
  clearInterval(emailTimer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
