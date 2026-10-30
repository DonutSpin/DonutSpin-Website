import fs from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional */
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const root = process.cwd();
const isProduction = process.env.NODE_ENV === 'production';
const appUrl = process.env.APP_URL || 'http://localhost:5173';

export const config = {
  root,
  isProduction,
  port: intEnv('PORT', 4000),
  appName: process.env.APP_NAME || 'Donutcash',
  appUrl,
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'aurum.db'),
  sessionDays: intEnv('SESSION_DAYS', 7),
  sessionSecret: process.env.SESSION_SECRET || '',
  startingCredits: intEnv('STARTING_CREDITS', 5_000_000),
  exposeResetToken: process.env.EXPOSE_RESET_TOKEN === 'true' || (!isProduction && process.env.EXPOSE_RESET_TOKEN !== 'false'),
  allowedOrigins: isProduction
    ? [appUrl]
    : [appUrl, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'],
  clientDist: path.join(root, 'dist', 'client'),
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
