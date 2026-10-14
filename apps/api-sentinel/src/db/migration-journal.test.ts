import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseUnknown } from '@hoseki/packages/result'
import type { Value } from '@libsql/client'
import { createClient } from '@libsql/client/sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { Encrypted, initEncryption, loadCredentialEncryptionKey } from '../lib/encrypted'
import { type SentinelDb, openDrizzleDatabase } from './drizzle'
import { migrationsTable, prepareMigrationJournal } from './migration-journal'

const logger = pino({ level: 'silent' })
const folder = fileURLToPath(new URL('../../drizzle/', import.meta.url))
const migrations = readMigrationFiles({ migrationsFolder: folder })
const fixture = readFileSync(new URL('./fixtures/legacy-main.sql', import.meta.url), 'utf8')
const profilesFixture = readFileSync(
  new URL('./fixtures/legacy-desktop-connection-profiles.sql', import.meta.url),
  'utf8',
)
const quotesFixture = readFileSync(new URL('./fixtures/legacy-statement-quotes.sql', import.meta.url), 'utf8')

function testDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-journal-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

function rawDatabase(directory: string): SentinelDb {
  const db = drizzle({ client: createClient({ url: pathToFileURL(join(directory, 'sentinel.db')).href }) })
  onTestFinished(() => {
    db.$client.close()
  })
  return db
}

async function legacyDatabase(directory: string, withProfiles = true, withQuotes = withProfiles): Promise<SentinelDb> {
  const db = rawDatabase(directory)
  await db.run(sql`PRAGMA foreign_keys = ON`)
  await db.$client.executeMultiple(fixture)
  if (withProfiles) {
    await db.$client.executeMultiple(profilesFixture)
  }
  if (withQuotes) {
    await db.$client.executeMultiple(quotesFixture)
  }
  return db
}

