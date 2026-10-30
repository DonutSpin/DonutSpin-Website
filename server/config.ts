import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional; hosted platforms inject the real environment */
}

function intEnv(name: string, fallback: number, min = Number.MIN_SAFE_INTEGER): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

const root = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Hosts that run Node behind IIS hand the port over in HTTP_PLATFORM_PORT and
 * usually map it to PORT. Accept both so a missing mapping cannot leave the
 * process listening on a port nothing forwards to.
 */
// Port 0 means "unassigned" on hosting platforms. Binding it would pick a
// random port that nothing forwards to, so it is treated as unset.
const port = intEnv('PORT', intEnv('HTTP_PLATFORM_PORT', 4000, 1), 1);

const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
/**
 * When APP_URL is not configured we cannot know the public origin up front, so
 * same-origin requests are trusted instead of locking the site to localhost.
 */
const appUrlConfigured = Boolean(process.env.APP_URL);

if (isProduction && !appUrlConfigured) {
  console.warn(
    `[config] APP_URL is not set, so email links and reset URLs fall back to ${appUrl}. ` +
      'Set APP_URL to the public origin before sending real email.',
  );
}

const databasePath = path.resolve(root, process.env.DATABASE_PATH || path.join('data', 'aurum.db'));

/**
 * A hosted deployment often has no way to inject a secret. Rather than crash on
 * boot, generate a strong secret once and persist it beside the database. An
 * explicit SESSION_SECRET always wins.
 */
function resolveSessionSecret(): string {
  const provided = (process.env.SESSION_SECRET || '').trim();
  if (provided) return provided;
  if (!isProduction) return '';

  const secretFile = path.join(root, 'data', '.session-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* first boot */
  }
  const generated = randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn(
      '[config] SESSION_SECRET was not set; generated a persistent secret at data/.session-secret. ' +
        'Set SESSION_SECRET in the environment to manage it yourself.',
    );
  } catch (error) {
    console.warn(
      '[config] SESSION_SECRET was not set and the generated secret could not be persisted:',
      error instanceof Error ? error.message : error,
    );
  }
  return generated;
}

export const config = {
  root,
  isProduction,
  port,
  appName: process.env.APP_NAME || 'Donutcash',
  appUrl,
  appUrlConfigured,
  databasePath,
  sessionDays: intEnv('SESSION_DAYS', 7),
  sessionSecret: resolveSessionSecret(),
  startingCredits: intEnv('STARTING_CREDITS', 5_000_000),
  exposeResetToken: process.env.EXPOSE_RESET_TOKEN === 'true' || (!isProduction && process.env.EXPOSE_RESET_TOKEN !== 'false'),
  allowedOrigins: isProduction
    ? [appUrl]
    : [appUrl, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'],
  /** The Vite build output. `npm run build` writes `index.html` and `assets/` here. */
  clientDist: path.join(root, 'dist'),
  mail: {
    host: process.env.SMTP_HOST || '',
    port: intEnv('SMTP_PORT', 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'Donutcash <no-reply@example.com>',
  },
};

export function ensureDataDir(dbPath: string): void {
  if (dbPath === ':memory:') return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export const SESSION_COOKIE = 'aurum_session';
