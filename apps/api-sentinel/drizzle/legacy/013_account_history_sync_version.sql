-- Compatibility migration for existing Sentinel databases.
-- Version sync rows so old/incomplete history reconstructions can be
      -- invalidated without deleting the user's snapshot history.
      ALTER TABLE account_history_syncs ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
