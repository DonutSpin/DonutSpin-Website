// server/app.ts
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import fs2 from "node:fs";
import path2 from "node:path";

// server/config.ts
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
try {
  process.loadEnvFile(".env");
} catch {
}
function intEnv(name, fallback, min = Number.MIN_SAFE_INTEGER) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}
var root = process.cwd();
var isProduction = process.env.NODE_ENV === "production";
var port = intEnv("PORT", intEnv("HTTP_PLATFORM_PORT", 4e3, 1), 1);
var appUrl = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
var appUrlConfigured = Boolean(process.env.APP_URL);
var trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === "true";
var trustedProxies = (process.env.TRUSTED_PROXY_IPS || "").split(",").map((entry) => entry.trim()).filter(Boolean);
var cookieSecureOverride = process.env.COOKIE_SECURE;
var cookieSecure = cookieSecureOverride === void 0 ? isProduction && appUrl.startsWith("https://") : cookieSecureOverride === "true";
if (isProduction && !appUrlConfigured) {
  console.warn(
    `[config] APP_URL is not set, so email links and reset URLs fall back to ${appUrl}. Set APP_URL to the public origin before sending real email.`
  );
}
var databasePath = path.resolve(root, process.env.DATABASE_PATH || path.join("data", "aurum.db"));
function resolveSessionSecret() {
  const provided = (process.env.SESSION_SECRET || "").trim();
  if (provided) return provided;
  if (!isProduction) return "";
  const secretFile = path.join(root, "data", ".session-secret");
  try {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
  }
  const generated = randomBytes(48).toString("hex");
  try {
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    fs.writeFileSync(secretFile, generated, { mode: 384 });
    console.warn(
      "[config] SESSION_SECRET was not set; generated a persistent secret at data/.session-secret. Set SESSION_SECRET in the environment to manage it yourself."
    );
  } catch (error) {
    console.warn(
      "[config] SESSION_SECRET was not set and the generated secret could not be persisted:",
      error instanceof Error ? error.message : error
    );
  }
  return generated;
}
var config = {
  root,
  isProduction,
  port,
  appName: process.env.APP_NAME || "Donutcash",
  appUrl,
  appUrlConfigured,
  trustProxyHeaders,
  trustedProxies,
  cookieSecure,
  databasePath,
  sessionDays: intEnv("SESSION_DAYS", 7),
  sessionSecret: resolveSessionSecret(),
  startingCredits: intEnv("STARTING_CREDITS", 5e6),
  exposeResetToken: process.env.EXPOSE_RESET_TOKEN === "true" || !isProduction && process.env.EXPOSE_RESET_TOKEN !== "false",
  allowedOrigins: isProduction ? [appUrl] : [appUrl, "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4000", "http://127.0.0.1:4000"],
  /** The Vite build output. `npm run build` writes `index.html` and `assets/` here. */
  clientDist: path.join(root, "dist"),
  mail: {
    host: process.env.SMTP_HOST || "",
    port: intEnv("SMTP_PORT", 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Donutcash <no-reply@example.com>"
  }
};
function ensureDataDir(dbPath) {
  if (dbPath === ":memory:") return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
var SESSION_COOKIE = "aurum_session";

// server/lib/core.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
var newId = (prefix) => `${prefix}_${randomBytes2(10).toString("hex")}`;
var ledgerId = () => `TX-${randomBytes2(6).toString("hex").toUpperCase()}`;
var ApiError = class extends Error {
  status;
  code;
  details;
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var badRequest = (message, code = "BAD_REQUEST", details) => new ApiError(400, code, message, details);
var unauthorized = (message = "Please sign in to continue.", code = "UNAUTHORIZED") => new ApiError(401, code, message);
var forbidden = (message = "You do not have permission to do that.", code = "FORBIDDEN") => new ApiError(403, code, message);
var notFound = (message = "Not found.", code = "NOT_FOUND") => new ApiError(404, code, message);
var conflict = (message, code = "CONFLICT", details) => new ApiError(409, code, message, details);
function inTransaction(db2, fn) {
  const txn = db2.transaction(fn);
  return txn.immediate();
}
function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
var LOOPBACK_ADDRESSES = /* @__PURE__ */ new Set(["127.0.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "::ffff:0.0.0.0"]);
function isLoopbackAddress(ip) {
  if (!ip) return true;
  return LOOPBACK_ADDRESSES.has(ip.trim().toLowerCase());
}
function clientIp(req) {
  const ip = req.ip ?? null;
  return ip && !isLoopbackAddress(ip) ? ip : null;
}

// server/lib/crypto.ts
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes as randomBytes3, scryptSync, timingSafeEqual } from "node:crypto";
var SCRYPT_N = 16384;
var SCRYPT_R = 8;
var SCRYPT_P = 1;
var KEY_LEN = 64;
function hashPassword(password) {
  const salt = randomBytes3(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p)
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
function randomToken(bytes = 32) {
  return randomBytes3(bytes).toString("base64url");
}
function mailEncryptionKey() {
  const material = process.env.EMAIL_ENCRYPTION_KEY || config.sessionSecret || "donutcash-local-email-key";
  return createHash("sha256").update(material).digest();
}
function encryptSecret(plain) {
  const iv = randomBytes3(12);
  const cipher = createCipheriv("aes-256-gcm", mailEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
function decryptSecret(payload) {
  try {
    const [version, iv, tag, encrypted] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) return null;
    const decipher = createDecipheriv("aes-256-gcm", mailEncryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
function tokenHash(token) {
  return createHmac("sha256", config.sessionSecret || "aurum-development-pepper").update(token).digest("hex");
}
function resetToken() {
  const token = randomToken(32);
  return { token, hash: tokenHash(token) };
}
function passwordIssues(password) {
  const issues = [];
  if (password.length < 10) issues.push("Use at least 10 characters.");
  if (password.length > 200) issues.push("Use at most 200 characters.");
  if (!/[a-zA-Z]/.test(password)) issues.push("Include at least one letter.");
  if (!/[0-9]/.test(password)) issues.push("Include at least one number.");
  return issues;
}
function assertProductionSecrets() {
  if (!config.isProduction) return;
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production.");
  }
  console.info("[security] SESSION_SECRET accepted; session tokens are peppered before storage.");
}

// shared/types.ts
var TICKET_STATUS_LABELS = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  waiting_user: "Waiting for user",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected"
};
var TICKET_TRANSITIONS = {
  new: ["open", "in_progress", "on_hold", "waiting_user", "resolved", "closed", "rejected"],
  open: ["in_progress", "on_hold", "waiting_user", "resolved", "closed", "rejected"],
  in_progress: ["open", "on_hold", "waiting_user", "resolved", "closed", "rejected"],
  on_hold: ["open", "in_progress", "waiting_user", "resolved", "closed", "rejected"],
  waiting_user: ["open", "in_progress", "on_hold", "resolved", "closed", "rejected"],
  resolved: ["closed", "open", "rejected"],
  closed: ["open"],
  rejected: ["open"]
};
var PERMISSIONS = [
  "tickets.create",
  "tickets.read_own",
  "tickets.read_all",
  "tickets.reply",
  "tickets.note",
  "tickets.assign",
  "tickets.status",
  "tickets.priority",
  "tickets.reject",
  "tickets.manage",
  "cashier.request",
  "credits.adjust",
  "users.read",
  "users.manage",
  "users.restrict",
  "roles.manage",
  "staff.manage",
  "games.play",
  "games.manage",
  "settings.manage",
  "audit.read",
  "economy.read",
  "notifications.broadcast",
  "staff.access",
  "admin.access"
];
var PLAYER_PERMISSIONS = [
  "tickets.create",
  "tickets.read_own",
  "cashier.request",
  "games.play"
];
var SUPPORT_PERMISSIONS = [
  ...PLAYER_PERMISSIONS,
  "staff.access",
  "tickets.read_all",
  "tickets.reply",
  "tickets.note",
  "tickets.assign",
  "tickets.status",
  "tickets.priority",
  "tickets.reject"
];
var MODERATOR_PERMISSIONS = [
  ...SUPPORT_PERMISSIONS,
  "admin.access",
  "tickets.manage",
  "users.read",
  "users.restrict"
];
var ADMIN_PERMISSIONS = [
  ...MODERATOR_PERMISSIONS,
  "admin.access",
  "users.manage",
  "roles.manage",
  "staff.manage",
  "games.manage",
  "settings.manage",
  "credits.adjust",
  "audit.read",
  "economy.read",
  "notifications.broadcast"
];
var ROLE_PERMISSIONS = {
  user: PLAYER_PERMISSIONS,
  support: SUPPORT_PERMISSIONS,
  moderator: MODERATOR_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  owner: [...PERMISSIONS]
};
function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
var ROLE_RANK = {
  user: 0,
  support: 1,
  moderator: 2,
  admin: 3,
  owner: 4
};

// shared/legal.ts
var LEGAL_TERMS_VERSION = "1.0";
var LEGAL_PRIVACY_VERSION = "1.0";
var LEGAL_EFFECTIVE_DATE = "2026-10-30";
var SELF_EXCLUSION_DURATIONS = ["24h", "7d", "30d", "permanent"];

// server/lib/legal.ts
function latestLegalAcceptance(db2, userId) {
  return db2.prepare(
    `SELECT * FROM legal_acceptances
       WHERE user_id = ?
       ORDER BY accepted_at DESC, rowid DESC
       LIMIT 1`
  ).get(userId);
}
function isCurrentLegalAcceptance(row) {
  return Boolean(row && row.terms_version === LEGAL_TERMS_VERSION && row.privacy_version === LEGAL_PRIVACY_VERSION);
}
function recordLegalAcceptance(db2, input) {
  const id = newId("leg");
  db2.prepare(
    `INSERT INTO legal_acceptances
       (id, user_id, terms_version, privacy_version, age_confirmed, tos_accepted, donut_rules_acknowledged, accepted_at, ip, user_agent)
     VALUES (?, ?, ?, ?, 1, 1, 1, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    LEGAL_TERMS_VERSION,
    LEGAL_PRIVACY_VERSION,
    input.acceptedAt ?? nowIso(),
    input.ip ?? null,
    input.userAgent?.slice(0, 500) ?? null
  );
  return id;
}
function isSelfExclusionActive(until, now = Date.now()) {
  if (!until) return false;
  const expiresAt = new Date(until).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

// server/auth.ts
function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Derived from the configured public origin (HTTPS ⇒ Secure) instead of a
    // forwarded protocol header, which a client can forge. COOKIE_SECURE
    // overrides it for the rare production site served over plain HTTP.
    secure: config.cookieSecure,
    path: "/",
    maxAge: config.sessionDays * 24 * 60 * 60 * 1e3
  };
}
function createSession(db2, userId, req) {
  const token = randomToken(32);
  const sessionId = `ses_${randomToken(12)}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1e3).toISOString();
  db2.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, tokenHash(token), createdAt, expiresAt, createdAt, clientIp(req), req.get("user-agent") ?? null);
  return { token, sessionId, expiresAt };
}
function revokeSession(db2, sessionId) {
  db2.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(nowIso(), sessionId);
}
function revokeAllSessions(db2, userId) {
  db2.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(nowIso(), userId);
}
function revokeOtherSessions(db2, userId, keepSessionId) {
  db2.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").run(
    nowIso(),
    userId,
    keepSessionId
  );
}
function setSessionCookie(res, token, req) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
}
function clearSessionCookie(res, req) {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: void 0 });
}
function loadUser(db2, userId) {
  const row = db2.prepare(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.email_verified, u.email_notifications,
              u.created_at, u.last_login_at, u.self_excluded_until, w.balance
       FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?`
  ).get(userId);
  if (!row) return null;
  const acceptance = latestLegalAcceptance(db2, row.id);
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    emailNotifications: Boolean(row.email_notifications),
    balance: row.balance,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    legalAcceptanceRequired: !isCurrentLegalAcceptance(acceptance),
    legalAcceptedAt: acceptance?.accepted_at ?? null,
    selfExcludedUntil: row.self_excluded_until,
    permissions: ROLE_PERMISSIONS[row.role]
  };
}
function authMiddleware(db2) {
  return (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const row = db2.prepare(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, s.last_used_at,
                u.username, u.email, u.role, u.status, u.email_verified, u.email_notifications,
                u.created_at, u.last_login_at, u.self_excluded_until, w.balance
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN wallets w ON w.user_id = u.id
         WHERE s.token_hash = ?`
    ).get(tokenHash(token));
    if (!row) {
      clearSessionCookie(res, req);
      return next();
    }
    if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now() || row.status === "suspended" || isSelfExclusionActive(row.self_excluded_until)) {
      if (!row.revoked_at) revokeSession(db2, row.session_id);
      clearSessionCookie(res, req);
      return next();
    }
    const acceptance = latestLegalAcceptance(db2, row.user_id);
    req.user = {
      id: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      emailVerified: Boolean(row.email_verified),
      emailNotifications: Boolean(row.email_notifications),
      balance: row.balance,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      legalAcceptanceRequired: !isCurrentLegalAcceptance(acceptance),
      legalAcceptedAt: acceptance?.accepted_at ?? null,
      selfExcludedUntil: row.self_excluded_until,
      permissions: ROLE_PERMISSIONS[row.role]
    };
    req.sessionId = row.session_id;
    const now = Date.now();
    if (now - new Date(row.last_used_at).getTime() > 5 * 6e4) {
      db2.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").run(nowIso(), row.session_id);
      db2.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(nowIso(), row.user_id);
    }
    next();
  };
}

// server/lib/rate-limit.ts
var sharedDb = null;
var calls = 0;
function useSharedRateLimitStore(db2) {
  sharedDb = db2;
}
function isSharedRateLimitStoreEnabled() {
  return sharedDb !== null;
}
function consumeShared(db2, key, limit, windowMs) {
  const now = Date.now();
  const run = db2.transaction(() => {
    calls += 1;
    if (calls % 256 === 0) db2.prepare("DELETE FROM rate_limits WHERE expires_at < ?").run(now - windowMs);
    const row = db2.prepare("SELECT window_start, hits FROM rate_limits WHERE key = ?").get(key);
    if (!row || now - row.window_start >= windowMs) {
      db2.prepare(
        `INSERT INTO rate_limits (key, window_start, hits, expires_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           window_start = excluded.window_start,
           hits = 1,
           expires_at = excluded.expires_at`
      ).run(key, now, now + windowMs);
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) };
    }
    if (row.hits >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1e3)),
        remaining: 0
      };
    }
    db2.prepare("UPDATE rate_limits SET hits = hits + 1 WHERE key = ?").run(key);
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - row.hits - 1) };
  });
  return run.immediate();
}
var RateLimiter = class {
  hits = /* @__PURE__ */ new Map();
  limit;
  windowMs;
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  live(key, now) {
    const list = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (list.length === 0) this.hits.delete(key);
    else this.hits.set(key, list);
    return list;
  }
  /** Returns false when the key is over its limit. */
  consume(key) {
    if (sharedDb) return consumeShared(sharedDb, key, this.limit, this.windowMs);
    const now = Date.now();
    const list = this.live(key, now);
    if (list.length >= this.limit) {
      const oldest = list[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1e3)),
        remaining: 0
      };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, retryAfterSeconds: 0, remaining: this.limit - list.length };
  }
  reset(key) {
    if (sharedDb) {
      sharedDb.prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
      return;
    }
    this.hits.delete(key);
  }
  /** Clears this limiter's local counters. Shared windows expire on their own. */
  clear() {
    this.hits.clear();
  }
  prune() {
    const now = Date.now();
    for (const key of this.hits.keys()) this.live(key, now);
  }
};
function clientAddress(req) {
  const ip = req.ip ?? null;
  return ip && !isLoopbackAddress(ip) ? ip : null;
}
var loginLimiter = new RateLimiter(10, 10 * 6e4);
var loginIpLimiter = new RateLimiter(30, 10 * 6e4);
var registerLimiter = new RateLimiter(8, 60 * 6e4);
var registerGlobalLimiter = new RateLimiter(120, 60 * 6e4);
var resetLimiter = new RateLimiter(6, 60 * 6e4);
var mutationLimiter = new RateLimiter(240, 6e4);
var ticketCreateLimiter = new RateLimiter(10, 60 * 6e4);
var cashierRequestLimiter = new RateLimiter(10, 60 * 6e4);

// server/routes/public.ts
import { Router } from "express";

// server/db/index.ts
import Database from "better-sqlite3";

// server/db/schema.ts
var migrations = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','support','moderator','admin','owner')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted','suspended')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  restriction_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('initial_grant','admin_adjustment','game_wager','game_payout','game_refund','credit_request','reversal')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  metadata TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX ledger_user_created_idx ON ledger(user_id, created_at DESC);
CREATE INDEX ledger_type_idx ON ledger(type);
CREATE INDEX ledger_ref_idx ON ledger(ref_id);
CREATE INDEX ledger_created_idx ON ledger(created_at DESC);
CREATE TRIGGER ledger_append_only_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger entries are immutable'); END;
CREATE TRIGGER ledger_append_only_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger entries cannot be deleted'); END;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  revoked_at TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_bet INTEGER NOT NULL DEFAULT 1,
  max_bet INTEGER NOT NULL DEFAULT 10000,
  config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  bet INTEGER NOT NULL CHECK (bet > 0),
  status TEXT NOT NULL CHECK (status IN ('active','won','lost','push')),
  payout INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  outcome TEXT,
  idempotency_key TEXT NOT NULL,
  wager_ledger_id TEXT REFERENCES ledger(id),
  payout_ledger_id TEXT REFERENCES ledger(id),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX game_sessions_user_idx ON game_sessions(user_id, created_at DESC);
CREATE INDEX game_sessions_game_idx ON game_sessions(game_id, created_at DESC);
CREATE INDEX game_sessions_active_idx ON game_sessions(status);

