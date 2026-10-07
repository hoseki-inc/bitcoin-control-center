-- On-chain accounts (xpubs/descriptors the user is tracking)
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL DEFAULT 'mainnet',
  descriptor TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Address discovery cache for faster subsequent scans
CREATE TABLE discovery_cache (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_used_receive_index INTEGER NOT NULL DEFAULT 0,
  last_used_change_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Historical balance snapshots for chart data
CREATE TABLE balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
--> statement-breakpoint
-- Exchange accounts (Coinbase/Strike API key connections)
CREATE TABLE exchange_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('coinbase', 'strike')),
  display_name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  balance_sats TEXT,
  balance_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Exchange balance snapshots for chart data
CREATE TABLE exchange_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
--> statement-breakpoint
-- Generated statements
CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  pdf_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- App settings (key-value store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
