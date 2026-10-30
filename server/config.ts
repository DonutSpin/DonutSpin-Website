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

/**
 * IIS's HttpPlatformHandler always assigns HTTP_PLATFORM_PORT to the child
 * process. Treat that as production even when a generated web.config forgot
 * NODE_ENV, otherwise a hosted deployment falls back to localhost email links.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.HTTP_PLATFORM_PORT);
}

const isProduction = isProductionRuntime();

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

export type DatabasePathSource =
  | 'env'
  | 'data_dir_env'
  | 'legacy_data'
  | 'legacy_root'
  | 'existing_app_data'
  | 'default';

export interface DatabasePathResolution {
  databasePath: string;
  dataDir: string;
  source: DatabasePathSource;
  exists: boolean;
  candidates: { path: string; exists: boolean }[];
}

/**
 * Runtime state that is not the database (backups, the generated session
 * secret, generated owner credentials) lives in one directory. `App_Data` is
 * the IIS convention: it sits beside the app but is preserved by publish
 * operations and is not a source folder, so `git pull` can never touch it.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env, appRoot = root): string {
  const configured = (env.DONUTCASH_DATA_DIR ?? '').trim();
  return path.resolve(appRoot, configured || 'App_Data');
}

/**
 * Resolve the one persistent database location. Explicit configuration always
 * wins. If it is absent, every known existing location is checked before a new
 * file is created, so an upgrade can never silently point production at an
 * empty database. New installations use App_Data/aurum.db.
 *
 * The order matters: root `app.db` is the long-standing production location,
 * followed by the older `data/` locations, then `App_Data/`. This application
 * never deletes or renames a database it finds; it only reports the choice.
 */
export function resolveDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  appRoot = root,
  // A zero-byte file is not an existing database. Treating it as one would
  // let a truncated/placeholder file win over a real database elsewhere.
  exists: (candidate: string) => boolean = (candidate) => {
    try {
      return fs.statSync(candidate).size > 0;
    } catch {
      return false;
    }
  },
): DatabasePathResolution {
  const rootPath = path.resolve(appRoot);
  const dataDir = resolveDataDir(env, rootPath);
  const explicit = (env.DATABASE_PATH ?? '').trim();
  if (explicit) {
    if (explicit === ':memory:') {
      return {
        databasePath: ':memory:',
        dataDir,
        source: 'env',
        exists: false,
        candidates: [{ path: ':memory:', exists: false }],
      };
    }
    const databasePath = path.resolve(rootPath, explicit);
    return {
      databasePath,
      dataDir,
      source: 'env',
      exists: exists(databasePath),
      candidates: [{ path: databasePath, exists: exists(databasePath) }],
    };
  }

  const configuredDataDir = (env.DONUTCASH_DATA_DIR ?? '').trim();
  const candidates: { path: string; source: DatabasePathSource }[] = [];
  const addCandidate = (candidatePath: string, source: DatabasePathSource) => {
    if (candidates.some((candidate) => candidate.path === candidatePath)) return;
    candidates.push({ path: candidatePath, source });
  };

  // An explicitly configured data directory is the strongest hint after
  // DATABASE_PATH itself, so check its known filenames first.
  if (configuredDataDir) {
    addCandidate(path.join(dataDir, 'app.db'), 'data_dir_env');
    addCandidate(path.join(dataDir, 'aurum.db'), 'data_dir_env');
  }
  addCandidate(path.join(rootPath, 'app.db'), 'legacy_root');
  addCandidate(path.join(rootPath, 'data', 'app.db'), 'legacy_data');
  addCandidate(path.join(rootPath, 'data', 'aurum.db'), 'legacy_data');
  addCandidate(path.join(rootPath, 'App_Data', 'app.db'), 'existing_app_data');
  addCandidate(path.join(rootPath, 'App_Data', 'aurum.db'), 'existing_app_data');

  const checked = candidates.map((candidate) => ({ ...candidate, exists: exists(candidate.path) }));
  const selected = checked.find((candidate) => candidate.exists) ?? {
    path: path.join(dataDir, 'aurum.db'),
    source: configuredDataDir ? ('data_dir_env' as const) : ('default' as const),
    exists: false,
  };
  return {
    databasePath: selected.path,
    dataDir,
    source: selected.source,
    exists: selected.exists,
    candidates: checked.map(({ path: candidatePath, exists: candidateExists }) => ({
      path: candidatePath,
      exists: candidateExists,
    })),
  };
}

/**
 * A production site must never boot on an empty database it just created. That
 * is how a moved/mistyped path silently resets balances and game settings.
 * Refuse to start unless the operator explicitly says this is a new install.
 */
