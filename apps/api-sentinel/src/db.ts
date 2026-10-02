import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'

export interface SentinelDatabase {
  readonly db: Database.Database
  close(): void
}

/**
 * Initialize SQLite database with schema migrations.
 * Migrations run inline on startup - no separate CLI step needed.
 */
export function initDatabase(dataDir: string, logger: Logger): SentinelDatabase {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = join(dataDir, 'sentinel.db')
  logger.info({ path: dbPath }, 'Opening SQLite database')

  const db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db, logger)

  return {
    db,
    close(): void {
      db.close()
    },
  }
}

// ─── Migrations ──────────────────────────────────────────────────────────────

function runMigrations(db: Database.Database, logger: Logger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = new Set(
    db
      .prepare<unknown[], { name: string }>('SELECT name FROM _migrations')
      .all()
      .map((row) => row.name),
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) {
      continue
    }
    logger.info({ migration: migration.name }, 'Applying migration')
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name)
    })()
  }
}

interface Migration {
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_initial',
    sql: `
      -- On-chain accounts (xpubs/descriptors the user is tracking)
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL DEFAULT 'mainnet',
        descriptor TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Address discovery cache for faster subsequent scans
      CREATE TABLE discovery_cache (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        last_used_receive_index INTEGER NOT NULL DEFAULT 0,
        last_used_change_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Historical balance snapshots for chart data
      CREATE TABLE balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        balance_sats TEXT NOT NULL,
        UNIQUE(account_id, timestamp)
      );

      -- Exchange accounts (Coinbase/Strike API key connections)
      CREATE TABLE exchange_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('coinbase', 'strike')),
        display_name TEXT NOT NULL,
        encrypted_credentials TEXT NOT NULL,
        balance_sats TEXT,
        balance_as_of TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Exchange balance snapshots for chart data
      CREATE TABLE exchange_balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        balance_sats TEXT NOT NULL,
        UNIQUE(account_id, timestamp)
      );

      -- Generated statements
      CREATE TABLE statements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        account_ids TEXT NOT NULL,
        pdf_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- App settings (key-value store)
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    name: '002_signing_flow',
    sql: `
      -- Keystores linked to an account (wallet info for signing)
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

      -- Challenges for proving ownership of an account
      CREATE TABLE challenges (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        is_satisfied INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Signed messages (challenge messages to be signed by the hardware wallet)
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

      -- Track verification status on accounts
      ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
    `,
  },
  {
    name: '003_statements_v2',
    sql: `
      -- Replace stub statements table with full schema for statement generation
      DROP TABLE IF EXISTS statements;

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
      );
    `,
  },
  {
    name: '004_exchange_external_id',
    sql: `
      -- Store the Coinbase BTC account UUID so we can fetch transaction history
      ALTER TABLE exchange_accounts ADD COLUMN external_account_id TEXT;
    `,
  },
  {
    name: '005_add_robinhood_provider',
    sql: `
      -- Add 'robinhood' to exchange_accounts provider CHECK constraint.
      -- SQLite cannot ALTER CHECK constraints, so recreate the table.
      -- Disable foreign keys to prevent CASCADE deletes from wiping snapshots.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE exchange_accounts_new (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('coinbase', 'strike', 'robinhood')),
        display_name TEXT NOT NULL,
        encrypted_credentials TEXT NOT NULL,
        balance_sats TEXT,
        balance_as_of TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        external_account_id TEXT
      );

      INSERT INTO exchange_accounts_new
        SELECT id, provider, display_name, encrypted_credentials, balance_sats, balance_as_of, created_at, external_account_id
        FROM exchange_accounts;

      DROP TABLE exchange_accounts;
      ALTER TABLE exchange_accounts_new RENAME TO exchange_accounts;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    name: '006_statement_exchange_account_ids',
    sql: `
      ALTER TABLE statements ADD COLUMN exchange_account_ids TEXT;
    `,
  },
  {
    name: '007_manual_accounts',
    sql: `
      -- Manually added holdings (user-entered BTC balances)
      CREATE TABLE manual_accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        balance_sats TEXT NOT NULL DEFAULT '0',
        balance_as_of TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- User-entered transactions for manual accounts
      CREATE TABLE manual_transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'transfer_in', 'transfer_out')),
        amount_sats TEXT NOT NULL,
        transacted_at TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Historical balance snapshots for chart data
      CREATE TABLE manual_balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES manual_accounts(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        balance_sats TEXT NOT NULL,
        UNIQUE(account_id, timestamp)
      );
    `,
  },
  {
    name: '008_exchange_statement_txs',
    sql: `
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
    `,
  },
  {
    name: '009_etf_holdings',
    sql: `
      -- ETF holding accounts (computed BTC balance from shares × btcPerShare)
      CREATE TABLE etf_accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Individual ETF holdings within an account
      CREATE TABLE etf_holdings (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
        ticker TEXT NOT NULL,
        shares TEXT NOT NULL,
        date_purchased TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Balance snapshots for chart data (balance changes daily due to expense ratio decay)
      CREATE TABLE etf_balance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES etf_accounts(id) ON DELETE CASCADE,
        timestamp TEXT NOT NULL,
        balance_sats TEXT NOT NULL,
        UNIQUE(account_id, timestamp)
      );
    `,
  },
  {
    name: '010_add_kraken_provider',
    sql: `
      -- Add 'kraken' to exchange_accounts provider CHECK constraint.
      -- SQLite cannot ALTER CHECK constraints, so recreate the table.
      -- Disable foreign keys to prevent CASCADE deletes from wiping snapshots.
      PRAGMA foreign_keys = OFF;

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

      INSERT INTO exchange_accounts_new
        SELECT id, provider, display_name, encrypted_credentials, balance_sats, balance_as_of, created_at, external_account_id
        FROM exchange_accounts;

      DROP TABLE exchange_accounts;
      ALTER TABLE exchange_accounts_new RENAME TO exchange_accounts;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    name: '011_exchange_credentials_connected_at',
    sql: `
      -- Track credential age separately from account age. Reconnects should
      -- refresh this timestamp without changing account ids or snapshot history.
      ALTER TABLE exchange_accounts ADD COLUMN credentials_connected_at TEXT;

      UPDATE exchange_accounts
      SET credentials_connected_at = created_at
      WHERE credentials_connected_at IS NULL;
    `,
  },
  {
    name: '012_account_history_syncs',
    sql: `
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

      CREATE INDEX idx_account_history_syncs_account_blocks
        ON account_history_syncs(account_id, from_block_height, to_block_height);
    `,
  },
  {
    name: '013_account_history_sync_version',
    sql: `
      -- Version sync rows so old/incomplete history reconstructions can be
      -- invalidated without deleting the user's snapshot history.
      ALTER TABLE account_history_syncs ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    name: '014_archive_accounts',
    sql: `
      -- Soft-delete support: archive accounts instead of hard-deleting so
      -- historical balance snapshots survive in portfolio charts.
      ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
    `,
  },
  {
    name: '015_desktop_connection_profiles',
    sql: `
      -- Named Electrum connections saved by the desktop app, each with its own Tor setting.
      CREATE TABLE desktop_connection_profiles (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
        protocol TEXT NOT NULL CHECK(protocol IN ('tcp', 'ssl')),
        tor_enabled INTEGER NOT NULL CHECK(tor_enabled IN (0, 1)),
        revision INTEGER NOT NULL DEFAULT 1
      );
    `,
  },
]
