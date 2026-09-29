-- HISTORICAL FAULT: the old runner executed these PRAGMAs inside a transaction,
-- where SQLite ignores foreign_keys changes. Dropping exchange_accounts could
-- cascade-delete balance snapshots and imported statement transactions.
-- Drizzle/libSQL disables foreign keys BEFORE its migration transaction, making
-- this rebuild safe. Do not execute this file through a runner that leaves
-- foreign keys enabled inside the batch.

-- Add 'kraken' to exchange_accounts provider CHECK constraint.
-- SQLite cannot ALTER CHECK constraints, so recreate the table.
-- Disable foreign keys to prevent CASCADE deletes from wiping snapshots.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE exchange_accounts_new (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('coinbase', 'strike', 'robinhood', 'kraken')),
  display_name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  balance_sats TEXT,
  balance_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  external_account_id TEXT
);
--> statement-breakpoint
INSERT INTO exchange_accounts_new
  SELECT id, provider, display_name, encrypted_credentials, balance_sats, balance_as_of, created_at, external_account_id
  FROM exchange_accounts;
--> statement-breakpoint
DROP TABLE exchange_accounts;
--> statement-breakpoint
ALTER TABLE exchange_accounts_new RENAME TO exchange_accounts;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