CREATE TABLE support_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  default_priority TEXT NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('low','normal','high','urgent')),
  request_kinds TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tickets (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES support_categories(key) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('new','open','in_progress','on_hold','waiting_user','resolved','closed','rejected')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  hold_reason TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX tickets_status_idx ON tickets(status, last_activity_at DESC);
CREATE INDEX tickets_assignee_idx ON tickets(assignee_id, status);
CREATE INDEX tickets_user_idx ON tickets(user_id, created_at DESC);
CREATE INDEX tickets_priority_idx ON tickets(priority);
CREATE INDEX tickets_activity_idx ON tickets(last_activity_at DESC);

CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal','system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages(ticket_id, created_at);

CREATE TABLE ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events(ticket_id, created_at);

CREATE TABLE ticket_reads (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE credit_requests (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('grant','correction','missing_transaction')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_reason TEXT,
  decided_at TEXT,
  ledger_id TEXT REFERENCES ledger(id),
  created_at TEXT NOT NULL
);
CREATE INDEX credit_requests_status_idx ON credit_requests(status, created_at DESC);
CREATE INDEX credit_requests_user_idx ON credit_requests(user_id);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications(user_id, read_at);

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,
  reason TEXT,
  metadata TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs(actor_id);
CREATE INDEX audit_action_idx ON audit_logs(action);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`
  },
  {
    version: 2,
    name: "cashier_requests",
    sql: `
CREATE TABLE cashier_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('deposit','withdrawal')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_reason TEXT,
  decided_at TEXT,
  ledger_id TEXT REFERENCES ledger(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);
CREATE INDEX cashier_requests_user_idx ON cashier_requests(user_id, created_at DESC);
CREATE INDEX cashier_requests_status_idx ON cashier_requests(status, created_at DESC);
CREATE INDEX cashier_requests_activity_idx ON cashier_requests(last_activity_at DESC);

CREATE TABLE cashier_messages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES cashier_requests(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_role TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','system')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX cashier_messages_request_idx ON cashier_messages(request_id, created_at);
`
  },
  {
    version: 3,
    name: "donutcash_branding",
    sql: `
UPDATE settings SET value = '"Donutcash"'
 WHERE key = 'platform.name' AND value IN ('"Aurum Casino"', '"Aurum"', '"DonutCash"');
UPDATE support_categories
   SET label = 'Money request',
       description = 'Ask the support team for a DonutSMP money grant or correction.'
 WHERE key = 'credit_request' AND label IN ('Virtual-credit request', 'Credit request');
`
  },
  {
    version: 4,
    name: "active_game_rounds",
    sql: `
CREATE TABLE active_rounds (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('playing','settled')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX active_rounds_session_idx ON active_rounds(session_id);
`
  },
  {
    version: 5,
    name: "economy_limits",
    sql: `
UPDATE settings SET value = '5000000'
 WHERE key = 'economy.starting_credits' AND value = '1000';
UPDATE settings SET value = '5000000000'
 WHERE key = 'economy.credit_request_limit' AND value = '50000';
UPDATE settings SET value = '5000000000'
 WHERE key = 'support.staff_approval_limit' AND value = '5000';
`
  },
  {
    version: 7,
    name: "rewards_and_email",
    sql: `
ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;
ALTER TABLE announcements ADD COLUMN email_recipient_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE reward_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  streak_day INTEGER NOT NULL,
  base_amount INTEGER NOT NULL,
  increment_amount INTEGER NOT NULL,
  milestone_amount INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL,
  ledger_id TEXT REFERENCES ledger(id),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, claim_day)
);
CREATE INDEX reward_claims_user_idx ON reward_claims(user_id, claim_day DESC);
CREATE INDEX reward_claims_created_idx ON reward_claims(created_at DESC);

CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX email_verifications_user_idx ON email_verifications(user_id, created_at DESC);

CREATE TABLE email_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX email_jobs_due_idx ON email_jobs(status, next_attempt_at);
CREATE INDEX email_jobs_created_idx ON email_jobs(created_at DESC);
`
  },
  {
    version: 8,
    name: "cashier_only_money_requests",
    sql: `
-- Money requests are handled only by the cashier. Keep the legacy category row
-- so historical tickets still resolve their label, but archive it from every
-- creation and management surface.
UPDATE support_categories
   SET label = 'Archived money request',
       description = 'Archived. Money requests are handled in the Cashier.',
       enabled = 0,
       request_kinds = '[]'
 WHERE key = 'credit_request';
UPDATE support_categories SET request_kinds = '[]' WHERE request_kinds <> '[]';

-- Retire the old ticket-approval setting and rename the per-request cap for the
-- cashier. The value is copied first so deployments keep their existing limit.
INSERT INTO settings (key, value, updated_at, updated_by)
SELECT 'economy.cashier_request_limit', value, updated_at, updated_by
  FROM settings WHERE key = 'economy.credit_request_limit'
  ON CONFLICT(key) DO NOTHING;
DELETE FROM settings WHERE key IN ('economy.credit_request_limit', 'support.staff_approval_limit');
`
  },
  {
    version: 10,
    name: "raise_default_payout_ceiling",
    // The original seed capped every payout at 1,000,000 while game wagers were
    // allowed to exceed it, so wins were silently truncated to the stake. Raise
    // the untouched seed value; a value an operator actually chose is kept.
    sql: `
UPDATE settings
   SET value = '1000000000000', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'economy.max_payout'
   AND CAST(value AS INTEGER) = 1000000
   AND NOT EXISTS (
     SELECT 1 FROM audit_logs WHERE action = 'settings.update' AND target_id = 'economy.max_payout'
   );
`
  },
  {
    version: 11,
    name: "shared_rate_limit_windows",
    // Limits used to live in per-process memory. Hosts that run more than one
    // Node worker (IIS web garden, scale-out) would then hand every worker its
    // own quota. The window lives in the database the workers already share, so
    // the effective limit no longer multiplies by the worker count.
    sql: `
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL CHECK (hits >= 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);
`
  },
  {
    version: 9,
    name: "legal_acceptance_and_self_exclusion",
    sql: `
ALTER TABLE users ADD COLUMN self_excluded_until TEXT;
ALTER TABLE users ADD COLUMN self_excluded_at TEXT;
ALTER TABLE users ADD COLUMN self_exclusion_reason TEXT;

CREATE TABLE legal_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  age_confirmed INTEGER NOT NULL CHECK (age_confirmed = 1),
  tos_accepted INTEGER NOT NULL CHECK (tos_accepted = 1),
  donut_rules_acknowledged INTEGER NOT NULL CHECK (donut_rules_acknowledged = 1),
  accepted_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX legal_acceptances_user_idx ON legal_acceptances(user_id, accepted_at DESC);
CREATE INDEX legal_acceptances_version_idx ON legal_acceptances(terms_version, privacy_version);
`
  },
  {
    version: 6,
    name: "backfill_active_rounds",
    // Existing databases may already have unfinished sessions. Give the newest
    // one per player the single active-bet slot instead of letting it vanish.
    sql: `
INSERT OR IGNORE INTO active_rounds (user_id, session_id, game_id, status, created_at, expires_at)
SELECT gs.user_id, gs.id, gs.game_id, 'playing', gs.created_at,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+365 days')
  FROM game_sessions gs
 WHERE gs.status = 'active'
   AND gs.created_at = (
     SELECT MAX(latest.created_at)
       FROM game_sessions latest
      WHERE latest.user_id = gs.user_id AND latest.status = 'active'
   )
   AND NOT EXISTS (SELECT 1 FROM active_rounds ar WHERE ar.user_id = gs.user_id);
`
  }
];
function migrate(db2) {
  db2.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db2.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db2.transaction(() => {
      db2.exec(migration.sql);
      db2.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        (/* @__PURE__ */ new Date()).toISOString()
      );
    })();
  }
}
var GAMES = [
  {
    id: "coinflip",
    name: "Coinflip",
    description: "Call heads or tails and watch the coin decide.",
    config: { winMultiplier: 1.96 }
  },
  {
    id: "mines",
    name: "Mines",
    description: "Reveal safe tiles, grow the multiplier, cash out before you hit a mine.",
    config: { maxMines: 20, houseEdge: 0.03 }
  },
  {
    id: "blackjack",
    name: "Blackjack",
    description: "Beat the dealer to 21. Six-deck shoe, dealer stands on 17.",
    config: { decks: 6, dealerStandsSoft17: true, blackjackPays: 1.5, allowDouble: true }
  },
  {
    id: "roulette",
    name: "Roulette",
    description: "European single-zero wheel with inside and outside bets.",
    config: { maxBetsPerSpin: 10 }
  },
  {
    id: "towers",
    name: "Towers",
    description: "Climb nine floors. One trap per floor. Cash out any time.",
    config: { levels: 9, houseEdge: 0.03 }
  },
  {
    id: "plinko",
    name: "Plinko",
    description: "Drop the ball and let the pegs decide your multiplier.",
    config: { enabledRisks: ["low", "medium", "high"] }
  }
];
var CATEGORIES = [
  { key: "wallet", label: "Wallet or transaction issue", description: "A wallet balance or ledger entry looks wrong.", priority: "high", order: 20 },
  { key: "game", label: "Game issue", description: "A round did not play out as expected.", priority: "high", order: 30 },
  { key: "account", label: "Account issue", description: "Sign-in, profile, or access problems.", priority: "high", order: 40 },
  { key: "technical", label: "Technical support", description: "The platform is not behaving correctly.", priority: "normal", order: 50 },
  { key: "question", label: "General question", description: "Ask about rules, limits, or how something works.", priority: "low", order: 60 },
  { key: "other", label: "Other", description: "Anything that does not fit another category.", priority: "normal", order: 70 }
];
function seed(db2, options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const insertGame = db2.prepare(
    `INSERT INTO games (id, name, description, enabled, min_bet, max_bet, config, updated_at)
     VALUES (?, ?, ?, 1, 1, 10000, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );
  const insertCategory = db2.prepare(
    `INSERT INTO support_categories (key, label, description, enabled, default_priority, request_kinds, sort_order)
     VALUES (?, ?, ?, 1, ?, '[]', ?)
     ON CONFLICT(key) DO NOTHING`
  );
  const insertSetting = db2.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`
  );
  db2.transaction(() => {
    for (const game of GAMES) {
      insertGame.run(game.id, game.name, game.description, JSON.stringify(game.config), now);
    }
    for (const category of CATEGORIES) {
      insertCategory.run(category.key, category.label, category.description, category.priority, category.order);
    }
    const settings = {
      "platform.name": options.appName,
      "platform.tagline": "The casino for DonutSMP money.",
      "platform.registration_open": true,
      "platform.maintenance": false,
      "platform.maintenance_message": "We are tuning the tables. Please try again shortly.",
      "economy.starting_credits": options.startingCredits,
      "economy.max_payout": 1e12,
      "economy.cashier_request_limit": 5e9,
      "security.session_days": options.sessionDays,
      "notifications.email_enabled": false,
      "rewards.enabled": true,
      "rewards.timezone": "UTC",
      "rewards.reset_hour": 0,
      "rewards.base_amount": 5e4,
      "rewards.increment_amount": 1e4,
      "rewards.max_amount": 5e5,
      "rewards.max_streak_days": 365,
      "rewards.missed_policy": "reset",
      "rewards.grace_days": 1,
      "rewards.milestones": [
        { day: 7, amount: 1e5, label: "Week one bonus" },
        { day: 14, amount: 25e4, label: "Two-week streak" },
        { day: 30, amount: 75e4, label: "Monthly devotee" }
      ],
      "rewards.email_enabled": true,
      "email.enabled": false,
      "email.host": "smtp-relay.brevo.com",
      "email.port": 587,
      "email.secure": false,
      "email.user": "c05ccf001@smtp-brevo.com",
      "email.from_name": "Donutcash",
      "email.from_email": "no-reply@donutcash.local",
      "email.reply_to": "",
      "email.security_notifications": true,
      "email.reward_notifications": true
    };
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(key, JSON.stringify(value), now);
    }
  })();
}

// server/db/index.ts
function createDatabase(filePath = config.databasePath) {
  ensureDataDir(filePath);
  const db2 = new Database(filePath);
  db2.pragma("journal_mode = WAL");
  db2.pragma("foreign_keys = ON");
  db2.pragma("busy_timeout = 5000");
  db2.pragma("synchronous = NORMAL");
  migrate(db2);
  seed(db2, {
    appName: config.appName,
    startingCredits: config.startingCredits,
    sessionDays: config.sessionDays
  });
  useSharedRateLimitStore(filePath === ":memory:" ? null : db2);
  return db2;
}
var singleton = null;
function getDatabase() {
  if (!singleton) singleton = createDatabase();
  return singleton;
}
function closeDatabase() {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
function getSetting(db2, key, fallback) {
  const row = db2.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}
function setSetting(db2, key, value, actorId) {
  db2.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(key, JSON.stringify(value), (/* @__PURE__ */ new Date()).toISOString(), actorId);
}

// server/lib/permissions.ts
function can(role, permission) {
  return roleHasPermission(role, permission);
}
function requireAuth(req) {
  if (!req.user) throw unauthorized();
  return req.user;
}
function requirePermission(req, permission) {
  const user = requireAuth(req);
  if (!can(user.role, permission)) throw forbidden("Your role does not include this permission.");
  return user;
}
function requireActive(req) {
  const user = requireAuth(req);
  if (user.status === "suspended") throw forbidden("This account is suspended.", "ACCOUNT_SUSPENDED");
  if (user.status === "restricted") throw forbidden("This account is restricted. Contact support.", "ACCOUNT_RESTRICTED");
  if (isSelfExclusionActive(user.selfExcludedUntil)) {
    throw forbidden("This account is self-excluded and cannot access the platform right now.", "SELF_EXCLUDED");
  }
  return user;
}

// server/lib/tickets.ts
function generateTicketReference(db2) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const name = `ticket_${year}`;
  const row = db2.prepare(
    `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
  ).get(name);
  return `TKT-${year}-${String(row.value).padStart(6, "0")}`;
}
function loadSupportCategories(db2, enabledOnly = false) {
  const rows = db2.prepare(
    `SELECT key, label, description, enabled, default_priority, sort_order
       FROM support_categories
       WHERE key <> 'credit_request' ${enabledOnly ? "AND enabled = 1" : ""}
       ORDER BY sort_order, label`
  ).all();
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    description: row.description,
    enabled: Boolean(row.enabled),
    defaultPriority: row.default_priority,
    sortOrder: row.sort_order
  }));
}
function canViewAllTickets(user) {
  return can(user.role, "tickets.read_all");
}
function assertCanViewTicket(user, ticketUserId) {
  if (canViewAllTickets(user)) return;
  if (ticketUserId !== user.id) throw forbidden("This ticket belongs to another account.");
}
function isStaffRole(role) {
  return role !== "user";
}
var LIST_SELECT = `
  SELECT t.*, c.label AS category_label, req.username AS requester_name, ag.username AS assignee_name,
         r.last_read_at,
         (SELECT m.created_at FROM ticket_messages m
          WHERE m.ticket_id = t.id AND m.visibility = 'public'
          ORDER BY m.created_at DESC LIMIT 1) AS last_public_message_at,
         (SELECT m.author_role FROM ticket_messages m
          WHERE m.ticket_id = t.id AND m.visibility = 'public'
          ORDER BY m.created_at DESC LIMIT 1) AS last_sender_role,
         (SELECT cr.id FROM credit_requests cr WHERE cr.ticket_id = t.id) AS credit_request_id
  FROM tickets t
  JOIN support_categories c ON c.key = t.category
  JOIN users req ON req.id = t.user_id
  LEFT JOIN users ag ON ag.id = t.assignee_id
  LEFT JOIN ticket_reads r ON r.ticket_id = t.id AND r.user_id = @viewerId
`;
function scopeClause(scope, viewer, params) {
  if (scope === "mine" || scope === "assigned") {
    params.mineId = viewer.id;
    return "t.assignee_id = @mineId";
  }
  if (scope === "unassigned") return "t.assignee_id IS NULL";
  if (scope === "open") return "t.status IN ('open','new','in_progress')";
  if (scope && ["new", "in_progress", "on_hold", "waiting_user", "resolved", "closed", "rejected"].includes(scope)) {
    params.scopeStatus = scope;
    return "t.status = @scopeStatus";
  }
  return null;
}
function buildTicketList(db2, viewer, filters) {
  const params = { viewerId: viewer.id };
  const clauses = [];
  if (filters.ownOnly || !canViewAllTickets(viewer)) {
    params.ownerId = viewer.id;
    clauses.push("t.user_id = @ownerId");
  }
  const scoped = scopeClause(filters.scope, viewer, params);
  if (scoped) clauses.push(scoped);
  if (filters.status && filters.status !== "all") {
    params.status = filters.status;
    clauses.push("t.status = @status");
  }
  if (filters.category) {
    params.category = filters.category;
    clauses.push("t.category = @category");
  }
  if (filters.priority) {
    params.priority = filters.priority;
    clauses.push("t.priority = @priority");
  }
  if (filters.assigneeId) {
    params.assigneeId = filters.assigneeId;
    clauses.push("t.assignee_id = @assigneeId");
  }
  if (filters.requesterId) {
    params.requesterId = filters.requesterId;
    clauses.push("t.user_id = @requesterId");
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    clauses.push("(t.reference LIKE @search OR t.subject LIKE @search OR req.username LIKE @search)");
  }
  if (filters.from) {
    params.from = filters.from;
    clauses.push("t.created_at >= @from");
  }
  if (filters.to) {
    params.to = filters.to;
    clauses.push("t.created_at <= @to");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const orderBy = filters.sort === "created" ? `t.created_at ${direction}` : filters.sort === "priority" ? `CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END ${direction}, t.last_activity_at DESC` : `t.last_activity_at ${direction}`;
  const totalRow = db2.prepare(`SELECT COUNT(*) AS count FROM (${LIST_SELECT.replace("@viewerId", "@viewerId")} ${where})`).get(params);
  const rows = db2.prepare(`${LIST_SELECT} ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all({ ...params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize });
  return { items: rows.map((row) => mapTicketSummary(row, viewer)), total: totalRow?.count ?? 0 };
}
function unreadFor(row, viewer) {
  if (!row.last_public_message_at) return false;
  if (!row.last_read_at) return row.last_sender_role !== viewer.role && row.last_sender_role !== null;
  if (row.last_public_message_at <= row.last_read_at) return false;
  if (canViewAllTickets(viewer)) return row.last_sender_role === "user";
  return row.last_sender_role !== "user";
}
function mapTicketSummary(row, viewer) {
  return {
    id: row.id,
    reference: row.reference,
    subject: row.subject,
    category: row.category,
    categoryLabel: row.category_label ?? row.category,
    status: row.status,
    priority: row.priority,
    requester: { id: row.user_id, username: row.requester_name ?? "Unknown" },
    assignee: row.assignee_id ? { id: row.assignee_id, username: row.assignee_name ?? "Unknown" } : null,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    unread: unreadFor(row, viewer),
    hasArchivedMoneyRequest: Boolean(row.credit_request_id)
  };
}
function ticketCounts(db2, viewer, options) {
  const params = { viewerId: viewer.id };
  let scope = "";
  if (options?.ownOnly || !canViewAllTickets(viewer)) {
    params.ownerId = viewer.id;
    scope = "WHERE t.user_id = @ownerId";
  }
  const row = db2.prepare(
    `SELECT
        COUNT(*) AS all_count,
        SUM(CASE WHEN t.status = 'new' THEN 1 ELSE 0 END) AS new_count,
        SUM(CASE WHEN t.assignee_id IS NULL AND t.status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned_count,
        SUM(CASE WHEN t.assignee_id = @viewerId AND t.status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS assigned_count,
        SUM(CASE WHEN t.status IN ('new','open','in_progress') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold_count,
        SUM(CASE WHEN t.status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_count,
        SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed_count,
        SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
       FROM tickets t ${scope}`
  ).get(params);
  return {
    all: row.all_count ?? 0,
    new: row.new_count ?? 0,
    unassigned: row.unassigned_count ?? 0,
    assignedToMe: row.assigned_count ?? 0,
    open: row.open_count ?? 0,
    inProgress: row.in_progress_count ?? 0,
    onHold: row.on_hold_count ?? 0,
    waitingUser: row.waiting_count ?? 0,
    resolved: row.resolved_count ?? 0,
    closed: row.closed_count ?? 0,
    rejected: row.rejected_count ?? 0
  };
}
function mapCreditRequest(row) {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    requesterId: row.user_id,
    requesterName: row.requester_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    ledgerId: row.ledger_id,
    createdAt: row.created_at
  };
}
function getTicketDetail(db2, viewer, reference) {
  const ticket = db2.prepare(
    `SELECT t.*, c.label AS category_label, req.username AS requester_name, req.email AS requester_email,
              req.created_at AS requester_created_at, req.status AS requester_status,
              w.balance AS requester_balance,
              ag.username AS assignee_name
       FROM tickets t
       JOIN support_categories c ON c.key = t.category
       JOIN users req ON req.id = t.user_id
       JOIN wallets w ON w.user_id = req.id
       LEFT JOIN users ag ON ag.id = t.assignee_id
       WHERE t.reference = ?`
  ).get(reference);
  if (!ticket) throw notFound("Ticket not found.");
  assertCanViewTicket(viewer, ticket.user_id);
  const staff = canViewAllTickets(viewer);
  const canSeeInternal = staff && can(viewer.role, "tickets.note");
  const messages = db2.prepare(
    `SELECT m.id, m.author_id, m.author_role, m.visibility, m.body, m.created_at, u.username AS author_name
         FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.ticket_id = ? ORDER BY m.created_at ASC, m.rowid ASC`
  ).all(ticket.id).filter((row) => canSeeInternal || row.visibility !== "internal").map((row) => ({
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_role === "system" ? "Donutcash" : row.author_name ?? "Deleted user",
    authorRole: row.author_role ?? "system",
    visibility: row.visibility,
    body: row.body,
    createdAt: row.created_at
  }));
  const events = db2.prepare(
    `SELECT e.id, e.actor_id, u.username AS actor_name, e.type, e.from_value, e.to_value, e.note, e.created_at
         FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.ticket_id = ? ORDER BY e.created_at ASC, e.rowid ASC`
  ).all(ticket.id).filter((event) => staff || ["status", "priority", "reopened", "rejected", "hold"].includes(event.type)).map((event) => ({
    id: event.id,
    actorName: event.actor_id ? event.actor_name ?? "Deleted user" : "System",
    type: event.type,
    fromValue: event.from_value,
    toValue: event.to_value,
    note: event.note,
    createdAt: event.created_at
  }));
  const creditRow = db2.prepare(
    `SELECT cr.*, req.username AS requester_name, rev.username AS reviewer_name
       FROM credit_requests cr
       JOIN users req ON req.id = cr.user_id
       LEFT JOIN users rev ON rev.id = cr.reviewer_id
       WHERE cr.ticket_id = ?`
  ).get(ticket.id);
  const allowedTransitions = can(viewer.role, "tickets.status") ? TICKET_TRANSITIONS[ticket.status].filter((next) => next !== "rejected" || can(viewer.role, "tickets.reject")) : [];
  const userCanReply = ticket.user_id === viewer.id && !["closed", "rejected"].includes(ticket.status);
  const staffCanReply = staff && can(viewer.role, "tickets.reply") && !["closed", "rejected"].includes(ticket.status);
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    categoryLabel: ticket.category_label ?? ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    requester: {
      id: ticket.user_id,
      username: ticket.requester_name ?? "Unknown",
      ...staff ? {
        email: ticket.requester_email,
        createdAt: ticket.requester_created_at,
        status: ticket.requester_status,
        balance: ticket.requester_balance
      } : {}
    },
    assignee: ticket.assignee_id ? { id: ticket.assignee_id, username: ticket.assignee_name ?? "Unknown" } : null,
    holdReason: ticket.hold_reason,
    rejectionReason: ticket.rejection_reason,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    lastActivityAt: ticket.last_activity_at,
    closedAt: ticket.closed_at,
    messages,
    events,
    creditRequest: creditRow ? mapCreditRequest(creditRow) : null,
    allowedTransitions,
    canReply: userCanReply || staffCanReply,
    canNote: staff && can(viewer.role, "tickets.note"),
    canAssign: staff && can(viewer.role, "tickets.assign")
  };
}
function addTicketEvent(db2, input) {
  db2.prepare(
    `INSERT INTO ticket_events (id, ticket_id, actor_id, type, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("tev"),
    input.ticketId,
    input.actorId,
    input.type,
    input.fromValue ?? null,
    input.toValue ?? null,
    input.note ?? null,
    nowIso()
  );
}
function addTicketMessage(db2, input) {
  const id = newId("tmsg");
  db2.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, author_id, author_role, visibility, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.ticketId, input.authorId, input.authorRole, input.visibility, input.body, input.createdAt ?? nowIso());
  return id;
}
function touchTicket(db2, ticketId, at = nowIso()) {
  db2.prepare("UPDATE tickets SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(at, at, ticketId);
}
function assertTransition(from, to, permissions) {
  if (from === to) throw badRequest(`Ticket is already ${TICKET_STATUS_LABELS[to].toLowerCase()}.`, "NO_STATUS_CHANGE");
  if (!TICKET_TRANSITIONS[from].includes(to)) {
    throw badRequest(`Cannot move a ticket from ${TICKET_STATUS_LABELS[from]} to ${TICKET_STATUS_LABELS[to]}.`, "INVALID_TRANSITION");
  }
  if (to === "rejected" && !permissions.reject) {
    throw forbidden("Your role cannot reject tickets.", "FORBIDDEN");
  }
}
function markTicketRead(db2, ticketId, userId) {
  db2.prepare(
    `INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`
  ).run(ticketId, userId, nowIso());
}

// server/lib/maintenance.ts
var DEFAULT_MAINTENANCE_MESSAGE = "We are tuning the tables. Please try again shortly.";
function isMaintenanceMode(db2) {
  return getSetting(db2, "platform.maintenance", false);
}
function maintenanceMessage(db2) {
  return getSetting(db2, "platform.maintenance_message", DEFAULT_MAINTENANCE_MESSAGE);
}
function assertNotInMaintenance(db2) {
  if (isMaintenanceMode(db2)) {
    throw new ApiError(503, "MAINTENANCE", "The platform is in maintenance mode. Please try again later.");
  }
}

// server/lib/email.ts
import nodemailer from "nodemailer";

// shared/amount.ts
var UNITS = [
  { suffix: "t", divisor: 1e12, symbol: "T" },
  { suffix: "b", divisor: 1e9, symbol: "B" },
  { suffix: "m", divisor: 1e6, symbol: "M" },
  { suffix: "k", divisor: 1e3, symbol: "K" }
];
var SUFFIXES = Object.fromEntries(UNITS.map((unit) => [unit.suffix, unit.divisor]));
function parseAmount(input, options = {}) {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.trunc(input) : null;
  }
  const cleaned = input.trim().toLowerCase().replace(/[\s,_]/g, "");
  if (!cleaned) return null;
  const match = /^([+-]?)(\d*\.?\d+)([kmbt])?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, digits, suffix] = match;
  if (sign === "-" && !options.allowNegative) return null;
  const base = Number(digits);
  if (!Number.isFinite(base)) return null;
  const value = Math.round(base * (suffix ? SUFFIXES[suffix] ?? 1 : 1));
  if (!Number.isFinite(value)) return null;
  if (sign === "-" && value !== 0) return -value;
  return value;
}
function shortNumber(value) {
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
function compactAmount(value) {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  for (let index = 0; index < UNITS.length; index += 1) {
    const unit = UNITS[index];
    if (!unit || abs < unit.divisor) continue;
    const scaled = abs / unit.divisor;
    const formatted = shortNumber(scaled);
    if (Number(formatted) >= 1e3 && index > 0) {
      const next = UNITS[index - 1];
      if (next) return `${sign}${shortNumber(abs / next.divisor)}${next.symbol}`;
    }
    return `${sign}${formatted}${unit.symbol}`;
  }
  return `${sign}${Math.trunc(abs)}`;
}

// server/lib/email.ts
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
  return value.length <= 254 && EMAIL_RE.test(value);
}
function parseFrom(raw, fallbackName) {
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match?.[2]) {
    return { name: (match[1] || fallbackName).trim(), email: match[2].trim() };
  }
  return { name: fallbackName, email: raw.trim() };
}
function getEmailConfig(db2) {
  const appName = getSetting(db2, "platform.name", config.appName);
  const tagline = getSetting(db2, "platform.tagline", "The casino for DonutSMP money.");
  const envFrom = parseFrom(config.mail.from, appName);
  const encrypted = getSetting(db2, "email.smtp_pass_enc", "");
  const databasePass = encrypted ? decryptSecret(encrypted) ?? "" : "";
  const pass = databasePass || config.mail.pass;
  return {
    enabled: getSetting(db2, "email.enabled", false),
    host: getSetting(db2, "email.host", config.mail.host) || config.mail.host,
    port: getSetting(db2, "email.port", config.mail.port) || config.mail.port,
    secure: getSetting(db2, "email.secure", config.mail.port === 465),
    user: getSetting(db2, "email.user", config.mail.user) || config.mail.user,
    pass,
    fromName: getSetting(db2, "email.from_name", envFrom.name) || envFrom.name || appName,
    fromEmail: getSetting(db2, "email.from_email", envFrom.email) || envFrom.email,
    replyTo: getSetting(db2, "email.reply_to", "") || "",
    securityNotifications: getSetting(db2, "email.security_notifications", true),
    rewardNotifications: getSetting(db2, "email.reward_notifications", true),
    passSource: databasePass ? "database" : config.mail.pass ? "environment" : "none",
    appName,
    tagline,
    appUrl: config.appUrl.replace(/\/$/, "")
  };
}
function emailReady(email) {
  return Boolean(email.host && email.user && email.pass && email.fromEmail && isValidEmail(email.fromEmail));
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function textValue(payload, key, fallback = "") {
  const value = payload[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}
function safeUrl(email, path4) {
  if (/^https?:\/\//i.test(path4)) return path4;
  return `${email.appUrl}${path4.startsWith("/") ? path4 : `/${path4}`}`;
}
function formatDateTime(value, timezone) {
  const iso = typeof value === "string" ? value : (/* @__PURE__ */ new Date()).toISOString();
  const tz = typeof timezone === "string" ? timezone : void 0;
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      ...tz ? { timeZone: tz } : {}
    });
  } catch {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }
}
function paragraph(text, tone = "muted") {
  return `<p style="margin:0 0 16px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:${tone === "ink" ? "#f6f4ef" : "#aeb5c2"};">${text}</p>`;
}
function button(email, label, path4) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 8px;">
  <tr>
    <td align="center" bgcolor="#e6c27a" style="border-radius:10px;box-shadow:0 10px 24px -14px rgba(230,194,122,0.8);">
      <a href="${escapeHtml(safeUrl(email, path4))}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#211706;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}
function detailRows(rows) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 6px;border:1px solid #28303d;border-radius:12px;border-collapse:separate;overflow:hidden;">
  ${rows.map(
    ([label, value], index) => `<tr>
    <td style="padding:11px 14px;border-${index === 0 ? "top" : "bottom"}:${index === 0 ? "none" : "1px solid #28303d"};background:#11151d;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#8f97a5;">${escapeHtml(label)}</td>
    <td align="right" style="padding:11px 14px;border-${index === 0 ? "top" : "bottom"}:${index === 0 ? "none" : "1px solid #28303d"};background:#11151d;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:#f6f4ef;">${escapeHtml(value)}</td>
  </tr>`
  ).join("")}
</table>`;
}
function callout(text, tone = "gold") {
  const colors = {
    gold: { border: "#5b4a28", bg: "#1c1810", text: "#f4d99f" },
    success: { border: "#245844", bg: "#101d18", text: "#8df0c4" },
    danger: { border: "#5c2d33", bg: "#1e1114", text: "#ffadb5" }
  }[tone];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 4px;">
  <tr><td style="padding:14px 16px;border:1px solid ${colors.border};border-radius:12px;background:${colors.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.65;color:${colors.text};">${text}</td></tr>
</table>`;
}
function preheader(text) {
  return `<div style="display:none;font-size:1px;color:#f3efe4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}</div>`;
}
function layout(email, input) {
  const preferences = safeUrl(email, "/settings#email");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(input.title)}</title>
<style>
  @media only screen and (max-width:620px){
    .email-shell{width:100%!important;}
    .email-pad{padding-left:22px!important;padding-right:22px!important;}
    .email-title{font-size:26px!important;line-height:1.15!important;}
  }
  a{text-decoration:none;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f2eee5;">
${preheader(input.preheader)}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f2eee5" style="background-color:#f2eee5;">
  <tr>
    <td align="center" style="padding:34px 12px;">
      <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;">
        <tr>
          <td class="email-pad" style="padding:26px 34px;background:#0a0c11;border:1px solid #252c39;border-bottom:none;border-radius:20px 20px 0 0;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td align="left">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                  <td width="40" height="40" align="center" valign="middle" bgcolor="#e6c27a" style="width:40px;height:40px;border-radius:12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:800;color:#211706;">D</td>
                  <td style="padding-left:12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                    <div style="font-size:15px;font-weight:800;letter-spacing:3px;color:#f6f4ef;">DONUTCASH</div>
                    <div style="font-size:9px;font-weight:600;letter-spacing:2px;color:#9b7f4d;text-transform:uppercase;padding-top:3px;">DonutSMP casino</div>
                  </td>
                </tr></table>
              </td>
              <td align="right" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#717987;">${escapeHtml(email.tagline)}</td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="height:3px;background-color:#e6c27a;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td class="email-pad" style="padding:38px 34px 34px;background:#0a0c11;border-left:1px solid #252c39;border-right:1px solid #252c39;">
            ${input.kicker ? `<p style="margin:0 0 12px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:#9b7f4d;">${escapeHtml(input.kicker)}</p>` : ""}
            <h1 class="email-title" style="margin:0 0 18px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:31px;line-height:1.15;letter-spacing:-0.8px;color:#f6f4ef;font-weight:700;">${escapeHtml(input.title)}</h1>
            ${input.content}
          </td>
        </tr>
        <tr>
          <td class="email-pad" style="padding:22px 34px 28px;background:#080a0e;border:1px solid #252c39;border-top:1px solid #1c212c;border-radius:0 0 20px 20px;">
            <p style="margin:0 0 8px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#717987;">
              ${escapeHtml(input.footerNote ?? `You are receiving this because you have a ${email.appName} account.`)}
            </p>
            <p style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#717987;">
              <a href="${escapeHtml(preferences)}" style="color:#e6c27a;text-decoration:underline;">Email preferences</a>
              &nbsp;\xB7&nbsp;
              <a href="${escapeHtml(safeUrl(email, "/"))}" style="color:#e6c27a;text-decoration:underline;">Open the lobby</a>
            </p>
            <p style="margin:10px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:10px;color:#4f5664;">
              \xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} ${escapeHtml(email.appName)} \xB7 Play responsibly with DonutSMP money only.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
function footerText(email) {
  return `

\u2014
${email.appName} \xB7 ${email.tagline}
Email preferences: ${safeUrl(email, "/settings#email")}
Open the lobby: ${safeUrl(email, "/")}`;
}
function renderEmail(template, payload, email) {
  const username = textValue(payload, "username", "there");
  const amount = Number(payload.amount ?? 0);
  const cta = (label, path4) => button(email, label, path4);
  const signoff = `<p style="margin:24px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#8f97a5;">See you at the tables,<br><strong style="color:#f6f4ef;">The ${escapeHtml(email.appName)} team</strong></p>`;
  switch (template) {
    case "welcome": {
      const verifyUrl = textValue(payload, "verifyUrl");
      const credits = Number(payload.startingCredits ?? 0);
      return {
        subject: `Welcome to ${email.appName}, ${username}`,
        html: layout(email, {
          title: `Welcome aboard, ${username}.`,
          kicker: "Your account is ready",
          preheader: `${compactAmount(credits)} DonutSMP money has been added to your wallet.`,
          content: [
            paragraph(`Your ${escapeHtml(email.appName)} account is live. We added <strong style="color:#f8e5b8;">${compactAmount(credits)} DonutSMP money</strong> to your wallet so you can try the tables right away.`),
            detailRows([
              ["Starting balance", `${compactAmount(credits)} money`],
              ["Account", username],
              ["Status", verifyUrl ? "Email verification pending" : "Active"]
            ]),
            verifyUrl ? paragraph("One quick step: confirm your email so we can help you recover your account and send important security alerts.") + cta("Verify my email", verifyUrl) : paragraph("Your email is already verified. You are all set."),
            cta("Enter the lobby", "/games"),
            callout("Every wager and payout is settled server-side and written to your ledger. Play responsibly.", "gold"),
            signoff
          ].join("")
        }),
        text: [
          `Welcome aboard, ${username}.`,
          "",
          `Your ${email.appName} account is live with ${compactAmount(credits)} DonutSMP money in your wallet.`,
          verifyUrl ? `
Verify your email: ${safeUrl(email, verifyUrl)}` : "",
          `
Enter the lobby: ${safeUrl(email, "/games")}`,
          "\nEvery wager and payout is settled server-side and written to your ledger. Play responsibly.",
          footerText(email)
        ].join("\n")
      };
    }
    case "verify-email":
      return {
        subject: `Verify your email for ${email.appName}`,
        html: layout(email, {
          title: "Confirm your email address",
          kicker: "Account security",
          preheader: "One click confirms your email and unlocks account recovery.",
          content: [
            paragraph(`Hi ${username || "there"}, please confirm the email address on your ${escapeHtml(email.appName)} account.`),
            cta("Verify my email", textValue(payload, "verifyUrl", "/settings")),
            callout(`This link expires ${escapeHtml(formatDateTime(payload.expiresAt))}. If you did not request it, you can safely ignore this email.`, "gold"),
            signoff
          ].join("")
        }),
        text: [
          `Confirm your email address for ${email.appName}.`,
          `${safeUrl(email, textValue(payload, "verifyUrl", "/settings"))}`,
          `This link expires ${formatDateTime(payload.expiresAt)}.`,
          footerText(email)
        ].join("\n")
      };
    case "password-reset":
      return {
        subject: `Reset your ${email.appName} password`,
        html: layout(email, {
          title: "Reset your password",
          kicker: "Password reset requested",
          preheader: "This secure link expires in one hour.",
          content: [
            paragraph(`We received a request to reset the password for <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong>.`),
            cta("Choose a new password", textValue(payload, "resetUrl", "/forgot-password")),
            callout("This link expires in one hour and can only be used once. If you did not request a reset, ignore this email \u2014 your password has not changed.", "gold"),
            paragraph("For your safety, all active sessions are revoked after a password reset.", "muted")
          ].join("")
        }),
        text: [
          `Reset your ${email.appName} password:`,
          safeUrl(email, textValue(payload, "resetUrl", "/forgot-password")),
          "This link expires in one hour. If you did not request it, ignore this email.",
          footerText(email)
        ].join("\n")
      };
    case "password-changed":
      return {
        subject: `Your ${email.appName} password was changed`,
        html: layout(email, {
          title: "Your password was changed",
          kicker: "Security alert",
          preheader: "If this was not you, secure your account immediately.",
          content: [
            paragraph(`The password for <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong> was changed on ${escapeHtml(formatDateTime(payload.changedAt))}.`),
            detailRows([
              ["Account", username],
              ["When", formatDateTime(payload.changedAt)],
              ["Sessions", "Other sessions were signed out"]
            ]),
            callout("If you did not make this change, reset your password immediately and contact support.", "danger"),
            cta("Review account security", "/settings")
          ].join("")
        }),
        text: [
          `Your ${email.appName} password was changed on ${formatDateTime(payload.changedAt)}.`,
          "If this was not you, reset your password immediately and contact support.",
          safeUrl(email, "/settings"),
          footerText(email)
        ].join("\n")
      };
    case "new-login":
      return {
        subject: `New sign-in to your ${email.appName} account`,
        html: layout(email, {
          title: "New sign-in detected",
          kicker: "Security alert",
          preheader: "Review the device and location below.",
          content: [
            paragraph(`Your account <strong style="color:#f6f4ef;">${escapeHtml(username)}</strong> was just signed in to.`),
            detailRows([
              ["When", formatDateTime(payload.at)],
              ["IP address", textValue(payload, "ip", "Unknown")],
              ["Device", textValue(payload, "device", "Unknown device").slice(0, 160)]
            ]),
            paragraph("If this was you, no action is needed. If not, change your password and review your active sessions now."),
            cta("Review active sessions", "/settings")
          ].join("")
        }),
        text: [
          `New sign-in to ${email.appName} for ${username}.`,
          `When: ${formatDateTime(payload.at)}`,
          `IP: ${textValue(payload, "ip", "Unknown")}`,
          `Device: ${textValue(payload, "device", "Unknown device")}`,
          "If this was not you, change your password and review active sessions.",
          safeUrl(email, "/settings"),
          footerText(email)
        ].join("\n")
      };
    case "email-changed":
      return {
        subject: `Your ${email.appName} email address was changed`,
        html: layout(email, {
          title: "Your email address was changed",
          kicker: "Security alert",
          preheader: "This notice was sent to the previous address on your account.",
          content: [
            paragraph(`The email address on your ${escapeHtml(email.appName)} account was changed to <strong style="color:#f8e5b8;">${escapeHtml(textValue(payload, "newEmail", "a new address"))}</strong>.`),
            paragraph("We sent this notice to the previous address so you are always aware of account changes."),
            callout("If you did not make this change, contact support immediately so we can secure your account.", "danger"),
            cta("Contact support", "/tickets/new")
          ].join("")
        }),
        text: [
          `The email on your ${email.appName} account was changed to ${textValue(payload, "newEmail", "a new address")}.`,
          "If this was not you, contact support immediately.",
          safeUrl(email, "/tickets/new"),
          footerText(email)
        ].join("\n")
      };
    case "reward-claimed": {
      const milestone = textValue(payload, "milestoneLabel");
      return {
        subject: `Day ${Number(payload.streakDay ?? 1)} reward claimed`,
        html: layout(email, {
          title: "Daily reward claimed",
          kicker: "Rewards",
          preheader: `${compactAmount(amount)} money added to your wallet.`,
          content: [
            paragraph(`Nice one, ${escapeHtml(username)}. Your day ${Number(payload.streakDay ?? 1)} reward is in your wallet.`),
            detailRows([
              ["Reward", `${compactAmount(amount)} money`],
              ["Streak day", String(Number(payload.streakDay ?? 1))],
              ...milestone ? [["Milestone", milestone]] : [],
              ["Next reset", formatDateTime(payload.nextResetAt, payload.timezone)]
            ]),
            cta("Keep the streak alive", "/rewards"),
            callout("Claim again after the next reset to keep your streak growing. Missing a day may reset it depending on the current reward policy.", "success"),
            signoff
          ].join("")
        }),
        text: [
          `Daily reward claimed: ${compactAmount(amount)} money for day ${Number(payload.streakDay ?? 1)}.`,
          milestone ? `Milestone: ${milestone}` : "",
          `Next reset: ${formatDateTime(payload.nextResetAt, payload.timezone)}`,
          safeUrl(email, "/rewards"),
          footerText(email)
        ].join("\n")
      };
    }
    case "announcement":
      return {
        subject: textValue(payload, "title", `News from ${email.appName}`),
        html: layout(email, {
          title: textValue(payload, "title", `News from ${email.appName}`),
          kicker: "Announcement",
          preheader: textValue(payload, "body").slice(0, 120),
          content: [
            paragraph(escapeHtml(textValue(payload, "body")).replace(/\n/g, "<br>")),
            cta("Read in your notifications", "/notifications")
          ].join("")
        }),
        text: [
          textValue(payload, "title", `News from ${email.appName}`),
          "",
          textValue(payload, "body"),
          "",
          safeUrl(email, "/notifications"),
          footerText(email)
        ].join("\n")
      };
    case "cashier-decision": {
      const approved = textValue(payload, "status") === "approved";
      return {
        subject: `${textValue(payload, "kind", "Cashier")} request ${textValue(payload, "status", "updated")}`,
        html: layout(email, {
          title: approved ? "Your request was approved" : "Your request needs attention",
          kicker: "Cashier update",
          preheader: `${textValue(payload, "reference")} \xB7 ${compactAmount(amount)} money`,
          content: [
            paragraph(`Hi ${escapeHtml(username)}, your ${escapeHtml(textValue(payload, "kind", "cashier"))} request has been ${escapeHtml(textValue(payload, "status", "updated"))}.`),
            detailRows([
              ["Reference", textValue(payload, "reference", "\u2014")],
              ["Amount", `${compactAmount(amount)} money`],
              ["Status", textValue(payload, "status", "\u2014")],
              ...textValue(payload, "reason") ? [["Note", textValue(payload, "reason")]] : []
            ]),
            cta("Open the cashier", `/cashier/${encodeURIComponent(textValue(payload, "reference", ""))}`)
          ].join("")
        }),
        text: [
          `Your ${textValue(payload, "kind", "cashier")} request ${textValue(payload, "reference")} was ${textValue(payload, "status")}.`,
          `Amount: ${compactAmount(amount)} money`,
          textValue(payload, "reason") ? `Note: ${textValue(payload, "reason")}` : "",
          safeUrl(email, `/cashier/${encodeURIComponent(textValue(payload, "reference", ""))}`),
          footerText(email)
        ].join("\n")
      };
    }
    case "test":
    default:
      return {
        subject: `Test email from ${email.appName}`,
        html: layout(email, {
          title: "SMTP is working",
          kicker: "Email settings",
          preheader: "This is a test message from your admin panel.",
          content: [
            paragraph("This test message confirms that your SMTP server, credentials, sender name and sender address are configured correctly."),
            detailRows([
              ["SMTP host", `${email.host}:${email.port}`],
              ["Sender", `${email.fromName} <${email.fromEmail}>`],
              ["Sent", formatDateTime((/* @__PURE__ */ new Date()).toISOString())]
            ]),
            callout("If this message landed in spam, add the sender to your allowlist and verify the domain in Brevo.", "gold")
          ].join("")
        }),
        text: [
          `SMTP is working for ${email.appName}.`,
          `Server: ${email.host}:${email.port}`,
          `Sender: ${email.fromName} <${email.fromEmail}>`,
          footerText(email)
        ].join("\n")
      };
  }
}
function enqueueEmail(db2, input) {
  const email = getEmailConfig(db2);
  if (!email.enabled || !emailReady(email)) return null;
  if (!isValidEmail(input.recipient)) return null;
  if (input.respectPreference && input.userId) {
    const row = db2.prepare("SELECT email_notifications FROM users WHERE id = ?").get(input.userId);
    if (!row || !row.email_notifications) return null;
  }
  const now = nowIso();
  const id = newId("eml");
  const result = db2.prepare(
    `INSERT OR IGNORE INTO email_jobs
         (id, user_id, recipient, template, payload, status, attempts, max_attempts, next_attempt_at, created_at, updated_at, dedupe_key)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, 3, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId ?? null,
    input.recipient.toLowerCase(),
    input.template,
    JSON.stringify(input.payload),
    now,
    now,
    now,
    input.dedupeKey ?? null
  );
  return result.changes === 1 ? id : null;
}
function createTransport(email) {
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    requireTLS: !email.secure,
    auth: { user: email.user, pass: email.pass },
    tls: { minVersion: "TLSv1.2" },
    connectionTimeout: 12e3,
    greetingTimeout: 12e3,
    socketTimeout: 2e4,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}
async function sendRendered(email, recipient, rendered) {
  if (!emailReady(email)) {
    throw new Error("Email delivery is not fully configured.");
  }
  const transporter = createTransport(email);
  const info = await transporter.sendMail({
    from: { name: email.fromName, address: email.fromEmail },
    to: recipient,
    replyTo: email.replyTo || void 0,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      "X-Entity-Ref-ID": `donutcash-${Date.now()}`,
      "List-Unsubscribe": `<${safeUrl(email, "/settings#email")}>`
    }
  });
  return info.messageId;
}
function safeError(error, email) {
  let message = error instanceof Error ? error.message : String(error);
  if (email.pass) message = message.replaceAll(email.pass, "[redacted]");
  message = message.replace(/pass(word)?[=:]\s*\S+/gi, "password=[redacted]");
  return message.slice(0, 500);
}
var processing = false;
async function processEmailQueue(db2, limit = 10) {
  const result = { considered: 0, sent: 0, failed: 0, skipped: 0 };
  if (processing) return result;
  const email = getEmailConfig(db2);
  if (!email.enabled || !emailReady(email)) return result;
  processing = true;
  try {
    const due = db2.prepare(
      `SELECT * FROM email_jobs
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT ?`
    ).all(nowIso(), limit);
    result.considered = due.length;
    for (const job of due) {
      const claimed = db2.prepare(
        `UPDATE email_jobs SET status = 'sending', attempts = attempts + 1, updated_at = ?
           WHERE id = ? AND status = 'pending'`
      ).run(nowIso(), job.id);
      if (claimed.changes !== 1) {
        result.skipped += 1;
        continue;
      }
      const fresh = db2.prepare("SELECT * FROM email_jobs WHERE id = ?").get(job.id);
      try {
        const payload = parseJson(fresh.payload, {});
        const rendered = renderEmail(fresh.template, payload, email);
        await sendRendered(email, fresh.recipient, rendered);
        db2.prepare(
          `UPDATE email_jobs SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?`
        ).run(nowIso(), nowIso(), fresh.id);
        result.sent += 1;
      } catch (error) {
        const message = safeError(error, email);
        const failed = fresh.attempts >= fresh.max_attempts;
        const delayMinutes = Math.min(60, 2 ** Math.max(0, fresh.attempts - 1));
        const next = new Date(Date.now() + delayMinutes * 6e4).toISOString();
        db2.prepare(
          `UPDATE email_jobs SET status = ?, next_attempt_at = ?, updated_at = ?, last_error = ? WHERE id = ?`
        ).run(failed ? "failed" : "pending", next, nowIso(), message, fresh.id);
        result.failed += 1;
        console.warn(
          `[email] ${failed ? "failed permanently" : "delivery retry scheduled"} for job ${fresh.id} (${fresh.template})`
        );
      }
    }
  } finally {
    processing = false;
  }
  return result;
}
async function sendTestEmail(db2, recipient) {
  const email = getEmailConfig(db2);
  if (!emailReady(email)) throw new Error("Complete the SMTP server, login, key and sender address first.");
  const rendered = renderEmail("test", {}, email);
  const messageId = await sendRendered(email, recipient, rendered);
  setSetting(db2, "email.last_test_at", nowIso(), null);
  setSetting(db2, "email.last_error", null, null);
  return { messageId };
}
function emailSettingsView(db2) {
  const email = getEmailConfig(db2);
  const counts = db2.prepare(
    `SELECT
         SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_jobs`
  ).get();
  const queue = db2.prepare("SELECT * FROM email_jobs ORDER BY created_at DESC LIMIT 15").all();
  return {
    enabled: email.enabled,
    host: email.host,
    port: email.port,
    secure: email.secure,
    user: email.user,
    fromName: email.fromName,
    fromEmail: email.fromEmail,
    replyTo: email.replyTo,
    securityNotifications: email.securityNotifications,
    rewardNotifications: email.rewardNotifications,
    smtpPassSet: Boolean(email.pass),
    smtpPassSource: email.passSource,
    lastTestAt: getSetting(db2, "email.last_test_at", null),
    lastError: getSetting(db2, "email.last_error", null),
    queue: queue.map(
      (job) => ({
        id: job.id,
        recipient: job.recipient,
        template: job.template,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        lastError: job.last_error,
        createdAt: job.created_at,
        sentAt: job.sent_at
      })
    ),
    counts: {
      pending: counts.pending ?? 0,
      sent: counts.sent ?? 0,
      failed: counts.failed ?? 0
    }
  };
}
function retryEmailJob(db2, id) {
  const result = db2.prepare(
    `UPDATE email_jobs SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ? AND status = 'failed'`
  ).run(nowIso(), nowIso(), id);
  return result.changes === 1;
}

// server/routes/public.ts
function createPublicRouter(db2) {
  const router = Router();
  router.get("/config", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const payload = {
      name: getSetting(db2, "platform.name", config.appName),
      tagline: getSetting(db2, "platform.tagline", "The casino for DonutSMP money."),
      registrationOpen: getSetting(db2, "platform.registration_open", true),
      maintenance: isMaintenanceMode(db2),
      maintenanceMessage: maintenanceMessage(db2),
      startingCredits: getSetting(db2, "economy.starting_credits", config.startingCredits),
      rewardsEnabled: getSetting(db2, "rewards.enabled", true),
      emailEnabled: (() => {
        const email = getEmailConfig(db2);
        return email.enabled && emailReady(email);
      })(),
      supportCategories: loadSupportCategories(db2, true)
    };
    res.json(payload);
  });
  router.get("/health", (_req, res) => {
    const row = db2.prepare("SELECT 1 AS ok").get();
    res.json({ ok: row.ok === 1, time: (/* @__PURE__ */ new Date()).toISOString() });
  });
  return router;
}

// server/routes/auth.ts
import { Router as Router2 } from "express";
import { z as z2 } from "zod";

// server/lib/validation.ts
import { z } from "zod";
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new ApiError(400, "VALIDATION_ERROR", "Please check the highlighted fields.", { fields });
}
var usernameSchema = z.string().trim().min(3, "Username must be at least 3 characters.").max(20, "Username must be at most 20 characters.").regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only.");
var emailSchema = z.string().trim().toLowerCase().min(3, "Enter a valid email address.").max(254, "Email is too long.").email("Enter a valid email address.");
var passwordSchema = z.string().min(10, "Use at least 10 characters.").max(200, "Use at most 200 characters.").superRefine((value, ctx) => {
  for (const issue of passwordIssues(value)) {
    ctx.addIssue({ code: "custom", message: issue });
  }
});
var ticketCategorySchema = z.string().trim().min(1).max(50);
var ticketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
var ticketStatusSchema = z.enum([
  "new",
  "open",
  "in_progress",
  "on_hold",
  "waiting_user",
  "resolved",
  "closed",
  "rejected"
]);
var pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20)
});

// server/lib/wallet.ts
function balanceOf(db2, userId) {
  const row = db2.prepare("SELECT balance FROM wallets WHERE user_id = ?").get(userId);
  return row?.balance ?? 0;
}
function mapLedgerRow(row, username, actorName) {
  return {
    id: row.id,
    userId: row.user_id,
    username: username ?? void 0,
    type: row.type,
    amount: row.amount,
    balanceBefore: row.balance_before,
    balanceAfter: row.balance_after,
    refType: row.ref_type,
    refId: row.ref_id,
    actorId: row.actor_id,
    actorName: actorName ?? null,
    reason: row.reason,
    metadata: parseJson(row.metadata, null),
    createdAt: row.created_at
  };
}
function applyLedger(db2, input) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest("Amount must be a non-zero whole number.", "INVALID_AMOUNT");
  }
  if (input.idempotencyKey) {
    const existing = db2.prepare("SELECT * FROM ledger WHERE idempotency_key = ?").get(input.idempotencyKey);
    if (existing) {
      if (existing.user_id !== input.userId) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This operation key belongs to another account.");
      }
      return existing;
    }
  }
  const wallet = db2.prepare("SELECT balance FROM wallets WHERE user_id = ?").get(input.userId);
  if (!wallet) throw badRequest("Wallet not found for this account.", "WALLET_MISSING");
  const before = wallet.balance;
  const after = before + input.amount;
  if (after < 0) {
    throw new ApiError(400, "INSUFFICIENT_CREDITS", "Not enough DonutSMP money for this operation.", {
      balance: before,
      required: Math.abs(input.amount)
    });
  }
  const update = db2.prepare("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND balance + ? >= 0").run(input.amount, nowIso(), input.userId, input.amount);
  if (update.changes !== 1) {
    throw new ApiError(409, "BALANCE_CONFLICT", "The balance changed concurrently. Please retry.");
  }
  const id = ledgerId();
  db2.prepare(
    `INSERT INTO ledger (id, user_id, type, amount, balance_before, balance_after, ref_type, ref_id, actor_id, reason, metadata, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.type,
    input.amount,
    before,
    after,
    input.refType ?? null,
    input.refId ?? null,
    input.actorId ?? null,
    input.reason ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.idempotencyKey ?? null,
    nowIso()
  );
  return db2.prepare("SELECT * FROM ledger WHERE id = ?").get(id);
}
function createWallet(db2, userId, startingCredits, actorId) {
  return inTransaction(db2, () => {
    db2.prepare("INSERT INTO wallets (user_id, balance, updated_at) VALUES (?, 0, ?)").run(userId, nowIso());
    if (startingCredits < 0) {
      throw badRequest("Starting money grant cannot be negative.", "INVALID_STARTING_CREDITS");
    }
    if (startingCredits === 0) return null;
    return applyLedger(db2, {
      userId,
      amount: startingCredits,
      type: "initial_grant",
      actorId,
      reason: "Welcome grant",
      refType: "account",
      refId: userId,
      idempotencyKey: `welcome:${userId}`,
      metadata: { source: "registration" }
    });
  });
}
function reconcileWallets(db2) {
  const rows = db2.prepare(
    `SELECT w.user_id AS userId, u.username AS username, w.balance AS walletBalance,
              COALESCE(SUM(l.amount), 0) AS ledgerTotal
       FROM wallets w
       JOIN users u ON u.id = w.user_id
       LEFT JOIN ledger l ON l.user_id = w.user_id
       GROUP BY w.user_id, u.username, w.balance
       HAVING w.balance <> COALESCE(SUM(l.amount), 0)`
  ).all();
  return rows.map((row) => ({ ...row, difference: row.walletBalance - row.ledgerTotal }));
}

// server/lib/audit.ts
function recordAudit(db2, input) {
  db2.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, target_label, reason, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("aud"),
    input.actorId ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.targetLabel ?? null,
    input.reason ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.ip ?? null,
    nowIso()
  );
}
function listAuditRows(db2, filters) {
  const where = [];
  const params = [];
  if (filters.actorId) {
    where.push("a.actor_id = ?");
    params.push(filters.actorId);
  }
  if (filters.action) {
    where.push("a.action = ?");
    params.push(filters.action);
  }
  if (filters.search) {
    where.push("(a.action LIKE ? OR a.target_label LIKE ? OR u.username LIKE ?)");
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }
  if (filters.from) {
    where.push("a.created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("a.created_at <= ?");
    params.push(filters.to);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const base = `FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${clause}`;
  const total = db2.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count;
  const rows = db2.prepare(
    `SELECT a.id, a.actor_id, u.username AS actor_name, a.action, a.target_type, a.target_id,
              a.target_label, a.reason, a.metadata, a.ip, a.created_at
       ${base} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, filters.limit, filters.offset);
  return { rows, total };
}

// server/lib/notifications.ts
function notify(db2, input) {
  const id = newId("ntf");
  db2.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, input.type, input.title, input.body, input.link ?? null, input.actorId ?? null, nowIso());
  return id;
}
function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at
  };
}
function unreadNotificationCount(db2, userId) {
  return db2.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId).count;
}

// server/lib/email-verification.ts
var VERIFY_TTL_MS = 24 * 60 * 60 * 1e3;
function createEmailVerification(db2, userId, address) {
  const token = randomToken(32);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + VERIFY_TTL_MS).toISOString();
  db2.prepare(
    `UPDATE email_verifications SET used_at = ?
     WHERE user_id = ? AND used_at IS NULL`
  ).run(now.toISOString(), userId);
  db2.prepare(
    `INSERT INTO email_verifications (id, user_id, email, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId("evf"), userId, address, tokenHash(token), now.toISOString(), expiresAt);
  return {
    token,
    path: `/verify-email?token=${encodeURIComponent(token)}`,
    expiresAt
  };
}
function verifyEmailToken(db2, token) {
  const row = db2.prepare("SELECT * FROM email_verifications WHERE token_hash = ?").get(tokenHash(token));
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest("This verification link is invalid or has expired. Request a new one.", "INVALID_VERIFICATION_TOKEN");
  }
  const user = db2.prepare("SELECT id, email FROM users WHERE id = ?").get(row.user_id);
  if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) {
    throw new ApiError(409, "EMAIL_CHANGED", "The email on this account changed after this link was issued. Request a new link.");
  }
  const now = nowIso();
  db2.transaction(() => {
    db2.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").run(now, user.id);
    db2.prepare("UPDATE email_verifications SET used_at = ? WHERE id = ?").run(now, row.id);
  })();
  return { userId: user.id, email: user.email };
}

// server/routes/auth.ts
var requiredConsent = (message) => z2.boolean().refine((value) => value === true, { message });
var registerSchema = z2.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  ageConfirmed: requiredConsent("You must confirm that you are 18 years or older."),
  acceptTerms: requiredConsent("You must agree to the Terms of Service and Privacy Policy."),
  acknowledgeDonutRules: requiredConsent("You must acknowledge the DonutSMP risk.")
});
var loginSchema = z2.object({
  identifier: z2.string().trim().min(1, "Enter your username or email.").max(254),
  password: z2.string().min(1, "Enter your password.").max(200)
});
var forgotSchema = z2.object({ email: emailSchema });
var resetSchema = z2.object({
  token: z2.string().min(10, "Reset link is invalid."),
  password: passwordSchema
});
var changePasswordSchema = z2.object({
  currentPassword: z2.string().min(1, "Enter your current password."),
  newPassword: passwordSchema
});
var verifyEmailSchema = z2.object({ token: z2.string().min(10, "Verification link is invalid.").max(200) });
function limiterGuard(result) {
  if (!result.allowed) {
    throw new ApiError(429, "RATE_LIMITED", `Too many attempts. Try again in ${result.retryAfterSeconds} seconds.`);
  }
}
function createAuthRouter(db2) {
  const router = Router2();
  router.post("/register", async (req, res) => {
    const body = parse(registerSchema, req.body);
    const registerAddress = clientAddress(req);
    if (registerAddress) limiterGuard(registerLimiter.consume(`register:ip:${registerAddress}`));
    else limiterGuard(registerGlobalLimiter.consume("register:global"));
    if (!getSetting(db2, "platform.registration_open", true)) {
      throw new ApiError(403, "REGISTRATION_CLOSED", "Registration is currently closed.");
    }
    assertNotInMaintenance(db2);
    const existing = db2.prepare("SELECT id, username, email FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE").get(body.username, body.email);
    if (existing) {
      const fields = {};
      if (existing.username.toLowerCase() === body.username.toLowerCase()) fields.username = "That username is already taken.";
      if (existing.email.toLowerCase() === body.email.toLowerCase()) fields.email = "An account with this email already exists.";
      throw new ApiError(409, "ACCOUNT_EXISTS", "Choose a different username or email.", { fields });
    }
    const userId = newId("usr");
    const now = nowIso();
    const startingCredits = getSetting(db2, "economy.starting_credits", config.startingCredits);
    try {
      db2.transaction(() => {
        db2.prepare(
          `INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'user', 'active', ?, ?)`
        ).run(userId, body.username, body.email, hashPassword(body.password), now, now);
        createWallet(db2, userId, startingCredits, userId);
        recordLegalAcceptance(db2, {
          userId,
          ip: clientIp(req),
          userAgent: req.get("user-agent") ?? null,
          acceptedAt: now
        });
      })();
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw conflict("That username or email is already in use.", "ACCOUNT_EXISTS");
      }
      throw error;
    }
    notify(db2, {
      userId,
      type: "account",
      title: "Welcome to Donutcash",
      body: `${compactAmount(startingCredits)} DonutSMP money was added to your wallet. Good luck at the tables.`,
      link: "/wallet"
    });
    const verification = createEmailVerification(db2, userId, body.email);
    enqueueEmail(db2, {
      userId,
      recipient: body.email,
      template: "welcome",
      payload: {
        username: body.username,
        startingCredits,
        verifyUrl: verification.path
      },
      dedupeKey: `welcome:${userId}`
    });
    recordAudit(db2, {
      actorId: userId,
      action: "auth.register",
      targetType: "user",
      targetId: userId,
      targetLabel: body.username,
      ip: clientIp(req),
      metadata: {
        startingCredits,
        legalTermsVersion: LEGAL_TERMS_VERSION,
        legalPrivacyVersion: LEGAL_PRIVACY_VERSION
      }
    });
    const { token } = createSession(db2, userId, req);
    setSessionCookie(res, token, req);
    res.status(201).json({ user: loadUser(db2, userId), startingCredits });
  });
  router.post("/login", async (req, res) => {
    const body = parse(loginSchema, req.body);
    const ipKey = `login:${body.identifier.toLowerCase()}`;
    limiterGuard(loginLimiter.consume(ipKey));
    const loginAddress = clientAddress(req);
    if (loginAddress) limiterGuard(loginIpLimiter.consume(`login-ip:${loginAddress}`));
    const row = db2.prepare(
      `SELECT id, username, email, role, status, password_hash, self_excluded_until FROM users
         WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE`
    ).get(body.identifier, body.identifier);
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      recordAudit(db2, {
        action: "auth.login_failed",
        targetType: "user",
        targetLabel: body.identifier,
        ip: clientIp(req)
      });
      throw new ApiError(401, "INVALID_CREDENTIALS", "Incorrect username, email, or password.");
    }
    if (isSelfExclusionActive(row.self_excluded_until)) {
      recordAudit(db2, {
        actorId: row.id,
        action: "auth.login_blocked",
        targetType: "user",
        targetId: row.id,
        targetLabel: row.username,
        reason: "Self-exclusion active",
        ip: clientIp(req)
      });
      const permanent = (row.self_excluded_until ?? "").startsWith("9999");
      throw new ApiError(
        403,
        "SELF_EXCLUDED",
        permanent ? "This account is permanently self-excluded and cannot sign in." : `This account is self-excluded until ${row.self_excluded_until?.slice(0, 10)} and cannot sign in.`,
        { selfExcludedUntil: row.self_excluded_until }
      );
    }
    if (row.status === "suspended") {
      recordAudit(db2, {
        actorId: row.id,
        action: "auth.login_blocked",
        targetType: "user",
        targetId: row.id,
        targetLabel: row.username,
        reason: "Account suspended",
        ip: clientIp(req)
      });
      throw new ApiError(403, "ACCOUNT_SUSPENDED", "This account is suspended. Contact support for help.");
    }
    loginLimiter.reset(ipKey);
    const previousSession = db2.prepare("SELECT ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(row.id);
    const now = nowIso();
    db2.prepare("UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?").run(now, now, row.id);
    const { token } = createSession(db2, row.id, req);
    setSessionCookie(res, token, req);
    const email = getEmailConfig(db2);
    const newDevice = previousSession && (previousSession.ip !== clientIp(req) || previousSession.user_agent !== (req.get("user-agent") ?? null));
    if (newDevice && email.securityNotifications) {
      enqueueEmail(db2, {
        userId: row.id,
        recipient: row.email,
        template: "new-login",
        payload: {
          username: row.username,
          at: now,
          ip: clientIp(req) ?? "Unknown",
          device: (req.get("user-agent") ?? "Unknown device").slice(0, 160)
        },
        dedupeKey: `new-login:${row.id}:${now.slice(0, 13)}`
      });
    }
    recordAudit(db2, {
      actorId: row.id,
      action: "auth.login",
      targetType: "user",
      targetId: row.id,
      targetLabel: row.username,
      ip: clientIp(req)
    });
    res.json({ user: loadUser(db2, row.id) });
  });
  router.post("/logout", (req, res) => {
    if (req.user && req.sessionId) {
      revokeSession(db2, req.sessionId);
      recordAudit(db2, {
        actorId: req.user.id,
        action: "auth.logout",
        targetType: "session",
        targetId: req.sessionId,
        ip: clientIp(req)
      });
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });
  router.get("/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });
  router.post("/forgot-password", async (req, res) => {
    const body = parse(forgotSchema, req.body);
    const forgotAddress = clientAddress(req);
    if (forgotAddress) limiterGuard(resetLimiter.consume(`forgot:ip:${forgotAddress}`));
    limiterGuard(resetLimiter.consume(`forgot-email:${body.email}`));
    const user = db2.prepare("SELECT id, username, email, status FROM users WHERE email = ? COLLATE NOCASE").get(body.email);
    let resetPath;
    if (user && user.status !== "suspended") {
      const { token, hash } = resetToken();
      const now = nowIso();
      const expiresAt = new Date(Date.now() + 60 * 6e4).toISOString();
      db2.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
      ).run(newId("prs"), user.id, hash, now, expiresAt);
      recordAudit(db2, {
        actorId: user.id,
        action: "auth.password_reset_requested",
        targetType: "user",
        targetId: user.id,
        targetLabel: user.username,
        ip: clientIp(req)
      });
      const path4 = `/reset-password?token=${encodeURIComponent(token)}`;
      const queued = enqueueEmail(db2, {
        userId: user.id,
        recipient: user.email,
        template: "password-reset",
        payload: { username: user.username, resetUrl: path4 },
        dedupeKey: `password-reset:${user.id}:${now}`
      });
      if (!queued && (!config.isProduction || config.exposeResetToken)) {
        console.info(`[auth] Password reset link for ${user.email}: ${config.appUrl}${path4}`);
      }
      if (config.exposeResetToken) resetPath = path4;
    }
    res.json({
      message: "If an account matches that email, a password reset link has been issued. It expires in one hour.",
      ...resetPath ? { resetPath, devNote: "EXPOSE_RESET_TOKEN is enabled. Disable it outside local development." } : {}
    });
  });
  router.post("/reset-password", async (req, res) => {
    const body = parse(resetSchema, req.body);
    const resetAddress = clientAddress(req);
    if (resetAddress) limiterGuard(resetLimiter.consume(`reset:ip:${resetAddress}`));
    const row = db2.prepare(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.username, u.email
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = ?`
    ).get(tokenHash(body.token));
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw badRequest("This reset link is invalid or has expired. Request a new one.", "INVALID_RESET_TOKEN");
    }
    const now = nowIso();
    db2.transaction(() => {
      db2.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
        hashPassword(body.password),
        now,
        row.user_id
      );
      db2.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(now, row.id);
      db2.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(now, row.user_id);
    })();
    revokeAllSessions(db2, row.user_id);
    recordAudit(db2, {
      actorId: row.user_id,
      action: "auth.password_reset",
      targetType: "user",
      targetId: row.user_id,
      ip: clientIp(req)
    });
    if (getEmailConfig(db2).securityNotifications) {
      enqueueEmail(db2, {
        userId: row.user_id,
        recipient: row.email,
        template: "password-changed",
        payload: { username: row.username, changedAt: nowIso() },
        dedupeKey: `password-changed:${row.user_id}:${row.id}`
      });
    }
    res.json({ ok: true, message: "Password updated. Sign in with your new password." });
  });
  router.post("/change-password", async (req, res) => {
    const user = requireAuth(req);
    const body = parse(changePasswordSchema, req.body);
    const row = db2.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id);
    if (!verifyPassword(body.currentPassword, row.password_hash)) {
      throw new ApiError(400, "INVALID_PASSWORD", "Your current password is incorrect.", {
        fields: { currentPassword: "Incorrect password." }
      });
    }
    db2.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
      hashPassword(body.newPassword),
      nowIso(),
      user.id
    );
    if (req.sessionId) revokeOtherSessions(db2, user.id, req.sessionId);
    recordAudit(db2, {
      actorId: user.id,
      action: "auth.password_changed",
      targetType: "user",
      targetId: user.id,
      targetLabel: user.username,
      ip: clientIp(req)
    });
    notify(db2, {
      userId: user.id,
      type: "security",
      title: "Password changed",
      body: "Your password was changed. If this was not you, contact support immediately.",
      link: "/settings"
    });
    if (getEmailConfig(db2).securityNotifications) {
      enqueueEmail(db2, {
        userId: user.id,
        recipient: user.email,
        template: "password-changed",
        payload: { username: user.username, changedAt: nowIso() },
        dedupeKey: `password-changed:${user.id}:${nowIso()}`
      });
    }
    res.json({ ok: true });
  });
  router.post("/verify-email", (req, res) => {
    const body = parse(verifyEmailSchema, req.body);
    const verified = verifyEmailToken(db2, body.token);
    recordAudit(db2, {
      actorId: verified.userId,
      action: "auth.email_verified",
      targetType: "user",
      targetId: verified.userId,
      ip: clientIp(req)
    });
    res.json({ ok: true, message: "Email verified. Your account is now fully secured." });
  });
  router.post("/resend-verification", (req, res) => {
    const user = requireAuth(req);
    if (user.emailVerified) {
      return res.json({ ok: true, alreadyVerified: true, message: "Your email is already verified." });
    }
    limiterGuard(resetLimiter.consume(`verify:${user.id}`));
    const verification = createEmailVerification(db2, user.id, user.email);
    const queued = enqueueEmail(db2, {
      userId: user.id,
      recipient: user.email,
      template: "verify-email",
      payload: {
        username: user.username,
        verifyUrl: verification.path,
        expiresAt: verification.expiresAt
      },
      dedupeKey: `verify-email:${user.id}:${Date.now()}`
    });
    recordAudit(db2, {
      actorId: user.id,
      action: "auth.verification_requested",
      targetType: "user",
      targetId: user.id,
      ip: clientIp(req)
    });
    res.json({
      ok: true,
      sent: Boolean(queued),
      message: queued ? "A new verification email is on its way." : "Email delivery is not configured yet. Ask an administrator to enable it.",
      ...config.exposeResetToken ? { verifyPath: verification.path } : {}
    });
  });
  return router;
}

// server/routes/legal.ts
import { Router as Router3 } from "express";
import { z as z3 } from "zod";
var requiredConsent2 = (message) => z3.boolean().refine((value) => value === true, { message });
var acceptSchema = z3.object({
  ageConfirmed: requiredConsent2("You must confirm that you are 18 years or older."),
  acceptTerms: requiredConsent2("You must agree to the Terms of Service and Privacy Policy."),
  acknowledgeDonutRules: requiredConsent2("You must acknowledge the DonutSMP risk.")
});
function statusFor(db2, userId) {
  const accepted = latestLegalAcceptance(db2, userId);
  return {
    current: {
      termsVersion: LEGAL_TERMS_VERSION,
      privacyVersion: LEGAL_PRIVACY_VERSION,
      effectiveDate: LEGAL_EFFECTIVE_DATE
    },
    accepted: accepted ? {
      id: accepted.id,
      termsVersion: accepted.terms_version,
      privacyVersion: accepted.privacy_version,
      acceptedAt: accepted.accepted_at,
      ip: accepted.ip
    } : null,
    required: !isCurrentLegalAcceptance(accepted)
  };
}
function createLegalRouter(db2) {
  const router = Router3();
  router.get("/status", (req, res) => {
    const user = requireAuth(req);
    res.set("Cache-Control", "no-store");
    res.json(statusFor(db2, user.id));
  });
  router.post("/accept", (req, res) => {
    const user = requireAuth(req);
    parse(acceptSchema, req.body);
    recordLegalAcceptance(db2, {
      userId: user.id,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null
    });
    recordAudit(db2, {
      actorId: user.id,
      action: "legal.accept",
      targetType: "legal_acceptance",
      targetId: user.id,
      targetLabel: `Terms ${LEGAL_TERMS_VERSION}`,
      metadata: {
        termsVersion: LEGAL_TERMS_VERSION,
        privacyVersion: LEGAL_PRIVACY_VERSION
      },
      ip: clientIp(req)
    });
    res.json({ user: loadUser(db2, user.id), status: statusFor(db2, user.id) });
  });
  return router;
}

// server/routes/me.ts
import { Router as Router4 } from "express";
import { z as z4 } from "zod";
var profileSchema = z4.object({
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
  emailNotifications: z4.boolean().optional()
});
var selfExclusionSchema = z4.object({
  duration: z4.enum(SELF_EXCLUSION_DURATIONS),
  reason: z4.string().trim().max(500).optional()
});
function selfExclusionUntil(duration, now) {
  if (duration === "permanent") return "9999-12-31T23:59:59.999Z";
  const days = duration === "24h" ? 1 : duration === "7d" ? 7 : 30;
  return new Date(now + days * 24 * 60 * 6e4).toISOString();
}
var ledgerQuerySchema = pageQuerySchema.extend({
  type: z4.enum(["initial_grant", "admin_adjustment", "game_wager", "game_payout", "game_refund", "credit_request", "reversal"]).optional(),
  from: z4.string().optional(),
  to: z4.string().optional()
});
function ledgerSelect(db2, where, params, limit, offset) {
  const rows = db2.prepare(
    `SELECT l.*, u.username AS username, a.username AS actor_name
       FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
       ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return rows.map((row) => mapLedgerRow(row, row.username, row.actor_name));
}
function createMeRouter(db2) {
  const router = Router4();
  router.get("/", (req, res) => {
    const user = requireAuth(req);
    res.json({ user: loadUser(db2, user.id), unreadNotifications: unreadNotificationCount(db2, user.id) });
  });
  router.patch("/", (req, res) => {
    const user = requireAuth(req);
    const body = parse(profileSchema, req.body);
    if (!body.username && !body.email && body.emailNotifications === void 0) {
      throw badRequest("Nothing to update.", "NO_CHANGES");
    }
    if (body.username && body.username.toLowerCase() !== user.username.toLowerCase()) {
      const taken = db2.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(body.username);
      if (taken) {
        throw conflict("That username is already taken.", "USERNAME_TAKEN", {
          fields: { username: "That username is already taken." }
        });
      }
    }
    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      const taken = db2.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(body.email);
      if (taken) {
        throw conflict("That email is already in use.", "EMAIL_TAKEN", {
          fields: { email: "An account already uses this email." }
        });
      }
    }
    const now = nowIso();
    const oldEmail = user.email;
    const emailChanged = Boolean(body.email && body.email.toLowerCase() !== user.email.toLowerCase());
    const nextEmail = body.email ?? user.email;
    db2.prepare(
      `UPDATE users SET username = ?, email = ?, email_verified = CASE WHEN ? THEN 0 ELSE email_verified END,
              email_notifications = ?, updated_at = ? WHERE id = ?`
    ).run(
      body.username ?? user.username,
      nextEmail,
      emailChanged ? 1 : 0,
      body.emailNotifications ?? user.emailNotifications ? 1 : 0,
      now,
      user.id
    );
    recordAudit(db2, {
      actorId: user.id,
      action: "profile.update",
      targetType: "user",
      targetId: user.id,
      targetLabel: body.username ?? user.username,
      metadata: {
        usernameChanged: Boolean(body.username),
        emailChanged,
        emailNotifications: body.emailNotifications
      },
      ip: clientIp(req)
    });
    if (emailChanged) {
      const emailSettings = getEmailConfig(db2);
      if (emailSettings.securityNotifications) {
        enqueueEmail(db2, {
          userId: user.id,
          recipient: oldEmail,
          template: "email-changed",
          payload: { username: body.username ?? user.username, newEmail: nextEmail },
          dedupeKey: `email-changed:${user.id}:${now}`
        });
      }
      const verification = createEmailVerification(db2, user.id, nextEmail);
      enqueueEmail(db2, {
        userId: user.id,
        recipient: nextEmail,
        template: "verify-email",
        payload: {
          username: body.username ?? user.username,
          verifyUrl: verification.path,
          expiresAt: verification.expiresAt
        },
        dedupeKey: `verify-email:${user.id}:${now}`
      });
      notify(db2, {
        userId: user.id,
        type: "security",
        title: "Email address pending verification",
        body: `Confirm ${nextEmail} to finish updating your account. Your previous address was notified.`,
        link: "/settings"
      });
    }
    res.json({ user: loadUser(db2, user.id) });
  });
  router.get("/wallet", (req, res) => {
    const user = requireAuth(req);
    const row = db2.prepare(
      `SELECT
           COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END), 0) AS wagered,
           COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END), 0) AS won,
           COALESCE(SUM(CASE WHEN type IN ('initial_grant','admin_adjustment','reversal','credit_request') THEN amount ELSE 0 END), 0) AS granted
         FROM ledger WHERE user_id = ?`
    ).get(user.id);
    const pendingCashier = db2.prepare("SELECT COUNT(*) AS count FROM cashier_requests WHERE user_id = ? AND status = 'pending'").get(user.id).count;
    res.json({
      balance: balanceOf(db2, user.id),
      lifetimeWagered: row.wagered,
      lifetimeWon: row.won,
      lifetimeGranted: row.granted,
      net: row.won - row.wagered,
      pendingCashier,
      payoutCap: getSetting(db2, "economy.max_payout", 1e6)
    });
  });
  router.get("/transactions", (req, res) => {
    const user = requireAuth(req);
    const query = parse(ledgerQuerySchema, req.query);
    const clauses = ["l.user_id = ?"];
    const params = [user.id];
    if (query.type) {
      clauses.push("l.type = ?");
      params.push(query.type);
    }
    if (query.from) {
      clauses.push("l.created_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      clauses.push("l.created_at <= ?");
      params.push(query.to);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const total = db2.prepare(`SELECT COUNT(*) AS count FROM ledger l ${where}`).get(...params).count;
    const items = ledgerSelect(db2, where, params, query.pageSize, (query.page - 1) * query.pageSize);
    const response = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      balance: balanceOf(db2, user.id)
    };
    res.json(response);
  });
  router.get("/notifications", (req, res) => {
    const user = requireAuth(req);
    const query = parse(pageQuerySchema.extend({ filter: z4.enum(["all", "unread"]).optional() }), req.query);
    const onlyUnread = query.filter === "unread";
    const where = `WHERE user_id = ? ${onlyUnread ? "AND read_at IS NULL" : ""}`;
    const total = db2.prepare(`SELECT COUNT(*) AS count FROM notifications ${where}`).get(user.id).count;
    const rows = db2.prepare(
      `SELECT id, type, title, body, link, read_at, created_at FROM notifications ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(user.id, query.pageSize, (query.page - 1) * query.pageSize);
    const response = {
      items: rows.map(mapNotification),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      unread: unreadNotificationCount(db2, user.id)
    };
    res.json(response);
  });
  router.post("/notifications/read-all", (req, res) => {
    const user = requireAuth(req);
    db2.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(nowIso(), user.id);
    res.json({ ok: true, unread: 0 });
  });
  router.post("/notifications/:id/read", (req, res) => {
    const user = requireAuth(req);
    const result = db2.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(nowIso(), req.params.id ?? "", user.id);
    if (result.changes !== 1) throw notFound("Notification not found.");
    res.json({ ok: true, unread: unreadNotificationCount(db2, user.id) });
  });
  router.get("/sessions", (req, res) => {
    const user = requireAuth(req);
    const rows = db2.prepare(
      `SELECT id, created_at, expires_at, last_used_at, ip, user_agent, revoked_at
         FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC`
    ).all(user.id, nowIso());
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastUsedAt: row.last_used_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === req.sessionId
      }))
    });
  });
  router.delete("/sessions/:id", (req, res) => {
    const user = requireAuth(req);
    const row = db2.prepare("SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL").get(req.params.id ?? "", user.id);
    if (!row) throw notFound("Session not found.");
    revokeSession(db2, row.id);
    recordAudit(db2, {
      actorId: user.id,
      action: "auth.session_revoked",
      targetType: "session",
      targetId: row.id,
      ip: clientIp(req)
    });
    res.json({ ok: true });
  });
  router.post("/sessions/revoke-others", (req, res) => {
    const user = requireAuth(req);
    if (!req.sessionId) throw badRequest("No active session.", "NO_SESSION");
    revokeOtherSessions(db2, user.id, req.sessionId);
    recordAudit(db2, {
      actorId: user.id,
      action: "auth.sessions_revoked",
      targetType: "session",
      targetId: req.sessionId,
      ip: clientIp(req)
    });
    res.json({ ok: true });
  });
  router.post("/self-exclusion", (req, res) => {
    const user = requireAuth(req);
    const body = parse(selfExclusionSchema, req.body);
    if (isSelfExclusionActive(user.selfExcludedUntil)) {
      throw conflict("This account is already self-excluded.", "ALREADY_SELF_EXCLUDED");
    }
    const now = nowIso();
    const until = selfExclusionUntil(body.duration, Date.now());
    db2.transaction(() => {
      db2.prepare(
        `UPDATE users
         SET self_excluded_at = ?, self_excluded_until = ?, self_exclusion_reason = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, until, body.reason ?? null, now, user.id);
      revokeAllSessions(db2, user.id);
      recordAudit(db2, {
        actorId: user.id,
        action: "account.self_exclusion",
        targetType: "user",
        targetId: user.id,
        targetLabel: user.username,
        reason: body.reason ?? null,
        metadata: { duration: body.duration, until },
        ip: clientIp(req)
      });
    })();
    clearSessionCookie(res, req);
    res.json({
      ok: true,
      until,
      permanent: body.duration === "permanent",
      message: body.duration === "permanent" ? "Your account is permanently self-excluded. Contact support if you need help." : `Your account is self-excluded until ${until.slice(0, 10)}. You have been signed out.`
    });
  });
  router.get("/overview", (req, res) => {
    const user = requireAuth(req);
    const tickets = ticketCounts(db2, user, { ownOnly: true });
    const recentLedger = ledgerSelect(db2, "WHERE l.user_id = ?", [user.id], 6, 0);
    const recentSessions = db2.prepare(
      `SELECT id, game_id, bet, status, payout, created_at, ended_at FROM game_sessions
         WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`
    ).all(user.id);
    const gameStats = db2.prepare(
      `SELECT COUNT(*) AS played, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout),0) AS won
         FROM game_sessions WHERE user_id = ?`
    ).get(user.id);
    const activeTickets = db2.prepare(
      `SELECT reference, subject, status, priority, last_activity_at FROM tickets
           WHERE user_id = ? AND status NOT IN ('closed','rejected') ORDER BY last_activity_at DESC LIMIT 3`
    ).all(user.id).map((row) => ({
      reference: row.reference,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      lastActivityAt: row.last_activity_at
    }));
    res.json({
      balance: balanceOf(db2, user.id),
      tickets,
      gamesPlayed: gameStats.played,
      lifetimeWagered: gameStats.wagered,
      lifetimeWon: gameStats.won,
      activeTickets,
      unreadNotifications: unreadNotificationCount(db2, user.id),
      recentTransactions: recentLedger,
      recentGames: recentSessions.map((row) => ({
        id: row.id,
        game: row.game_id,
        bet: row.bet,
        status: row.status,
        payout: row.payout,
        createdAt: row.created_at,
        endedAt: row.ended_at,
        gameLabel: row.game_id.charAt(0).toUpperCase() + row.game_id.slice(1)
      })),
      startingCredits: getSetting(db2, "economy.starting_credits", config.startingCredits),
      maxPayout: getSetting(db2, "economy.max_payout", 1e6),
      platformName: getSetting(db2, "platform.name", config.appName)
    });
  });
  return router;
}

// server/routes/games.ts
import { Router as Router5 } from "express";
import { z as z9 } from "zod";

// server/lib/amount.ts
import { z as z5 } from "zod";
function amountSchema(options = {}) {
  const { max, maxAbs, allowNegative = false, allowZero = false, label } = options;
  const min = options.min ?? (allowNegative ? -Number.MAX_SAFE_INTEGER : allowZero ? 0 : 1);
  const subject = label ? `${label} amount` : "amount";
  return z5.unknown().transform((raw, ctx) => {
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? parseAmount(raw, { allowNegative }) : null;
    if (parsed === null || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      ctx.addIssue({
        code: "custom",
        message: `Enter a valid ${subject}, for example 100k, 2.5M, 5B or 1T.`
      });
      return z5.NEVER;
    }
    if (!allowZero && parsed === 0) {
      ctx.addIssue({ code: "custom", message: "Amount cannot be zero." });
      return z5.NEVER;
    }
    if (parsed < min) {
      ctx.addIssue({ code: "custom", message: `Must be at least ${compactAmount(min)}.` });
      return z5.NEVER;
    }
    if (max !== void 0 && parsed > max) {
      ctx.addIssue({ code: "custom", message: `Must be at most ${compactAmount(max)}.` });
      return z5.NEVER;
    }
    if (maxAbs !== void 0 && Math.abs(parsed) > maxAbs) {
      ctx.addIssue({ code: "custom", message: `Must be between -${compactAmount(maxAbs)} and ${compactAmount(maxAbs)}.` });
      return z5.NEVER;
    }
    return parsed;
  });
}

// server/games/common.ts
import { randomInt } from "node:crypto";
function secureInt(maxExclusive) {
  return randomInt(maxExclusive);
}
function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = secureInt(i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a === void 0 || b === void 0) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
function parseGameConfig(game) {
  return parseJson(game.config, {});
}
function numberConfig(config2, key, fallback) {
  const value = config2[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function findReplay(db2, userId, requestId) {
  return db2.prepare("SELECT * FROM game_sessions WHERE user_id = ? AND idempotency_key = ?").get(userId, requestId);
}
function getSessionRow(db2, sessionId) {
  return db2.prepare("SELECT * FROM game_sessions WHERE id = ?").get(sessionId);
}
function debitWager(db2, userId, sessionId, bet, gameId) {
  const entry = applyLedger(db2, {
    userId,
    amount: -bet,
    type: "game_wager",
    refType: "game_session",
    refId: sessionId,
    reason: `${gameId} wager`,
    idempotencyKey: `game-wager:${sessionId}`,
    metadata: { game: gameId }
  });
  return entry.id;
}
function insertSession(db2, input) {
  db2.prepare(
    `INSERT INTO game_sessions (id, user_id, game_id, bet, status, payout, state, outcome, idempotency_key, wager_ledger_id, created_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.userId,
    input.gameId,
    input.bet,
    input.status,
    input.payout ?? 0,
    JSON.stringify(input.state),
    input.outcome === void 0 ? null : JSON.stringify(input.outcome),
    input.requestId,
    input.wagerLedgerId,
    nowIso(),
    input.endedAt ?? (input.status === "active" ? null : nowIso())
  );
}
function maxPayout(db2) {
  return getSetting(db2, "economy.max_payout", 1e12);
}
function creditPayout(db2, session, payout, reason) {
  if (payout <= 0) return null;
  const entry = applyLedger(db2, {
    userId: session.user_id,
    amount: payout,
    type: "game_payout",
    refType: "game_session",
    refId: session.id,
    reason,
    idempotencyKey: `game-payout:${session.id}`,
    metadata: { game: session.game_id }
  });
  return entry.id;
}
function finishSession(db2, sessionId, input) {
  const now = nowIso();
  const result = db2.prepare(
    `UPDATE game_sessions
       SET status = ?, payout = ?, state = ?, outcome = COALESCE(?, outcome), payout_ledger_id = ?, ended_at = ?
       WHERE id = ? AND status = 'active'`
  ).run(
    input.status,
    input.payout,
    JSON.stringify(input.state),
    input.outcome === void 0 ? null : JSON.stringify(input.outcome),
    input.payoutLedgerId ?? null,
    now,
    sessionId
  );
  if (result.changes !== 1) throw conflict("This round is already complete.", "ROUND_COMPLETE");
  const row = getSessionRow(db2, sessionId);
  if (!row) throw badRequest("Game session not found.", "SESSION_NOT_FOUND");
  return row;
}
function updateSessionState(db2, sessionId, state, bet) {
  if (bet === void 0) {
    db2.prepare("UPDATE game_sessions SET state = ? WHERE id = ?").run(JSON.stringify(state), sessionId);
  } else {
    db2.prepare("UPDATE game_sessions SET state = ?, bet = ? WHERE id = ?").run(JSON.stringify(state), bet, sessionId);
  }
}
function sessionSummary(row) {
  return {
    id: row.id,
    game: row.game_id,
    bet: row.bet,
    payout: row.payout,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
}
function baseView(row, balance) {
  return { session: sessionSummary(row), balance };
}
function loadGame(db2, slug) {
  const row = db2.prepare("SELECT * FROM games WHERE id = ?").get(slug);
  if (!row) throw badRequest("Unknown game.", "GAME_NOT_FOUND");
  return row;
}
function assertWager(game, bet) {
  if (!Number.isInteger(bet) || bet <= 0) {
    throw badRequest("Wager must be a positive whole number amount.", "INVALID_WAGER", {
      fields: { bet: "Enter a whole number amount." }
    });
  }
  if (bet < game.min_bet) {
    throw badRequest(`Minimum wager for ${game.name} is ${compactAmount(game.min_bet)} DonutSMP money.`, "WAGER_TOO_LOW", {
      fields: { bet: `Minimum is ${compactAmount(game.min_bet)}.` }
    });
  }
  if (bet > game.max_bet) {
    throw badRequest(`Maximum wager for ${game.name} is ${compactAmount(game.max_bet)} DonutSMP money.`, "WAGER_TOO_HIGH", {
      fields: { bet: `Maximum is ${compactAmount(game.max_bet)}.` }
    });
  }
}
function newSessionId() {
  return newId("gs");
}

// server/games/instant.ts
import { z as z6 } from "zod";

// shared/payout.ts
function normalizeMultiplier(multiplier) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.round(multiplier * 100) / 100;
}
function payoutFor(bet, multiplier, cap = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(bet) || bet <= 0) return 0;
  const normalized = normalizeMultiplier(multiplier);
  if (normalized <= 0) return 0;
  const betInt = BigInt(Math.trunc(bet));
  const hundredths = BigInt(Math.round(normalized * 100));
  const capInt = BigInt(Math.max(0, Math.trunc(cap)));
  const raw = betInt * hundredths / 100n;
  return Number(raw < capInt ? raw : capInt);
}
function capBelowWager(bet, cap) {
  return Number.isFinite(cap) && cap > 0 && bet > cap;
}

// server/games/instant.ts
var coinflipSchema = z6.object({ pick: z6.enum(["heads", "tails"]) });
var coinflip = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { pick } = parse(coinflipSchema, ctx.body);
    const outcome = secureInt(2) === 0 ? "heads" : "tails";
    const multiplier = Math.min(2, Math.max(1.5, numberConfig(ctx.gameConfig, "winMultiplier", 1.96)));
    const won = pick === outcome;
    const payout = won ? payoutFor(ctx.bet, multiplier, maxPayout(ctx.db)) : 0;
    const sessionId = newSessionId();
    const state = { pick, outcome, multiplier };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      payout,
      won ? "Coinflip win" : "Coinflip loss"
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? "won" : "lost",
      payout,
      state,
      outcome: { pick, outcome },
      payoutLedgerId
    });
    const view = {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      pick,
      outcome,
      won,
      multiplier
    };
    return view;
  },
  resume(row, balance) {
    const state = parseJson(row.state, { pick: "heads", outcome: "heads", multiplier: 1.96 });
    return {
      ...baseView(row, balance),
      pick: state.pick,
      outcome: state.outcome,
      won: row.status === "won",
      multiplier: state.multiplier
    };
  }
};
var PLINKO_ROWS = 12;
var PLINKO_TABLES = {
  low: [10, 3, 1.6, 1.3, 1.1, 0.7, 0.5, 0.7, 1.1, 1.3, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.2, 0.5, 0.2, 0.5, 1.2, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170]
};
var plinkoSchema = z6.object({ risk: z6.enum(["low", "medium", "high"]) });
var plinko = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { risk } = parse(plinkoSchema, ctx.body);
    const enabledRisks = Array.isArray(ctx.gameConfig.enabledRisks) ? ctx.gameConfig.enabledRisks : ["low", "medium", "high"];
    if (!enabledRisks.includes(risk)) {
      throw badRequest("That risk level is disabled.", "RISK_DISABLED", { fields: { risk: "Choose an available risk level." } });
    }
    const path4 = Array.from({ length: PLINKO_ROWS }, () => secureInt(2) === 0 ? "left" : "right");
    const slot = path4.filter((step) => step === "right").length;
    const multiplier = PLINKO_TABLES[risk][slot] ?? 0;
    const payout = payoutFor(ctx.bet, multiplier, maxPayout(ctx.db));
    const won = payout > 0;
    const sessionId = newSessionId();
    const state = { risk, path: path4, slot, multiplier };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      payout,
      `Plinko ${risk} drop`
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? "won" : "lost",
      payout,
      state,
      outcome: { risk, slot, multiplier },
      payoutLedgerId
    });
    return {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      risk,
      path: path4,
      slot,
      multiplier,
      won
    };
  },
  resume(row, balance) {
    const state = parseJson(row.state, { risk: "medium", path: [], slot: 6, multiplier: 0 });
    return {
      ...baseView(row, balance),
      risk: state.risk,
      path: state.path,
      slot: state.slot,
      multiplier: state.multiplier,
      won: row.status === "won"
    };
  }
};
var ROULETTE_BET_TYPES = [
  "red",
  "black",
  "odd",
  "even",
  "low",
  "high",
  "dozen1",
  "dozen2",
  "dozen3",
  "column1",
  "column2",
  "column3",
  "straight"
];
var rouletteSchema = z6.object({
  bets: z6.array(
    z6.object({
      type: z6.enum(ROULETTE_BET_TYPES),
      number: z6.number().int().min(0).max(36).optional(),
      amount: amountSchema({ max: 1e12 })
    })
  ).min(1, "Place at least one bet.").max(30)
});
var RED_NUMBERS = /* @__PURE__ */ new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}
function betWins(bet, winning) {
  const amount = bet.amount;
  if (bet.type === "straight") return bet.number === winning ? amount * 36 : 0;
  if (winning === 0) return 0;
  switch (bet.type) {
    case "red":
      return rouletteColor(winning) === "red" ? amount * 2 : 0;
    case "black":
      return rouletteColor(winning) === "black" ? amount * 2 : 0;
    case "odd":
      return winning % 2 === 1 ? amount * 2 : 0;
    case "even":
      return winning % 2 === 0 ? amount * 2 : 0;
    case "low":
      return winning <= 18 ? amount * 2 : 0;
    case "high":
      return winning >= 19 ? amount * 2 : 0;
    case "dozen1":
      return winning <= 12 ? amount * 3 : 0;
    case "dozen2":
      return winning >= 13 && winning <= 24 ? amount * 3 : 0;
    case "dozen3":
      return winning >= 25 ? amount * 3 : 0;
    case "column1":
      return winning % 3 === 1 ? amount * 3 : 0;
    case "column2":
      return winning % 3 === 2 ? amount * 3 : 0;
    case "column3":
      return winning % 3 === 0 ? amount * 3 : 0;
    default:
      return 0;
  }
}
var roulette = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const parsed = parse(rouletteSchema, ctx.body);
    const maxBets = Math.max(1, Math.floor(numberConfig(ctx.gameConfig, "maxBetsPerSpin", 10)));
    if (parsed.bets.length > maxBets) {
      throw badRequest(`You can place at most ${maxBets} bets per spin.`, "TOO_MANY_BETS");
    }
    const bets = parsed.bets.map((bet) => {
      const type = bet.type;
      if (type === "straight" && bet.number === void 0) {
        throw badRequest("Choose a number for a straight bet.", "INVALID_BET", { fields: { bets: "Straight bets need a number." } });
      }
      return { type, ...type === "straight" ? { number: bet.number } : {}, amount: bet.amount };
    });
    const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
    if (total !== ctx.bet) {
      throw badRequest("Wager total does not match the placed bets.", "BET_MISMATCH");
    }
    const winningNumber = secureInt(37);
    let payoutRaw = 0;
    for (const bet of bets) payoutRaw += betWins(bet, winningNumber);
    const totalPayout = Math.min(payoutRaw, maxPayout(ctx.db));
    const won = totalPayout > 0;
    const sessionId = newSessionId();
    const state = { bets, winningNumber, totalPayout };
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const payoutLedgerId = creditPayout(
      ctx.db,
      { id: sessionId, user_id: ctx.user.id, game_id: ctx.game.id },
      totalPayout,
      `Roulette spin ${winningNumber}`
    );
    const row = finishSession(ctx.db, sessionId, {
      status: won ? "won" : "lost",
      payout: totalPayout,
      state,
      outcome: { winningNumber },
      payoutLedgerId
    });
    return {
      ...baseView(row, balanceOf(ctx.db, ctx.user.id)),
      bets,
      winningNumber,
      color: rouletteColor(winningNumber),
      totalPayout,
      won
    };
  },
  resume(row, balance) {
    const state = parseJson(row.state, { bets: [], winningNumber: 0, totalPayout: 0 });
    return {
      ...baseView(row, balance),
      bets: state.bets,
      winningNumber: state.winningNumber,
      color: rouletteColor(state.winningNumber),
      totalPayout: state.totalPayout,
      won: row.status === "won"
    };
  }
};

// server/games/blackjack.ts
import { z as z7 } from "zod";
var SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function buildShoe(decks) {
  const cards = [];
  for (let d = 0; d < decks; d += 1) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit });
  }
  return shuffle(cards);
}
function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank) || 0;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}
function isSoft(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(card.rank)) total += 10;
    else total += Number(card.rank) || 0;
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return softAces > 0;
}
function draw(shoe, decks) {
  const card = shoe.pop();
  if (card) return card;
  const rebuilt = buildShoe(decks);
  const next = rebuilt.pop();
  if (!next) throw new Error("Unable to draw a card");
  shoe.push(...rebuilt);
  return next;
}
function isNatural(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}
function dealerPlay(state, decks) {
  for (let guard = 0; guard < 30; guard += 1) {
    const total = handTotal(state.dealer);
    const soft = isSoft(state.dealer);
    const shouldHit = total < 17 || total === 17 && soft && !state.standsSoft17;
    if (!shouldHit) return;
    state.dealer.push(draw(state.shoe, decks));
  }
}
function settle(db2, input) {
  const playerTotal = handTotal(input.state.player);
  const dealerTotal = handTotal(input.state.dealer);
  let status = "lost";
  let payoutMultiplier = 0;
  let result = "";
  if (playerTotal > 21) {
    result = "Bust \u2014 you went over 21.";
    status = "lost";
  } else if (input.natural) {
    if (dealerTotal === 21 && input.state.dealer.length === 2) {
      result = "Both blackjack \u2014 push.";
      status = "push";
      payoutMultiplier = 1;
    } else {
      result = "Blackjack!";
      status = "won";
      payoutMultiplier = 1 + input.state.blackjackPays;
    }
  } else if (dealerTotal > 21) {
    result = "Dealer busts \u2014 you win.";
    status = "won";
    payoutMultiplier = 2;
  } else if (playerTotal > dealerTotal) {
    result = "You beat the dealer.";
    status = "won";
    payoutMultiplier = 2;
  } else if (playerTotal === dealerTotal) {
    result = "Push \u2014 your wager is returned.";
    status = "push";
    payoutMultiplier = 1;
  } else {
    result = "Dealer wins.";
    status = "lost";
  }
  const payout = payoutFor(input.bet, payoutMultiplier, maxPayout(db2));
  input.state.result = result;
  const payoutLedgerId = creditPayout(
    db2,
    { id: input.sessionId, user_id: input.userId, game_id: "blackjack" },
    payout,
    result
  );
  finishSession(db2, input.sessionId, {
    status,
    payout,
    state: input.state,
    outcome: { playerTotal, dealerTotal, result },
    payoutLedgerId
  });
  return { status, payout, result };
}
function buildView(row, state, balance, configDecks = 6) {
  const active = row.status === "active";
  const dealerCards = state.dealer.map(
    (card, index) => active && index === 1 ? { rank: "?", suit: "\u2660", hidden: true } : { rank: card.rank, suit: card.suit }
  );
  return {
    ...baseView(row, balance),
    playerCards: state.player.map((card) => ({ rank: card.rank, suit: card.suit })),
    dealerCards,
    playerScore: handTotal(state.player),
    dealerScore: active ? handTotal(state.dealer.slice(0, 1)) : handTotal(state.dealer),
    canHit: active,
    canStand: active,
    canDouble: active && state.actions === 0 && state.player.length === 2 && state.allowDouble,
    result: state.result
  };
}
var actionSchema = z7.object({ action: z7.enum(["hit", "stand", "double"]) });
var blackjack = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const decks = Math.min(8, Math.max(1, Math.floor(numberConfig(ctx.gameConfig, "decks", 6))));
    const blackjackPays = Math.min(2, Math.max(1, numberConfig(ctx.gameConfig, "blackjackPays", 1.5)));
    const standsSoft17 = ctx.gameConfig.dealerStandsSoft17 !== false;
    const allowDouble = ctx.gameConfig.allowDouble !== false;
    const shoe = buildShoe(decks);
    const player = [draw(shoe, decks), draw(shoe, decks)];
    const dealer = [draw(shoe, decks), draw(shoe, decks)];
    const state = {
      shoe,
      player,
      dealer,
      doubled: false,
      actions: 0,
      result: null,
      lastActionId: null,
      allowDouble,
      standsSoft17,
      blackjackPays,
      decks
    };
    const sessionId = newSessionId();
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const playerNatural = isNatural(player);
    const dealerNatural = isNatural(dealer);
    if (playerNatural || dealerNatural) {
      state.lastActionId = null;
      settle(ctx.db, { sessionId, userId: ctx.user.id, bet: ctx.bet, state, natural: playerNatural });
    }
    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error("Session disappeared");
    return buildView(row, state, balanceOf(ctx.db, ctx.user.id), decks);
  },
  action(ctx) {
    const { action } = parse(actionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound("Game session not found.");
    const state = parseJson(session.state, null);
    if (!state) throw new Error("Corrupt game state");
    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return buildView(session, state, balanceOf(ctx.db, ctx.user.id));
    }
    if (session.status !== "active") {
      throw conflict("This round is already complete.", "ROUND_COMPLETE");
    }
    const decks = Math.min(8, Math.max(1, Math.floor(state.decks || 6)));
    const bet = session.bet;
    state.lastActionId = ctx.requestId;
    if (action === "hit") {
      state.actions += 1;
      state.player.push(draw(state.shoe, decks));
      const total = handTotal(state.player);
      if (total > 21) {
        state.result = "Bust \u2014 you went over 21.";
        creditPayout(ctx.db, { id: session.id, user_id: session.user_id, game_id: session.game_id }, 0, "Blackjack loss");
        finishSession(ctx.db, session.id, {
          status: "lost",
          payout: 0,
          state,
          outcome: { playerTotal: total, dealerTotal: handTotal(state.dealer) }
        });
      } else if (total === 21) {
        dealerPlay(state, decks);
        settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet, state });
      } else {
        updateSessionState(ctx.db, session.id, state);
      }
    } else if (action === "stand") {
      dealerPlay(state, decks);
      settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet, state });
    } else {
      if (!state.allowDouble) throw badRequest("Doubling is disabled for this table.", "DOUBLE_DISABLED");
      if (state.actions !== 0 || state.player.length !== 2) {
        throw badRequest("You can only double on the first two cards.", "DOUBLE_NOT_ALLOWED");
      }
      const newBet = bet * 2;
      if (newBet > ctx.game.max_bet) {
        throw badRequest(
          `Doubling would stake ${compactAmount(newBet)} DonutSMP money, above the ${compactAmount(ctx.game.max_bet)} table maximum.`,
          "WAGER_TOO_HIGH"
        );
      }
      applyLedger(ctx.db, {
        userId: session.user_id,
        amount: -bet,
        type: "game_wager",
        refType: "game_session",
        refId: session.id,
        reason: "Blackjack double down",
        idempotencyKey: `game-wager-double:${session.id}`,
        metadata: { game: "blackjack" }
      });
      state.doubled = true;
      state.actions += 1;
      state.player.push(draw(state.shoe, decks));
      updateSessionState(ctx.db, session.id, state, newBet);
      if (handTotal(state.player) > 21) {
        state.result = "Bust \u2014 you went over 21.";
        creditPayout(ctx.db, { id: session.id, user_id: session.user_id, game_id: session.game_id }, 0, "Blackjack loss");
        finishSession(ctx.db, session.id, {
          status: "lost",
          payout: 0,
          state,
          outcome: { playerTotal: handTotal(state.player), dealerTotal: handTotal(state.dealer) }
        });
      } else {
        dealerPlay(state, decks);
        settle(ctx.db, { sessionId: session.id, userId: session.user_id, bet: newBet, state });
      }
    }
    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error("Session disappeared");
    const finalState = parseJson(updated.state, state);
    return buildView(updated, finalState, balanceOf(ctx.db, ctx.user.id));
  },
  resume(row, balance) {
    const state = parseJson(row.state, null);
    if (!state) throw new Error("Corrupt game state");
    return buildView(row, state, balance);
  }
};

// server/games/table.ts
import { z as z8 } from "zod";
var round2 = (value) => Math.round(value * 100) / 100;
var GRID = 25;
function minesMultiplier(mines2, picks, edge) {
  if (picks === 0) return 1;
  let numerator = 1;
  let denominator = 1;
  for (let i = 0; i < picks; i += 1) {
    numerator *= GRID - i;
    denominator *= GRID - mines2 - i;
  }
  return round2((1 - edge) * (numerator / denominator));
}
var minesStartSchema = z8.object({
  mines: z8.number().int().min(1).max(24)
});
var minesActionSchema = z8.object({
  action: z8.enum(["reveal", "cashout"]),
  tile: z8.number().int().min(0).max(GRID - 1).optional()
});
function minesView(row, state, balance, mineCount, cap) {
  const active = row.status === "active";
  const safeTiles = GRID - mineCount;
  return {
    ...baseView(row, balance),
    mines: mineCount,
    revealed: state.revealed,
    multiplier: state.multiplier,
    nextMultiplier: active && state.revealed.length < safeTiles ? minesMultiplier(mineCount, state.revealed.length + 1, state.edge) : null,
    // The displayed potential is the settled payout, cap included.
    potential: state.revealed.length > 0 ? payoutFor(row.bet, state.multiplier, cap) : 0,
    mineTiles: active ? null : state.mineTiles,
    hitTile: active ? null : state.hitTile ?? null
  };
}
var mines = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const { mines: mineCount } = parse(minesStartSchema, ctx.body);
    const maxMines = Math.min(24, Math.max(1, Math.floor(numberConfig(ctx.gameConfig, "maxMines", 20))));
    if (mineCount > maxMines) {
      throw badRequest(`This table allows at most ${maxMines} mines.`, "INVALID_MINE_COUNT", {
        fields: { mines: `Choose between 1 and ${maxMines}.` }
      });
    }
    const positions = shuffle(Array.from({ length: GRID }, (_, index) => index));
    const state = {
      mineTiles: positions.slice(0, mineCount),
      revealed: [],
      multiplier: 1,
      edge: Math.min(0.1, Math.max(0, numberConfig(ctx.gameConfig, "houseEdge", 0.03))),
      hitTile: null,
      lastActionId: null
    };
    const sessionId = newSessionId();
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error("Session missing");
    return minesView(row, state, balanceOf(ctx.db, ctx.user.id), mineCount, maxPayout(ctx.db));
  },
  action(ctx) {
    const body = parse(minesActionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound("Game session not found.");
    const state = parseJson(session.state, null);
    if (!state) throw new Error("Corrupt game state");
    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return minesView(session, state, balanceOf(ctx.db, ctx.user.id), state.mineTiles.length, maxPayout(ctx.db));
    }
    if (session.status !== "active") throw conflict("This round is already complete.", "ROUND_COMPLETE");
    const mineCount = state.mineTiles.length;
    const safeTiles = GRID - mineCount;
    const edge = state.edge;
    state.lastActionId = ctx.requestId;
    if (body.action === "cashout") {
      if (state.revealed.length === 0) {
        throw badRequest("Reveal at least one safe tile before cashing out.", "NOTHING_TO_CASH_OUT");
      }
      const payout = payoutFor(session.bet, state.multiplier, maxPayout(ctx.db));
      const ledgerId2 = creditPayout(
        ctx.db,
        { id: session.id, user_id: session.user_id, game_id: session.game_id },
        payout,
        `Mines cash-out at ${state.multiplier.toFixed(2)}x`
      );
      finishSession(ctx.db, session.id, {
        status: "won",
        payout,
        state,
        outcome: { cashout: true, multiplier: state.multiplier },
        payoutLedgerId: ledgerId2
      });
    } else {
      if (body.tile === void 0) throw badRequest("Choose a tile to reveal.", "TILE_REQUIRED");
      if (state.revealed.includes(body.tile)) {
        throw badRequest("That tile is already revealed.", "TILE_ALREADY_REVEALED");
      }
      if (state.mineTiles.includes(body.tile)) {
        state.hitTile = body.tile;
        finishSession(ctx.db, session.id, {
          status: "lost",
          payout: 0,
          state,
          outcome: { hitMine: body.tile }
        });
      } else {
        state.revealed.push(body.tile);
        state.multiplier = Math.min(minesMultiplier(mineCount, state.revealed.length, edge), 1e6);
        if (state.revealed.length === safeTiles) {
          const payout = payoutFor(session.bet, state.multiplier, maxPayout(ctx.db));
          const ledgerId2 = creditPayout(
            ctx.db,
            { id: session.id, user_id: session.user_id, game_id: session.game_id },
            payout,
            "Mines \u2014 all safe tiles cleared"
          );
          finishSession(ctx.db, session.id, {
            status: "won",
            payout,
            state,
            outcome: { cleared: true, multiplier: state.multiplier },
            payoutLedgerId: ledgerId2
          });
        } else {
          updateSessionState(ctx.db, session.id, state);
        }
      }
    }
    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error("Session missing");
    const finalState = parseJson(updated.state, state);
    return minesView(updated, finalState, balanceOf(ctx.db, ctx.user.id), mineCount, maxPayout(ctx.db));
  },
  resume(row, balance, cap = Number.MAX_SAFE_INTEGER) {
    const state = parseJson(row.state, null);
    if (!state) throw new Error("Corrupt game state");
    return minesView(row, state, balance, state.mineTiles.length, cap);
  }
};
var TILES_PER_LEVEL = 3;
var towersActionSchema = z8.object({
  action: z8.enum(["reveal", "cashout"]),
  tile: z8.number().int().min(0).max(TILES_PER_LEVEL - 1).optional()
});
function towerLevels(gameConfig) {
  return Math.min(12, Math.max(3, Math.floor(numberConfig(gameConfig, "levels", 9))));
}
function towerMultiplier(level, edge) {
  if (level === 0) return 1;
  return round2((1 - edge) * 1.5 ** level);
}
function towersView(row, state, balance, levels, cap) {
  const active = row.status === "active";
  const trapTile = state.failedLevel !== null ? state.traps[state.failedLevel] ?? null : null;
  return {
    ...baseView(row, balance),
    level: state.level,
    revealed: state.choices,
    multiplier: state.multiplier,
    nextMultiplier: active && state.level < levels ? towerMultiplier(state.level + 1, state.edge) : state.multiplier,
    potential: state.level > 0 ? payoutFor(row.bet, state.multiplier, cap) : 0,
    trapTile
  };
}
var towers = {
  start(ctx) {
    const replay = findReplay(ctx.db, ctx.user.id, ctx.requestId);
    if (replay) return this.resume(replay, balanceOf(ctx.db, ctx.user.id), maxPayout(ctx.db));
    const levels = towerLevels(ctx.gameConfig);
    const edge = Math.min(0.1, Math.max(0, numberConfig(ctx.gameConfig, "houseEdge", 0.03)));
    const state = {
      traps: Array.from({ length: levels }, () => secureInt(TILES_PER_LEVEL)),
      choices: [],
      level: 0,
      multiplier: 1,
      edge,
      failedLevel: null,
      lastActionId: null
    };
    const sessionId = newSessionId();
    const wagerLedgerId = debitWager(ctx.db, ctx.user.id, sessionId, ctx.bet, ctx.game.id);
    insertSession(ctx.db, {
      id: sessionId,
      userId: ctx.user.id,
      gameId: ctx.game.id,
      bet: ctx.bet,
      status: "active",
      state,
      requestId: ctx.requestId,
      wagerLedgerId
    });
    const row = getSessionRow(ctx.db, sessionId);
    if (!row) throw new Error("Session missing");
    return towersView(row, state, balanceOf(ctx.db, ctx.user.id), levels, maxPayout(ctx.db));
  },
  action(ctx) {
    const body = parse(towersActionSchema, ctx.body);
    const session = getSessionRow(ctx.db, ctx.sessionId);
    if (!session || session.user_id !== ctx.user.id) throw notFound("Game session not found.");
    const state = parseJson(session.state, null);
    if (!state) throw new Error("Corrupt game state");
    if (state.lastActionId && state.lastActionId === ctx.requestId) {
      return towersView(session, state, balanceOf(ctx.db, ctx.user.id), state.traps.length, maxPayout(ctx.db));
    }
    if (session.status !== "active") throw conflict("This round is already complete.", "ROUND_COMPLETE");
    const levels = state.traps.length;
    const edge = state.edge;
    state.lastActionId = ctx.requestId;
    if (body.action === "cashout") {
      if (state.level === 0) {
        throw badRequest("Reveal at least one safe floor before cashing out.", "NOTHING_TO_CASH_OUT");
      }
      const payout = payoutFor(session.bet, state.multiplier, maxPayout(ctx.db));
      const ledgerId2 = creditPayout(
        ctx.db,
        { id: session.id, user_id: session.user_id, game_id: session.game_id },
        payout,
        `Towers cash-out at ${state.multiplier.toFixed(2)}x`
      );
      finishSession(ctx.db, session.id, {
        status: "won",
        payout,
        state,
        outcome: { cashout: true, level: state.level, multiplier: state.multiplier },
        payoutLedgerId: ledgerId2
      });
    } else {
      if (body.tile === void 0) throw badRequest("Choose a tile.", "TILE_REQUIRED");
      const trap = state.traps[state.level];
      if (trap === body.tile) {
        state.failedLevel = state.level;
        finishSession(ctx.db, session.id, {
          status: "lost",
          payout: 0,
          state,
          outcome: { trap: true, level: state.level }
        });
      } else {
        state.choices.push(body.tile);
        state.level += 1;
        state.multiplier = Math.min(towerMultiplier(state.level, edge), 1e6);
        if (state.level === levels) {
          const payout = payoutFor(session.bet, state.multiplier, maxPayout(ctx.db));
          const ledgerId2 = creditPayout(
            ctx.db,
            { id: session.id, user_id: session.user_id, game_id: session.game_id },
            payout,
            "Towers \u2014 reached the top"
          );
          finishSession(ctx.db, session.id, {
            status: "won",
            payout,
            state,
            outcome: { cleared: true, multiplier: state.multiplier },
            payoutLedgerId: ledgerId2
          });
        } else {
          updateSessionState(ctx.db, session.id, state);
        }
      }
    }
    const updated = getSessionRow(ctx.db, session.id);
    if (!updated) throw new Error("Session missing");
    const finalState = parseJson(updated.state, state);
    return towersView(updated, finalState, balanceOf(ctx.db, ctx.user.id), levels, maxPayout(ctx.db));
  },
  resume(row, balance, cap = Number.MAX_SAFE_INTEGER) {
    const state = parseJson(row.state, null);
    if (!state) throw new Error("Corrupt game state");
    return towersView(row, state, balance, state.traps.length, cap);
  }
};

// server/games/index.ts
var GAME_MODULES = {
  coinflip,
  mines,
  blackjack,
  roulette,
  towers,
  plinko
};
function getGameModule(slug) {
  return GAME_MODULES[slug];
}
var RED_NUMBERS2 = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
function publicGameConfig(slug, config2) {
  switch (slug) {
    case "mines":
      return { ...config2, gridSize: 25 };
    case "roulette":
      return { ...config2, redNumbers: RED_NUMBERS2 };
    case "towers":
      return { ...config2, tilesPerLevel: 3 };
    case "plinko":
      return {
        ...config2,
        rows: 12,
        tables: {
          low: [10, 3, 1.6, 1.3, 1.1, 0.7, 0.5, 0.7, 1.1, 1.3, 1.6, 3, 10],
          medium: [33, 11, 4, 2, 1.2, 0.5, 0.2, 0.5, 1.2, 2, 4, 11, 33],
          high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170]
        }
      };
    default:
      return config2;
  }
}

// server/lib/active-round.ts
var INSTANT_GAMES = /* @__PURE__ */ new Set(["coinflip", "roulette", "plinko"]);
var PLAYING_TTL_MS = 365 * 24 * 60 * 60 * 1e3;
var SETTLED_TTL_MS = 24 * 60 * 60 * 1e3;
var SETTLED_BLOCK_MS = 5 * 60 * 1e3;
function expiryFor(status, from = Date.now()) {
  return new Date(from + (status === "playing" ? PLAYING_TTL_MS : SETTLED_TTL_MS)).toISOString();
}
function readRow(db2, userId) {
  const row = db2.prepare("SELECT * FROM active_rounds WHERE user_id = ?").get(userId);
  if (!row) return void 0;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    db2.prepare("DELETE FROM active_rounds WHERE user_id = ?").run(userId);
    return void 0;
  }
  return row;
}
function clearActiveRound(db2, userId) {
  db2.prepare("DELETE FROM active_rounds WHERE user_id = ?").run(userId);
}
function clearActiveRoundForSession(db2, userId, sessionId) {
  db2.prepare("DELETE FROM active_rounds WHERE user_id = ? AND session_id = ?").run(userId, sessionId);
}
function assertNoActiveRound(db2, userId) {
  const row = readRow(db2, userId);
  if (row) {
    if (row.status === "settled") {
      const settledAt = Date.parse(row.created_at);
      if (!Number.isFinite(settledAt) || Date.now() - settledAt <= SETTLED_BLOCK_MS) {
        throw conflict("Finish your current game first.", "ACTIVE_ROUND", {
          activeRound: { game: row.game_id, sessionId: row.session_id, status: row.status }
        });
      }
    } else {
      throw conflict("Finish your current game first.", "ACTIVE_ROUND", {
        activeRound: { game: row.game_id, sessionId: row.session_id, status: row.status }
      });
    }
  }
  const legacy = newestLegacySession(db2, userId);
  if (!legacy) return;
  throw conflict("Finish your current game first.", "ACTIVE_ROUND", {
    activeRound: { game: legacy.game_id, sessionId: legacy.id, status: "playing" }
  });
}
function newestLegacySession(db2, userId) {
  return db2.prepare(
    "SELECT id, game_id FROM game_sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
}
function adoptLegacyActiveRound(db2, userId) {
  const legacy = newestLegacySession(db2, userId);
  if (!legacy) return;
  const existing = db2.prepare("SELECT expires_at FROM active_rounds WHERE user_id = ?").get(userId);
  if (existing) {
    const expires = Date.parse(existing.expires_at);
    if (Number.isFinite(expires) && expires > Date.now()) return;
    db2.prepare("DELETE FROM active_rounds WHERE user_id = ?").run(userId);
  }
  db2.prepare(
    `INSERT INTO active_rounds (user_id, session_id, game_id, status, created_at, expires_at)
     VALUES (?, ?, ?, 'playing', ?, ?)
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, legacy.id, legacy.game_id, nowIso(), expiryFor("playing"));
}
function recordActiveRound(db2, userId, gameId, view) {
  if (!INSTANT_GAMES.has(gameId) && view.session.status !== "active") {
    clearActiveRound(db2, userId);
    return;
  }
  const status = view.session.status === "active" ? "playing" : "settled";
  db2.prepare(
    `INSERT INTO active_rounds (user_id, session_id, game_id, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       session_id = excluded.session_id,
       game_id = excluded.game_id,
       status = excluded.status,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`
  ).run(userId, view.session.id, gameId, status, nowIso(), expiryFor(status));
}
function settleActiveRound(db2, userId, sessionId) {
  clearActiveRoundForSession(db2, userId, sessionId);
}
function loadActiveRound(db2, userId) {
  let row = readRow(db2, userId);
  if (!row) {
    adoptLegacyActiveRound(db2, userId);
    row = readRow(db2, userId);
  }
  if (!row) return null;
  const session = getSessionRow(db2, row.session_id);
  if (!session || session.user_id !== userId) {
    clearActiveRound(db2, userId);
    return null;
  }
  const module = getGameModule(session.game_id);
  if (!module) {
    clearActiveRound(db2, userId);
    return null;
  }
  let status = session.status === "active" ? "playing" : "settled";
  if (status !== row.status) {
    db2.prepare("UPDATE active_rounds SET status = ?, expires_at = ? WHERE user_id = ?").run(
      status,
      expiryFor(status),
      userId
    );
  }
  return {
    game: session.game_id,
    status,
    view: module.resume(session, balanceOf(db2, userId), maxPayout(db2))
  };
}

// server/routes/games.ts
var requestIdSchema = z9.string().min(8, "Request id is too short.").max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid request id.");
var playSchema = z9.object({
  requestId: requestIdSchema,
  bet: amountSchema({ max: 1e12 })
});
var actionSchema2 = z9.object({
  requestId: requestIdSchema
});
function sessionSummary2(row) {
  return {
    id: row.id,
    game: row.game_id,
    bet: row.bet,
    payout: row.payout,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
}
function createGamesRouter(db2) {
  const router = Router5();
  router.get("/", (req, res) => {
    requireAuth(req);
    const rows = db2.prepare("SELECT * FROM games ORDER BY name").all();
    const games = rows.map((row) => {
      const parsed = parseGameConfig(row);
      return {
        slug: row.id,
        name: row.name,
        description: row.description,
        enabled: Boolean(row.enabled),
        minBet: row.min_bet,
        maxBet: row.max_bet,
        config: publicGameConfig(row.id, parsed),
        updatedAt: row.updated_at
      };
    });
    res.json({
      games,
      maxPayout: getSetting(db2, "economy.max_payout", 1e12),
      maintenance: isMaintenanceMode(db2),
      startingCredits: getSetting(db2, "economy.starting_credits", config.startingCredits)
    });
  });
  router.get("/active", (req, res) => {
    const user = requireAuth(req);
    res.json({ round: loadActiveRound(db2, user.id) });
  });
  router.get("/history", (req, res) => {
    const user = requireAuth(req);
    const { page, pageSize } = parse(pageQuerySchema, req.query);
    const total = db2.prepare("SELECT COUNT(*) AS count FROM game_sessions WHERE user_id = ?").get(user.id).count;
    const rows = db2.prepare("SELECT * FROM game_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(user.id, pageSize, (page - 1) * pageSize);
    res.json({
      items: rows.map(sessionSummary2),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      balance: balanceOf(db2, user.id)
    });
  });
  router.get("/sessions/:id", (req, res) => {
    const user = requireAuth(req);
    const row = getSessionRow(db2, req.params.id ?? "");
    if (!row || row.user_id !== user.id) throw notFound("Game session not found.");
    const module = getGameModule(row.game_id);
    if (!module) throw notFound("Game not available.");
    res.json(module.resume(row, balanceOf(db2, user.id), getSetting(db2, "economy.max_payout", 1e12)));
  });
  router.post("/:slug/play", async (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "games.play");
    assertNotInMaintenance(db2);
    const slug = req.params.slug ?? "";
    const module = getGameModule(slug);
    if (!module) throw notFound("Game not found.");
    const game = loadGame(db2, slug);
    if (!game.enabled) throw badRequest(`${game.name} is currently unavailable.`, "GAME_DISABLED");
    const parsed = parse(playSchema, req.body);
    assertWager(game, parsed.bet);
    if (capBelowWager(parsed.bet, getSetting(db2, "economy.max_payout", 1e12))) {
      throw badRequest("That wager is above the platform payout limit.", "WAGER_ABOVE_PAYOUT_CAP");
    }
    const replay = findReplay(db2, user.id, parsed.requestId);
    if (replay && replay.game_id !== slug) {
      throw badRequest("This request id was already used for another game.", "REQUEST_ID_REUSED");
    }
    const gameConfig = parseGameConfig(game);
    const view = (() => {
      try {
        return inTransaction(db2, () => {
          const existing = findReplay(db2, user.id, parsed.requestId);
          if (!existing) assertNoActiveRound(db2, user.id);
          const started = module.start({
            db: db2,
            user,
            game,
            gameConfig,
            bet: parsed.bet,
            requestId: parsed.requestId,
            body: req.body
          });
          if (!existing) recordActiveRound(db2, user.id, slug, started);
          return started;
        });
      } catch (error) {
        if (error instanceof ApiError && error.code === "ACTIVE_ROUND") adoptLegacyActiveRound(db2, user.id);
        throw error;
      }
    })();
    res.status(201).json(view);
  });
  router.post("/sessions/:id/action", async (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "games.play");
    assertNotInMaintenance(db2);
    const sessionId = req.params.id ?? "";
    const session = getSessionRow(db2, sessionId);
    if (!session || session.user_id !== user.id) throw notFound("Game session not found.");
    const module = getGameModule(session.game_id);
    if (!module?.action) throw badRequest("This game does not accept actions.", "NO_ACTIONS");
    const game = loadGame(db2, session.game_id);
    const parsed = parse(actionSchema2, req.body);
    const view = inTransaction(db2, () => {
      const result = module.action({
        db: db2,
        user,
        sessionId,
        game,
        gameConfig: parseGameConfig(game),
        body: req.body,
        requestId: parsed.requestId
      });
      if (result.session.status !== "active") settleActiveRound(db2, user.id, sessionId);
      return result;
    });
    res.json(view);
  });
  router.post("/sessions/:id/acknowledge", (req, res) => {
    const user = requireAuth(req);
    const session = getSessionRow(db2, req.params.id ?? "");
    if (!session || session.user_id !== user.id) throw notFound("Game session not found.");
    if (session.status === "active") {
      throw badRequest("Finish this round before clearing it.", "ROUND_ACTIVE");
    }
    clearActiveRoundForSession(db2, user.id, session.id);
    res.json({ ok: true });
  });
  return router;
}

// server/routes/tickets.ts
import { Router as Router6 } from "express";
import { z as z10 } from "zod";
var createSchema = z10.object({
  subject: z10.string().trim().min(4, "Use at least 4 characters.").max(140, "Keep the subject under 140 characters."),
  category: z10.string().trim().min(1, "Choose a category."),
  description: z10.string().trim().min(10, "Describe the issue in at least 10 characters.").max(8e3),
  priority: ticketPrioritySchema.optional()
});
var messageSchema = z10.object({
  body: z10.string().trim().min(1, "Write a message before sending.").max(5e3, "Messages are limited to 5,000 characters."),
  visibility: z10.enum(["public", "internal"]).optional()
});
var statusSchema = z10.object({
  status: z10.enum(["new", "open", "in_progress", "on_hold", "waiting_user", "resolved", "closed", "rejected"]),
  reason: z10.string().trim().max(500).optional()
});
var assignSchema = z10.object({ assigneeId: z10.string().min(1).nullable(), reason: z10.string().trim().max(500).optional() });
var prioritySchema = z10.object({ priority: ticketPrioritySchema });
var listQuerySchema = pageQuerySchema.extend({
  scope: z10.string().optional(),
  status: z10.string().optional(),
  category: z10.string().optional(),
  priority: z10.string().optional(),
  assigneeId: z10.string().optional(),
  requesterId: z10.string().optional(),
  q: z10.string().trim().max(140).optional(),
  own: z10.enum(["true", "false"]).optional(),
  sort: z10.enum(["activity", "created", "priority"]).optional(),
  direction: z10.enum(["asc", "desc"]).optional(),
  from: z10.string().optional(),
  to: z10.string().optional()
});
function loadTicketByReference(db2, reference) {
  const row = db2.prepare("SELECT * FROM tickets WHERE reference = ?").get(reference);
  if (!row) throw notFound("Ticket not found.");
  return row;
}
function notifyStaff(db2, input) {
  const staff = db2.prepare("SELECT id FROM users WHERE role <> 'user' AND status = 'active'").all();
  for (const member of staff) {
    if (member.id === input.excludeUserId) continue;
    notify(db2, {
      userId: member.id,
      type: "ticket",
      title: input.title,
      body: input.body,
      link: input.link,
      actorId: input.actorId
    });
  }
}
function ensureReason(reason, status) {
  if (["on_hold", "rejected"].includes(status) && (!reason || reason.trim().length < 3)) {
    throw badRequest(`A reason is required when moving a ticket to ${TICKET_STATUS_LABELS[status]}.`, "REASON_REQUIRED", {
      fields: { reason: "Provide a short reason." }
    });
  }
}
function applyStatusChange(db2, input) {
  const { ticket, actor, next } = input;
  if (ticket.status === next) return;
  if (next === "rejected" && !can(actor.role, "tickets.reject")) {
    throw forbidden("Your role cannot reject tickets.");
  }
  const now = nowIso();
  const reason = input.reason?.trim() || null;
  db2.prepare(
    `UPDATE tickets SET status = ?, hold_reason = ?, rejection_reason = ?, closed_at = ?, updated_at = ?, last_activity_at = ?
     WHERE id = ?`
  ).run(
    next,
    next === "on_hold" ? reason : null,
    next === "rejected" ? reason : ticket.rejection_reason,
    next === "closed" ? now : null,
    now,
    now,
    ticket.id
  );
  const eventType = next === "rejected" ? "rejected" : next === "on_hold" ? "hold" : ticket.status === "closed" ? "reopened" : "status";
  addTicketEvent(db2, {
    ticketId: ticket.id,
    actorId: actor.id,
    type: eventType,
    fromValue: ticket.status,
    toValue: next,
    note: reason
  });
  if (["on_hold", "rejected", "closed", "resolved", "waiting_user", "open"].includes(next)) {
    addTicketMessage(db2, {
      ticketId: ticket.id,
      authorId: null,
      authorRole: "system",
      visibility: "system",
      body: `Ticket moved to ${TICKET_STATUS_LABELS[next].toLowerCase()}` + (reason ? `. Reason: ${reason}` : ".")
    });
  }
  const requesterLink = `/tickets/${ticket.reference}`;
  notify(db2, {
    userId: ticket.user_id,
    type: "ticket_status",
    title: `Ticket ${ticket.reference} \u2014 ${TICKET_STATUS_LABELS[next]}`,
    body: reason ? `Your ticket is now ${TICKET_STATUS_LABELS[next].toLowerCase()}. Reason: ${reason}` : `Your ticket is now ${TICKET_STATUS_LABELS[next].toLowerCase()}.`,
    link: requesterLink,
    actorId: actor.id
  });
  recordAudit(db2, {
    actorId: actor.id,
    action: "ticket.status",
    targetType: "ticket",
    targetId: ticket.id,
    targetLabel: ticket.reference,
    reason,
    metadata: { from: ticket.status, to: next, source: input.source ?? "staff" },
    ip: input.ip ?? null
  });
}
function assertStaffEligible(db2, assigneeId) {
  const target = db2.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(assigneeId);
  if (!target) throw badRequest("Choose an existing staff member.", "INVALID_ASSIGNEE");
  if (target.role === "user") throw badRequest("Tickets can only be assigned to staff.", "INVALID_ASSIGNEE");
  if (target.status === "suspended") throw badRequest("That staff account is suspended.", "INVALID_ASSIGNEE");
  return target;
}
function createTicketsRouter(db2) {
  const router = Router6();
  router.get("/", (req, res) => {
    const user = requireAuth(req);
    const query = parse(listQuerySchema, req.query);
    const ownOnly = query.own === "true";
    const { items, total } = buildTicketList(db2, user, {
      ownOnly,
      scope: query.scope,
      status: query.status,
      category: query.category,
      priority: query.priority,
      assigneeId: query.assigneeId,
      requesterId: query.requesterId,
      search: query.q,
      sort: query.sort,
      direction: query.direction,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: ticketCounts(db2, user, { ownOnly })
    });
  });
  router.get("/categories", (req, res) => {
    requireAuth(req);
    res.json({ categories: loadSupportCategories(db2, true) });
  });
  router.post("/", (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "tickets.create");
    const limit = ticketCreateLimiter.consume(user.id);
    if (!limit.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "You have created several tickets recently. Please wait before opening another.");
    }
    const body = parse(createSchema, req.body);
    assertNotInMaintenance(db2);
    if (body.category === "credit_request") {
      throw badRequest(
        "Money requests are handled in the Cashier. Open a cashier request instead of a support ticket.",
        "USE_CASHIER",
        { fields: { category: "Use the Cashier for every money request." } }
      );
    }
    const categories = loadSupportCategories(db2, true);
    const category = categories.find((entry) => entry.key === body.category);
    if (!category) {
      throw badRequest("Choose an available ticket category.", "INVALID_CATEGORY", {
        fields: { category: "That category is not available." }
      });
    }
    const ticketId = newId("tkt");
    const reference = inTransaction(db2, () => {
      const ref = generateTicketReference(db2);
      const now = nowIso();
      db2.prepare(
        `INSERT INTO tickets (id, reference, user_id, subject, description, category, status, priority, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
      ).run(ticketId, ref, user.id, body.subject, body.description, category.key, body.priority ?? category.defaultPriority, now, now, now);
      addTicketEvent(db2, { ticketId, actorId: user.id, type: "created", toValue: "new" });
      notify(db2, {
        userId: user.id,
        type: "ticket",
        title: `Ticket ${ref} received`,
        body: "Your request is in the queue. You can follow its progress from My tickets.",
        link: `/tickets/${ref}`
      });
      notifyStaff(db2, {
        title: `New ticket ${ref}`,
        body: `${body.subject} \u2014 ${category.label}`,
        link: `/staff/tickets/${ref}`,
        actorId: user.id
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "ticket.create",
        targetType: "ticket",
        targetId: ticketId,
        targetLabel: ref,
        metadata: { category: category.key },
        ip: clientIp(req)
      });
      return ref;
    });
    res.status(201).json({ ticket: getTicketDetail(db2, user, reference) });
  });
  router.get("/:reference", (req, res) => {
    const user = requireAuth(req);
    const detail = getTicketDetail(db2, user, req.params.reference ?? "");
    markTicketRead(db2, detail.id, user.id);
    res.json({ ticket: detail });
  });
  router.post("/:reference/messages", (req, res) => {
    const user = requireAuth(req);
    const body = parse(messageSchema, req.body);
    const ticket = loadTicketByReference(db2, req.params.reference ?? "");
    assertCanViewTicket(user, ticket.user_id);
    const staff = isStaffRole(user.role);
    if (staff) requirePermission(req, "tickets.reply");
    if (body.visibility === "internal" && (!staff || !can(user.role, "tickets.note"))) {
      throw forbidden("Internal notes are restricted to staff.");
    }
    if (["closed", "rejected"].includes(ticket.status) && !staff) {
      throw badRequest("This ticket is closed. Open a new ticket if you need more help.", "TICKET_CLOSED");
    }
    if (["closed", "rejected"].includes(ticket.status) && staff) {
      throw badRequest("Reopen this ticket before replying.", "TICKET_CLOSED");
    }
    const internal = body.visibility === "internal";
    inTransaction(db2, () => {
      addTicketMessage(db2, {
        ticketId: ticket.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: internal ? "internal" : "public",
        body: body.body
      });
      touchTicket(db2, ticket.id);
      if (internal) {
        addTicketEvent(db2, { ticketId: ticket.id, actorId: user.id, type: "internal_note" });
        recordAudit(db2, {
          actorId: user.id,
          action: "ticket.internal_note",
          targetType: "ticket",
          targetId: ticket.id,
          targetLabel: ticket.reference,
          ip: clientIp(req)
        });
      } else if (staff) {
        const from = ticket.status;
        const next = from === "new" || from === "waiting_user" ? "in_progress" : from === "on_hold" ? "open" : null;
        if (next) {
          db2.prepare("UPDATE tickets SET status = ?, hold_reason = NULL WHERE id = ?").run(next, ticket.id);
          addTicketEvent(db2, {
            ticketId: ticket.id,
            actorId: user.id,
            type: "status",
            fromValue: from,
            toValue: next,
            note: "Staff replied"
          });
          notify(db2, {
            userId: ticket.user_id,
            type: "ticket_status",
            title: `Ticket ${ticket.reference} \u2014 ${TICKET_STATUS_LABELS[next]}`,
            body: "A support agent replied to your ticket.",
            link: `/tickets/${ticket.reference}`,
            actorId: user.id
          });
        } else {
          notify(db2, {
            userId: ticket.user_id,
            type: "ticket_reply",
            title: `New reply on ${ticket.reference}`,
            body: "Support replied to your ticket.",
            link: `/tickets/${ticket.reference}`,
            actorId: user.id
          });
        }
        recordAudit(db2, {
          actorId: user.id,
          action: "ticket.reply",
          targetType: "ticket",
          targetId: ticket.id,
          targetLabel: ticket.reference,
          ip: clientIp(req)
        });
      } else {
        if (ticket.status === "waiting_user" || ticket.status === "resolved") {
          const next = "open";
          db2.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?").run(next, nowIso(), ticket.id);
          addTicketEvent(db2, {
            ticketId: ticket.id,
            actorId: user.id,
            type: "status",
            fromValue: ticket.status,
            toValue: next,
            note: "Requester replied"
          });
        }
        if (ticket.assignee_id) {
          notify(db2, {
            userId: ticket.assignee_id,
            type: "ticket_reply",
            title: `New reply on ${ticket.reference}`,
            body: `${user.username}: ${body.body.slice(0, 120)}`,
            link: `/staff/tickets/${ticket.reference}`,
            actorId: user.id
          });
        } else {
          notifyStaff(db2, {
            title: `Requester replied on ${ticket.reference}`,
            body: `${user.username}: ${body.body.slice(0, 120)}`,
            link: `/staff/tickets/${ticket.reference}`,
            actorId: user.id,
            excludeUserId: user.id
          });
        }
      }
    });
    res.status(201).json({ ticket: getTicketDetail(db2, user, ticket.reference) });
  });
  router.post("/:reference/status", (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, "tickets.status");
    const body = parse(statusSchema, req.body);
    const ticket = loadTicketByReference(db2, req.params.reference ?? "");
    assertTransition(ticket.status, body.status, { reject: can(user.role, "tickets.reject") });
    ensureReason(body.reason, body.status);
    inTransaction(db2, () => {
      applyStatusChange(db2, { ticket, actor: user, next: body.status, reason: body.reason, ip: clientIp(req) });
    });
    res.json({ ticket: getTicketDetail(db2, user, ticket.reference) });
  });
  router.post("/:reference/priority", (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, "tickets.priority");
    const body = parse(prioritySchema, req.body);
    const ticket = loadTicketByReference(db2, req.params.reference ?? "");
    if (ticket.priority === body.priority) throw badRequest("Priority is unchanged.", "NO_CHANGE");
    inTransaction(db2, () => {
      db2.prepare("UPDATE tickets SET priority = ?, updated_at = ? WHERE id = ?").run(body.priority, nowIso(), ticket.id);
      addTicketEvent(db2, {
        ticketId: ticket.id,
        actorId: user.id,
        type: "priority",
        fromValue: ticket.priority,
        toValue: body.priority
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "ticket.priority",
        targetType: "ticket",
        targetId: ticket.id,
        targetLabel: ticket.reference,
        metadata: { from: ticket.priority, to: body.priority },
        ip: clientIp(req)
      });
    });
    res.json({ ticket: getTicketDetail(db2, user, ticket.reference) });
  });
  router.post("/:reference/assign", (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, "tickets.assign");
    const body = parse(assignSchema, req.body);
    const ticket = loadTicketByReference(db2, req.params.reference ?? "");
    const assignee = body.assigneeId ? assertStaffEligible(db2, body.assigneeId) : null;
    if (ticket.assignee_id === (assignee?.id ?? null)) {
      throw badRequest(assignee ? "That agent already owns this ticket." : "This ticket is already unassigned.", "NO_CHANGE");
    }
    inTransaction(db2, () => {
      db2.prepare("UPDATE tickets SET assignee_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ?").run(
        assignee?.id ?? null,
        nowIso(),
        nowIso(),
        ticket.id
      );
      addTicketEvent(db2, {
        ticketId: ticket.id,
        actorId: user.id,
        type: "assignment",
        fromValue: ticket.assignee_id,
        toValue: assignee?.id ?? null,
        note: assignee ? `Assigned to ${assignee.username}` : "Unassigned"
      });
      if (assignee) {
        notify(db2, {
          userId: assignee.id,
          type: "ticket_assignment",
          title: `Ticket ${ticket.reference} assigned to you`,
          body: ticket.subject,
          link: `/staff/tickets/${ticket.reference}`,
          actorId: user.id
        });
      }
      if (ticket.assignee_id && ticket.assignee_id !== assignee?.id) {
        notify(db2, {
          userId: ticket.assignee_id,
          type: "ticket_assignment",
          title: `Ticket ${ticket.reference} reassigned`,
          body: assignee ? `Now owned by ${assignee.username}.` : "The ticket is unassigned.",
          link: `/staff/tickets/${ticket.reference}`,
          actorId: user.id
        });
      }
      recordAudit(db2, {
        actorId: user.id,
        action: "ticket.assign",
        targetType: "ticket",
        targetId: ticket.id,
        targetLabel: ticket.reference,
        reason: body.reason ?? null,
        metadata: { from: ticket.assignee_id, to: assignee?.id ?? null },
        ip: clientIp(req)
      });
    });
    res.json({ ticket: getTicketDetail(db2, user, ticket.reference) });
  });
  router.post("/:reference/claim", (req, res) => {
    const user = requireAuth(req);
    requirePermission(req, "tickets.assign");
    if (user.role === "user") throw forbidden();
    const ticket = loadTicketByReference(db2, req.params.reference ?? "");
    const result = db2.prepare("UPDATE tickets SET assignee_id = ?, updated_at = ?, last_activity_at = ? WHERE id = ? AND assignee_id IS NULL").run(user.id, nowIso(), nowIso(), ticket.id);
    if (result.changes !== 1) {
      throw conflict("This ticket was already claimed by another agent.", "ALREADY_CLAIMED");
    }
    inTransaction(db2, () => {
      addTicketEvent(db2, {
        ticketId: ticket.id,
        actorId: user.id,
        type: "assignment",
        fromValue: null,
        toValue: user.id,
        note: `Claimed by ${user.username}`
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "ticket.claim",
        targetType: "ticket",
        targetId: ticket.id,
        targetLabel: ticket.reference,
        ip: clientIp(req)
      });
    });
    res.json({ ticket: getTicketDetail(db2, user, ticket.reference) });
  });
  return router;
}

// server/routes/cashier.ts
import { Router as Router7 } from "express";
import { z as z11 } from "zod";

// server/lib/cashier.ts
var LIST_SELECT2 = `
  SELECT r.*, u.username AS requester_name, u.email AS requester_email, w.balance AS requester_balance,
         rev.username AS reviewer_name,
         (SELECT COUNT(*) FROM cashier_messages m WHERE m.request_id = r.id) AS message_count
  FROM cashier_requests r
  JOIN users u ON u.id = r.user_id
  JOIN wallets w ON w.user_id = r.user_id
  LEFT JOIN users rev ON rev.id = r.reviewer_id
`;
function canManageCashier(user) {
  return can(user.role, "credits.adjust");
}
function generateCashierReference(db2, kind) {
  const year = (/* @__PURE__ */ new Date()).getUTCFullYear();
  const name = `cashier_${kind}_${year}`;
  const row = db2.prepare(
    `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1
       RETURNING value`
  ).get(name);
  const prefix = kind === "deposit" ? "DEP" : "WDR";
  return `${prefix}-${year}-${String(row.value).padStart(6, "0")}`;
}
function loadCashierRow(db2, reference) {
  return db2.prepare(`${LIST_SELECT2} WHERE r.reference = ?`).get(reference);
}
function mapSummary(row) {
  return {
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    requester: {
      id: row.user_id,
      username: row.requester_name ?? "Unknown",
      ...typeof row.requester_balance === "number" ? { balance: row.requester_balance } : {}
    },
    reviewer: row.reviewer_id ? { id: row.reviewer_id, username: row.reviewer_name ?? "Unknown" } : null,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    ledgerId: row.ledger_id,
    messageCount: row.message_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at
  };
}
function buildCashierList(db2, filters) {
  const params = {};
  const clauses = [];
  if (filters.requesterId) {
    params.requesterId = filters.requesterId;
    clauses.push("r.user_id = @requesterId");
  }
  if (filters.status && filters.status !== "all") {
    params.status = filters.status;
    clauses.push("r.status = @status");
  }
  if (filters.kind) {
    params.kind = filters.kind;
    clauses.push("r.kind = @kind");
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    clauses.push("(r.reference LIKE @search OR u.username LIKE @search)");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const order = filters.pendingFirst ? "CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.last_activity_at DESC" : "r.last_activity_at DESC";
  const total = db2.prepare(
    `SELECT COUNT(*) AS count FROM cashier_requests r JOIN users u ON u.id = r.user_id ${where}`
  ).get(params).count;
  const rows = db2.prepare(`${LIST_SELECT2} ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`).all({ ...params, limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize });
  return { items: rows.map(mapSummary), total };
}
function cashierCounts(db2, requesterId) {
  const where = requesterId ? "WHERE user_id = ?" : "";
  const params = requesterId ? [requesterId] : [];
  const row = db2.prepare(
    `SELECT
         COUNT(*) AS all_count,
         COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
         COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
         COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
         COALESCE(SUM(CASE WHEN kind = 'deposit' THEN 1 ELSE 0 END), 0) AS deposit_count,
         COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN 1 ELSE 0 END), 0) AS withdrawal_count
       FROM cashier_requests ${where}`
  ).get(...params);
  return {
    all: row.all_count ?? 0,
    pending: row.pending_count ?? 0,
    approved: row.approved_count ?? 0,
    rejected: row.rejected_count ?? 0,
    cancelled: row.cancelled_count ?? 0,
    deposits: row.deposit_count ?? 0,
    withdrawals: row.withdrawal_count ?? 0
  };
}
function getCashierDetail(db2, viewer, reference) {
  const row = db2.prepare(
    `SELECT r.*, u.username AS requester_name, u.email AS requester_email,
              u.status AS requester_status, u.created_at AS requester_created_at,
              w.balance AS requester_balance, rev.username AS reviewer_name,
              (SELECT COUNT(*) FROM cashier_messages m WHERE m.request_id = r.id) AS message_count
       FROM cashier_requests r
       JOIN users u ON u.id = r.user_id
       JOIN wallets w ON w.user_id = r.user_id
       LEFT JOIN users rev ON rev.id = r.reviewer_id
       WHERE r.reference = ?`
  ).get(reference);
  if (!row) throw notFound("Cashier request not found.");
  const canManage = canManageCashier(viewer);
  if (!canManage && row.user_id !== viewer.id) {
    throw forbidden("This cashier request belongs to another account.");
  }
  const messages = db2.prepare(
    `SELECT m.id, m.author_id, m.author_role, m.visibility, m.body, m.created_at,
                u.username AS author_name
         FROM cashier_messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.request_id = ? ORDER BY m.created_at ASC, m.rowid ASC`
  ).all(row.id).map((message) => ({
    id: message.id,
    authorId: message.author_id,
    authorName: message.author_role === "system" ? "Donutcash" : message.author_name ?? "Deleted user",
    authorRole: message.author_role ?? "system",
    visibility: message.visibility,
    body: message.body,
    createdAt: message.created_at
  }));
  const summary = mapSummary({ ...row, message_count: messages.length });
  return {
    ...summary,
    requester: {
      id: row.user_id,
      username: row.requester_name ?? "Unknown",
      ...canManage ? {
        email: row.requester_email,
        status: row.requester_status,
        createdAt: row.requester_created_at
      } : {},
      ...typeof row.requester_balance === "number" ? { balance: row.requester_balance } : {}
    },
    messages,
    canDecide: canManage && row.status === "pending",
    canCancel: row.user_id === viewer.id && row.status === "pending",
    canMessage: row.status !== "cancelled"
  };
}
function addCashierMessage(db2, input) {
  const id = newId("cmsg");
  const now = nowIso();
  db2.prepare(
    `INSERT INTO cashier_messages (id, request_id, author_id, author_role, visibility, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.requestId, input.authorId, input.authorRole, input.visibility, input.body, now);
  db2.prepare("UPDATE cashier_requests SET last_activity_at = ? WHERE id = ?").run(now, input.requestId);
  return id;
}
function notifyCashierAdmins(db2, input) {
  const admins = db2.prepare("SELECT id FROM users WHERE role IN ('admin','owner') AND status = 'active'").all();
  for (const admin of admins) {
    if (admin.id === input.excludeUserId) continue;
    notify(db2, {
      userId: admin.id,
      type: "cashier",
      title: input.title,
      body: input.body,
      link: input.link,
      actorId: input.actorId ?? null
    });
  }
}

// server/routes/cashier.ts
var createSchema2 = z11.object({
  kind: z11.enum(["deposit", "withdrawal"]),
  amount: amountSchema({ max: 1e12 })
});
var messageSchema2 = z11.object({
  body: z11.string().trim().min(1, "Write a message before sending.").max(2e3, "Messages are limited to 2,000 characters.")
});
var listQuerySchema2 = pageQuerySchema.extend({
  status: z11.enum(["all", "pending", "approved", "rejected", "cancelled"]).optional(),
  kind: z11.enum(["deposit", "withdrawal"]).optional(),
  q: z11.string().trim().max(120).optional()
});
var decisionSchema = z11.object({
  decision: z11.enum(["approve", "reject"]),
  reason: z11.string().trim().max(1e3).optional()
}).superRefine((value, ctx) => {
  if (value.decision === "reject" && (!value.reason || value.reason.length < 5)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Record a reason of at least 5 characters." });
  }
});
function requestLimit(db2) {
  return getSetting(db2, "economy.cashier_request_limit", 5e9);
}
function kindLabel(kind) {
  return kind === "deposit" ? "Deposit" : "Withdrawal";
}
function loadRequestOrThrow(db2, reference) {
  const row = loadCashierRow(db2, reference);
  if (!row) throw notFound("Cashier request not found.");
  return row;
}
function assertOwnRequest(user, row) {
  if (row.user_id !== user.id) throw notFound("Cashier request not found.");
}
function createCashierRouter(db2) {
  const router = Router7();
  router.get("/", (req, res) => {
    const user = requireActive(req);
    const query = parse(listQuerySchema2, req.query);
    const { items, total } = buildCashierList(db2, {
      requesterId: user.id,
      status: query.status,
      kind: query.kind,
      search: query.q,
      page: query.page,
      pageSize: query.pageSize
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: cashierCounts(db2, user.id),
      balance: balanceOf(db2, user.id),
      requestLimit: requestLimit(db2)
    });
  });
  router.post("/", (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "cashier.request");
    const limiter = cashierRequestLimiter.consume(user.id);
    if (!limiter.allowed) {
      throw new ApiError(429, "RATE_LIMITED", "You have opened several cashier requests recently. Please wait before submitting another.");
    }
    const body = parse(createSchema2, req.body);
    assertNotInMaintenance(db2);
    const limit = requestLimit(db2);
    if (body.amount > limit) {
      throw badRequest(`Cashier requests are limited to ${compactAmount(limit)} DonutSMP money.`, "REQUEST_TOO_LARGE", {
        fields: { amount: `Maximum is ${compactAmount(limit)}.` }
      });
    }
    if (body.kind === "withdrawal" && body.amount > balanceOf(db2, user.id)) {
      throw badRequest("You do not have enough DonutSMP money for that withdrawal.", "INSUFFICIENT_CREDITS", {
        fields: { amount: "Enter an amount within your available balance." }
      });
    }
    const requestId = newId("csr");
    const reference = inTransaction(db2, () => {
      const ref = generateCashierReference(db2, body.kind);
      const now = nowIso();
      db2.prepare(
        `INSERT INTO cashier_requests
           (id, reference, user_id, kind, amount, status, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      ).run(requestId, ref, user.id, body.kind, body.amount, now, now, now);
      addCashierMessage(db2, {
        requestId,
        authorId: null,
        authorRole: "system",
        visibility: "system",
        body: `${kindLabel(body.kind)} request created for ${compactAmount(body.amount)} DonutSMP money.`
      });
      notifyCashierAdmins(db2, {
        title: `New ${body.kind} request ${ref}`,
        body: `${user.username} requested ${compactAmount(body.amount)} DonutSMP money.`,
        link: `/admin/cashier/${ref}`,
        actorId: user.id
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "cashier.request",
        targetType: "cashier_request",
        targetId: requestId,
        targetLabel: ref,
        metadata: { kind: body.kind, amount: body.amount },
        ip: clientIp(req)
      });
      return ref;
    });
    res.status(201).json({ request: getCashierDetail(db2, user, reference) });
  });
  router.get("/:reference", (req, res) => {
    const user = requireActive(req);
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    assertOwnRequest(user, row);
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  router.post("/:reference/messages", (req, res) => {
    const user = requireActive(req);
    const body = parse(messageSchema2, req.body);
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    assertOwnRequest(user, row);
    if (row.status === "cancelled") {
      throw conflict("This cashier request was cancelled. Open a new request if you still need help.", "REQUEST_CANCELLED");
    }
    inTransaction(db2, () => {
      addCashierMessage(db2, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: "public",
        body: body.body
      });
      notifyCashierAdmins(db2, {
        title: `New message on ${row.reference}`,
        body: `${user.username} replied in the ${row.kind} request.`,
        link: `/admin/cashier/${row.reference}`,
        actorId: user.id,
        excludeUserId: user.id
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "cashier.message",
        targetType: "cashier_request",
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req)
      });
    });
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  router.post("/:reference/cancel", (req, res) => {
    const user = requireActive(req);
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    assertOwnRequest(user, row);
    if (row.status !== "pending") {
      throw conflict("Only pending requests can be cancelled.", "REQUEST_FINAL");
    }
    inTransaction(db2, () => {
      const now = nowIso();
      const updated = db2.prepare(
        `UPDATE cashier_requests SET status = 'cancelled', updated_at = ?, last_activity_at = ?
           WHERE id = ? AND status = 'pending'`
      ).run(now, now, row.id);
      if (updated.changes !== 1) {
        throw conflict("This cashier request has already been reviewed.", "ALREADY_DECIDED");
      }
      addCashierMessage(db2, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: "system",
        body: "Request cancelled by the requester."
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "cashier.cancel",
        targetType: "cashier_request",
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req)
      });
    });
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  return router;
}
function createAdminCashierRouter(db2) {
  const router = Router7();
  router.get("/", (req, res) => {
    const user = requirePermission(req, "credits.adjust");
    const query = parse(listQuerySchema2, req.query);
    const { items, total } = buildCashierList(db2, {
      status: query.status,
      kind: query.kind,
      search: query.q,
      pendingFirst: true,
      page: query.page,
      pageSize: query.pageSize
    });
    res.json({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      counts: cashierCounts(db2),
      reviewer: user.username
    });
  });
  router.get("/:reference", (req, res) => {
    const user = requirePermission(req, "credits.adjust");
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  router.post("/:reference/messages", (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "credits.adjust");
    const body = parse(messageSchema2, req.body);
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    if (row.status === "cancelled") {
      throw conflict("This cashier request was cancelled.", "REQUEST_CANCELLED");
    }
    inTransaction(db2, () => {
      addCashierMessage(db2, {
        requestId: row.id,
        authorId: user.id,
        authorRole: user.role,
        visibility: "public",
        body: body.body
      });
      notify(db2, {
        userId: row.user_id,
        type: "cashier",
        title: `New message on ${row.reference}`,
        body: `${user.username} replied to your ${row.kind} request.`,
        link: `/cashier/${row.reference}`,
        actorId: user.id
      });
      recordAudit(db2, {
        actorId: user.id,
        action: "cashier.message",
        targetType: "cashier_request",
        targetId: row.id,
        targetLabel: row.reference,
        ip: clientIp(req)
      });
    });
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  router.post("/:reference/decision", (req, res) => {
    const user = requireActive(req);
    requirePermission(req, "credits.adjust");
    if (!canManageCashier(user)) throw new ApiError(403, "FORBIDDEN", "Only administrators can decide cashier requests.");
    const body = parse(decisionSchema, req.body);
    const row = loadRequestOrThrow(db2, req.params.reference ?? "");
    if (row.status !== "pending") {
      throw conflict("This cashier request has already been reviewed.", "ALREADY_DECIDED");
    }
    if (body.decision === "approve" && row.kind === "withdrawal" && balanceOf(db2, row.user_id) < row.amount) {
      throw new ApiError(
        409,
        "INSUFFICIENT_CREDITS",
        "The requester no longer has enough DonutSMP money for this withdrawal. Reject the request or ask them to open a new one.",
        { balance: balanceOf(db2, row.user_id), required: row.amount }
      );
    }
    inTransaction(db2, () => {
      const now = nowIso();
      const nextStatus = body.decision === "approve" ? "approved" : "rejected";
      const claimed = db2.prepare(
        `UPDATE cashier_requests
           SET status = ?, reviewer_id = ?, decision_reason = ?, decided_at = ?, updated_at = ?, last_activity_at = ?
           WHERE id = ? AND status = 'pending'`
      ).run(nextStatus, user.id, body.reason ?? null, now, now, now, row.id);
      if (claimed.changes !== 1) {
        throw conflict("This cashier request has already been reviewed.", "ALREADY_DECIDED");
      }
      let ledgerId2 = null;
      if (body.decision === "approve") {
        const amount = row.kind === "deposit" ? row.amount : -row.amount;
        const entry = applyLedger(db2, {
          userId: row.user_id,
          amount,
          type: row.kind === "deposit" ? "credit_request" : "admin_adjustment",
          actorId: user.id,
          reason: `Cashier ${row.kind} ${row.reference}${body.reason ? `: ${body.reason}` : ""}`,
          refType: "cashier_request",
          refId: row.id,
          idempotencyKey: `cashier:${row.id}`,
          metadata: { requestId: row.id, kind: row.kind, reference: row.reference }
        });
        ledgerId2 = entry.id;
        db2.prepare("UPDATE cashier_requests SET ledger_id = ? WHERE id = ?").run(ledgerId2, row.id);
        addCashierMessage(db2, {
          requestId: row.id,
          authorId: user.id,
          authorRole: user.role,
          visibility: "system",
          body: `${kindLabel(row.kind)} approved by ${user.username}. ${compactAmount(row.amount)} DonutSMP money ${row.kind === "deposit" ? "added to" : "removed from"} the wallet.`
        });
      } else {
        addCashierMessage(db2, {
          requestId: row.id,
          authorId: user.id,
          authorRole: user.role,
          visibility: "system",
          body: `Request rejected by ${user.username}.${body.reason ? ` Reason: ${body.reason}` : ""}`
        });
      }
      notify(db2, {
        userId: row.user_id,
        type: "cashier",
        title: body.decision === "approve" ? `${kindLabel(row.kind)} ${row.reference} approved` : `${kindLabel(row.kind)} ${row.reference} rejected`,
        body: body.decision === "approve" ? `${compactAmount(row.amount)} DonutSMP money ${row.kind === "deposit" ? "was added to" : "was removed from"} your wallet.` : `Your request was not approved.${body.reason ? ` Reason: ${body.reason}` : ""}`,
        link: `/cashier/${row.reference}`,
        actorId: user.id
      });
      if (row.requester_email) {
        enqueueEmail(db2, {
          userId: row.user_id,
          recipient: row.requester_email,
          template: "cashier-decision",
          payload: {
            username: row.requester_name ?? "there",
            kind: row.kind,
            status: body.decision === "approve" ? "approved" : "rejected",
            reference: row.reference,
            amount: row.amount,
            reason: body.reason ?? ""
          },
          dedupeKey: `cashier-decision:${row.id}`
        });
      }
      recordAudit(db2, {
        actorId: user.id,
        action: body.decision === "approve" ? "cashier.approve" : "cashier.reject",
        targetType: "cashier_request",
        targetId: row.id,
        targetLabel: row.reference,
        reason: body.reason ?? null,
        metadata: { kind: row.kind, amount: row.amount, targetUserId: row.user_id, ledgerId: ledgerId2 },
        ip: clientIp(req)
      });
    });
    res.json({ request: getCashierDetail(db2, user, row.reference) });
  });
  return router;
}

// server/routes/staff.ts
import { Router as Router8 } from "express";
function staffWorkload(db2) {
  const rows = db2.prepare(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.last_seen_at, u.created_at,
              (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id AND t.status NOT IN ('closed','rejected')) AS assigned_open,
              (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id) AS assigned_total
       FROM users u
       WHERE u.role <> 'user'
       ORDER BY assigned_open DESC, u.username ASC`
  ).all();
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    assignedOpen: row.assigned_open,
    assignedTotal: row.assigned_total,
    lastActivityAt: row.last_seen_at,
    createdAt: row.created_at
  }));
}
function createStaffRouter(db2) {
  const router = Router8();
  router.get("/overview", (req, res) => {
    const user = requirePermission(req, "staff.access");
    const counts = ticketCounts(db2, user);
    const assigned = buildTicketList(db2, user, { scope: "mine", page: 1, pageSize: 8, sort: "activity" }).items;
    const unassigned = buildTicketList(db2, user, { scope: "unassigned", page: 1, pageSize: 5, sort: "activity" }).items;
    const recentEvents = db2.prepare(
      `SELECT e.id, e.type, e.from_value, e.to_value, e.note, e.created_at,
                t.reference AS ticket_reference, t.subject AS ticket_subject
         FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
         WHERE e.actor_id = ? ORDER BY e.created_at DESC LIMIT 12`
    ).all(user.id);
    const handled = db2.prepare(
      `SELECT COUNT(*) AS count FROM tickets
         WHERE assignee_id = ? AND status IN ('resolved','closed') AND last_activity_at >= ?`
    ).get(user.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString());
    res.json({
      counts,
      assignedTickets: assigned,
      unassignedTickets: unassigned,
      recentEvents: recentEvents.map((row) => ({
        id: row.id,
        type: row.type,
        from: row.from_value,
        to: row.to_value,
        note: row.note,
        createdAt: row.created_at,
        ticketReference: row.ticket_reference,
        ticketSubject: row.ticket_subject
      })),
      resolvedLast7Days: handled.count,
      workload: staffWorkload(db2)
    });
  });
  router.get("/team", (req, res) => {
    const user = requireAuth(req);
    if (!can(user.role, "users.read") && !can(user.role, "tickets.assign")) {
      throw forbidden("You cannot view the staff roster.");
    }
    res.json({ staff: staffWorkload(db2) });
  });
  router.get("/activity", (req, res) => {
    const user = requirePermission(req, "staff.access");
    const rows = db2.prepare(
      `SELECT e.id, e.type, e.from_value, e.to_value, e.note, e.created_at,
                t.reference AS ticket_reference, t.subject AS ticket_subject
         FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
         WHERE e.actor_id = ? ORDER BY e.created_at DESC LIMIT 100`
    ).all(user.id);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        from: row.from_value,
        to: row.to_value,
        note: row.note,
        createdAt: row.created_at,
        ticketReference: row.ticket_reference,
        ticketSubject: row.ticket_subject
      }))
    });
  });
  return router;
}