async function databaseState(
  db: SentinelDb,
  includeJournal = false,
): Promise<{
  schema: { type: string; name: string; tbl_name: string; sql: string | null }[]
  data: { table: string; rows: Record<string, Value>[] }[]
}> {
  const schema = await db.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    sql`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`,
  )
  const selected = schema.filter((row) => includeJournal || row.tbl_name !== migrationsTable)
  const data = await Promise.all(
    selected
      .filter((row) => row.type === 'table')
      .map(async (row) => {
        const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(row.name)})`)
        // Explicit columns avoid libSQL's cached SELECT * metadata after ALTER TABLE.
        const selection = sql.join(
          columns.map((column) => sql.identifier(column.name)),
          sql`, `,
        )
        return {
          table: row.name,
          rows: await db.all<Record<string, Value>>(
            sql`SELECT ${selection} FROM ${sql.identifier(row.name)} ORDER BY rowid`,
          ),
        }
      }),
  )
  return { schema: selected, data }
}

it.each(['file', 'database'] as const)(
  'adopts a fully upgraded main profile without changing any application data or its %s credential key',
  async (keyLocation) => {
    const directory = testDirectory()
    const legacy = await legacyDatabase(directory)
    const key = '01'.repeat(32)
    const plaintext = '{"synthetic":"exchange-credentials"}'
    initEncryption(key)
    const ciphertext = Encrypted.encrypt(plaintext).unwrap().blob
    await legacy.run(sql`UPDATE exchange_accounts SET encrypted_credentials = ${ciphertext}`)
    const keyPath = join(directory, 'secrets', 'exchange-credentials.key')
    if (keyLocation === 'file') {
      mkdirSync(join(directory, 'secrets'))
      writeFileSync(keyPath, `${key}\n`, { mode: 0o600 })
    } else {
      await legacy.run(sql`INSERT INTO settings (key, value) VALUES ('encryption_key', ${key})`)
    }
    const before = await databaseState(legacy)
    const applicationTables = before.data.filter((table) => table.table !== 'sqlite_sequence')
    expect(applicationTables).toHaveLength(21)
    expect(applicationTables.every((table) => table.rows.length > 0)).toBe(true)
    const oldJournal = await legacy.all<{ id: number; applied_at: string }>(
      sql`SELECT id, applied_at FROM _migrations ORDER BY id`,
    )
    legacy.$client.close()

    const upgraded = await openDrizzleDatabase(directory, logger)
    try {
      // Upgrading adds the statement counter, which starts from the highest existing number, a
      // transaction source on statements, unknown for those made before it, and an empty record of
      // price history downloads.
      const upgradedState = await databaseState(upgraded)
      const statementsSql = (state: typeof before): string | null | undefined =>
        state.schema.find((row) => row.name === 'statements')?.sql
      expect(statementsSql(upgradedState)).toBe(
        statementsSql(before)?.replace(
          /\)$/,
          `, \`tx_source\` text CONSTRAINT "statements_tx_source_check" CHECK("tx_source" IN ('electrum', 'node_mempool', 'public_mempool')))`,
        ),
      )
      expect({
        schema: upgradedState.schema
          .filter((row) => !['statement_counter', 'btc_quote_downloads'].includes(row.tbl_name))
          .map((row) => (row.name === 'statements' ? before.schema.find((old) => old.name === 'statements') : row)),
        data: upgradedState.data
          .filter((table) => !['statement_counter', 'btc_quote_downloads'].includes(table.table))
          .map((table) => ({
            table: table.table,
            rows:
              table.table === 'statements'
                ? table.rows.map(({ tx_source, ...row }) => {
                    expect(tx_source).toBeNull()
                    return row
                  })
                : table.table === 'btc_quote_lookups'
                  ? table.rows.map(({ expires_at, ...row }) => {
                      // Saved lookups are all looked up again, since prices are no longer kept forever.
                      expect(expires_at).toBe(0)
                      return row
                    })
                  : table.rows,
          })),
      }).toEqual({
        ...before,
        data: before.data.map((table) =>
          table.table === 'btc_quote_lookups'
            ? {
                table: table.table,
                rows: table.rows.map((row) =>
                  Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'expires_at')),
                ),
              }
            : table,
        ),
      })
      await expect(upgraded.all(sql`SELECT * FROM statement_counter`)).resolves.toEqual([{ id: 1, last_counter: 123 }])
      await expect(upgraded.all(sql`SELECT * FROM btc_quote_downloads`)).resolves.toEqual([])
      const journal = await upgraded.all<{ id: number; hash: string; created_at: number; name: string }>(
        sql`SELECT * FROM _migrations ORDER BY id`,
      )
      // Adopted entries keep their IDs and applied times; later migrations are applied normally.
      expect(journal.slice(0, oldJournal.length)).toEqual(
        migrations.slice(0, oldJournal.length).map((migration, index) => ({
          id: oldJournal[index]?.id,
          applied_at: oldJournal[index]?.applied_at,
          hash: migration.hash,
          created_at: migration.folderMillis,
          name: migration.name,
        })),
      )
      expect(
        journal.slice(oldJournal.length).map(({ hash, created_at, name }) => ({ hash, created_at, name })),
      ).toEqual(
        migrations
          .slice(oldJournal.length)
          .map((migration) => ({ hash: migration.hash, created_at: migration.folderMillis, name: migration.name })),
      )
      await expect(
        upgraded.all(
          sql`SELECT name FROM sqlite_master WHERE name IN ('_migrations', '__drizzle_migrations', '_migrations_drizzle')`,
        ),
      ).resolves.toEqual([{ name: '_migrations' }])
      await expect(upgraded.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
      await expect(upgraded.all(sql`PRAGMA integrity_check`)).resolves.toEqual([{ integrity_check: 'ok' }])
      const loaded = await loadCredentialEncryptionKey({ dataDir: directory, db: upgraded, logger })
      expect(loaded.key).toBe(key)
      expect(readFileSync(keyPath, 'utf8')).toBe(`${key}\n`)
      initEncryption(loaded.key)
      const [stored] = await upgraded.all<{ encrypted_credentials: string }>(
        sql`SELECT encrypted_credentials FROM exchange_accounts WHERE id = 'exchange'`,
      )
      expect(stored?.encrypted_credentials).toBe(ciphertext)
      expect(
        Encrypted.fromString(stored?.encrypted_credentials ?? '')
          .unwrap()
          .decrypt()
          .unwrap(),
      ).toBe(plaintext)
      const after = await databaseState(upgraded, true)
      upgraded.$client.close()
      const reopened = await openDrizzleDatabase(directory, logger)
      try {
        await expect(databaseState(reopened, true)).resolves.toEqual(after)
        const reloaded = await loadCredentialEncryptionKey({ dataDir: directory, db: reopened, logger })
        expect(reloaded.key).toBe(key)
      } finally {
        reopened.$client.close()
      }
    } finally {
      upgraded.$client.close()
    }
  },
)

