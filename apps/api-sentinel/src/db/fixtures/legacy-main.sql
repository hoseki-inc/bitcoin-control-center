-- Frozen application schema from apps/api-sentinel/src/db.ts at cb78f11 (main).
-- Captured after its original 14 migrations, independently of the Drizzle files.
-- Keep this fixture stable so upgrade tests cannot accidentally test only the
-- schema produced by the new migration implementation. All seed data is synthetic.

CREATE TABLE _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO _migrations (id, name, applied_at) VALUES
  (1, '001_initial', '2026-08-27 00:00:01'),
  (2, '002_signing_flow', '2026-08-27 00:00:02'),
  (3, '003_statements_v2', '2026-08-27 00:00:03'),
  (4, '004_exchange_external_id', '2026-08-27 00:00:04'),
  (5, '005_add_robinhood_provider', '2026-08-27 00:00:05'),
  (6, '006_statement_exchange_account_ids', '2026-08-27 00:00:06'),
  (7, '007_manual_accounts', '2026-08-27 00:00:07'),
  (8, '008_exchange_statement_txs', '2026-08-27 00:00:08'),
  (9, '009_etf_holdings', '2026-08-27 00:00:09'),
  (10, '010_add_kraken_provider', '2026-08-27 00:00:10'),
  (11, '011_exchange_credentials_connected_at', '2026-08-27 00:00:11'),
  (12, '012_account_history_syncs', '2026-08-27 00:00:12'),
  (13, '013_account_history_sync_version', '2026-08-27 00:00:13'),
  (14, '014_archive_accounts', '2026-08-27 00:00:14');

CREATE TABLE account_history_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_block_height INTEGER NOT NULL,
  to_block_height INTEGER NOT NULL,
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')), sync_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(account_id, from_block_height, to_block_height)
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  network TEXT NOT NULL DEFAULT 'mainnet',
  descriptor TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, status TEXT NOT NULL DEFAULT 'pending', deleted_at TEXT);
CREATE TABLE balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  is_satisfied INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE discovery_cache (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_used_receive_index INTEGER NOT NULL DEFAULT 0,
  last_used_change_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE etf_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE etf_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
CREATE TABLE etf_holdings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares TEXT NOT NULL,
  date_purchased TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE "exchange_accounts" (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('coinbase', 'strike', 'robinhood', 'kraken')),
  display_name TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  balance_sats TEXT,
  balance_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  external_account_id TEXT
, credentials_connected_at TEXT);
CREATE TABLE exchange_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
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
CREATE TABLE keystores (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  wallet TEXT,
  model TEXT,
  derivation_path TEXT,
  xpub TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE manual_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  balance_sats TEXT NOT NULL DEFAULT '0',
  balance_as_of TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE manual_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  balance_sats TEXT NOT NULL,
  UNIQUE(account_id, timestamp)
);
CREATE TABLE manual_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'transfer_in', 'transfer_out')),
  amount_sats TEXT NOT NULL,
  transacted_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE signed_messages (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  keystore_id TEXT NOT NULL REFERENCES keystores(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  message_text TEXT NOT NULL,
  signature TEXT,
  signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  opening_date TEXT NOT NULL,
  closing_date TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  user_name TEXT,
  user_address TEXT,
  transaction_map TEXT,
  daily_rates TEXT,
  counter INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, exchange_account_ids TEXT);
CREATE INDEX idx_account_history_syncs_account_blocks
  ON account_history_syncs(account_id, from_block_height, to_block_height);

INSERT INTO accounts VALUES
  ('wallet', 'mainnet', 'synthetic-descriptor', 'Wallet', '2026-08-01 00:00:00', 'verified', NULL),
  ('archived', 'testnet', 'synthetic-archived-descriptor', 'Archived', '2026-08-02 00:00:00', 'expired', '2026-08-31T12:00:00Z');
INSERT INTO discovery_cache VALUES ('wallet', 23, 17, '2026-09-01T12:00:00Z');
INSERT INTO balance_snapshots VALUES
  (7, 'wallet', '2026-08-01T00:00:00Z', '2100000000000000'),
  (18, 'archived', '2026-08-02T00:00:00Z', '123456789');
INSERT INTO account_history_syncs VALUES
  (25, 'wallet', 800000, 900000, '2026-08-01', '2026-09-01', '2026-09-02T00:00:00Z', 2);
INSERT INTO keystores VALUES
  ('keystore', 'wallet', 'Signing wallet', 'synthetic-wallet', 'synthetic-model', 'm/84/0/0', 'synthetic-xpub', '2026-08-01T01:00:00Z');
INSERT INTO challenges VALUES
  ('challenge', 'wallet', 1, '2026-08-01T02:00:00Z', '2026-08-01T01:00:00Z');
INSERT INTO signed_messages VALUES
  ('message', 'challenge', 'keystore', 'synthetic-address', 'Synthetic ownership message', 'synthetic-signature', '2026-08-01T02:00:00Z', '2026-08-01T01:00:00Z');
INSERT INTO exchange_accounts VALUES
  ('exchange', 'coinbase', 'Exchange', 'synthetic-ciphertext', '987654321', '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z', 'synthetic-external-account', '2026-08-15T00:00:00Z');
INSERT INTO exchange_balance_snapshots VALUES
  (31, 'exchange', '2026-08-01T00:00:00Z', '111'),
  (42, 'exchange', '2026-09-01T00:00:00Z', '987654321');
INSERT INTO exchange_statement_txs VALUES
  ('exchange-tx', 'exchange', 'synthetic-external-tx', '2026-08-10T00:00:00Z', 'buy', '0.12345678', '12345.67', '1.23', '0.00000001', '100000.00', 'Synthetic import', 'synthetic-tx-hash', '2026-08', '2026-09-01T00:00:00Z');
INSERT INTO manual_accounts VALUES
  ('manual', 'Manual', '500000001', '2026-09-01T00:00:00Z', '2026-08-01T00:00:00Z');
INSERT INTO manual_transactions VALUES
  ('manual-tx', 'manual', 'transfer_in', '500000001', '2026-08-01T00:00:00Z', 'Synthetic note', '2026-08-01T01:00:00Z');
INSERT INTO manual_balance_snapshots VALUES
  (53, 'manual', '2026-08-01T00:00:00Z', '500000001');
INSERT INTO etf_accounts VALUES ('etf', 'ETF', '2026-08-01T00:00:00Z');
INSERT INTO etf_holdings VALUES ('holding', 'etf', 'IBIT', '12.3456', '2026-08-01', '2026-08-01T00:00:00Z');
INSERT INTO etf_balance_snapshots VALUES (64, 'etf', '2026-08-01T00:00:00Z', '654321');
INSERT INTO settings VALUES
  ('user_name', 'Synthetic User'),
  ('electrum_host', '127.0.0.1'),
  ('electrum_port', '50001'),
  ('electrum_protocol', 'tcp'),
  ('tor_enabled', 'false');
INSERT INTO statements VALUES
  ('statement', 'completed', 'America/New_York', '2026-08-01', '2026-08-31', '["wallet","archived"]', 'Synthetic User', 'Synthetic Address', '{"exchange":["exchange-tx"],"manual":["manual-tx"]}', '{"2026-08-01":"90000.00"}', 123, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', '["exchange"]');