// server/routes/admin.ts
import { Router as Router9 } from "express";
import { randomBytes as randomBytes4 } from "node:crypto";
import { z as z12 } from "zod";
var roleSchema = z12.enum(["user", "support", "moderator", "admin", "owner"]);
var usersQuerySchema = pageQuerySchema.extend({
  q: z12.string().trim().max(120).optional(),
  role: z12.string().optional(),
  status: z12.string().optional(),
  sort: z12.enum(["created", "balance", "activity", "username"]).optional()
});
var statusSchema2 = z12.object({
  status: z12.enum(["active", "restricted", "suspended"]),
  reason: z12.string().trim().max(500).optional()
});
var roleChangeSchema = z12.object({
  role: roleSchema,
  reason: z12.string().trim().max(500).optional()
});
var wipeSchema = z12.object({
  confirmUsername: z12.string().trim().min(1, "Type the username to confirm.").max(40),
  reason: z12.string().trim().max(500).optional()
});
var adjustSchema = z12.object({
  amount: amountSchema({ allowNegative: true, maxAbs: 1e12, label: "adjustment" }),
  reason: z12.string().trim().min(5, "Record a reason of at least 5 characters.").max(500),
  requestId: z12.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/)
});
var staffSchema = z12.object({
  username: usernameSchema,
  email: emailSchema,
  role: z12.enum(["support", "moderator", "admin"]),
  reason: z12.string().trim().max(300).optional()
});
var transactionsQuerySchema = pageQuerySchema.extend({
  type: z12.string().optional(),
  userId: z12.string().optional(),
  q: z12.string().trim().max(120).optional(),
  from: z12.string().optional(),
  to: z12.string().optional()
});
function daysSeries(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(Date.now() - i * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10));
  }
  return out;
}
function assertCanModerate(actor, target) {
  if (target.id === actor.id) throw forbidden("You cannot change your own access.", "SELF_MODERATION");
  if (target.role === "owner" && actor.role !== "owner") {
    throw forbidden("Only an owner can modify another owner.", "OWNER_PROTECTED");
  }
  if (actor.role !== "owner" && ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) {
    throw forbidden("You can only manage accounts with a lower role.", "ROLE_RANK");
  }
}
function lastActiveOwner(db2, userId) {
  const count = db2.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND status = 'active'").get().count;
  const target = db2.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  return count <= 1 && target?.role === "owner";
}
function createAdminRouter(db2) {
  const router = Router9();
  router.get("/overview", (req, res) => {
    requirePermission(req, "admin.access");
    const daysRaw = Number(req.query.days ?? 14);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.floor(daysRaw))) : 14;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1e3).toISOString();
    const users = db2.prepare(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN status = 'restricted' THEN 1 ELSE 0 END) AS restricted,
          SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_users
         FROM users`
    ).get(since);
    const tickets = db2.prepare(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
          SUM(CASE WHEN status IN ('new','open','in_progress') THEN 1 ELSE 0 END) AS open_count,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
          SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold,
          SUM(CASE WHEN status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_user,
          SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN assignee_id IS NULL AND status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned
         FROM tickets`
    ).get();
    const economy = db2.prepare(
      `SELECT
          (SELECT COALESCE(SUM(balance),0) FROM wallets) AS circulating,
          COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END),0) AS wagered,
          COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END),0) AS payouts,
          COALESCE(SUM(CASE WHEN type = 'credit_request' THEN amount ELSE 0 END),0) AS credit_granted,
          COALESCE(SUM(CASE WHEN type = 'admin_adjustment' THEN amount ELSE 0 END),0) AS adjusted,
          COALESCE(SUM(CASE WHEN type = 'initial_grant' THEN amount ELSE 0 END),0) AS initial_grants
         FROM ledger`
    ).get();
    const pendingCashier = db2.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM cashier_requests WHERE status = 'pending'`
    ).get();
    const gamesAgg = db2.prepare(
      `SELECT COUNT(*) AS total_sessions,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent_sessions,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_sessions
         FROM game_sessions`
    ).get(since);
    const registrationRows = db2.prepare("SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day").all(since);
    const volumeRows = db2.prepare(
      `SELECT substr(created_at,1,10) AS day,
                COALESCE(SUM(CASE WHEN type = 'game_wager' THEN -amount ELSE 0 END),0) AS wagers,
                COALESCE(SUM(CASE WHEN type = 'game_payout' THEN amount ELSE 0 END),0) AS payouts
         FROM ledger WHERE created_at >= ? AND type IN ('game_wager','game_payout') GROUP BY day`
    ).all(since);
    const regMap = new Map(registrationRows.map((row) => [row.day, row.count]));
    const volMap = new Map(volumeRows.map((row) => [row.day, row]));
    const byGame = db2.prepare(
      `SELECT g.id, g.name, g.enabled,
                COUNT(gs.id) AS sessions,
                COALESCE(SUM(gs.bet),0) AS wagers,
                COALESCE(SUM(gs.payout),0) AS payouts
         FROM games g LEFT JOIN game_sessions gs ON gs.game_id = g.id AND gs.created_at >= ?
         GROUP BY g.id ORDER BY sessions DESC`
    ).all(since);
    const recentAudit = db2.prepare(
      `SELECT a.id, a.action, a.target_type, a.target_label, a.reason, a.created_at, u.username AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 8`
    ).all();
    const pendingCashierRequests = db2.prepare(
      `SELECT r.id, r.reference, r.amount, r.kind, r.created_at, u.username
         FROM cashier_requests r JOIN users u ON u.id = r.user_id
         WHERE r.status = 'pending' ORDER BY r.created_at ASC LIMIT 5`
    ).all();
    const unassignedTickets = db2.prepare(
      `SELECT t.reference, t.subject, t.priority, t.status, t.created_at, c.label AS category
         FROM tickets t JOIN support_categories c ON c.key = t.category
         WHERE t.assignee_id IS NULL AND t.status NOT IN ('closed','rejected')
         ORDER BY CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,
                  t.created_at ASC LIMIT 5`
    ).all();
    const reconcile = reconcileWallets(db2);
    res.json({
      rangeDays: days,
      generatedAt: nowIso(),
      users: {
        total: users.total ?? 0,
        active: users.active ?? 0,
        restricted: users.restricted ?? 0,
        suspended: users.suspended ?? 0,
        new: users.new_users ?? 0
      },
      tickets: {
        total: tickets.total ?? 0,
        new: tickets.new_count ?? 0,
        open: tickets.open_count ?? 0,
        inProgress: tickets.in_progress ?? 0,
        onHold: tickets.on_hold ?? 0,
        waitingUser: tickets.waiting_user ?? 0,
        resolved: tickets.resolved ?? 0,
        closed: tickets.closed ?? 0,
        rejected: tickets.rejected ?? 0,
        unassigned: tickets.unassigned ?? 0,
        pendingCashier: pendingCashier.count
      },
      economy: {
        circulating: economy.circulating ?? 0,
        lifetimeWagered: economy.wagered ?? 0,
        lifetimePayouts: economy.payouts ?? 0,
        gameNet: (economy.wagered ?? 0) - (economy.payouts ?? 0),
        creditGranted: economy.credit_granted ?? 0,
        adminAdjusted: economy.adjusted ?? 0,
        initialGrants: economy.initial_grants ?? 0,
        pendingCashierAmount: pendingCashier.amount,
        mismatchedWallets: reconcile.length
      },
      games: {
        totalSessions: gamesAgg.total_sessions ?? 0,
        recentSessions: gamesAgg.recent_sessions ?? 0,
        activeSessions: gamesAgg.active_sessions ?? 0,
        byGame
      },
      series: daysSeries(days).map((day) => ({
        date: day,
        registrations: regMap.get(day) ?? 0,
        wagers: volMap.get(day)?.wagers ?? 0,
        payouts: volMap.get(day)?.payouts ?? 0
      })),
      recentAudit,
      pendingCashierRequests,
      unassignedTickets
    });
  });
  router.get("/users", (req, res) => {
    requirePermission(req, "users.read");
    const query = parse(usersQuerySchema, req.query);
    const clauses = [];
    const params = [];
    if (query.q) {
      clauses.push("(u.username LIKE ? OR u.email LIKE ? OR u.id LIKE ?)");
      const term = `%${query.q}%`;
      params.push(term, term, term);
    }
    if (query.role) {
      clauses.push("u.role = ?");
      params.push(query.role);
    }
    if (query.status) {
      clauses.push("u.status = ?");
      params.push(query.status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sort = query.sort === "balance" ? "w.balance DESC" : query.sort === "activity" ? "u.last_seen_at DESC" : query.sort === "username" ? "u.username ASC" : "u.created_at DESC";
    const total = db2.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params).count;
    const rows = db2.prepare(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.created_at, u.last_login_at, u.last_seen_at,
                w.balance,
                (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id AND t.status NOT IN ('closed','rejected')) AS open_tickets
         FROM users u JOIN wallets w ON w.user_id = u.id
         ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`
    ).all(...params, query.pageSize, (query.page - 1) * query.pageSize);
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        role: row.role,
        status: row.status,
        balance: row.balance,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        lastSeenAt: row.last_seen_at,
        openTickets: row.open_tickets
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize))
    });
  });
  router.get("/users/:id", (req, res) => {
    const admin = requirePermission(req, "users.read");
    const userId = req.params.id ?? "";
    const user = db2.prepare(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.email_verified, u.created_at, u.updated_at,
                u.last_login_at, u.last_seen_at, u.restriction_reason, w.balance
         FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?`
    ).get(userId);
    if (!user) throw notFound("User not found.");
    const ledgerRows = db2.prepare(
      `SELECT l.*, u.username AS username, a.username AS actor_name
         FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
         WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 12`
    ).all(userId);
    const tickets = buildTicketList(db2, admin, {
      requesterId: userId,
      page: 1,
      pageSize: 10,
      sort: "activity"
    });
    const gameSessions = db2.prepare(
      `SELECT id, game_id, bet, payout, status, created_at FROM game_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`
    ).all(userId);
    const stats = db2.prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(bet),0) AS wagered, COALESCE(SUM(payout),0) AS won
         FROM game_sessions WHERE user_id = ?`
    ).get(userId);
    const creditRequests = db2.prepare(
      `SELECT cr.id, cr.amount, cr.kind, cr.status, cr.created_at, cr.decided_at, t.reference,
                rev.username AS reviewer
         FROM credit_requests cr JOIN tickets t ON t.id = cr.ticket_id
         LEFT JOIN users rev ON rev.id = cr.reviewer_id
         WHERE cr.user_id = ? ORDER BY cr.created_at DESC LIMIT 10`
    ).all(userId);
    const audit = db2.prepare(
      `SELECT a.id, a.action, a.target_label, a.reason, a.created_at, u.username AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.target_id = ? OR a.actor_id = ? ORDER BY a.created_at DESC LIMIT 15`
    ).all(userId, userId);
    const activeSessions = db2.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").get(userId, nowIso()).count;
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: Boolean(user.email_verified),
        balance: user.balance,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        lastLoginAt: user.last_login_at,
        lastSeenAt: user.last_seen_at,
        restrictionReason: user.restriction_reason
      },
      stats: { sessions: stats.sessions, wagered: stats.wagered, won: stats.won },
      ledger: ledgerRows.map((row) => mapLedgerRow(row, row.username, row.actor_name)),
      tickets: tickets.items,
      gameSessions: gameSessions.map((row) => ({
        id: row.id,
        game: row.game_id,
        bet: row.bet,
        payout: row.payout,
        status: row.status,
        createdAt: row.created_at
      })),
      creditRequests,
      audit,
      activeSessions
    });
  });
  router.patch("/users/:id/status", (req, res) => {
    const admin = requirePermission(req, "users.restrict");
    const userId = req.params.id ?? "";
    const body = parse(statusSchema2, req.body);
    const target = db2.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(userId);
    if (!target) throw notFound("User not found.");
    assertCanModerate(admin, target);
    if (body.status !== "active" && (!body.reason || body.reason.trim().length < 5)) {
      throw badRequest("Provide a reason of at least 5 characters.", "REASON_REQUIRED", {
        fields: { reason: "Explain the restriction." }
      });
    }
    if (body.status !== "active" && lastActiveOwner(db2, userId)) {
      throw forbidden("The last active owner cannot be restricted.", "LAST_OWNER");
    }
    if (target.status === body.status) throw badRequest("Account status is unchanged.", "NO_CHANGE");
    const now = nowIso();
    db2.prepare("UPDATE users SET status = ?, restriction_reason = ?, updated_at = ? WHERE id = ?").run(
      body.status,
      body.status === "active" ? null : body.reason ?? null,
      now,
      userId
    );
    if (body.status === "suspended") revokeAllSessions(db2, userId);
    notify(db2, {
      userId,
      type: "account_status",
      title: `Account ${body.status}`,
      body: body.status === "active" ? "Your account access has been restored." : `Your account is now ${body.status}. Reason: ${body.reason ?? "Contact support for details."}`,
      link: "/settings",
      actorId: admin.id
    });
    recordAudit(db2, {
      actorId: admin.id,
      action: "user.status",
      targetType: "user",
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason ?? null,
      metadata: { from: target.status, to: body.status },
      ip: clientIp(req)
    });
    res.json({ user: loadUser(db2, userId) });
  });
  router.patch("/users/:id/role", (req, res) => {
    const admin = requirePermission(req, "roles.manage");
    const userId = req.params.id ?? "";
    const body = parse(roleChangeSchema, req.body);
    const target = db2.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(userId);
    if (!target) throw notFound("User not found.");
    if (target.id === admin.id) throw forbidden("You cannot change your own role.", "SELF_MODERATION");
    if (target.role === body.role) throw badRequest("Role is unchanged.", "NO_CHANGE");
    if (body.role === "owner" && admin.role !== "owner") {
      throw forbidden("Only an owner can assign the owner role.", "ROLE_RANK");
    }
    if (admin.role !== "owner" && ROLE_RANK[target.role] >= ROLE_RANK[admin.role]) {
      throw forbidden("You can only manage accounts with a lower role.", "ROLE_RANK");
    }
    if (admin.role !== "owner" && ROLE_RANK[body.role] >= ROLE_RANK[admin.role]) {
      throw forbidden("You cannot promote an account to your own role or higher.", "ROLE_RANK");
    }
    if (target.role === "owner" && body.role !== "owner" && lastActiveOwner(db2, userId)) {
      throw forbidden("The last active owner cannot be demoted.", "LAST_OWNER");
    }
    db2.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(body.role, nowIso(), userId);
    notify(db2, {
      userId,
      type: "account_role",
      title: "Your role changed",
      body: `Your account role is now ${body.role}.`,
      link: "/settings",
      actorId: admin.id
    });
    recordAudit(db2, {
      actorId: admin.id,
      action: "user.role",
      targetType: "user",
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason ?? null,
      metadata: { from: target.role, to: body.role },
      ip: clientIp(req)
    });
    res.json({ user: loadUser(db2, userId) });
  });
  router.post("/users/:id/wipe", (req, res) => {
    const admin = requirePermission(req, "users.manage");
    const userId = req.params.id ?? "";
    const body = parse(wipeSchema, req.body);
    const target = db2.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(userId);
    if (!target) throw notFound("User not found.");
    if (target.id === admin.id) throw forbidden("You cannot wipe your own account.", "SELF_MODERATION");
    assertCanModerate(admin, target);
    if (target.username.toLowerCase() !== body.confirmUsername.trim().toLowerCase()) {
      throw badRequest("Type the exact username to confirm this wipe.", "CONFIRMATION_MISMATCH", {
        fields: { confirmUsername: "Does not match the username." }
      });
    }
    const summary = inTransaction(db2, () => {
      const balanceBefore = balanceOf(db2, userId);
      const aborted = db2.prepare(
        `UPDATE game_sessions
              SET status = 'lost', payout = 0, ended_at = ?, outcome = COALESCE(outcome, ?)
            WHERE user_id = ? AND status = 'active'`
      ).run(nowIso(), JSON.stringify({ aborted: "account wiped" }), userId).changes;
      db2.prepare("DELETE FROM active_rounds WHERE user_id = ?").run(userId);
      const claimsRemoved = db2.prepare("DELETE FROM reward_claims WHERE user_id = ?").run(userId).changes;
      if (balanceBefore > 0) {
        applyLedger(db2, {
          userId,
          amount: -balanceBefore,
          type: "admin_adjustment",
          actorId: admin.id,
          reason: "Account progression wiped",
          refType: "user",
          refId: userId,
          idempotencyKey: `wipe:${userId}:${randomBytes4(8).toString("hex")}`,
          metadata: { action: "user.wipe", admin: admin.username }
        });
      }
      const balanceAfter = balanceOf(db2, userId);
      if (balanceAfter !== 0) {
        throw conflict("The balance could not be reset. Nothing was changed.", "WIPE_INCOMPLETE");
      }
      recordAudit(db2, {
        actorId: admin.id,
        action: "user.wipe",
        targetType: "user",
        targetId: userId,
        targetLabel: target.username,
        reason: body.reason ?? null,
        metadata: { balanceBefore, balanceAfter, abortedRounds: aborted, rewardClaimsRemoved: claimsRemoved },
        ip: clientIp(req)
      });
      return { balanceBefore, abortedRounds: aborted, rewardClaimsRemoved: claimsRemoved };
    });
    notify(db2, {
      userId,
      type: "account_wipe",
      title: "Your progression was reset",
      body: "An administrator reset your balance and reward streak. Your account is still active.",
      link: "/rewards",
      actorId: admin.id
    });
    res.json({ ok: true, balance: balanceOf(db2, userId), ...summary, user: loadUser(db2, userId) });
  });
  router.post("/users/:id/adjust", (req, res) => {
    const admin = requirePermission(req, "credits.adjust");
    const userId = req.params.id ?? "";
    const body = parse(adjustSchema, req.body);
    if (userId === admin.id) throw forbidden("Administrators cannot adjust their own balance.", "SELF_ADJUSTMENT");
    const target = db2.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(userId);
    if (!target) throw notFound("User not found.");
    if (target.role === "owner" && admin.role !== "owner") {
      throw forbidden("Only an owner can adjust another owner.", "OWNER_PROTECTED");
    }
    const idempotencyKey = `admin-adjust:${body.requestId}`;
    const existing = db2.prepare("SELECT * FROM ledger WHERE idempotency_key = ?").get(idempotencyKey);
    if (existing) {
      if (existing.user_id !== userId) throw conflict("This request id belongs to another adjustment.", "IDEMPOTENCY_CONFLICT");
      res.json({ balance: balanceOf(db2, userId), transaction: existing, duplicate: true });
      return;
    }
    const entry = inTransaction(
      db2,
      () => applyLedger(db2, {
        userId,
        amount: body.amount,
        type: "admin_adjustment",
        actorId: admin.id,
        reason: body.reason,
        refType: "admin_action",
        refId: body.requestId,
        idempotencyKey,
        metadata: { requestId: body.requestId }
      })
    );
    notify(db2, {
      userId,
      type: "wallet_adjustment",
      title: `${body.amount > 0 ? "Money added" : "Money removed"}`,
      body: `${body.amount > 0 ? "+" : ""}${compactAmount(body.amount)} DonutSMP money. Reason: ${body.reason}. Transaction ${entry.id}.`,
      link: "/wallet",
      actorId: admin.id
    });
    recordAudit(db2, {
      actorId: admin.id,
      action: "credits.admin_adjustment",
      targetType: "user",
      targetId: userId,
      targetLabel: target.username,
      reason: body.reason,
      metadata: { amount: body.amount, ledgerId: entry.id, balanceAfter: entry.balance_after },
      ip: clientIp(req)
    });
    res.json({ balance: entry.balance_after, transaction: entry, duplicate: false });
  });
  router.get("/transactions", (req, res) => {
    requirePermission(req, "economy.read");
    const query = parse(transactionsQuerySchema, req.query);
    const clauses = [];
    const params = [];
    if (query.type) {
      clauses.push("l.type = ?");
      params.push(query.type);
    }
    if (query.userId) {
      clauses.push("l.user_id = ?");
      params.push(query.userId);
    }
    if (query.q) {
      clauses.push("(u.username LIKE ? OR l.id LIKE ? OR l.ref_id LIKE ?)");
      const term = `%${query.q}%`;
      params.push(term, term, term);
    }
    if (query.from) {
      clauses.push("l.created_at >= ?");
      params.push(query.from);
    }
    if (query.to) {
      clauses.push("l.created_at <= ?");
      params.push(query.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const base = `FROM ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id ${where}`;
    const total = db2.prepare(`SELECT COUNT(*) AS count ${base}`).get(...params).count;
    const totals = db2.prepare(
      `SELECT COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END),0) AS inflow,
                COALESCE(SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END),0) AS outflow
         ${base}`
    ).get(...params);
    const rows = db2.prepare(
      `SELECT l.*, u.username AS username, a.username AS actor_name ${base}
         ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, query.pageSize, (query.page - 1) * query.pageSize);
    res.json({
      items: rows.map((row) => mapLedgerRow(row, row.username, row.actor_name)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.inflow - totals.outflow }
    });
  });
  router.get("/economy", (req, res) => {
    requirePermission(req, "economy.read");
    const byType = db2.prepare(
      `SELECT type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM ledger GROUP BY type ORDER BY type`
    ).all();
    const recentAdjustments = db2.prepare(
      `SELECT l.id, l.amount, l.reason, l.created_at, l.balance_after, t.username AS target, a.username AS actor
         FROM ledger l JOIN users t ON t.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
         WHERE l.type = 'admin_adjustment' ORDER BY l.created_at DESC LIMIT 12`
    ).all();
    res.json({
      circulation: balanceOfAll(db2),
      byType,
      reconcile: reconcileWallets(db2),
      recentAdjustments: recentAdjustments.map((row) => ({
        id: row.id,
        amount: row.amount,
        reason: row.reason,
        createdAt: row.created_at,
        balanceAfter: row.balance_after,
        target: row.target,
        actor: row.actor
      }))
    });
  });
  router.get("/diagnostics/request", (req, res) => {
    requirePermission(req, "settings.manage");
    res.json({
      socketAddress: req.socket.remoteAddress ?? null,
      resolvedClientIp: clientIp(req),
      forwardedFor: req.get("x-forwarded-for") ?? null,
      forwardedProto: req.get("x-forwarded-proto") ?? null,
      forwardedHost: req.get("x-forwarded-host") ?? null,
      trustProxyHeaders: config.trustProxyHeaders,
      trustedProxies: config.trustedProxies,
      secureRequest: req.secure,
      cookieSecure: config.cookieSecure,
      guidance: config.trustProxyHeaders ? "Forwarded headers are trusted from the configured proxies. Confirm the proxy overwrites client-supplied values." : "Forwarded headers are ignored. Set TRUST_PROXY_HEADERS=true only after the proxy is configured to replace them."
    });
  });
  router.get("/staff", (req, res) => {
    requirePermission(req, "staff.manage");
    const staff = staffWorkload(db2).map((member) => {
      const resolved = db2.prepare(
        `SELECT COUNT(*) AS count FROM tickets WHERE assignee_id = ? AND status IN ('resolved','closed')
             AND last_activity_at >= ?`
      ).get(member.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString()).count;
      const handled = db2.prepare(
        `SELECT COUNT(*) AS count FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
             WHERE e.actor_id = ? AND e.created_at >= ?`
      ).get(member.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString()).count;
      return { ...member, resolvedLast7Days: resolved, actionsLast7Days: handled };
    });
    res.json({ staff });
  });
  router.post("/staff", (req, res) => {
    const admin = requirePermission(req, "staff.manage");
    const body = parse(staffSchema, req.body);
    if (admin.role !== "owner" && ROLE_RANK[body.role] >= ROLE_RANK[admin.role]) {
      throw forbidden("You cannot create a staff account at or above your own role.", "ROLE_RANK");
    }
    const existing = db2.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE").get(body.username, body.email);
    if (existing) throw conflict("That username or email is already in use.", "ACCOUNT_EXISTS");
    const temporaryPassword = `Donutcash-${randomBytes4(6).toString("hex")}!`;
    const userId = `usr_${randomBytes4(10).toString("hex")}`;
    const now = nowIso();
    db2.transaction(() => {
      db2.prepare(
        `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`
      ).run(userId, body.username, body.email, hashPassword(temporaryPassword), body.role, now, now);
      createWallet(db2, userId, 0, admin.id);
    })();
    notify(db2, {
      userId,
      type: "account",
      title: "Staff account created",
      body: `You have been added as ${body.role}. Change your temporary password from Settings after signing in.`,
      link: "/settings",
      actorId: admin.id
    });
    recordAudit(db2, {
      actorId: admin.id,
      action: "staff.created",
      targetType: "user",
      targetId: userId,
      targetLabel: body.username,
      reason: body.reason ?? null,
      metadata: { role: body.role },
      ip: clientIp(req)
    });
    res.status(201).json({
      user: loadUser(db2, userId),
      temporaryPassword,
      note: "This temporary password is shown once. Deliver it through a secure channel and ask the agent to change it."
    });
  });
  return router;
}
function balanceOfAll(db2) {
  return db2.prepare("SELECT COALESCE(SUM(balance),0) AS total FROM wallets").get().total;
}

// server/routes/admin-config.ts
import { Router as Router10 } from "express";
import { z as z14 } from "zod";

// server/games/config.ts
import { z as z13 } from "zod";
var schemas = {
  coinflip: z13.object({
    winMultiplier: z13.number().min(1.5, "Minimum multiplier is 1.5x.").max(2, "Maximum multiplier is 2x.")
  }).strict(),
  mines: z13.object({
    maxMines: z13.number().int().min(1).max(24),
    houseEdge: z13.number().min(0).max(0.1)
  }).strict(),
  blackjack: z13.object({
    decks: z13.number().int().min(1).max(8),
    dealerStandsSoft17: z13.boolean(),
    blackjackPays: z13.number().min(1).max(2),
    allowDouble: z13.boolean()
  }).strict(),
  roulette: z13.object({
    maxBetsPerSpin: z13.number().int().min(1).max(30)
  }).strict(),
  towers: z13.object({
    levels: z13.number().int().min(3).max(12),
    houseEdge: z13.number().min(0).max(0.1)
  }).strict(),
  plinko: z13.object({
    enabledRisks: z13.array(z13.enum(["low", "medium", "high"])).min(1, "Keep at least one risk level enabled.")
  }).strict()
};
function validateGameConfig(slug, raw) {
  const schema = schemas[slug];
  if (!schema) throw new Error(`Unknown game ${slug}`);
  return parse(schema, raw);
}

// server/routes/admin-config.ts
var settingSchemas = {
  "platform.name": z14.string().trim().min(2, "Use at least 2 characters.").max(60),
  "platform.tagline": z14.string().trim().max(120),
  "platform.registration_open": z14.boolean(),
  "platform.maintenance": z14.boolean(),
  "platform.maintenance_message": z14.string().trim().max(300),
  "economy.starting_credits": amountSchema({ min: 0, max: 1e12, allowZero: true, label: "starting money" }),
  "economy.max_payout": amountSchema({ min: 100, max: 1e12, label: "maximum payout" }),
  "economy.cashier_request_limit": amountSchema({ min: 1, max: 1e12, label: "cashier request limit" }),
  "notifications.email_enabled": z14.boolean()
};
var categorySchema = z14.object({
  key: z14.string().trim().regex(/^[a-z0-9_]{2,30}$/, "Use lowercase letters, numbers, and underscores."),
  label: z14.string().trim().min(2).max(60),
  description: z14.string().trim().max(200),
  defaultPriority: z14.enum(["low", "normal", "high", "urgent"]),
  sortOrder: z14.number().int().min(0).max(1e3).optional()
});
var categoryPatchSchema = z14.object({
  label: z14.string().trim().min(2).max(60).optional(),
  description: z14.string().trim().max(200).optional(),
  enabled: z14.boolean().optional(),
  defaultPriority: z14.enum(["low", "normal", "high", "urgent"]).optional(),
  sortOrder: z14.number().int().min(0).max(1e3).optional()
});
var gamePatchSchema = z14.object({
  enabled: z14.boolean(),
  minBet: amountSchema({ max: 1e12, label: "minimum wager" }),
  maxBet: amountSchema({ max: 1e12, label: "maximum wager" }),
  config: z14.record(z14.string(), z14.unknown())
});
var announcementSchema = z14.object({
  title: z14.string().trim().min(3).max(120),
  body: z14.string().trim().min(5).max(2e3),
  audience: z14.enum(["all", "players", "staff"]),
  sendEmail: z14.boolean().optional().default(false)
});
function gameList(db2, publicShape) {
  const rows = db2.prepare("SELECT * FROM games ORDER BY name").all();
  return rows.map((row) => {
    const parsed = parseJson(row.config, {});
    return {
      slug: row.id,
      name: row.name,
      description: row.description,
      enabled: Boolean(row.enabled),
      minBet: row.min_bet,
      maxBet: row.max_bet,
      config: publicShape ? publicGameConfig(row.id, parsed) : parsed,
      updatedAt: row.updated_at
    };
  });
}
function createAdminConfigRouter(db2) {
  const router = Router10();
  router.get("/settings", (req, res) => {
    requirePermission(req, "settings.manage");
    const rows = db2.prepare("SELECT key, value, updated_at, updated_by FROM settings ORDER BY key").all();
    const settings = {};
    const updated = {};
    for (const row of rows) {
      if (row.key === "email.smtp_pass_enc") continue;
      settings[row.key] = parseJson(row.value, null);
      updated[row.key] = row.updated_at;
    }
    res.json({ settings, updated, categories: loadSupportCategories(db2), games: gameList(db2, false) });
  });
  router.patch("/settings/:key", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const key = req.params.key ?? "";
    const schema = settingSchemas[key];
    if (!schema) throw notFound("Unknown setting.");
    const body = z14.object({ value: z14.unknown() }).parse(req.body ?? {});
    let value;
    try {
      value = schema.parse(body.value);
    } catch (error) {
      if (error instanceof z14.ZodError) {
        const message = error.issues[0]?.message ?? "Enter a valid value.";
        throw new ApiError(400, "VALIDATION_ERROR", message, { fields: { [key]: message } });
      }
      throw error;
    }
    const previous = getSetting(db2, key, null);
    setSetting(db2, key, value, admin.id);
    recordAudit(db2, {
      actorId: admin.id,
      action: "settings.update",
      targetType: "setting",
      targetId: key,
      targetLabel: key,
      metadata: { previous, next: value },
      ip: clientIp(req)
    });
    res.json({ key, value });
  });
  router.get("/games", (req, res) => {
    requirePermission(req, "games.manage");
    res.json({ games: gameList(db2, false) });
  });
  router.patch("/games/:slug", (req, res) => {
    const admin = requirePermission(req, "games.manage");
    const slug = req.params.slug ?? "";
    const game = db2.prepare("SELECT * FROM games WHERE id = ?").get(slug);
    if (!game) throw notFound("Game not found.");
    const body = parse(gamePatchSchema, req.body);
    if (body.maxBet < body.minBet) {
      throw badRequest("Maximum wager must be at least the minimum wager.", "INVALID_LIMITS", {
        fields: { maxBet: "Must be at least the minimum wager." }
      });
    }
    const config2 = validateGameConfig(slug, body.config);
    db2.prepare("UPDATE games SET enabled = ?, min_bet = ?, max_bet = ?, config = ?, updated_at = ?, updated_by = ? WHERE id = ?").run(
      body.enabled ? 1 : 0,
      body.minBet,
      body.maxBet,
      JSON.stringify(config2),
      nowIso(),
      admin.id,
      slug
    );
    recordAudit(db2, {
      actorId: admin.id,
      action: "game.update",
      targetType: "game",
      targetId: slug,
      targetLabel: game.name,
      metadata: {
        before: { enabled: Boolean(game.enabled), minBet: game.min_bet, maxBet: game.max_bet, config: parseJson(game.config, {}) },
        after: { enabled: body.enabled, minBet: body.minBet, maxBet: body.maxBet, config: config2 }
      },
      ip: clientIp(req)
    });
    res.json({ game: gameList(db2, false).find((entry) => entry.slug === slug) });
  });
  router.post("/categories", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const body = parse(categorySchema, req.body);
    if (body.key === "credit_request") {
      throw conflict("Money requests are handled in the Cashier and cannot be a ticket category.", "RESERVED_CATEGORY");
    }
    const existing = db2.prepare("SELECT key FROM support_categories WHERE key = ?").get(body.key);
    if (existing) throw conflict("That category key already exists.", "CATEGORY_EXISTS");
    db2.prepare(
      `INSERT INTO support_categories (key, label, description, enabled, default_priority, sort_order)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(body.key, body.label, body.description, body.defaultPriority, body.sortOrder ?? 100);
    recordAudit(db2, {
      actorId: admin.id,
      action: "support_category.create",
      targetType: "category",
      targetId: body.key,
      targetLabel: body.label,
      ip: clientIp(req)
    });
    res.status(201).json({ categories: loadSupportCategories(db2) });
  });
  router.patch("/categories/:key", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const key = req.params.key ?? "";
    if (key === "credit_request") {
      throw badRequest("This category is archived. Money requests are handled in the Cashier.", "LEGACY_CATEGORY");
    }
    const current = loadSupportCategories(db2).find((category) => category.key === key);
    if (!current) throw notFound("Category not found.");
    const body = parse(categoryPatchSchema, req.body);
    db2.prepare(
      `UPDATE support_categories SET label = ?, description = ?, enabled = ?, default_priority = ?, sort_order = ?
       WHERE key = ?`
    ).run(
      body.label ?? current.label,
      body.description ?? current.description,
      body.enabled ?? current.enabled ? 1 : 0,
      body.defaultPriority ?? current.defaultPriority,
      body.sortOrder ?? current.sortOrder,
      key
    );
    recordAudit(db2, {
      actorId: admin.id,
      action: "support_category.update",
      targetType: "category",
      targetId: key,
      targetLabel: body.label ?? current.label,
      metadata: { before: current, after: body },
      ip: clientIp(req)
    });
    res.json({ categories: loadSupportCategories(db2) });
  });
  router.get("/audit", (req, res) => {
    requirePermission(req, "audit.read");
    const query = parse(
      pageQuerySchema.extend({
        action: z14.string().trim().max(80).optional(),
        actor: z14.string().trim().max(80).optional(),
        q: z14.string().trim().max(120).optional(),
        from: z14.string().optional(),
        to: z14.string().optional()
      }),
      req.query
    );
    let actorId;
    if (query.actor) {
      const actor = db2.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(query.actor);
      actorId = actor?.id ?? "__none__";
    }
    const { rows, total } = listAuditRows(db2, {
      actorId,
      action: query.action,
      search: query.q,
      from: query.from,
      to: query.to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize
    });
    const actions = db2.prepare("SELECT DISTINCT action FROM audit_logs ORDER BY action").all().map(
      (row) => row.action
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name ?? "System",
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        targetLabel: row.target_label,
        reason: row.reason,
        metadata: parseJson(row.metadata, null),
        ip: row.ip,
        createdAt: row.created_at
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      actions
    });
  });
  router.get("/announcements", (req, res) => {
    requirePermission(req, "notifications.broadcast");
    const rows = db2.prepare(
      `SELECT a.id, a.title, a.body, a.recipient_count, a.email_recipient_count, a.created_at, u.username AS creator
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by
         ORDER BY a.created_at DESC LIMIT 50`
    ).all();
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        recipientCount: row.recipient_count,
        emailRecipientCount: row.email_recipient_count,
        createdAt: row.created_at,
        creator: row.creator ?? "System"
      }))
    });
  });
  router.post("/announcements", (req, res) => {
    const admin = requirePermission(req, "notifications.broadcast");
    const body = parse(announcementSchema, req.body);
    const audienceClause = body.audience === "players" ? "WHERE role = 'user' AND status <> 'suspended'" : body.audience === "staff" ? "WHERE role <> 'user' AND status <> 'suspended'" : "WHERE status <> 'suspended'";
    const recipients = db2.prepare(`SELECT id, username, email, email_notifications FROM users ${audienceClause}`).all();
    const id = newId("ann");
    const emailRecipients = body.sendEmail ? recipients.filter((recipient) => recipient.email_notifications) : [];
    inTransaction(db2, () => {
      db2.prepare(
        `INSERT INTO announcements (id, title, body, created_by, recipient_count, email_recipient_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, body.title, body.body, admin.id, recipients.length, emailRecipients.length, nowIso());
      for (const recipient of recipients) {
        notify(db2, {
          userId: recipient.id,
          type: "announcement",
          title: body.title,
          body: body.body,
          link: "/notifications",
          actorId: admin.id
        });
      }
      for (const recipient of emailRecipients) {
        enqueueEmail(db2, {
          userId: recipient.id,
          recipient: recipient.email,
          template: "announcement",
          payload: { username: recipient.username, title: body.title, body: body.body },
          dedupeKey: `announcement:${id}:${recipient.id}`
        });
      }
      recordAudit(db2, {
        actorId: admin.id,
        action: "announcement.send",
        targetType: "announcement",
        targetId: id,
        targetLabel: body.title,
        metadata: {
          audience: body.audience,
          recipients: recipients.length,
          emailRecipients: emailRecipients.length,
          sendEmail: body.sendEmail
        },
        ip: clientIp(req)
      });
    });
    res.status(201).json({ id, recipientCount: recipients.length, emailRecipientCount: emailRecipients.length });
  });
  router.get("/ticket-summary", (req, res) => {
    requirePermission(req, "tickets.read_all");
    const row = db2.prepare(
      `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
           SUM(CASE WHEN assignee_id IS NULL AND status NOT IN ('closed','rejected') THEN 1 ELSE 0 END) AS unassigned,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'on_hold' THEN 1 ELSE 0 END) AS on_hold,
           SUM(CASE WHEN status = 'waiting_user' THEN 1 ELSE 0 END) AS waiting_user,
           SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
         FROM tickets`
    ).get();
    const priority = db2.prepare(
      `SELECT priority, COUNT(*) AS count FROM tickets
         WHERE status NOT IN ('closed','rejected') GROUP BY priority`
    ).all();
    res.json({ counts: row, priority });
  });
  return router;
}

// server/routes/rewards.ts
import { Router as Router11 } from "express";

// server/lib/rewards.ts
var DAY_MS = 864e5;
function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(/* @__PURE__ */ new Date());
    return true;
  } catch {
    return false;
  }
}
function getRewardsConfig(db2) {
  const rawMilestones = getSetting(db2, "rewards.milestones", []);
  const milestones = (Array.isArray(rawMilestones) ? rawMilestones : []).map((entry) => entry && typeof entry === "object" ? entry : null).filter((entry) => Boolean(entry)).map((entry) => ({
    day: clampInt(Number(entry.day), 1, 3650, 1),
    amount: clampInt(Number(entry.amount), 0, 1e12, 0),
    label: typeof entry.label === "string" ? entry.label.slice(0, 80) : `Day ${clampInt(Number(entry.day), 1, 3650, 1)} bonus`
  })).filter((entry) => entry.amount > 0).sort((a, b) => a.day - b.day).slice(0, 12);
  const timezone = getSetting(db2, "rewards.timezone", "UTC");
  return {
    enabled: getSetting(db2, "rewards.enabled", true),
    timezone: isValidTimezone(timezone) ? timezone : "UTC",
    resetHour: clampInt(getSetting(db2, "rewards.reset_hour", 0), 0, 23, 0),
    baseAmount: Math.max(0, getSetting(db2, "rewards.base_amount", 5e4)),
    incrementAmount: Math.max(0, getSetting(db2, "rewards.increment_amount", 1e4)),
    maxAmount: Math.max(1, getSetting(db2, "rewards.max_amount", 5e5)),
    maxStreakDays: clampInt(getSetting(db2, "rewards.max_streak_days", 365), 1, 3650, 365),
    missedPolicy: getSetting(db2, "rewards.missed_policy", "reset") === "grace" ? "grace" : "reset",
    graceDays: clampInt(getSetting(db2, "rewards.grace_days", 1), 0, 14, 1),
    milestones,
    emailEnabled: getSetting(db2, "rewards.email_enabled", true)
  };
}
function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}
function dayKey(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function rewardDayKey(now, timezone, resetHour) {
  const parts = zonedParts(now, timezone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour < resetHour) date.setUTCDate(date.getUTCDate() - 1);
  return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function parseDayKey(day) {
  return /* @__PURE__ */ new Date(`${day}T00:00:00.000Z`);
}
function calendarGap(from, to) {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / DAY_MS);
}
function nextResetIso(now, timezone, resetHour) {
  const parts = zonedParts(now, timezone);
  const secondsToday = parts.hour * 3600 + parts.minute * 60 + parts.second;
  let diff = resetHour * 3600 - secondsToday;
  if (diff <= 0) diff += 86400;
  return new Date(now.getTime() + diff * 1e3).toISOString();
}
function mapClaim(row, milestoneLabel) {
  return {
    id: row.id,
    day: row.claim_day,
    streakDay: row.streak_day,
    baseAmount: row.base_amount,
    incrementAmount: row.increment_amount,
    milestoneAmount: row.milestone_amount,
    milestoneLabel,
    amount: row.amount,
    createdAt: row.created_at
  };
}
function milestoneFor(config2, streakDay) {
  return config2.milestones.find((milestone) => milestone.day === streakDay);
}
function rewardAmounts(config2, streakDay) {
  const base = Math.min(config2.maxAmount, config2.baseAmount + config2.incrementAmount * Math.max(0, streakDay - 1));
  const milestone = milestoneFor(config2, streakDay);
  return {
    base,
    milestone: milestone?.amount ?? 0,
    total: base + (milestone?.amount ?? 0),
    milestoneLabel: milestone?.label ?? null
  };
}
function readEmailPreference(db2, userId) {
  const row = db2.prepare("SELECT email_notifications FROM users WHERE id = ?").get(userId);
  return Boolean(row?.email_notifications ?? 1);
}
function currentStreak(db2, userId, config2, today) {
  const lastClaim = db2.prepare("SELECT * FROM reward_claims WHERE user_id = ? ORDER BY claim_day DESC LIMIT 1").get(userId);
  if (!lastClaim) return { streak: 0, claimedToday: false, lastClaim: null };
  if (lastClaim.claim_day === today) {
    return { streak: lastClaim.streak_day, claimedToday: true, lastClaim };
  }
  const gap = calendarGap(lastClaim.claim_day, today);
  if (gap === 1) return { streak: lastClaim.streak_day, claimedToday: false, lastClaim };
  if (gap <= 0) return { streak: 0, claimedToday: false, lastClaim };
  const missedDays = gap - 1;
  if (config2.missedPolicy === "grace" && missedDays <= config2.graceDays) {
    return { streak: lastClaim.streak_day, claimedToday: false, lastClaim };
  }
  return { streak: 0, claimedToday: false, lastClaim };
}
function buildCalendar(rows, today, days = 14) {
  const claims = new Map(rows.map((row) => [row.claim_day, row]));
  const todayDate = parseDayKey(today);
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(todayDate.getTime() - offset * DAY_MS);
    const key = dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    const claim = claims.get(key);
    result.push({
      day: key,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      weekday: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      claimed: Boolean(claim),
      isToday: key === today,
      isPast: key < today,
      reward: claim?.amount ?? null
    });
  }
  return result;
}
function rewardsSummary(db2, userId, now = /* @__PURE__ */ new Date()) {
  const config2 = getRewardsConfig(db2);
  const today = rewardDayKey(now, config2.timezone, config2.resetHour);
  const { streak, claimedToday, lastClaim } = currentStreak(db2, userId, config2, today);
  const nextStreakDay = Math.min(config2.maxStreakDays, streak + 1);
  const nextAmounts = rewardAmounts(config2, nextStreakDay);
  const historyRows = db2.prepare("SELECT * FROM reward_claims WHERE user_id = ? ORDER BY claim_day DESC LIMIT 20").all(userId);
  const todayRow = claimedToday ? historyRows.find((row) => row.claim_day === today) ?? lastClaim : null;
  const todayDate = parseDayKey(today);
  const calendarStart = new Date(todayDate.getTime() - 13 * DAY_MS);
  const calendarRows = db2.prepare("SELECT * FROM reward_claims WHERE user_id = ? AND claim_day >= ? ORDER BY claim_day").all(
    userId,
    dayKey(calendarStart.getUTCFullYear(), calendarStart.getUTCMonth() + 1, calendarStart.getUTCDate())
  );
  return {
    enabled: config2.enabled,
    timezone: config2.timezone,
    resetHour: config2.resetHour,
    baseAmount: config2.baseAmount,
    incrementAmount: config2.incrementAmount,
    maxAmount: config2.maxAmount,
    maxStreakDays: config2.maxStreakDays,
    missedPolicy: config2.missedPolicy,
    graceDays: config2.graceDays,
    milestones: config2.milestones,
    streak,
    claimedToday,
    todayClaim: todayRow ? mapClaim(todayRow, milestoneFor(config2, todayRow.streak_day)?.label ?? null) : null,
    nextReward: {
      streakDay: nextStreakDay,
      baseAmount: nextAmounts.base,
      milestoneAmount: nextAmounts.milestone,
      total: nextAmounts.total
    },
    nextResetAt: nextResetIso(now, config2.timezone, config2.resetHour),
    calendar: buildCalendar(calendarRows, today),
    history: historyRows.map((row) => mapClaim(row, milestoneFor(config2, row.streak_day)?.label ?? null)),
    emailNotifications: readEmailPreference(db2, userId)
  };
}
function claimReward(db2, userId, now = /* @__PURE__ */ new Date()) {
  const config2 = getRewardsConfig(db2);
  if (!config2.enabled) {
    throw new ApiError(403, "REWARDS_DISABLED", "Daily rewards are currently paused.");
  }
  const today = rewardDayKey(now, config2.timezone, config2.resetHour);
  const outcome = inTransaction(db2, () => {
    const state = currentStreak(db2, userId, config2, today);
    if (state.claimedToday) {
      throw new ApiError(409, "ALREADY_CLAIMED", "You already claimed today's reward.", {
        claimedToday: true,
        nextResetAt: nextResetIso(now, config2.timezone, config2.resetHour)
      });
    }
    const streakDay = Math.min(config2.maxStreakDays, state.streak + 1);
    const amounts = rewardAmounts(config2, streakDay);
    const claimId = newId("rwd");
    const createdAt = nowIso();
    const insert = db2.prepare(
      `INSERT INTO reward_claims
           (id, user_id, claim_day, timezone, streak_day, base_amount, increment_amount, milestone_amount, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      claimId,
      userId,
      today,
      config2.timezone,
      streakDay,
      amounts.base,
      config2.incrementAmount,
      amounts.milestone,
      amounts.total,
      createdAt
    );
    if (insert.changes !== 1) {
      throw new ApiError(409, "ALREADY_CLAIMED", "You already claimed today's reward.");
    }
    const ledger = applyLedger(db2, {
      userId,
      amount: amounts.total,
      type: "admin_adjustment",
      reason: `Daily reward \xB7 day ${streakDay}${amounts.milestoneLabel ? ` \xB7 ${amounts.milestoneLabel}` : ""}`,
      refType: "reward",
      refId: claimId,
      idempotencyKey: `reward:${userId}:${today}`,
      metadata: {
        source: "rewards",
        claimDay: today,
        streakDay,
        baseAmount: amounts.base,
        milestoneAmount: amounts.milestone
      }
    });
    db2.prepare("UPDATE reward_claims SET ledger_id = ? WHERE id = ?").run(ledger.id, claimId);
    const row = db2.prepare("SELECT * FROM reward_claims WHERE id = ?").get(claimId);
    return {
      claim: mapClaim(row, amounts.milestoneLabel),
      balance: balanceOf(db2, userId)
    };
  });
  return {
    claim: outcome.claim,
    balance: outcome.balance,
    summary: rewardsSummary(db2, userId, now)
  };
}
function rewardsAdminView(db2) {
  const config2 = getRewardsConfig(db2);
  const today = rewardDayKey(/* @__PURE__ */ new Date(), config2.timezone, config2.resetHour);
  const todayCount = db2.prepare("SELECT COUNT(*) AS count FROM reward_claims WHERE claim_day = ?").get(today);
  const totals = db2.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM reward_claims").get();
  return {
    ...config2,
    claimsToday: todayCount.count,
    claimsAllTime: totals.count,
    totalPaid: totals.total
  };
}

// server/routes/rewards.ts
function createRewardsRouter(db2) {
  const router = Router11();
  router.get("/", (req, res) => {
    const user = requireAuth(req);
    res.set("Cache-Control", "no-store");
    res.json(rewardsSummary(db2, user.id));
  });
  router.post("/claim", (req, res) => {
    const user = requireAuth(req);
    const result = claimReward(db2, user.id);
    const config2 = getRewardsConfig(db2);
    notify(db2, {
      userId: user.id,
      type: "reward",
      title: `Day ${result.claim.streakDay} reward claimed`,
      body: `${compactAmount(result.claim.amount)} DonutSMP money was added to your wallet.${result.claim.milestoneLabel ? ` ${result.claim.milestoneLabel} included.` : ""}`,
      link: "/rewards"
    });
    if (result.summary.emailNotifications && config2.emailEnabled && getEmailConfig(db2).rewardNotifications) {
      enqueueEmail(db2, {
        userId: user.id,
        recipient: user.email,
        template: "reward-claimed",
        payload: {
          username: user.username,
          amount: result.claim.amount,
          streakDay: result.claim.streakDay,
          milestoneLabel: result.claim.milestoneLabel,
          nextResetAt: result.summary.nextResetAt,
          timezone: result.summary.timezone
        },
        dedupeKey: `reward-email:${result.claim.id}`
      });
    }
    const payload = {
      ...result.summary,
      claim: result.claim,
      balance: result.balance
    };
    res.json(payload);
  });
  return router;
}

// server/routes/admin-rewards.ts
import { Router as Router12 } from "express";
import { z as z15 } from "zod";
var milestoneSchema = z15.object({
  day: z15.number().int().min(1).max(3650),
  amount: amountSchema({ min: 0, max: 1e12, allowZero: true, label: "milestone bonus" }),
  label: z15.string().trim().min(1).max(60)
});
var rewardsConfigSchema = z15.object({
  enabled: z15.boolean(),
  timezone: z15.string().trim().min(1).max(80).refine(isValidTimezone, "Use a valid IANA timezone, for example Europe/London."),
  resetHour: z15.number().int().min(0).max(23),
  baseAmount: amountSchema({ min: 0, max: 1e12, allowZero: true, label: "base reward" }),
  incrementAmount: amountSchema({ min: 0, max: 1e12, allowZero: true, label: "streak increment" }),
  maxAmount: amountSchema({ min: 1, max: 1e12, label: "reward cap" }),
  maxStreakDays: z15.number().int().min(1).max(3650),
  missedPolicy: z15.enum(["reset", "grace"]),
  graceDays: z15.number().int().min(0).max(14),
  emailEnabled: z15.boolean(),
  milestones: z15.array(milestoneSchema).max(12)
}).superRefine((value, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  value.milestones.forEach((milestone, index) => {
    if (seen.has(milestone.day)) {
      ctx.addIssue({ code: "custom", path: ["milestones", index, "day"], message: "Milestone days must be unique." });
    }
    seen.add(milestone.day);
    if (milestone.day > value.maxStreakDays) {
      ctx.addIssue({
        code: "custom",
        path: ["milestones", index, "day"],
        message: "Milestone day cannot exceed the maximum streak length."
      });
    }
  });
  if (value.missedPolicy === "grace" && value.graceDays < 1) {
    ctx.addIssue({ code: "custom", path: ["graceDays"], message: "Grace mode needs at least one grace day." });
  }
});
function adminView(db2) {
  const view = rewardsAdminView(db2);
  const claims = db2.prepare(
    `SELECT rc.*, u.username
       FROM reward_claims rc JOIN users u ON u.id = rc.user_id
       ORDER BY rc.created_at DESC LIMIT 15`
  ).all();
  return {
    ...view,
    recentClaims: claims.map((row) => ({
      id: row.id,
      username: row.username,
      day: row.claim_day,
      streakDay: row.streak_day,
      baseAmount: row.base_amount,
      incrementAmount: row.increment_amount,
      milestoneAmount: row.milestone_amount,
      amount: row.amount,
      createdAt: row.created_at
    }))
  };
}
function createAdminRewardsRouter(db2) {
  const router = Router12();
  router.get("/rewards", (req, res) => {
    requirePermission(req, "settings.manage");
    res.json(adminView(db2));
  });
  router.patch("/rewards", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const body = parse(rewardsConfigSchema, req.body);
    const before = getRewardsConfig(db2);
    const after = {
      enabled: body.enabled,
      timezone: body.timezone,
      resetHour: body.resetHour,
      baseAmount: body.baseAmount,
      incrementAmount: body.incrementAmount,
      maxAmount: body.maxAmount,
      maxStreakDays: body.maxStreakDays,
      missedPolicy: body.missedPolicy,
      graceDays: body.graceDays,
      milestones: [...body.milestones].sort((a, b) => a.day - b.day),
      emailEnabled: body.emailEnabled
    };
    inTransaction(db2, () => {
      setSetting(db2, "rewards.enabled", after.enabled, admin.id);
      setSetting(db2, "rewards.timezone", after.timezone, admin.id);
      setSetting(db2, "rewards.reset_hour", after.resetHour, admin.id);
      setSetting(db2, "rewards.base_amount", after.baseAmount, admin.id);
      setSetting(db2, "rewards.increment_amount", after.incrementAmount, admin.id);
      setSetting(db2, "rewards.max_amount", after.maxAmount, admin.id);
      setSetting(db2, "rewards.max_streak_days", after.maxStreakDays, admin.id);
      setSetting(db2, "rewards.missed_policy", after.missedPolicy, admin.id);
      setSetting(db2, "rewards.grace_days", after.graceDays, admin.id);
      setSetting(db2, "rewards.milestones", after.milestones, admin.id);
      setSetting(db2, "rewards.email_enabled", after.emailEnabled, admin.id);
      recordAudit(db2, {
        actorId: admin.id,
        action: "rewards.settings_update",
        targetType: "rewards",
        targetId: "daily",
        targetLabel: "Daily rewards",
        metadata: { before, after },
        ip: clientIp(req)
      });
    });
    res.json(adminView(db2));
  });
  return router;
}

