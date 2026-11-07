import type { Database } from 'better-sqlite3';

/**
 * Production data rules for every migration:
 *
 * 1. Never rewrite an admin-configured value just because a default changed.
 *    Only transform a value that is provably still the old untouched default.
 * 2. Prefer additive changes (new tables, columns, indexes, missing settings).
 * 3. The seed below is insert-only (`ON CONFLICT DO NOTHING`). Keep it that way
 *    so a restart or code deploy can never reset balances, multipliers, reward
 *    rules, economy limits, or platform settings.
 * 4. A pending migration takes a verified snapshot first; startup aborts if the
 *    snapshot cannot be created or passes `integrity_check`.
 */
type Migration = {
  version: number;
  name: string;
  /** Plain SQL migrations run first; run() is for changes SQLite cannot express conditionally. */
  sql?: string;
  run?: (db: Database) => void;
};

const migrations: Migration[] = [
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
    name: 'legacy_branding',
    // Applied migrations are immutable: this SQL already ran on existing
    // databases under the old brand. The old value is kept in the WHERE list
    // so a database upgrading from before this migration is still rebranded.
    sql: `
UPDATE settings SET value = '"DonutSpin"'
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
    version: 12,
    name: 'bet_streaks_and_account_reviews',
    sql: `
ALTER TABLE users ADD COLUMN registration_ip TEXT;
ALTER TABLE users ADD COLUMN account_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN account_hold_reason TEXT;
ALTER TABLE users ADD COLUMN account_hold_at TEXT;
CREATE INDEX users_registration_ip_idx ON users(registration_ip);

-- Registration history for the visible IP review, backfilled from sessions when
-- an older database still has a trustworthy address on record.
UPDATE users
   SET registration_ip = (
     SELECT s.ip FROM sessions s
      WHERE s.user_id = users.id AND s.ip IS NOT NULL
      ORDER BY s.created_at ASC LIMIT 1
   )
 WHERE registration_ip IS NULL
   AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.ip IS NOT NULL);

CREATE TABLE account_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cleared','alt_confirmed','resolved')),
  reason TEXT NOT NULL,
  trigger_ip TEXT,
  related_user_ids TEXT NOT NULL DEFAULT '[]',
  related_count INTEGER NOT NULL DEFAULT 1,
  flagged_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  decision_reason TEXT,
  hold_released_at TEXT
);
CREATE INDEX account_reviews_status_idx ON account_reviews(status, flagged_at DESC);
CREATE INDEX account_reviews_user_idx ON account_reviews(user_id);

