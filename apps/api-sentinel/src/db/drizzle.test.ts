import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { initDatabase } from '../db'
import { openDrizzleDatabase } from './drizzle'
import { accounts, exchangeAccounts, settings } from './schema'

const logger = pino({ level: 'silent' })
const legacyFolder = new URL('../../drizzle/legacy/', import.meta.url)
const names = [
  '001_initial',
  '002_signing_flow',
  '003_statements_v2',
  '004_exchange_external_id',
  '005_add_robinhood_provider',
  '006_statement_exchange_account_ids',
  '007_manual_accounts',
  '008_exchange_statement_txs',
  '009_etf_holdings',
  '010_add_kraken_provider',
  '011_exchange_credentials_connected_at',
  '012_account_history_syncs',
  '013_account_history_sync_version',
  '014_archive_accounts',
]

function testDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-libsql-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function legacyDatabase(directory: string, version: number): Database.Database {
  const raw = new Database(join(directory, 'sentinel.db'))
  raw.exec(`CREATE TABLE _migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  for (const name of names.slice(0, version)) {
    const migration = readFileSync(new URL(`${name}.sql`, legacyFolder), 'utf8').replaceAll(
      '--> statement-breakpoint',
      '',
    )
    raw.pragma('foreign_keys = OFF')
    raw.transaction(() => {
      raw.exec(migration)
      raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name)
    })()
    raw.pragma('foreign_keys = ON')
  }
  return raw
}

it('initializes and reopens a local SQLite file using Drizzle migrations', async () => {
  const directory = testDirectory()
  const first = await openDrizzleDatabase(directory, logger)
  try {
    await first.db.insert(accounts).values({ id: 'wallet', descriptor: 'test-descriptor', displayName: 'Wallet' })
    await first.db.insert(settings).values({ key: 'test', value: 'persisted' })
    expect((await first.client.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys']).toBe(1)
    await expect(
      first.client.execute(
        "INSERT INTO balance_snapshots (account_id, timestamp, balance_sats) VALUES ('missing', '2026-01-01', '1')",
      ),
    ).rejects.toThrow('FOREIGN KEY constraint failed')
  } finally {
    first.close()
  }

  const second = await openDrizzleDatabase(directory, logger)
  try {
    await expect(second.db.select().from(settings).where(eq(settings.key, 'test'))).resolves.toMatchObject([
      { key: 'test', value: 'persisted' },
    ])
    expect((await second.client.execute('SELECT count(*) AS count FROM __drizzle_migrations')).rows[0]?.['count']).toBe(
      1,
    )
  } finally {
    second.close()
  }
})

it.each([4, 9, 14])('upgrades legacy version %i without losing exchange history', async (version) => {
  const directory = testDirectory()
  const raw = legacyDatabase(directory, version)
  raw
    .prepare(`INSERT INTO exchange_accounts
    (id, provider, display_name, encrypted_credentials, balance_sats)
    VALUES ('exchange', 'coinbase', 'Test', 'synthetic-ciphertext', '123')`)
    .run()
  raw
    .prepare(`INSERT INTO exchange_balance_snapshots
    (account_id, timestamp, balance_sats) VALUES ('exchange', '2026-01-01', '123')`)
    .run()
  if (version >= 9) {
    raw
      .prepare(`INSERT INTO exchange_statement_txs
      (id, account_id, external_id, transacted_at, type, amount_btc, statement_month)
      VALUES ('tx', 'exchange', 'external', '2026-01-01', 'buy', '1', '2026-01')`)
      .run()
  }
  if (version === 14) {
    raw
      .prepare(
        "INSERT INTO accounts (id, descriptor, display_name) VALUES ('wallet', 'synthetic-descriptor', 'Wallet')",
      )
      .run()
    raw
      .prepare(`INSERT INTO balance_snapshots (account_id, timestamp, balance_sats)
      VALUES ('wallet', '2026-01-01', '100')`)
      .run()
    raw
      .prepare(`INSERT INTO account_history_syncs
      (account_id, from_block_height, to_block_height, range_start, range_end)
      VALUES ('wallet', 1, 2, '2026-01-01', '2026-01-02')`)
      .run()
    raw
      .prepare(`INSERT INTO statements (id, opening_date, closing_date, account_ids, transaction_map)
      VALUES ('statement', '2026-01-01', '2026-01-31', '["wallet"]', '{"wallet":[]}')`)
      .run()
  }
  raw.close()

  const database = await openDrizzleDatabase(directory, logger)
  try {
    await expect(
      database.db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'exchange')),
    ).resolves.toMatchObject([{ encryptedCredentials: 'synthetic-ciphertext', balanceSats: '123' }])
    expect((await database.client.execute('SELECT * FROM exchange_balance_snapshots')).rows).toHaveLength(1)
    expect((await database.client.execute('SELECT * FROM exchange_statement_txs')).rows).toHaveLength(
      version >= 9 ? 1 : 0,
    )
    expect((await database.client.execute('PRAGMA foreign_key_check')).rows).toHaveLength(0)
    expect((await database.client.execute('SELECT name FROM _migrations')).rows).toHaveLength(14)
    expect((await database.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(1)
    if (version === 14) {
      expect(
        (await database.client.execute('SELECT balance_sats FROM balance_snapshots')).rows[0]?.['balance_sats'],
      ).toBe('100')
      expect((await database.client.execute('SELECT * FROM account_history_syncs')).rows).toHaveLength(1)
      expect(
        (await database.client.execute('SELECT transaction_map FROM statements')).rows[0]?.['transaction_map'],
      ).toBe('{"wallet":[]}')
    }
  } finally {
    database.close()
  }
})

it.each([0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13])('upgrades from legacy version %i', async (version) => {
  const directory = testDirectory()
  legacyDatabase(directory, version).close()
  const database = await openDrizzleDatabase(directory, logger)
  try {
    expect((await database.client.execute('SELECT name FROM _migrations')).rows).toHaveLength(14)
    expect((await database.client.execute('PRAGMA foreign_key_check')).rows).toHaveLength(0)
  } finally {
    database.close()
  }
})

it.each([4, 9])('preserves exchange history with the current startup migrator at version %i', (version) => {
  const directory = testDirectory()
  const raw = legacyDatabase(directory, version)
  raw
    .prepare(`INSERT INTO exchange_accounts (id, provider, display_name, encrypted_credentials)
    VALUES ('exchange', 'coinbase', 'Test', 'synthetic-ciphertext')`)
    .run()
  raw
    .prepare(`INSERT INTO exchange_balance_snapshots (account_id, timestamp, balance_sats)
    VALUES ('exchange', '2026-01-01', '123')`)
    .run()
  if (version >= 9) {
    raw
      .prepare(`INSERT INTO exchange_statement_txs
      (id, account_id, external_id, transacted_at, type, amount_btc, statement_month)
      VALUES ('tx', 'exchange', 'external', '2026-01-01', 'buy', '1', '2026-01')`)
      .run()
  }
  raw.close()

  const database = initDatabase(directory, logger)
  try {
    expect(database.db.prepare('SELECT * FROM exchange_balance_snapshots').all()).toHaveLength(1)
    expect(database.db.prepare('SELECT * FROM exchange_statement_txs').all()).toHaveLength(version >= 9 ? 1 : 0)
    expect(database.db.pragma('foreign_key_check')).toHaveLength(0)
  } finally {
    database.close()
  }
})

it('rolls back a failed legacy upgrade and allows retry', async () => {
  const directory = testDirectory()
  const raw = legacyDatabase(directory, 4)
  raw.exec('CREATE TABLE exchange_accounts_new (id TEXT PRIMARY KEY)')
  raw.close()
  await expect(openDrizzleDatabase(directory, logger)).rejects.toThrow('already exists')

  const inspect = new Database(join(directory, 'sentinel.db'))
  expect(inspect.prepare('SELECT name FROM _migrations').all()).toHaveLength(4)
  expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()).toBeUndefined()
  inspect.exec('DROP TABLE exchange_accounts_new')
  inspect.close()

  const retry = await openDrizzleDatabase(directory, logger)
  try {
    expect((await retry.client.execute('SELECT name FROM _migrations')).rows).toHaveLength(14)
  } finally {
    retry.close()
  }
})

it('refuses to adopt unknown migration history', async () => {
  const directory = testDirectory()
  const raw = legacyDatabase(directory, 4)
  raw.prepare("UPDATE _migrations SET name = 'unexpected' WHERE name = '004_exchange_external_id'").run()
  raw.close()

  await expect(openDrizzleDatabase(directory, logger)).rejects.toThrow('Unknown or out-of-order legacy')
  const inspect = new Database(join(directory, 'sentinel.db'))
  try {
    expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()).toBeUndefined()
  } finally {
    inspect.close()
  }
})

it('refuses to migrate a database with orphaned history', async () => {
  const directory = testDirectory()
  const raw = legacyDatabase(directory, 4)
  raw.pragma('foreign_keys = OFF')
  raw
    .prepare(`INSERT INTO exchange_balance_snapshots (account_id, timestamp, balance_sats)
    VALUES ('missing', '2026-01-01', '123')`)
    .run()
  raw.close()

  await expect(openDrizzleDatabase(directory, logger)).rejects.toThrow('broken foreign key references')
  const inspect = new Database(join(directory, 'sentinel.db'))
  try {
    expect(inspect.prepare('SELECT name FROM _migrations').all()).toHaveLength(4)
  } finally {
    inspect.close()
  }
})
