import type { Database } from 'better-sqlite3';

const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'initial_schema',
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
`,
  },
  {
    version: 2,
    name: 'cashier_requests',
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
`,
  },
  {
    version: 3,
    name: 'donutcash_branding',
    sql: `
UPDATE settings SET value = '"Donutcash"'
 WHERE key = 'platform.name' AND value IN ('"Aurum Casino"', '"Aurum"', '"DonutCash"');
UPDATE support_categories
   SET label = 'Money request',
       description = 'Ask the support team for a DonutSMP money grant or correction.'
 WHERE key = 'credit_request' AND label IN ('Virtual-credit request', 'Credit request');
`,
  },
  {
    version: 4,
    name: 'active_game_rounds',
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
`,
  },
  {
    version: 5,
    name: 'economy_limits',
    sql: `
UPDATE settings SET value = '5000000'
 WHERE key = 'economy.starting_credits' AND value = '1000';
UPDATE settings SET value = '5000000000'
 WHERE key = 'economy.credit_request_limit' AND value = '50000';
UPDATE settings SET value = '5000000000'
 WHERE key = 'support.staff_approval_limit' AND value = '5000';
`,
  },
  {
    version: 7,
    name: 'rewards_and_email',
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
`,
  },
  {
    version: 8,
    name: 'cashier_only_money_requests',
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
`,
  },
  {
    version: 10,
    name: 'raise_default_payout_ceiling',
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
`,
  },
  {
    version: 11,
    name: 'shared_rate_limit_windows',
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
`,
  },
  {
    version: 9,
    name: 'legal_acceptance_and_self_exclusion',
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
`,
  },
  {
    version: 6,
    name: 'backfill_active_rounds',
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
`,
  },
];

export function migrate(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    })();
  }
}

const GAMES = [
  {
    id: 'coinflip',
    name: 'Coinflip',
    description: 'Call heads or tails and watch the coin decide.',
    config: { winMultiplier: 1.96 },
  },
  {
    id: 'mines',
    name: 'Mines',
    description: 'Reveal safe tiles, grow the multiplier, cash out before you hit a mine.',
    config: { maxMines: 20, houseEdge: 0.03 },
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    description: 'Beat the dealer to 21. Six-deck shoe, dealer stands on 17.',
    config: { decks: 6, dealerStandsSoft17: true, blackjackPays: 1.5, allowDouble: true },
  },
  {
    id: 'roulette',
    name: 'Roulette',
    description: 'European single-zero wheel with inside and outside bets.',
    config: { maxBetsPerSpin: 10 },
  },
  {
    id: 'towers',
    name: 'Towers',
    description: 'Climb nine floors. One trap per floor. Cash out any time.',
    config: { levels: 9, houseEdge: 0.03 },
  },
  {
    id: 'plinko',
    name: 'Plinko',
    description: 'Drop the ball and let the pegs decide your multiplier.',
    config: { enabledRisks: ['low', 'medium', 'high'] },
  },
];

const CATEGORIES = [
  { key: 'wallet', label: 'Wallet or transaction issue', description: 'A wallet balance or ledger entry looks wrong.', priority: 'high', order: 20 },
  { key: 'game', label: 'Game issue', description: 'A round did not play out as expected.', priority: 'high', order: 30 },
  { key: 'account', label: 'Account issue', description: 'Sign-in, profile, or access problems.', priority: 'high', order: 40 },
  { key: 'technical', label: 'Technical support', description: 'The platform is not behaving correctly.', priority: 'normal', order: 50 },
  { key: 'question', label: 'General question', description: 'Ask about rules, limits, or how something works.', priority: 'low', order: 60 },
  { key: 'other', label: 'Other', description: 'Anything that does not fit another category.', priority: 'normal', order: 70 },
];

export function seed(db: Database, options: { appName: string; startingCredits: number; sessionDays: number }): void {
  const now = new Date().toISOString();
  const insertGame = db.prepare(
    `INSERT INTO games (id, name, description, enabled, min_bet, max_bet, config, updated_at)
     VALUES (?, ?, ?, 1, 1, 10000, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const insertCategory = db.prepare(
    `INSERT INTO support_categories (key, label, description, enabled, default_priority, request_kinds, sort_order)
     VALUES (?, ?, ?, 1, ?, '[]', ?)
     ON CONFLICT(key) DO NOTHING`,
  );
  const insertSetting = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`,
  );

  db.transaction(() => {
    for (const game of GAMES) {
      insertGame.run(game.id, game.name, game.description, JSON.stringify(game.config), now);
    }
    for (const category of CATEGORIES) {
      insertCategory.run(category.key, category.label, category.description, category.priority, category.order);
    }
    const settings: Record<string, unknown> = {
      'platform.name': options.appName,
      'platform.tagline': 'The casino for DonutSMP money.',
      'platform.registration_open': true,
      'platform.maintenance': false,
      'platform.maintenance_message': 'We are tuning the tables. Please try again shortly.',
      'economy.starting_credits': options.startingCredits,
      'economy.max_payout': 1_000_000_000_000,
      'economy.cashier_request_limit': 5_000_000_000,
      'security.session_days': options.sessionDays,
      'notifications.email_enabled': false,
      'rewards.enabled': true,
      'rewards.timezone': 'UTC',
      'rewards.reset_hour': 0,
      'rewards.base_amount': 50_000,
      'rewards.increment_amount': 10_000,
      'rewards.max_amount': 500_000,
      'rewards.max_streak_days': 365,
      'rewards.missed_policy': 'reset',
      'rewards.grace_days': 1,
      'rewards.milestones': [
        { day: 7, amount: 100_000, label: 'Week one bonus' },
        { day: 14, amount: 250_000, label: 'Two-week streak' },
        { day: 30, amount: 750_000, label: 'Monthly devotee' },
      ],
      'rewards.email_enabled': true,
      'email.enabled': false,
      'email.host': 'smtp-relay.brevo.com',
      'email.port': 587,
      'email.secure': false,
      'email.user': 'c05ccf001@smtp-brevo.com',
      'email.from_name': 'Donutcash',
      'email.from_email': 'no-reply@donutcash.local',
      'email.reply_to': '',
      'email.security_notifications': true,
      'email.reward_notifications': true,
    };
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(key, JSON.stringify(value), now);
    }
  })();
}
