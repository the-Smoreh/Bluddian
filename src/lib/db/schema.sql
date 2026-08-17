-- Bluddian schema. Applied idempotently at boot by src/lib/db/index.ts.
-- Money is ALWAYS stored as integer minor units (cents). Never floats.
-- Timestamps are unix epoch milliseconds (integer).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- identity --

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL DEFAULT 'Founder',
  password_hash  TEXT NOT NULL,          -- scrypt$N$r$p$salt$hash
  totp_secret    TEXT,                   -- encrypted blob, null until 2FA enrolled
  totp_enabled   INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT,                   -- encrypted JSON array of unused code hashes
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Sessions store only a SHA-256 of the cookie token, so a DB leak alone
-- cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  csrf_secret  TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

-- --------------------------------------------------------------- integrations

-- Third-party credentials. `ciphertext` is AES-256-GCM; the plaintext key never
-- leaves the server and is never serialised into any API response.
CREATE TABLE IF NOT EXISTS credentials (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,             -- anthropic | whop | shopify
  name        TEXT NOT NULL,             -- admin_api_key | api_key | shop_domain | ...
  ciphertext  TEXT NOT NULL,
  hint        TEXT NOT NULL DEFAULT '',  -- last 4 chars, safe to display
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(provider, name)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL,             -- running | ok | error
  message     TEXT NOT NULL DEFAULT '',
  items       INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_provider ON sync_runs(provider, started_at DESC);

-- ------------------------------------------------------------------ catalog --

CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'product',  -- product | course | bundle | membership | service
  platform     TEXT NOT NULL DEFAULT 'manual',   -- whop | shopify | manual
  external_id  TEXT,
  status       TEXT NOT NULL DEFAULT 'idea',     -- idea | building | live | paused | archived
  price_cents  INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  url          TEXT,
  emoji        TEXT NOT NULL DEFAULT 'package',
  notes        TEXT NOT NULL DEFAULT '',
  launch_at    INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE(platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Course-specific fields live alongside rather than inside products so a
-- course is still a first-class product for revenue rollups.
CREATE TABLE IF NOT EXISTS course_meta (
  product_id     TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  lessons_total  INTEGER NOT NULL DEFAULT 0,
  lessons_done   INTEGER NOT NULL DEFAULT 0,
  students       INTEGER NOT NULL DEFAULT 0,
  completion_pct INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  platform    TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  email       TEXT,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(platform, external_id)
);

-- One row per money event. `net_cents` is what actually lands in your pocket.
CREATE TABLE IF NOT EXISTS sales (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL DEFAULT 'manual',
  external_id  TEXT,
  product_id   TEXT REFERENCES products(id) ON DELETE SET NULL,
  customer_id  TEXT REFERENCES customers(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL DEFAULT '',   -- denormalised so history survives deletes
  gross_cents  INTEGER NOT NULL DEFAULT 0,
  fees_cents   INTEGER NOT NULL DEFAULT 0,
  refund_cents INTEGER NOT NULL DEFAULT 0,
  net_cents    INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'paid', -- paid | pending | refunded | failed
  is_recurring INTEGER NOT NULL DEFAULT 0,
  occurred_at  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_time     ON sales(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_product  ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_platform ON sales(platform, occurred_at DESC);

-- -------------------------------------------------------------- claude usage --

CREATE TABLE IF NOT EXISTS claude_usage (
  id             TEXT PRIMARY KEY,
  day            TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  model          TEXT NOT NULL DEFAULT 'unknown',
  workspace      TEXT NOT NULL DEFAULT '',
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  cache_write    INTEGER NOT NULL DEFAULT 0,
  cost_cents     INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'manual', -- admin_api | manual
  created_at     INTEGER NOT NULL,
  UNIQUE(day, model, workspace, source)
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON claude_usage(day DESC);

-- What you're actually building with Claude, so cost has something to point at.
CREATE TABLE IF NOT EXISTS claude_projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active', -- active | shipped | parked
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- the game --

CREATE TABLE IF NOT EXISTS goals (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'revenue', -- revenue | sales | students | custom
  target_value  INTEGER NOT NULL DEFAULT 0,      -- cents when kind=revenue, else a count
  start_value   INTEGER NOT NULL DEFAULT 0,
  manual_value  INTEGER NOT NULL DEFAULT 0,      -- used when kind=custom
  unit          TEXT NOT NULL DEFAULT 'USD',
  period        TEXT NOT NULL DEFAULT 'all',     -- all | month | quarter | year
  deadline      INTEGER,
  xp_reward     INTEGER NOT NULL DEFAULT 500,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | done | failed | archived
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

CREATE TABLE IF NOT EXISTS quests (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  cadence      TEXT NOT NULL DEFAULT 'daily',  -- daily | weekly | once
  xp           INTEGER NOT NULL DEFAULT 50,
  target       INTEGER NOT NULL DEFAULT 1,
  progress     INTEGER NOT NULL DEFAULT 0,
  period_key   TEXT NOT NULL,                  -- e.g. 2026-08-17 or 2026-W33
  completed_at INTEGER,
  created_at   INTEGER NOT NULL,
  UNIQUE(title, period_key)
);
CREATE INDEX IF NOT EXISTS idx_quests_period ON quests(period_key);

CREATE TABLE IF NOT EXISTS player (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  xp             INTEGER NOT NULL DEFAULT 0,
  streak_days    INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active    TEXT NOT NULL DEFAULT '',      -- YYYY-MM-DD
  updated_at     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS xp_events (
  id         TEXT PRIMARY KEY,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xp_time ON xp_events(created_at DESC);

CREATE TABLE IF NOT EXISTS achievements (
  code       TEXT PRIMARY KEY,
  earned_at  INTEGER NOT NULL
);

-- --------------------------------------------------------------- protection --

-- Persistent token buckets so restarting the server can't be used to reset a
-- brute-force budget.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,
  tokens     REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rl_updated ON rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC);
