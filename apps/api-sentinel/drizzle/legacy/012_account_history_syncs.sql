-- Compatibility migration for existing Sentinel databases.
-- Track self-custody history ranges that have been backfilled from Electrum.
      CREATE TABLE account_history_syncs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        from_block_height INTEGER NOT NULL,
        to_block_height INTEGER NOT NULL,
        range_start TEXT NOT NULL,
        range_end TEXT NOT NULL,
        synced_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, from_block_height, to_block_height)
      );
--> statement-breakpoint
CREATE INDEX idx_account_history_syncs_account_blocks
        ON account_history_syncs(account_id, from_block_height, to_block_height);