// server/routes/admin-email.ts
import { Router as Router13 } from "express";
import { z as z16 } from "zod";
var settingsSchema = z16.object({
  enabled: z16.boolean(),
  host: z16.string().trim().min(1, "Enter the SMTP server.").max(255),
  port: z16.number().int().min(1, "Enter a valid port.").max(65535),
  secure: z16.boolean(),
  user: z16.string().trim().min(1, "Enter the SMTP login.").max(255),
  fromName: z16.string().trim().min(1, "Enter a sender name.").max(80),
  fromEmail: z16.string().trim().email("Enter a valid sender address.").max(254),
  replyTo: z16.string().trim().max(254).refine((value) => value === "" || isValidEmail(value), "Enter a valid reply-to address or leave it blank."),
  securityNotifications: z16.boolean(),
  rewardNotifications: z16.boolean(),
  smtpPass: z16.string().trim().min(1, "Enter the SMTP key.").max(300).optional(),
  clearSmtpPass: z16.boolean().optional()
}).superRefine((value, ctx) => {
  if (value.smtpPass && value.clearSmtpPass) {
    ctx.addIssue({ code: "custom", path: ["smtpPass"], message: "Enter a new key or clear the saved key, not both." });
  }
});
var testSchema = z16.object({ to: z16.string().trim().email("Enter a valid destination address.").max(254).optional() });
function safeMailError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/pass(word)?[=:]\s*\S+/gi, "password=[redacted]").slice(0, 500);
}
function createAdminEmailRouter(db2) {
  const router = Router13();
  router.get("/email", (req, res) => {
    requirePermission(req, "settings.manage");
    res.set("Cache-Control", "no-store");
    res.json(emailSettingsView(db2));
  });
  router.patch("/email", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const body = parse(settingsSchema, req.body);
    const current = getEmailConfig(db2);
    const hasPassAfter = body.smtpPass ? true : body.clearSmtpPass ? current.passSource === "environment" : Boolean(current.pass);
    if (body.enabled && !hasPassAfter) {
      throw new ApiError(400, "VALIDATION_ERROR", "Add an SMTP key before enabling email delivery.", {
        fields: { smtpPass: "An SMTP key is required." }
      });
    }
    if (body.enabled && (!body.host || !body.user || !body.fromEmail)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Complete the required email settings before enabling delivery.");
    }
    const before = {
      enabled: current.enabled,
      host: current.host,
      port: current.port,
      secure: current.secure,
      user: current.user,
      fromName: current.fromName,
      fromEmail: current.fromEmail,
      replyTo: current.replyTo,
      securityNotifications: current.securityNotifications,
      rewardNotifications: current.rewardNotifications,
      smtpPassSource: current.passSource
    };
    inTransaction(db2, () => {
      setSetting(db2, "email.enabled", body.enabled, admin.id);
      setSetting(db2, "email.host", body.host, admin.id);
      setSetting(db2, "email.port", body.port, admin.id);
      setSetting(db2, "email.secure", body.secure, admin.id);
      setSetting(db2, "email.user", body.user, admin.id);
      setSetting(db2, "email.from_name", body.fromName, admin.id);
      setSetting(db2, "email.from_email", body.fromEmail, admin.id);
      setSetting(db2, "email.reply_to", body.replyTo, admin.id);
      setSetting(db2, "email.security_notifications", body.securityNotifications, admin.id);
      setSetting(db2, "email.reward_notifications", body.rewardNotifications, admin.id);
      if (body.smtpPass) setSetting(db2, "email.smtp_pass_enc", encryptSecret(body.smtpPass), admin.id);
      if (body.clearSmtpPass) setSetting(db2, "email.smtp_pass_enc", "", admin.id);
      recordAudit(db2, {
        actorId: admin.id,
        action: "email.settings_update",
        targetType: "email",
        targetId: "smtp",
        targetLabel: "Email settings",
        metadata: {
          before,
          after: {
            enabled: body.enabled,
            host: body.host,
            port: body.port,
            secure: body.secure,
            fromName: body.fromName,
            fromEmail: body.fromEmail,
            replyTo: body.replyTo,
            securityNotifications: body.securityNotifications,
            rewardNotifications: body.rewardNotifications,
            smtpPassChanged: Boolean(body.smtpPass),
            smtpPassCleared: Boolean(body.clearSmtpPass)
          }
        },
        ip: clientIp(req)
      });
    });
    res.json(emailSettingsView(db2));
  });
  router.post("/email/test", async (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const body = parse(testSchema, req.body ?? {});
    const recipient = body.to ?? admin.email;
    try {
      const result = await sendTestEmail(db2, recipient);
      recordAudit(db2, {
        actorId: admin.id,
        action: "email.test_sent",
        targetType: "email",
        targetId: "smtp",
        targetLabel: "Email settings",
        metadata: { recipient },
        ip: clientIp(req)
      });
      res.json({ ok: true, messageId: result.messageId, recipient });
    } catch (error) {
      const message = safeMailError(error);
      setSetting(db2, "email.last_error", message, admin.id);
      recordAudit(db2, {
        actorId: admin.id,
        action: "email.test_failed",
        targetType: "email",
        targetId: "smtp",
        targetLabel: "Email settings",
        reason: message,
        ip: clientIp(req)
      });
      throw new ApiError(502, "EMAIL_TEST_FAILED", `Test email failed: ${message}`);
    }
  });
  router.post("/email/queue/:id/retry", (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const ok = retryEmailJob(db2, req.params.id ?? "");
    if (!ok) throw new ApiError(404, "EMAIL_JOB_NOT_FOUND", "That email job is not failed or no longer exists.");
    recordAudit(db2, {
      actorId: admin.id,
      action: "email.queue_retry",
      targetType: "email_job",
      targetId: req.params.id ?? "",
      targetLabel: "Email queue",
      ip: clientIp(req)
    });
    res.json(emailSettingsView(db2));
  });
  router.post("/email/queue/process", async (req, res) => {
    const admin = requirePermission(req, "settings.manage");
    const result = await processEmailQueue(db2, 20);
    recordAudit(db2, {
      actorId: admin.id,
      action: "email.queue_process",
      targetType: "email_job",
      targetId: "queue",
      targetLabel: "Email queue",
      metadata: { ...result },
      ip: clientIp(req)
    });
    res.json({ ...emailSettingsView(db2), result });
  });
  router.get("/email/ready", (req, res) => {
    requirePermission(req, "settings.manage");
    const email = getEmailConfig(db2);
    res.json({
      ready: emailReady(email),
      enabled: email.enabled,
      appName: email.appName,
      fromEmail: email.fromEmail
    });
  });
  return router;
}

