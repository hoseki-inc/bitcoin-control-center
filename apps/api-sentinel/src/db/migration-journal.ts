import { Err, Ok, type Result } from '@hoseki/packages/result'
import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { SentinelDb } from './drizzle'

export const migrationsTable = '_migrations'

const legacyNames = [
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
const profilesLegacyName = '015_desktop_connection_profiles'
const quotesLegacyName = '015_btc_quote_cache'
const currencyLegacyName = '016_statement_quote_currency'

function unsupportedHistory(): Result<void, Error> {
  return Err(
    new Error(
      'Unsupported Sentinel migration history. Keep the data directory intact and use a compatible build to verify or finish upgrades before retrying.',
    ),
  )
}

/** Convert metadata only; Drizzle is the sole runner for application migrations. */
export async function prepareMigrationJournal(db: SentinelDb, folder: string): Promise<Result<void, Error>> {
  const migrations = readMigrationFiles({ migrationsFolder: folder })
  const imported = legacyNames.map((name, index) => {
    const folderName = `202608270000${String(index + 1).padStart(2, '0')}_${name}`
    return migrations.find((migration) => migration.name === folderName)
  })
  if (imported.some((migration) => migration === undefined)) {
    return Err(new Error('The Sentinel package is missing imported migration files'))
  }
  const profilesMigration = migrations.find((migration) => migration.name.endsWith('_desktop_connection_profiles'))
  if (profilesMigration === undefined) {
    return Err(new Error('The Sentinel package is missing the desktop connection profiles migration'))
  }
  const quotesMigration = migrations.find((migration) => migration.name.endsWith('_btc_quote_cache'))
  const currencyMigration = migrations.find((migration) => migration.name.endsWith('_statement_quote_currency'))
  if (quotesMigration === undefined || currencyMigration === undefined) {
    return Err(new Error('The Sentinel package is missing statement quote migrations'))
  }
  const optionalMigrations = new Map([
    [profilesLegacyName, profilesMigration],
    [quotesLegacyName, quotesMigration],
    [currencyLegacyName, currencyMigration],
  ])

  const tables = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
  const applicationTables = tables.filter((table) => !table.name.startsWith('sqlite_'))
  if (!applicationTables.some((table) => table.name === migrationsTable)) {
    return applicationTables.length === 0 ? Ok(undefined) : unsupportedHistory()
  }

  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(migrationsTable)})`)
  const names = columns
    .map((column) => column.name)
    .sort()
    .join(',')
  const applied = await db.all<{ id: number; name: string; applied_at: string }>(
    sql`SELECT id, name, applied_at FROM ${sql.identifier(migrationsTable)} ORDER BY id`,
  )
  if (names === 'applied_at,created_at,hash,id,name') {
    // A failed fresh migration can leave an empty journal, but no application
    // tables. Never run the historical destructive SQL over an unknown profile.
    if (applied.length === 0) {
      return applicationTables.length === 1 ? Ok(undefined) : unsupportedHistory()
    }
    const appliedNames = new Set(applied.map((row) => row.name))
    const localNames = new Set(migrations.map((migration) => migration.name))
    return imported.every((migration) => migration !== undefined && appliedNames.has(migration.name)) &&
      applied.every((row) => localNames.has(row.name)) &&
      appliedNames.size === applied.length
      ? Ok(undefined)
      : unsupportedHistory()
  }
  if (
    names !== 'applied_at,id,name' ||
    applied.length < legacyNames.length ||
    applied.length > legacyNames.length + optionalMigrations.size ||
    !legacyNames.every((name) => applied.some((row) => row.name === name)) ||
    applied.some((row) => !legacyNames.includes(row.name) && !optionalMigrations.has(row.name)) ||
    (applied.some((row) => row.name === currencyLegacyName) && !applied.some((row) => row.name === quotesLegacyName)) ||
    new Set(applied.map((row) => row.name)).size !== applied.length
  ) {
    return unsupportedHistory()
  }

  // Existing profiles have all 14 original migrations, optionally followed by
  // main's desktop connections and statement quote migrations. Preserve their journal IDs and applied
  // times, and never replay application SQL during adoption.
  await db.transaction(async (tx) => {
    await tx.run(sql`CREATE TABLE _migrations_drizzle (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at NUMERIC,
      name TEXT,
      applied_at TEXT
    )`)
    for (const row of applied) {
      const migration = optionalMigrations.get(row.name) ?? imported[legacyNames.indexOf(row.name)]
      if (migration === undefined) {
        throw new Error('Missing imported migration')
      }
      await tx.run(sql`INSERT INTO _migrations_drizzle (id, hash, created_at, name, applied_at)
        VALUES (${row.id}, ${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${row.applied_at})`)
    }
    await tx.run(sql`DROP TABLE ${sql.identifier(migrationsTable)}`)
    await tx.run(sql`ALTER TABLE _migrations_drizzle RENAME TO ${sql.identifier(migrationsTable)}`)
  })
  return Ok(undefined)
}
