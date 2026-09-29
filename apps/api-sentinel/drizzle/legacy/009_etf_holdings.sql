-- Compatibility migration for existing Sentinel databases.
-- ETF holding accounts (computed BTC balance from shares × btcPerShare)
      CREATE TABLE etf_accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
--> statement-breakpoint
-- Individual ETF holdings within an account
      CREATE TABLE etf_holdings (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
        ticker TEXT NOT NULL,
        shares TEXT NOT NULL,
        date_purchased TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
--> statement-breakpoint
-- Balance snapshots for chart data (balance changes daily due to expense ratio decay)
      CREATE TABLE etf_balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        balance_sats TEXT NOT NULL,
        UNIQUE(account_id, timestamp)
      );