it.each(['legacy', 'drizzle'] as const)(
  'upgrades an earlier 14-migration %s profile without replaying historical SQL',
  async (history) => {
    const directory = testDirectory()
    const earlier = await legacyDatabase(directory, false)
    if (history === 'drizzle') {
      expect((await prepareMigrationJournal(earlier, folder)).isOk()).toBe(true)
      const oldFolder = join(testDirectory(), 'drizzle')
      mkdirSync(oldFolder)
      for (const migration of migrations.slice(0, 14)) {
        cpSync(join(folder, migration.name), join(oldFolder, migration.name), { recursive: true })
      }
      await migrate(earlier, { migrationsFolder: oldFolder, migrationsTable })
    }
    const before = await databaseState(earlier)
    earlier.$client.close()
    const upgraded = await openDrizzleDatabase(directory, logger)
    try {
      const after = await databaseState(upgraded)
      const addedTables = new Set([
        'desktop_connection_profiles',
        'btc_quote_cache',
        'btc_quote_lookups',
        'statement_counter',
        'btc_quote_downloads',
      ])
      expect({
        schema: after.schema
          .filter((row) => !addedTables.has(row.tbl_name))
          .map((row) => (row.name === 'statements' ? before.schema.find((old) => old.name === 'statements') : row)),
        data: after.data
          .filter((row) => !addedTables.has(row.table))
          .map((table) => ({
            table: table.table,
            rows:
              table.table === 'statements'
                ? table.rows.map(({ quote_currency, error_message, tx_source, ...row }) => {
                    expect(quote_currency).toBe('USD')
                    expect(error_message).toBeNull()
                    expect(tx_source).toBeNull()
                    return row
                  })
                : table.rows,
          })),
      }).toEqual(before)
      await expect(upgraded.all(sql`SELECT * FROM desktop_connection_profiles`)).resolves.toEqual([])
      await expect(upgraded.all(sql`SELECT * FROM statement_counter`)).resolves.toEqual([{ id: 1, last_counter: 123 }])
      await expect(upgraded.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(migrations.length)
      const completed = await databaseState(upgraded, true)
      upgraded.$client.close()
      const reopened = await openDrizzleDatabase(directory, logger)
      try {
        await expect(databaseState(reopened, true)).resolves.toEqual(completed)
      } finally {
        reopened.$client.close()
      }
    } finally {
      upgraded.$client.close()
    }
  },
)

it.each([false, true])('upgrades a legacy profile with desktop connections and quote cache %s', async (withCache) => {
  const directory = testDirectory()
  const legacy = await legacyDatabase(directory, true, false)
  if (withCache) {
    await legacy.$client.executeMultiple(quotesFixture.split('ALTER TABLE statements')[0] ?? '')
    await legacy.run(sql`INSERT INTO _migrations (name) VALUES ('015_btc_quote_cache')`)
    await legacy.run(sql`INSERT INTO btc_quote_cache (provider_url, quote_currency, timestamp, price)
      VALUES ('https://example.invalid', 'CAD', 1785542400, '81000')`)
  }
  const before = await legacy.all(sql`SELECT id, daily_rates, transaction_map FROM statements`)
  legacy.$client.close()
  const upgraded = await openDrizzleDatabase(directory, logger)
  try {
    await expect(upgraded.all(sql`SELECT id, daily_rates, transaction_map FROM statements`)).resolves.toEqual(before)
    await expect(upgraded.all(sql`SELECT quote_currency, error_message FROM statements`)).resolves.toEqual([
      { quote_currency: 'USD', error_message: null },
    ])
    await expect(upgraded.all(sql`SELECT quote_currency, price FROM btc_quote_cache`)).resolves.toEqual(
      withCache ? [{ quote_currency: 'CAD', price: '81000' }] : [],
    )
    await expect(upgraded.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(migrations.length)
    await expect(upgraded.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
  } finally {
    upgraded.$client.close()
  }
})

it.each([
  [14, false, false],
  [15, true, false],
  [17, true, true],
] as const)(
  'converts a %i-migration profile, then clears only messages for unfinished verifications',
  async (count, withProfiles, withQuotes) => {
    const directory = testDirectory()
    const legacy = await legacyDatabase(directory, withProfiles, withQuotes)
    await expect(legacy.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(count)
    await legacy.run(sql`INSERT INTO challenges (id, account_id, is_satisfied, completed_at, created_at)
      VALUES ('unfinished', 'wallet', 0, NULL, '2026-08-02T00:00:00Z')`)
    await legacy.run(sql`INSERT INTO signed_messages
      (id, challenge_id, keystore_id, address, message_text, signature, signed_at, created_at)
      VALUES ('unfinished-message', 'unfinished', 'keystore', 'synthetic-address', 'Unfinished proof',
        'synthetic-signature', '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z')`)
    legacy.$client.close()

    const upgraded = await openDrizzleDatabase(directory, logger)
    try {
      await expect(upgraded.all(sql`SELECT id FROM signed_messages ORDER BY id`)).resolves.toEqual([{ id: 'message' }])
      await expect(upgraded.all(sql`SELECT id FROM challenges ORDER BY id`)).resolves.toEqual([
        { id: 'challenge' },
        { id: 'unfinished' },
      ])
      const journal = await upgraded.all<{ name: string }>(sql`SELECT name FROM _migrations ORDER BY id`)
      expect(journal.map(({ name }) => name)).toEqual(migrations.map((migration) => migration.name))
    } finally {
      upgraded.$client.close()
    }
  },
)

it('creates the same application schema from scratch as an upgraded main fixture', async () => {
  const legacyDirectory = testDirectory()
  ;(await legacyDatabase(legacyDirectory)).$client.close()
  const legacy = await openDrizzleDatabase(legacyDirectory, logger)
  const fresh = await openDrizzleDatabase(testDirectory(), logger)
  try {
    const tables = await legacy.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    for (const table of tables) {
      if (table.name === migrationsTable) {
        continue
      }
      for (const pragma of ['table_info', 'foreign_key_list', 'index_list']) {
        const query = sql`PRAGMA ${sql.identifier(pragma)}(${sql.identifier(table.name)})`
        const expected = await legacy.all(query)
        await expect(fresh.all(query)).resolves.toEqual(expected)
      }
      const indexes = await legacy.all<{ name: string }>(sql`PRAGMA index_list(${sql.identifier(table.name)})`)
      for (const index of indexes) {
        const query = sql`PRAGMA index_xinfo(${sql.identifier(index.name)})`
        const expected = await legacy.all(query)
        await expect(fresh.all(query)).resolves.toEqual(expected)
      }
    }
    await expect(fresh.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(migrations.length)
    await expect(fresh.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
    // CHECK constraints are not exposed by a SQLite PRAGMA.
    await expect(
      fresh.run(
        sql`INSERT INTO exchange_accounts (id, provider, display_name, encrypted_credentials) VALUES ('invalid', 'unknown', 'Invalid', 'synthetic')`,
      ),
    ).rejects.toHaveProperty('cause.message', expect.stringContaining('CHECK constraint failed'))
    await expect(
      fresh.run(
        sql`INSERT INTO statements (id, status, opening_date, closing_date, account_ids) VALUES ('invalid', 'unknown', '2026-01-01', '2026-01-31', '[]')`,
      ),
    ).rejects.toHaveProperty('cause.message', expect.stringContaining('CHECK constraint failed'))
    for (const db of [fresh, legacy]) {
      await expect(
        db.run(
          sql`INSERT INTO statements (id, opening_date, closing_date, account_ids, tx_source) VALUES ('invalid', '2026-01-01', '2026-01-31', '[]', 'unknown')`,
        ),
      ).rejects.toHaveProperty('cause.message', expect.stringContaining('CHECK constraint failed'))
    }
  } finally {
    legacy.$client.close()
    fresh.$client.close()
  }
})

it.each(['partial legacy', 'unknown legacy', 'missing journal', 'unknown drizzle', 'partial drizzle'])(
  'refuses %s history without changing stored data or metadata',
  async (history) => {
    const directory = testDirectory()
    const db = await legacyDatabase(directory)
    if (history.endsWith('drizzle')) {
      expect((await prepareMigrationJournal(db, folder)).isOk()).toBe(true)
    }
    if (history.startsWith('partial')) {
      await db.run(sql`DELETE FROM _migrations WHERE id = 3`)
    } else if (history.startsWith('unknown')) {
      await db.run(sql`UPDATE _migrations SET name = 'unknown_migration' WHERE id = 14`)
    } else {
      await db.run(sql`DROP TABLE _migrations`)
    }
    const before = await databaseState(db, true)
    db.$client.close()
    await expect(openDrizzleDatabase(directory, logger)).rejects.toThrow('Unsupported Sentinel migration history')
    const unchanged = rawDatabase(directory)
    await expect(databaseState(unchanged, true)).resolves.toEqual(before)
  },
)

it.each([6, 17])('rolls back journal conversion interrupted at write %i and safely retries it', async (failureAt) => {
  const db = await legacyDatabase(testDirectory())
  const before = await databaseState(db, true)
  const transaction = db.transaction.bind(db)
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(async (run, config) =>
    transaction(async (tx) => {
      const execute = tx.run.bind(tx)
      let count = 0
      vi.spyOn(tx, 'run').mockImplementation((query) => {
        count += 1
        if (count === failureAt) {
          throw new Error('Simulated interruption after journal writes')
        }
        return execute(query)
      })
      return run(tx)
    }, config),
  )
  await expect(prepareMigrationJournal(db, folder)).rejects.toThrow('Simulated interruption')
  spy.mockRestore()
  await expect(databaseState(db, true)).resolves.toEqual(before)
  expect((await prepareMigrationJournal(db, folder)).isOk()).toBe(true)
  await migrate(db, { migrationsFolder: folder, migrationsTable })
  const applicationBefore = await databaseState(db)
  expect((await prepareMigrationJournal(db, folder)).isOk()).toBe(true)
  await expect(databaseState(db)).resolves.toEqual(applicationBefore)
})

it('retries a failed fresh initialization without treating its empty Drizzle journal as a legacy profile', async () => {
  const directory = testDirectory()
  const migrationFolder = join(directory, 'drizzle')
  cpSync(folder, migrationFolder, { recursive: true })
  const last = migrations.at(-1)
  if (last === undefined) {
    throw new Error('Missing imported migrations')
  }
  const migrationPath = join(migrationFolder, last.name, 'migration.sql')
  writeFileSync(
    migrationPath,
    `${readFileSync(migrationPath, 'utf8')}\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);`,
  )
  const failed = rawDatabase(directory)
  await expect(migrate(failed, { migrationsFolder: migrationFolder, migrationsTable })).rejects.toThrow('no such table')
  await expect(failed.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).resolves.toEqual([
    { name: migrationsTable },
  ])
  failed.$client.close()
  const retried = await openDrizzleDatabase(directory, logger)
  try {
    await expect(retried.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(migrations.length)
    await expect(retried.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
  } finally {
    retried.$client.close()
  }
})

it.each(['fresh', 'legacy'] as const)(
  'applies and retries future Drizzle migrations through the same %s journal',
  async (profile) => {
    const directory = testDirectory()
    const migrationFolder = join(directory, 'drizzle')
    cpSync(folder, migrationFolder, { recursive: true })
    const next = join(migrationFolder, '20270101000000_add_account_upgrade_marker')
    mkdirSync(next)
    const db = profile === 'legacy' ? await legacyDatabase(directory) : rawDatabase(directory)
    expect((await prepareMigrationJournal(db, folder)).isOk()).toBe(true)
    await migrate(db, { migrationsFolder: folder, migrationsTable })
    const before = await databaseState(db, true)
    const migrationSql = 'ALTER TABLE accounts ADD COLUMN upgrade_marker TEXT;'
    writeFileSync(
      join(next, 'migration.sql'),
      `${migrationSql}\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);`,
    )
    await expect(migrate(db, { migrationsFolder: migrationFolder, migrationsTable })).rejects.toThrow('no such table')
    await expect(databaseState(db, true)).resolves.toEqual(before)
    writeFileSync(join(next, 'migration.sql'), migrationSql)
    await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
    const after = await databaseState(db, true)
    expect(
      after.data
        .map((table) => ({
          ...table,
          rows: table.table === 'accounts' ? table.rows.map(({ upgrade_marker: _marker, ...row }) => row) : table.rows,
        }))
        .filter((table) => table.table !== migrationsTable),
    ).toEqual(before.data.filter((table) => table.table !== migrationsTable))
    await expect(db.all(sql`SELECT name FROM _migrations`)).resolves.toHaveLength(migrations.length + 1)
    expect((await prepareMigrationJournal(db, migrationFolder)).isOk()).toBe(true)
    await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
    await expect(databaseState(db, true)).resolves.toEqual(after)
  },
)

it.each([4, 9])('preserves populated exchange history across historical migration %i + 1', async (prefix) => {
  const directory = testDirectory()
  const migrationFolder = join(directory, 'drizzle')
  mkdirSync(migrationFolder)
  for (const migration of migrations.slice(0, prefix)) {
    cpSync(join(folder, migration.name), join(migrationFolder, migration.name), { recursive: true })
  }
  const db = rawDatabase(directory)
  await db.run(sql`PRAGMA foreign_keys = ON`)
  await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
  await db.run(sql`INSERT INTO exchange_accounts (id, provider, display_name, encrypted_credentials, external_account_id)
    VALUES ('exchange', 'coinbase', 'Synthetic exchange', 'synthetic-ciphertext', 'synthetic-external')`)
  await db.run(sql`INSERT INTO exchange_balance_snapshots (id, account_id, timestamp, balance_sats)
    VALUES (99, 'exchange', '2026-08-01', '123456789')`)
  if (prefix === 9) {
    await db.run(sql`INSERT INTO exchange_statement_txs (id, account_id, external_id, transacted_at, type, amount_btc, statement_month)
      VALUES ('transaction', 'exchange', 'external', '2026-08-01', 'buy', '0.12345678', '2026-08')`)
  }
  const before = await databaseState(db)
  const next = migrations[prefix]
  if (next === undefined) {
    throw new Error('Missing historical rebuild migration')
  }
  cpSync(join(folder, next.name), join(migrationFolder, next.name), { recursive: true })
  await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
  const after = await databaseState(db)
  expect(after.data).toEqual(before.data)
  await expect(db.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])
  await expect(db.all(sql`PRAGMA foreign_keys`)).resolves.toEqual([{ foreign_keys: 1 }])
  const completed = await databaseState(db, true)
  await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
  await expect(databaseState(db, true)).resolves.toEqual(completed)
})

it('links historical snapshots and matches their columns to every replayed migration state', async () => {
  const snapshotSchema = z.object({
    id: z.string().uuid(),
    prevIds: z.array(z.string().uuid()),
    ddl: z.array(
      z.object({
        entityType: z.string(),
        name: z.string(),
        table: z.string().optional(),
        type: z.string().optional(),
        notNull: z.boolean().optional(),
        default: z.string().nullable().optional(),
      }),
    ),
  })
  const directory = testDirectory()
  const migrationFolder = join(directory, 'drizzle')
  mkdirSync(migrationFolder)
  const db = rawDatabase(directory)
  let previous = '00000000-0000-0000-0000-000000000000'
  for (const migration of migrations) {
    cpSync(join(folder, migration.name), join(migrationFolder, migration.name), { recursive: true })
    await migrate(db, { migrationsFolder: migrationFolder, migrationsTable })
    const snapshot = parseUnknown(
      snapshotSchema,
      // SAFETY: the committed JSON is validated before any fields are used.
      JSON.parse(readFileSync(join(folder, migration.name, 'snapshot.json'), 'utf8')),
    ).expect('Valid historical snapshot')
    expect(snapshot.prevIds).toEqual([previous])
    previous = snapshot.id
    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name`,
    )
    expect(snapshot.ddl.filter((entity) => entity.entityType === 'tables').map((table) => table.name)).toEqual(
      tables.map((table) => table.name),
    )
    for (const table of tables) {
      const columns = await db.all<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
        sql`PRAGMA table_info(${sql.identifier(table.name)})`,
      )
      const normalizeDefault = (value: string | null | undefined): string | null =>
        value?.replace(/^\((.*)\)$/, '$1') ?? null
      const expected = columns
        .map((column) => ({
          name: column.name,
          type: column.type.toLowerCase(),
          notNull: column.notnull === 1,
          default: normalizeDefault(column.dflt_value),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      expect(
        snapshot.ddl
          .filter((entity) => entity.entityType === 'columns' && entity.table === table.name)
          .map((column) => ({
            name: column.name,
            type: column.type,
            notNull: column.notNull,
            default: normalizeDefault(column.default),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual(expected)
    }
  }
})

it(
  'generates no migration when the final imported snapshot is compared with the current typed schema',
  { timeout: 30_000 },
  () => {
    const out = join(testDirectory(), 'drizzle')
    cpSync(folder, out, { recursive: true })
    const before = readdirSync(out)
    const output = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../../node_modules/drizzle-kit/bin.cjs', import.meta.url)),
        'generate',
        '--dialect=sqlite',
        `--schema=${fileURLToPath(new URL('./schema.ts', import.meta.url))}`,
        `--out=${out}`,
        '--output=json',
      ],
      { encoding: 'utf8', timeout: 20_000 },
    )
    expect(output).toMatch(/"status"\s*:\s*"no_changes"/)
    expect(readdirSync(out)).toEqual(before)
  },
)
