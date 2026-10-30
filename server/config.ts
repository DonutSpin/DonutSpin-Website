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
 * The production origin is the default so a missing or copied-development
 * environment cannot put localhost links into real email. Development keeps
 * the Vite origin; set APP_URL to point at any other host.
 */
export const DEFAULT_PRODUCTION_APP_URL = 'https://donutcash.runasp.net';
export const DEFAULT_DEVELOPMENT_APP_URL = 'http://localhost:5173';

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  );
}

/**
 * Resolve the public origin once at startup. Besides normalising the value,
 * production refuses loopback origins: a `.env` copied from development must
 * never put `http://localhost:5173` into verification or reset emails.
 */
export function resolveAppUrl(
  raw: string | undefined,
  production: boolean,
): { appUrl: string; configured: boolean; warning?: string } {
  const fallback = production ? DEFAULT_PRODUCTION_APP_URL : DEFAULT_DEVELOPMENT_APP_URL;
  const value = (raw ?? '').trim();
  if (!value) {
    return {
      appUrl: fallback,
      configured: false,
      ...(production
        ? { warning: `APP_URL is not set; using ${fallback} for email links and secure session cookies.` }
        : {}),
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      appUrl: fallback,
      configured: false,
      warning: `APP_URL is not a valid http(s) origin; using ${fallback} instead.`,
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      appUrl: fallback,
      configured: false,
      warning: `APP_URL must use http or https; using ${fallback} instead.`,
    };
  }

  if (production && isLoopbackHost(url.hostname)) {
    return {
      appUrl: fallback,
      configured: false,
      warning: `APP_URL points at loopback (${url.origin}), which cannot be used in production; using ${fallback} instead.`,
    };
  }

  return { appUrl: url.origin, configured: true };
}

/**
 * Hosts that run Node behind IIS hand the port over in HTTP_PLATFORM_PORT and
 * usually map it to PORT. Accept both so a missing mapping cannot leave the
 * process listening on a port nothing forwards to.
 */
// Port 0 means "unassigned" on hosting platforms. Binding it would pick a
// random port that nothing forwards to, so it is treated as unset.
const port = intEnv('PORT', intEnv('HTTP_PLATFORM_PORT', 4000, 1), 1);

const resolvedAppUrl = resolveAppUrl(process.env.APP_URL, isProduction);
const appUrl = resolvedAppUrl.appUrl;
const appUrlConfigured = resolvedAppUrl.configured;
if (resolvedAppUrl.warning) console.warn(`[config] ${resolvedAppUrl.warning}`);

/**
 * Forwarded headers are opt-in, because a proxy that passes `X-Forwarded-For`
 * through untouched lets the caller choose their own address. IIS does exactly
 * that unless Application Request Routing is configured to replace the header,
 * so trusting it by default would hand every attacker a fresh rate-limit bucket
 * and forge audit-log IPs. Turn this on only after the host confirms it strips
 * or overwrites client-supplied forwarding headers.
 */
const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === 'true';
const trustedProxies = (process.env.TRUSTED_PROXY_IPS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

/**
 * Session cookies are Secure whenever the public origin is HTTPS; that does not
 * depend on a forwarded protocol header. `COOKIE_SECURE` overrides it for the
 * unusual case of production over plain HTTP.
 */
const cookieSecureOverride = process.env.COOKIE_SECURE;
const cookieSecure =
  cookieSecureOverride === undefined ? isProduction && appUrl.startsWith('https://') : cookieSecureOverride === 'true';

const databasePath = path.resolve(root, process.env.DATABASE_PATH || path.join('data', 'aurum.db'));

/**
 * `vite build` empties dist/, and a server build replaces build/. A database
 * placed in either folder would disappear on the next deploy, so refuse to
 * start instead of silently pointing a production site at disposable storage.
 */
export function assertDatabasePathSafe(dbPath: string, appRoot = root): void {
  for (const segment of ['dist', 'build']) {
    const directory = path.resolve(appRoot, segment);
    const relative = path.relative(directory, dbPath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(
        `DATABASE_PATH resolves inside ${segment}/ (${dbPath}); that directory is deleted by the build. ` +
          'Use the default data/aurum.db or another persistent path outside dist/ and build/.',
      );
    }
  }
}

assertDatabasePathSafe(databasePath);

/**
 * Turnstile's site key is public and safe to ship. The secret key is never
 * exposed by the API or the client bundle; it is read from the host environment
 * and only used by the server-side Siteverify call. CAPTCHA stays disabled until
 * the secret is configured, so a missing panel variable cannot lock everyone out.
 */
const turnstileSiteKey = (process.env.TURNSTILE_SITE_KEY || '0x4AAAAAAFtGePz0IE36l1Gz').trim();
const turnstileSecretKey = (process.env.TURNSTILE_SECRET_KEY || '').trim();
const turnstileEnabled =
  process.env.TURNSTILE_ENABLED === 'false' ? false : Boolean(turnstileSiteKey && turnstileSecretKey);

if (isProduction && !turnstileEnabled) {
  console.warn(
    '[config] Turnstile is disabled because TURNSTILE_SECRET_KEY is not set. ' +
      'Set it in the hosting panel to enable CAPTCHA on login, registration and password reset requests.',
  );
}

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
  trustProxyHeaders,
  trustedProxies,
  cookieSecure,
  databasePath,
  turnstile: {
    enabled: turnstileEnabled,
    siteKey: turnstileSiteKey,
    secretKey: turnstileSecretKey,
    expectedHostname: (process.env.TURNSTILE_EXPECTED_HOSTNAME || '').trim().toLowerCase(),
  },
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