CREATE TABLE account_review_events (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES account_reviews(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX account_review_events_review_idx ON account_review_events(review_id, created_at);

-- One accepted wager day keeps the daily reward streak honest: merely signing
-- in or browsing never creates a row. The row is written in the same
-- transaction as the wager debit, so rejected or rolled-back bets cannot count.
CREATE TABLE bet_activity_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_day TEXT NOT NULL,
  first_bet_at TEXT NOT NULL,
  PRIMARY KEY (user_id, activity_day)
);
CREATE INDEX bet_activity_days_day_idx ON bet_activity_days(activity_day);
INSERT OR IGNORE INTO bet_activity_days (user_id, activity_day, first_bet_at)
SELECT user_id, substr(created_at, 1, 10), MIN(created_at)
  FROM game_sessions
 WHERE bet > 0 AND wager_ledger_id IS NOT NULL
 GROUP BY user_id, substr(created_at, 1, 10);

INSERT INTO settings (key, value, updated_at)
SELECT 'security.accounts_per_ip', '3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'security.accounts_per_ip');
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
  {
    version: 13,
    name: 'self_service_account_deletion',
    sql: `
ALTER TABLE users ADD COLUMN deleted_at TEXT;

CREATE TABLE account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX account_deletion_requests_user_idx ON account_deletion_requests(user_id, created_at DESC);
`,
  },
  {
    version: 14,
    name: 'game_statistics_and_win_chance',
    // A round records the exact configuration it started with. Existing rounds
    // are deliberately left NULL: we cannot know which historical chance they
    // used, and inventing one would make deviation warnings lie.
    sql: `
ALTER TABLE game_sessions ADD COLUMN config_snapshot TEXT;
ALTER TABLE game_sessions ADD COLUMN configured_win_chance REAL;
CREATE INDEX game_sessions_stats_idx ON game_sessions(status, ended_at);
CREATE INDEX game_sessions_game_settled_idx ON game_sessions(game_id, ended_at DESC);

CREATE TABLE game_config_history (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  previous_config TEXT NOT NULL,
  new_config TEXT NOT NULL,
  previous_win_chance REAL,
  new_win_chance REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX game_config_history_game_idx ON game_config_history(game_id, created_at DESC);
CREATE INDEX game_config_history_actor_idx ON game_config_history(actor_id, created_at DESC);

UPDATE games SET config = json_set(config, '$.winChance', 50)
 WHERE id = 'coinflip' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
UPDATE games SET config = json_set(config, '$.winChance', 40)
 WHERE id = 'mines' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
UPDATE games SET config = json_set(config, '$.winChance', 42)
 WHERE id = 'blackjack' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
UPDATE games SET config = json_set(config, '$.winChance', 48.6)
 WHERE id = 'roulette' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
UPDATE games SET config = json_set(config, '$.winChance', 40)
 WHERE id = 'towers' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
UPDATE games SET config = json_set(config, '$.winChance', 39)
 WHERE id = 'plinko' AND json_valid(config) AND json_extract(config, '$.winChance') IS NULL;
`,
  },
  {
    version: 15,
    name: 'roulette_chip_preferences',
    sql: `
CREATE TABLE game_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roulette_chip_value INTEGER NOT NULL DEFAULT 10 CHECK (roulette_chip_value BETWEEN 1 AND 1000000000000),
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 16,
    name: 'money_rain',
    sql: `
CREATE TABLE rain_events (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  status TEXT NOT NULL DEFAULT 'countdown' CHECK (status IN ('countdown','settled')),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 3600),
  ends_at TEXT NOT NULL,
  settled_at TEXT,
  participant_count INTEGER NOT NULL DEFAULT 0,
  payout_per_participant INTEGER NOT NULL DEFAULT 0,
  remainder_distributed INTEGER NOT NULL DEFAULT 0,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- The partial index is the database-level guarantee that only one joinable
-- rain can exist at a time, even if two creators race past the API check.
CREATE UNIQUE INDEX rain_events_one_active_idx ON rain_events(status) WHERE status = 'countdown';
CREATE INDEX rain_events_created_idx ON rain_events(created_at DESC);

CREATE TABLE rain_participants (
  rain_id TEXT NOT NULL REFERENCES rain_events(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL,
  payout INTEGER,
  payout_ledger_id TEXT REFERENCES ledger(id),
  PRIMARY KEY (rain_id, user_id)
);
CREATE INDEX rain_participants_user_idx ON rain_participants(user_id, joined_at DESC);
`,
  },
  {
    version: 17,
    name: 'rain_refunded_amount_backfill',
    // Migration 16 shipped and was applied on existing databases before the
    // refund column was added to its SQL. Editing an applied migration does not
    // run it again, so those databases need this additive repair. Fresh
    // databases already have the column and the guard makes this a no-op.
    run: (db) => {
      const columns = db.prepare('PRAGMA table_info(rain_events)').all() as { name: string }[];
      if (columns.length === 0) return;
      if (columns.some((column) => column.name === 'refunded_amount')) return;
      db.exec('ALTER TABLE rain_events ADD COLUMN refunded_amount INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 19,
    name: 'giveaways_and_claims',
    // Giveaways keep their prize in escrow, reveal a commitment before the draw
    // and store one unique winner row per entrant so a duplicate payout is
    // impossible at the database level. Sponsor funding is deducted when staff
    // approves the request, before a giveaway can be published.
    sql: `
CREATE TABLE giveaway_sponsorships (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  sponsor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  prize_amount INTEGER NOT NULL CHECK (prize_amount > 0),
  winner_count INTEGER NOT NULL CHECK (winner_count BETWEEN 1 AND 50),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 300 AND 2592000),
  title TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','published','cancelled')),
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_reason TEXT,
  reviewed_at TEXT,
  escrow_ledger_id TEXT REFERENCES ledger(id),
  giveaway_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX giveaway_sponsorships_status_idx ON giveaway_sponsorships(status, created_at DESC);
CREATE INDEX giveaway_sponsorships_sponsor_idx ON giveaway_sponsorships(sponsor_user_id, created_at DESC);

CREATE TABLE giveaways (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  prize_amount INTEGER NOT NULL CHECK (prize_amount > 0),
  winner_count INTEGER NOT NULL CHECK (winner_count BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  funded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  sponsor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  funding_kind TEXT NOT NULL CHECK (funding_kind IN ('staff','sponsor')),
  sponsorship_id TEXT UNIQUE REFERENCES giveaway_sponsorships(id) ON DELETE SET NULL,
  escrow_ledger_id TEXT REFERENCES ledger(id),
  refund_ledger_id TEXT REFERENCES ledger(id),
  draw_commitment TEXT NOT NULL,
  draw_seed TEXT NOT NULL,
  drawn_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX giveaways_status_idx ON giveaways(status, starts_at, ends_at);
CREATE INDEX giveaways_created_idx ON giveaways(created_at DESC);
CREATE INDEX giveaways_sponsor_idx ON giveaways(sponsor_user_id, created_at DESC);

CREATE TABLE giveaway_entries (
  giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);
CREATE INDEX giveaway_entries_user_idx ON giveaway_entries(user_id, joined_at DESC);

CREATE TABLE giveaway_winners (
  id TEXT PRIMARY KEY,
  giveaway_id TEXT NOT NULL REFERENCES giveaways(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  username_snapshot TEXT NOT NULL,
  position INTEGER NOT NULL,
  payout_amount INTEGER NOT NULL CHECK (payout_amount > 0),
  claim_status TEXT NOT NULL DEFAULT 'unclaimed' CHECK (claim_status IN ('unclaimed','pending','approved','rejected')),
  claim_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  payout_ledger_id TEXT REFERENCES ledger(id),
  selected_at TEXT NOT NULL,
  UNIQUE (giveaway_id, user_id),
  UNIQUE (giveaway_id, position)
);
CREATE INDEX giveaway_winners_user_idx ON giveaway_winners(user_id, selected_at DESC);
CREATE INDEX giveaway_winners_claim_idx ON giveaway_winners(claim_status, selected_at DESC);

INSERT INTO support_categories (key, label, description, enabled, default_priority, request_kinds, sort_order)
VALUES
  ('giveaway_claim', 'Giveaway claim', 'Claim a prize you won in a giveaway. Staff verify the win before paying it out.', 1, 'high', '[]', 80),
  ('giveaway_sponsorship', 'Giveaway sponsorship', 'Fund a community giveaway from your balance. Staff review the request first.', 1, 'normal', '[]', 85)
ON CONFLICT(key) DO NOTHING;
`,
  },
  {
    version: 18,
    name: 'concurrent_rains_and_verified_chat',
    sql: `
-- Every active rain is independent now, so the single-active unique index
-- would reject a second creator. The active lookup keeps an index of its own.
DROP INDEX IF EXISTS rain_events_one_active_idx;
CREATE INDEX rain_events_active_idx ON rain_events(status, ends_at) WHERE status = 'countdown';

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL
);
CREATE INDEX chat_messages_created_idx ON chat_messages(created_at DESC);
`,
  },
  {
    version: 20,
    name: 'discord_integration',
    // The bot is a separate process on another host. It reaches this database
    // only through the authenticated bot API, so every link, invite, vouch,
    // code, announcement and outbox row lives here with the website data.
    sql: `
ALTER TABLE giveaways ADD COLUMN banner_url TEXT;
ALTER TABLE giveaways ADD COLUMN discord_message_id TEXT;
ALTER TABLE giveaways ADD COLUMN discord_channel_id TEXT;
ALTER TABLE giveaways ADD COLUMN discord_guild_id TEXT;

CREATE TABLE discord_guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_url TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  owner_discord_id TEXT,
  primary_guild INTEGER NOT NULL DEFAULT 0,
  bot_version TEXT,
  latency_ms INTEGER,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX discord_guilds_primary_idx ON discord_guilds(primary_guild) WHERE primary_guild = 1;

CREATE TABLE discord_guild_config (
  guild_id TEXT PRIMARY KEY REFERENCES discord_guilds(guild_id) ON DELETE CASCADE,
  welcome_channel_id TEXT,
  vouch_channel_id TEXT,
  scam_vouch_channel_id TEXT,
  codes_channel_id TEXT,
  giveaway_channel_id TEXT,
  news_channel_id TEXT,
  changelog_channel_id TEXT,
  logs_channel_id TEXT,
  owner_role_ids TEXT NOT NULL DEFAULT '[]',
  admin_role_ids TEXT NOT NULL DEFAULT '[]',
  staff_role_ids TEXT NOT NULL DEFAULT '[]',
  moderator_role_ids TEXT NOT NULL DEFAULT '[]',
  invite_rewards_enabled INTEGER NOT NULL DEFAULT 1,
  invite_reward_every INTEGER NOT NULL DEFAULT 3,
  invite_reward_amount INTEGER NOT NULL DEFAULT 5000000,
  announcement_everyone INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE discord_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT NOT NULL,
  linked_at TEXT NOT NULL
);
CREATE INDEX discord_links_discord_idx ON discord_links(discord_user_id);

CREATE TABLE discord_link_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX discord_link_codes_user_idx ON discord_link_codes(user_id, created_at DESC);

CREATE TABLE discord_invite_joins (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  inviter_discord_id TEXT,
  inviter_username TEXT,
  invite_code TEXT,
  counted INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  UNIQUE (guild_id, discord_user_id)
);
CREATE INDEX discord_invite_joins_inviter_idx ON discord_invite_joins(guild_id, inviter_discord_id, joined_at DESC);

CREATE TABLE discord_invite_rewards (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  inviter_discord_id TEXT NOT NULL,
  inviter_username TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  threshold_count INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','void')),
  ledger_id TEXT REFERENCES ledger(id),
  created_at TEXT NOT NULL,
  paid_at TEXT,
  UNIQUE (guild_id, inviter_discord_id, threshold_count)
);
CREATE INDEX discord_invite_rewards_user_idx ON discord_invite_rewards(user_id, created_at DESC);

CREATE TABLE discord_vouches (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  voucher_discord_id TEXT NOT NULL,
  voucher_username TEXT NOT NULL,
  target_discord_id TEXT NOT NULL,
  target_username TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('positive','scam')),
  reason TEXT NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX discord_vouches_target_idx ON discord_vouches(guild_id, target_discord_id, created_at DESC);
CREATE INDEX discord_vouches_voucher_idx ON discord_vouches(guild_id, voucher_discord_id, target_discord_id, type, created_at DESC);

CREATE TABLE reward_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  max_redemptions INTEGER NOT NULL CHECK (max_redemptions BETWEEN 1 AND 100000),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  expires_at TEXT,
  disabled_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_via TEXT NOT NULL DEFAULT 'web' CHECK (created_via IN ('web','discord')),
  announcement_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX reward_codes_created_idx ON reward_codes(created_at DESC);

CREATE TABLE reward_code_redemptions (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES reward_codes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  ledger_id TEXT REFERENCES ledger(id),
  source TEXT NOT NULL CHECK (source IN ('web','discord')),
  redeemed_at TEXT NOT NULL,
  UNIQUE (code_id, user_id)
);
CREATE INDEX reward_code_redemptions_user_idx ON reward_code_redemptions(user_id, redeemed_at DESC);

CREATE TABLE discord_announcements (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('news','changelog')),
  title TEXT NOT NULL,
  body TEXT,
  sections TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  footer TEXT,
  author TEXT,
  color TEXT,
  emoji TEXT,
  mention_everyone INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','deleted')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX discord_announcements_kind_idx ON discord_announcements(guild_id, kind, created_at DESC);

CREATE TABLE discord_outbox (
  id TEXT PRIMARY KEY,
  guild_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TEXT NOT NULL,
  locked_until TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX discord_outbox_pending_idx ON discord_outbox(status, available_at);

CREATE TABLE discord_activity (
  id TEXT PRIMARY KEY,
  guild_id TEXT,
  actor_discord_id TEXT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX discord_activity_created_idx ON discord_activity(created_at DESC);
`,
  },
  {
    version: 21,
    name: 'discord_info_panels',
    // Staff can register any number of informational Discord channels without
    // editing code. Categories are website-side labels used to group channels;
    // the bot only needs the real channel ID when a panel is published.
    sql: `
CREATE TABLE discord_info_channels (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES discord_guilds(guild_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (guild_id, channel_id)
);
CREATE INDEX discord_info_channels_guild_idx ON discord_info_channels(guild_id, category, name);

CREATE TABLE discord_panels (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES discord_guilds(guild_id) ON DELETE CASCADE,
  info_channel_id TEXT NOT NULL REFERENCES discord_info_channels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  color TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  footer TEXT,
  links TEXT NOT NULL DEFAULT '[]',
  mention_everyone INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','deleted')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX discord_panels_channel_idx ON discord_panels(info_channel_id, created_at DESC);
`,
  },
  {
    version: 22,
    name: 'donutspin_branding',
    // Rebrand databases created before the rename. Only the historical default
    // names are touched, so a platform name an operator chose is preserved.
    sql: `
UPDATE settings SET value = '"DonutSpin"'
 WHERE key IN ('platform.name', 'email.from_name')
   AND value IN ('"DonutCash"', '"Donutcash"', '"Donut Spin"');
`,
  },
  {
    version: 23,
    name: 'donutspin_email_domain',
    // The seeded sender address used the old brand's local domain. A real
    // operator-configured address is left untouched.
    sql: `
UPDATE settings SET value = '"no-reply@donutspin.local"'
 WHERE key = 'email.from_email' AND value = '"no-reply@donutcash.local"';
`,
  },
];

export function pendingMigrations(db: Database): { version: number; name: string }[] {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name: string } | undefined;
  if (!table) return migrations.map(({ version, name }) => ({ version, name }));
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  return migrations.filter((migration) => !applied.has(migration.version)).map(({ version, name }) => ({ version, name }));
}

export function migrate(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const pending = pendingMigrations(db);
  for (const migration of migrations) {
    if (!pending.some((entry) => entry.version === migration.version)) continue;
    db.transaction(() => {
      if (migration.sql) db.exec(migration.sql);
      migration.run?.(db);
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
    config: { winMultiplier: 1.96, winChance: 50 },
  },
  {
    id: 'mines',
    name: 'Mines',
    description: 'Reveal safe tiles, grow the multiplier, cash out before you hit a mine.',
    config: { maxMines: 20, houseEdge: 0.03, winChance: 40 },
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    description: 'Beat the dealer to 21. Six-deck shoe, dealer stands on 17.',
    config: { decks: 6, dealerStandsSoft17: true, blackjackPays: 1.5, allowDouble: true, winChance: 42 },
  },
  {
    id: 'roulette',
    name: 'Roulette',
    description: 'European single-zero wheel with inside and outside bets.',
    config: { maxBetsPerSpin: 10, winChance: 48.6 },
  },
  {
    id: 'towers',
    name: 'Towers',
    description: 'Climb nine floors. One trap per floor. Cash out any time.',
    config: { levels: 9, houseEdge: 0.03, winChance: 40 },
  },
  {
    id: 'plinko',
    name: 'Plinko',
    description: 'Drop the ball and let the pegs decide your multiplier.',
    config: { enabledRisks: ['low', 'medium', 'high'], winChance: 39 },
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
      'rain.min_amount': 10_000,
      'rain.max_amount': 5_000_000,
      'security.session_days': options.sessionDays,
      'security.accounts_per_ip': 3,
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
      'email.from_name': 'DonutSpin',
      'email.from_email': 'no-reply@donutspin.local',
      'email.reply_to': '',
      'email.security_notifications': true,
      'email.reward_notifications': true,
    };
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(key, JSON.stringify(value), now);
    }
  })();
}