// server/app.ts
function isSameOrigin(req, origin) {
  try {
    const target = new URL(origin);
    const candidates = [req.get("host")];
    if (config.trustProxyHeaders) candidates.push(req.get("x-forwarded-host")?.split(",")[0]?.trim());
    return candidates.some((host) => Boolean(host) && target.host.toLowerCase() === host.toLowerCase());
  } catch {
    return false;
  }
}
var PRIVATE_PREFIXES = ["/data", "/server", "/build", "/node_modules", "/shared", "/tests", "/src", "/.git", "/logs"];
function isPrivatePath(urlPath) {
  const segments = urlPath.toLowerCase().split("?")[0] ?? "";
  if (segments === "/.env" || segments.startsWith("/.env")) return true;
  return PRIVATE_PREFIXES.some((prefix) => segments === prefix || segments.startsWith(`${prefix}/`));
}
function createApp(db2) {
  const app2 = express();
  app2.disable("x-powered-by");
  app2.set(
    "trust proxy",
    config.trustProxyHeaders ? (address) => isLoopbackAddress(address) || config.trustedProxies.includes(address) : false
  );
  app2.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"]
        }
      } : false,
      crossOriginEmbedderPolicy: false
    })
  );
  app2.use(express.json({ limit: "128kb" }));
  app2.use(cookieParser(config.sessionSecret || void 0));
  app2.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.get("x-requested-with") !== "donutcash") {
      return next(new ApiError(403, "CSRF_HEADER", "This request is missing the required application header."));
    }
    const origin = req.get("origin");
    if (origin && !config.allowedOrigins.includes(origin) && !isSameOrigin(req, origin)) {
      return next(new ApiError(403, "ORIGIN_BLOCKED", "This origin is not allowed to perform that action."));
    }
    next();
  });
  app2.use(authMiddleware(db2));
  app2.use("/api", (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !config.isProduction) return next();
    const address = clientAddress(req);
    const key = req.user ? `mutate:user:${req.user.id}` : address ? `mutate:ip:${address}` : null;
    if (key && !mutationLimiter.consume(key).allowed) {
      return next(new ApiError(429, "RATE_LIMITED", "Too many requests. Please slow down."));
    }
    next();
  });
  app2.use("/api", (req, _res, next) => {
    if (!req.user?.legalAcceptanceRequired) return next();
    if (req.path.startsWith("/auth") || req.path.startsWith("/legal") || req.path.startsWith("/public")) return next();
    if (req.method === "POST" && req.path === "/me/self-exclusion") return next();
    return next(
      new ApiError(
        403,
        "LEGAL_ACCEPTANCE_REQUIRED",
        "Accept the current Terms of Service and Privacy Policy to continue."
      )
    );
  });
  app2.use("/api/public", createPublicRouter(db2));
  app2.use("/api/auth", createAuthRouter(db2));
  app2.use("/api/legal", createLegalRouter(db2));
  app2.use("/api/me", createMeRouter(db2));
  app2.use("/api/games", createGamesRouter(db2));
  app2.use("/api/rewards", createRewardsRouter(db2));
  app2.use("/api/tickets", createTicketsRouter(db2));
  app2.use("/api/cashier", createCashierRouter(db2));
  app2.use("/api/staff", createStaffRouter(db2));
  app2.use("/api/admin", createAdminRouter(db2));
  app2.use("/api/admin", createAdminConfigRouter(db2));
  app2.use("/api/admin", createAdminRewardsRouter(db2));
  app2.use("/api/admin", createAdminEmailRouter(db2));
  app2.use("/api/admin/cashier", createAdminCashierRouter(db2));
  app2.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "API endpoint not found." } });
  });
  const clientDir = path2.resolve(config.clientDist);
  const clientIndex = path2.join(clientDir, "index.html");
  if (fs2.existsSync(clientIndex)) {
    app2.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app2.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      if (isPrivatePath(req.path)) return next();
      res.sendFile(clientIndex, (error) => {
        if (error) next(error);
      });
    });
  } else if (config.isProduction) {
    console.warn(`[api] no client build found at ${clientIndex}; only the API will be served. Run \`npm run build\`.`);
  }
  const errorHandler = (error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details ?? void 0 }
      });
      return;
    }
    if (error instanceof ZodError) {
      const fields = {};
      for (const issue of error.issues) {
        const key = issue.path.length ? issue.path.join(".") : "_";
        if (!fields[key]) fields[key] = issue.message;
      }
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Please check the highlighted fields.", details: { fields } }
      });
      return;
    }
    const type = error?.type;
    if (type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON." } });
      return;
    }
    if (type === "entity.too.large") {
      res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "The request could not be read." } });
      return;
    }
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." }
    });
  };
  app2.use(errorHandler);
  return app2;
}

