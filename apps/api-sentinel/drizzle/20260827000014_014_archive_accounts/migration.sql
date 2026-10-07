-- Soft-delete support: archive accounts instead of hard-deleting so
-- historical balance snapshots survive in portfolio charts.
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
