-- Track credential age separately from account age. Reconnects should
-- refresh this timestamp without changing account ids or snapshot history.
ALTER TABLE exchange_accounts ADD COLUMN credentials_connected_at TEXT;
--> statement-breakpoint
UPDATE exchange_accounts
SET credentials_connected_at = created_at
WHERE credentials_connected_at IS NULL;