// server/lib/owner-bootstrap.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { randomBytes as randomBytes5 } from "node:crypto";
var USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
function credentialsPath() {
  return path3.join(config.root, "data", "owner-credentials.txt");
}
function writeCredentialsFile(lines) {
  try {
    const file = credentialsPath();
    fs3.mkdirSync(path3.dirname(file), { recursive: true });
    fs3.writeFileSync(file, `${lines.join("\n")}
`, { mode: 384 });
  } catch (error) {
    console.warn("[owner] could not write owner-credentials.txt:", error instanceof Error ? error.message : error);
  }
}
function createOwner(db2, username, email, password) {
  const startingCredits = getSetting(db2, "economy.starting_credits", config.startingCredits);
  const userId = newId("usr");
  const now = nowIso();
  db2.transaction(() => {
    db2.prepare(
      `INSERT INTO users (id, username, email, password_hash, role, status, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'active', 1, ?, ?)`
    ).run(userId, username, email, hashPassword(password), now, now);
    createWallet(db2, userId, startingCredits, userId);
  })();
  recordAudit(db2, {
    actorId: userId,
    action: "owner.bootstrap",
    targetType: "user",
    targetId: userId,
    targetLabel: username
  });
  return userId;
}
function ensureBootstrapOwner(db2) {
  const email = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const username = (process.env.OWNER_USERNAME || "owner").trim();
  const password = process.env.OWNER_PASSWORD || "";
  if (email && password) {
    const issues = passwordIssues(password);
    if (issues.length) {
      console.error(`[owner] OWNER_PASSWORD does not meet the password policy: ${issues.join(" ")}`);
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      console.error("[owner] OWNER_USERNAME must be 3-20 letters, numbers, or underscores.");
      return;
    }
    const byEmail = db2.prepare("SELECT id, role FROM users WHERE email = ? COLLATE NOCASE").get(email);
    if (byEmail) {
      if (byEmail.role !== "owner") {
        db2.prepare("UPDATE users SET role = 'owner', status = 'active', updated_at = ? WHERE id = ?").run(
          nowIso(),
          byEmail.id
        );
        recordAudit(db2, {
          actorId: byEmail.id,
          action: "owner.bootstrap.promote",
          targetType: "user",
          targetId: byEmail.id,
          targetLabel: email,
          metadata: { from: byEmail.role }
        });
        console.info(`[owner] promoted existing account ${email} to owner.`);
      }
      if (process.env.OWNER_RESET_PASSWORD === "true") {
        db2.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
          hashPassword(password),
          nowIso(),
          byEmail.id
        );
        recordAudit(db2, {
          actorId: byEmail.id,
          action: "owner.bootstrap.password_reset",
          targetType: "user",
          targetId: byEmail.id,
          targetLabel: email
        });
        console.info(`[owner] reset the password for ${email} from OWNER_PASSWORD.`);
      }
      return;
    }
    const clash = db2.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
    if (clash) {
      console.error(`[owner] OWNER_USERNAME "${username}" is already taken; set OWNER_USERNAME to a free name.`);
      return;
    }
    createOwner(db2, username, email, password);
    console.info(`[owner] created owner account ${username} <${email}> from environment variables.`);
    const others = db2.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get();
    if (others.count > 1) {
      console.warn(`[owner] ${others.count} owner accounts now exist; the environment owner is independent of them.`);
    }
    return;
  }
  const owners = db2.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get();
  if (owners.count > 0) return;
  const generated = `Donutcash-${randomBytes5(9).toString("base64url")}!9`;
  const ownerUsername = USERNAME_PATTERN.test(username) ? username : "owner";
  const ownerEmail = email || `owner@${new URL(config.appUrl).hostname}`;
  createOwner(db2, ownerUsername, ownerEmail, generated);
  console.info("");
  console.info("==============================================================");
  console.info(" Owner account created (no owner existed in this database).");
  console.info(`   Username: ${ownerUsername}`);
  console.info(`   Email:    ${ownerEmail}`);
  console.info(`   Password: ${generated}`);
  console.info(" Sign in, then change this password immediately.");
  console.info(" This is printed once; it is not stored anywhere in the repository.");
  console.info("==============================================================");
  console.info("");
  writeCredentialsFile([
    `Username: ${ownerUsername}`,
    `Email: ${ownerEmail}`,
    `Password: ${generated}`,
    "",
    "Created at startup because the database had no owner account.",
    "Sign in and change this password, then delete this file."
  ]);
}

