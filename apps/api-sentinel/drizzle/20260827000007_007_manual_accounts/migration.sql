-- Manually added holdings (user-entered BTC balances)
CREATE TABLE manual_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  balance_sats TEXT NOT NULL DEFAULT '0',
  balance_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- User-entered transactions for manual accounts
CREATE TABLE manual_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'transfer_in', 'transfer_out')),
  amount_sats TEXT NOT NULL,
  transacted_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Historical balance snapshots for chart data
CREATE TABLE manual_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