export function assertProductionDatabaseAvailable(options: {
  isProduction: boolean;
  databaseExists: boolean;
  allowNewDatabase: boolean;
  databasePath: string;
  candidates: { path: string; exists: boolean }[];
}): void {
  if (options.isProduction && options.databasePath === ':memory:') {
    throw new Error(
      'Refusing to start: DATABASE_PATH=:memory: in production. Every account, balance and setting would disappear on restart.',
    );
  }
  if (!options.isProduction || options.databaseExists || options.allowNewDatabase) return;
  const checked = options.candidates
    .filter((candidate) => !candidate.exists)
    .map((candidate) => candidate.path)
    .join(', ');
  throw new Error(
    `Refusing to start: no existing database was found at ${options.databasePath} and ` +
      `creating an empty one would hide all existing accounts and settings. ` +
      `Checked: ${checked || options.databasePath}. ` +
      'Restore the database file, set DATABASE_PATH to its real location, or set ' +
      'ALLOW_NEW_DATABASE=true only for a genuinely new installation.',
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

const databaseResolution = resolveDatabasePath();
const databasePath = databaseResolution.databasePath;
const dataDir = databaseResolution.dataDir;
const backupDir = path.join(dataDir, 'backups');
const databaseExists = databaseResolution.exists;

if (databaseResolution.candidates.filter((candidate) => candidate.exists).length > 1) {
  console.warn(
    `[config] multiple database files found; using ${databasePath}. ` +
      `Set DATABASE_PATH explicitly to choose one. Candidates: ${databaseResolution.candidates
        .filter((candidate) => candidate.exists)
        .map((candidate) => candidate.path)
        .join(', ')}`,
  );
}

/**
 * `vite build` empties dist/, a server build replaces build/, and code folders
 * are replaced by Git. A database inside any of them would disappear on the
 * next deploy, so refuse to start instead of silently pointing production at
 * disposable storage.
 */
export function assertDatabasePathSafe(dbPath: string, appRoot = root): void {
  if (dbPath === ':memory:') return;
  const protectedSegments = ['dist', 'build', 'node_modules', 'src', 'server', 'shared', 'public', 'tests', 'logs', '.git'];
  for (const segment of protectedSegments) {
    const directory = path.resolve(appRoot, segment);
    const relative = path.relative(directory, dbPath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(
        `DATABASE_PATH resolves inside ${segment}/ (${dbPath}); that directory is replaced by Git or the build. ` +
          'Use App_Data/, data/, app.db, or an absolute path outside code/build directories.',
      );
    }
  }
}

/**
 * The runtime directory must not sit inside a folder that Git replaces or a
 * build empties. `App_Data`, `data/`, or an absolute path outside the project
 * are valid; `src/`, `server/`, `dist/`, and `build/` are not.
 */
export function assertRuntimePathSafe(runtimePath: string, appRoot = root): void {
  const protectedSegments = ['dist', 'build', 'node_modules', 'src', 'server', 'shared', 'public', 'tests', 'logs', '.git'];
  for (const segment of protectedSegments) {
    const directory = path.resolve(appRoot, segment);
    const relative = path.relative(directory, runtimePath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(
        `The persistent data directory resolves inside ${segment}/ (${runtimePath}); that directory is replaced by Git or the build. ` +
          'Use App_Data/, data/, or an absolute path outside code/build directories.',
      );
    }
  }
}

assertDatabasePathSafe(databasePath);
assertRuntimePathSafe(dataDir);

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

  // Keep an existing legacy data/.session-secret valid when the database is
  // moved to App_Data or kept at the site root. Generating a new secret would
  // sign every existing user out after an otherwise safe storage migration.
  const secretFiles = [
    path.join(dataDir, '.session-secret'),
    path.join(root, '.session-secret'),
    path.join(root, 'data', '.session-secret'),
    path.join(path.dirname(databasePath), '.session-secret'),
  ].filter((file, index, files) => files.indexOf(file) === index);
  for (const secretFile of secretFiles) {
    try {
      const existing = fs.readFileSync(secretFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    } catch {
      /* try the next location */
    }
  }

  const generated = randomBytes(48).toString('hex');
  const secretFile = path.join(dataDir, '.session-secret');
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn(
      `[config] SESSION_SECRET was not set; generated a persistent secret at ${path.relative(root, secretFile)}. ` +
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

let sessionSecretCache: string | null = null;

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
  databasePathSource: databaseResolution.source,
  databasePathCandidates: databaseResolution.candidates,
  databaseExists,
  allowNewDatabase: process.env.ALLOW_NEW_DATABASE === 'true',
  dataDir,
  backupDir,
  sessionSecretPath: path.join(dataDir, '.session-secret'),
  ownerCredentialsPath: path.join(dataDir, 'owner-credentials.txt'),
  databaseBackupBeforeMigration: process.env.DB_BACKUP_BEFORE_MIGRATION !== 'false',
  databaseBackupKeep: intEnv('DB_BACKUP_KEEP', 10, 1),
  turnstile: {
    enabled: turnstileEnabled,
    siteKey: turnstileSiteKey,
    secretKey: turnstileSecretKey,
    expectedHostname: (process.env.TURNSTILE_EXPECTED_HOSTNAME || '').trim().toLowerCase(),
  },
  sessionDays: intEnv('SESSION_DAYS', 7),
  /**
   * Resolved lazily so a production boot that aborts on a missing/wrong
   * database cannot generate a new secret (and sign everyone out) first.
   */
  get sessionSecret(): string {
    if (sessionSecretCache === null) sessionSecretCache = resolveSessionSecret();
    return sessionSecretCache;
  },
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
