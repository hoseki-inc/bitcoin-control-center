import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Value } from '@libsql/client'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from './drizzle'
import {
  accounts,
  balanceSnapshots,
  exchangeAccounts,
  exchangeBalanceSnapshots,
  exchangeStatementTxs,
  settings,
  statements,
} from './schema'

const logger = pino({ level: 'silent' })
const migrationFolder = new URL('../../drizzle/', import.meta.url)
const baselineName = '20260929113903_initial_sentinel_schema'

function testDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-libsql-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

// Inspect every physical table, including Drizzle's journal, so migration tests
// detect changes outside the application's current schema too.
async function databaseState(db: SentinelDb): Promise<{
  schema: { name: string; sql: string | null }[]
  data: Record<string, Value>[][]
}> {
  const schema = await db.all<{ name: string; sql: string | null }>(
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`,
  )
  const data = await Promise.all(
    schema.map(async (row) =>
      db.all<Record<string, Value>>(sql`SELECT * FROM ${sql.identifier(row.name)} ORDER BY rowid`),
    ),
  )
  return { schema, data }
}

async function seedHistory(db: SentinelDb): Promise<void> {
  await db.insert(settings).values({ key: 'test', value: 'persisted' })
  await db.insert(exchangeAccounts).values({
    id: 'exchange',
    provider: 'coinbase',
    displayName: 'Test',
    encryptedCredentials: 'synthetic-ciphertext',
    balanceSats: '123',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'exchange',
    timestamp: '2026-01-01',
    balanceSats: '123',
  })
  await db.insert(exchangeStatementTxs).values({
    id: 'transaction',
    accountId: 'exchange',
    externalId: 'external',
    transactedAt: '2026-01-01',
    type: 'buy',
    amountBtc: '1',
    statementMonth: '2026-01',
  })
  await db.insert(statements).values({
    id: 'statement',
    status: 'completed',
    openingDate: '2026-01-01',
    closingDate: '2026-01-31',
    accountIds: '[]',
    exchangeAccountIds: '["exchange"]',
    transactionMap: '{"exchange":["transaction"]}',
    dailyRates: '{"2026-01-01":"90000"}',
  })
}

function futureMigrations(migrationSql: string): string {
  const directory = testDirectory()
  cpSync(migrationFolder, directory, { recursive: true })
  const migration = join(directory, '20260930000000_rebuild_account_and_statement_tables')
  mkdirSync(migration)
  writeFileSync(join(migration, 'migration.sql'), migrationSql)
  return directory
}

function rebuildTable(table: string): string {
  const baseline = readMigrationFiles({ migrationsFolder: fileURLToPath(migrationFolder) })[0]
  const create = baseline?.sql.find((statement) => statement.trim().startsWith(`CREATE TABLE \`${table}\``))
  if (create === undefined) {
    throw new Error(`Missing table definition: ${table}`)
  }
  return [
    create.replaceAll(`\`${table}\``, `\`${table}_new\``).replaceAll(`"${table}"`, `"${table}_new"`),
    `INSERT INTO ${table}_new SELECT * FROM ${table};`,
    `DROP TABLE ${table};`,
    `ALTER TABLE ${table}_new RENAME TO ${table};`,
  ].join('\n--> statement-breakpoint\n')
}

it('initializes the named baseline and reopens without changing persisted data or migration history', async () => {
  const directory = testDirectory()
  const first = await openDrizzleDatabase(directory, logger)
  let state: Awaited<ReturnType<typeof databaseState>>
  try {
    await first.insert(accounts).values({ id: 'wallet', descriptor: 'test-descriptor', displayName: 'Wallet' })
    await seedHistory(first)
    await expect(first.all(sql`PRAGMA foreign_keys`)).resolves.toEqual([{ foreign_keys: 1 }])
    await expect(first.all(sql`PRAGMA journal_mode`)).resolves.toEqual([{ journal_mode: 'wal' }])
    await expect(
      first.insert(balanceSnapshots).values({ accountId: 'missing', timestamp: '2026-01-01', balanceSats: '1' }),
    ).rejects.toHaveProperty('cause.message', expect.stringContaining('FOREIGN KEY constraint failed'))
    await expect(first.all(sql`SELECT name FROM __drizzle_migrations`)).resolves.toEqual([{ name: baselineName }])
    state = await databaseState(first)
  } finally {
    first.$client.close()
  }

  const second = await openDrizzleDatabase(directory, logger)
  try {
    await expect(databaseState(second)).resolves.toEqual(state)
    await expect(second.select().from(settings).where(eq(settings.key, 'test'))).resolves.toMatchObject([
      { key: 'test', value: 'persisted' },
    ])
  } finally {
    second.$client.close()
  }
})

it('preserves statements and exchange history when Drizzle rebuilds populated tables', async () => {
  const database = await openDrizzleDatabase(testDirectory(), logger)
  try {
    await seedHistory(database)
    const before = await databaseState(database)
    const folder = futureMigrations(
      [rebuildTable('exchange_accounts'), rebuildTable('statements')].join('\n--> statement-breakpoint\n'),
    )
    await migrate(database, { migrationsFolder: folder })
    const after = await databaseState(database)
    // Only the Drizzle journal gains a row; every application table keeps its data.
    const journalIndex = before.schema.findIndex((row) => row.name === '__drizzle_migrations')
    expect(after.data.filter((_, index) => index !== journalIndex)).toEqual(
      before.data.filter((_, index) => index !== journalIndex),
    )
    await expect(database.all(sql`SELECT name FROM __drizzle_migrations`)).resolves.toHaveLength(2)
    await expect(database.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
    await expect(database.all(sql`PRAGMA foreign_keys`)).resolves.toEqual([{ foreign_keys: 1 }])
    await migrate(database, { migrationsFolder: folder })
    await expect(databaseState(database)).resolves.toEqual(after)
  } finally {
    database.$client.close()
  }
})

it('rolls back failed migration data and journal changes, then permits retry', async () => {
  const database = await openDrizzleDatabase(testDirectory(), logger)
  try {
    await seedHistory(database)
    const before = await databaseState(database)
    const folder = futureMigrations(
      [
        "UPDATE settings SET value = 'changed' WHERE key = 'test';",
        rebuildTable('exchange_accounts'),
        'INSERT INTO missing_table VALUES (1);',
      ].join('\n--> statement-breakpoint\n'),
    )
    await expect(migrate(database, { migrationsFolder: folder })).rejects.toThrow('no such table')
    await expect(databaseState(database)).resolves.toEqual(before)
    await expect(database.all(sql`PRAGMA foreign_keys`)).resolves.toEqual([{ foreign_keys: 1 }])
    writeFileSync(
      join(folder, '20260930000000_rebuild_account_and_statement_tables', 'migration.sql'),
      rebuildTable('exchange_accounts'),
    )
    await migrate(database, { migrationsFolder: folder })
    await expect(database.all(sql`SELECT name FROM __drizzle_migrations`)).resolves.toHaveLength(2)
    await expect(database.select().from(exchangeBalanceSnapshots)).resolves.toHaveLength(1)
  } finally {
    database.$client.close()
  }
})
