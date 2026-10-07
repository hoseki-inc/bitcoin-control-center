-- HISTORICAL FAULT: this migration discarded the stub statements table without
-- copying its rows. Keep the original SQL as migration history, not as a model
-- for future migrations. Fully upgraded internal profiles already applied it;
-- journal adoption skips it. New v1 profiles run it before storing user data.
-- Startup refuses partially migrated legacy profiles rather than replaying it.

-- Replace stub statements table with full schema for statement generation
DROP TABLE IF EXISTS statements;
--> statement-breakpoint
CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  opening_date TEXT NOT NULL,
  closing_date TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  user_name TEXT,
  user_address TEXT,
  transaction_map TEXT,
  daily_rates TEXT,
  counter INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
