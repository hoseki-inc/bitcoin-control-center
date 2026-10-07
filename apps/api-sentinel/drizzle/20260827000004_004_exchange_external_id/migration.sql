-- Store the Coinbase BTC account UUID so we can fetch transaction history
ALTER TABLE exchange_accounts ADD COLUMN external_account_id TEXT;
