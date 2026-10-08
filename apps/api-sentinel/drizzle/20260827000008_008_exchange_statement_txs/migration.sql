CREATE TABLE exchange_statement_txs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  transacted_at TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_btc TEXT NOT NULL,
  amount_usd TEXT,
  fee_usd TEXT,
  fee_btc TEXT,
  exchange_rate TEXT,
  description TEXT,
  tx_hash TEXT,
  statement_month TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);
