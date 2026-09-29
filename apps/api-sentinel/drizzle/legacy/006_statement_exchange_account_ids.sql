-- Compatibility migration for existing Sentinel databases.
ALTER TABLE statements ADD COLUMN exchange_account_ids TEXT;