// server/index.ts
assertProductionSecrets();
var db = getDatabase();
try {
  ensureBootstrapOwner(db);
} catch (error) {
  console.error("[owner] bootstrap failed:", error instanceof Error ? error.message : error);
}
function maintenance() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString();
    db.prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").run(cutoff, cutoff);
    db.prepare("DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL").run(cutoff);
    db.prepare("DELETE FROM email_verifications WHERE expires_at < ? OR used_at IS NOT NULL").run(cutoff);
    db.prepare("DELETE FROM email_jobs WHERE status = 'sent' AND sent_at < ?").run(cutoff);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (error) {
    console.warn("[maintenance] cleanup skipped:", error instanceof Error ? error.message : error);
  }
}
maintenance();
var emailTimer = setInterval(() => {
  void processEmailQueue(db, 10).catch((error) => {
    console.warn("[email] queue tick failed:", error instanceof Error ? error.message : error);
  });
}, 3e4);
emailTimer.unref();
setTimeout(() => {
  void processEmailQueue(db, 10).catch(() => void 0);
}, 4e3).unref();
var app = createApp(db);
var server = app.listen(config.port, () => {
  console.info(`[donutcash] API listening on http://localhost:${config.port}`);
  console.info(`[donutcash] environment: ${config.isProduction ? "production" : "development"}`);
  console.info(`[donutcash] database: ${config.databasePath}`);
  console.info(`[donutcash] client build: ${config.clientDist}`);
  console.info(`[donutcash] public url: ${config.appUrl}${config.appUrlConfigured ? "" : " (APP_URL not set; same-origin requests are trusted)"}`);
  console.info(
    `[donutcash] client ip: ${config.trustProxyHeaders ? `forwarded headers trusted from loopback${config.trustedProxies.length ? ` and ${config.trustedProxies.join(", ")}` : ""}` : "forwarded headers ignored (recorded IPs fall back to unknown)"}`
  );
  console.info(`[donutcash] rate limits: ${isSharedRateLimitStoreEnabled() ? "shared SQLite windows" : "in-process windows"}`);
  console.info(`[donutcash] session cookie secure: ${config.cookieSecure}`);
  if (!config.isProduction) console.info("[donutcash] start the client with `npm run dev:web` (Vite proxies /api here)");
});
server.on("error", (error) => {
  console.error(`[donutcash] could not listen on port ${config.port}:`, error.message);
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  console.error("[donutcash] uncaught exception:", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[donutcash] unhandled rejection:", reason);
});
function shutdown(signal) {
  console.info(`[donutcash] ${signal} received, closing server`);
  clearInterval(emailTimer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5e3).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
