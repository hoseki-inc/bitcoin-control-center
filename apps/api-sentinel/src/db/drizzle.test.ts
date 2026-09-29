import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { Client, Row } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { type SentinelDb, openDrizzleDatabase } from './drizzle'
import {
  accounts,
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

async function databaseState(client: Client): Promise<{ schema: Row[]; data: Row[][] }> {
  const schema = await client.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
  const data = await Promise.all(
    schema.rows.map(async (row) => {
      const name = parseUnknown(z.string(), row['name']).expect('Expected a table name')
      return (await client.execute(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)).rows
    }),
  )
  return { schema: schema.rows, data }
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

function futureMigrations(sql: string): string {
  const directory = testDirectory()
  cpSync(migrationFolder, directory, { recursive: true })
  const migration = join(directory, '20260930000000_rebuild_account_and_statement_tables')
  mkdirSync(migration)
  writeFileSync(join(migration, 'migration.sql'), sql)
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
    expect((await first.$client.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys']).toBe(1)
    expect((await first.$client.execute('PRAGMA journal_mode')).rows[0]?.['journal_mode']).toBe('wal')
    await expect(
      first.$client.execute(
        "INSERT INTO balance_snapshots (account_id, timestamp, balance_sats) VALUES ('missing', '2026-01-01', '1')",
      ),
    ).rejects.toThrow('FOREIGN KEY constraint failed')
    expect((await first.$client.execute('SELECT name FROM __drizzle_migrations')).rows).toEqual([
      { name: baselineName },
    ])
    state = await databaseState(first.$client)
  } finally {
    first.$client.close()
  }

  const second = await openDrizzleDatabase(directory, logger)
  try {
    await expect(databaseState(second.$client)).resolves.toEqual(state)
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
    const before = await databaseState(database.$client)
    const folder = futureMigrations(
      [rebuildTable('exchange_accounts'), rebuildTable('statements')].join('\n--> statement-breakpoint\n'),
    )
    await migrate(database, { migrationsFolder: folder })
    const after = await databaseState(database.$client)
    // Only the Drizzle journal gains a row; every application table keeps its data.
    const journalIndex = before.schema.findIndex((row) => row['name'] === '__drizzle_migrations')
    expect(after.data.filter((_, index) => index !== journalIndex)).toEqual(
      before.data.filter((_, index) => index !== journalIndex),
    )
    expect((await database.$client.execute('SELECT name FROM __drizzle_migrations')).rows).toHaveLength(2)
    expect((await database.$client.execute('PRAGMA foreign_key_check')).rows).toEqual([])
    expect((await database.$client.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys']).toBe(1)
    await migrate(database, { migrationsFolder: folder })
    await expect(databaseState(database.$client)).resolves.toEqual(after)
  } finally {
    database.$client.close()
  }
})

it('rolls back failed migration data and journal changes, then permits retry', async () => {
  const database = await openDrizzleDatabase(testDirectory(), logger)
  try {
    await seedHistory(database)
    const before = await databaseState(database.$client)
    const folder = futureMigrations(
      [
        "UPDATE settings SET value = 'changed' WHERE key = 'test';",
        rebuildTable('exchange_accounts'),
        'INSERT INTO missing_table VALUES (1);',
      ].join('\n--> statement-breakpoint\n'),
    )
    await expect(migrate(database, { migrationsFolder: folder })).rejects.toThrow('no such table')
    await expect(databaseState(database.$client)).resolves.toEqual(before)
    expect((await database.$client.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys']).toBe(1)
    writeFileSync(
      join(folder, '20260930000000_rebuild_account_and_statement_tables', 'migration.sql'),
      rebuildTable('exchange_accounts'),
    )
    await migrate(database, { migrationsFolder: folder })
    expect((await database.$client.execute('SELECT name FROM __drizzle_migrations')).rows).toHaveLength(2)
    expect((await database.$client.execute('SELECT * FROM exchange_balance_snapshots')).rows).toHaveLength(1)
  } finally {
    database.$client.close()
  }
})
