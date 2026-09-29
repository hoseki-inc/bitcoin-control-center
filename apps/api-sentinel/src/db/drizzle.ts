import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Client } from '@libsql/client'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Logger } from 'pino'
import * as schema from './schema'

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
] as const

// esbuild places both entry points in dist/; during development this module
// lives in src/db/. Never resolve migration files from process.cwd().
function migrationsFolder(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const bundledFolder = join(moduleDir, 'drizzle')
  return existsSync(join(bundledFolder, 'meta', '_journal.json'))
    ? bundledFolder
    : join(moduleDir, '..', '..', 'drizzle')
}

function migrationStatements(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

async function hasTable(client: Client, name: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  })
  return result.rows.length > 0
}

async function assertForeignKeys(client: Client): Promise<void> {
  const violations = await client.execute('PRAGMA foreign_key_check')
  if (violations.rows.length > 0) {
    throw new Error('Database contains broken foreign key references; migration stopped')
  }
}

async function finishLegacyMigrations(client: Client, folder: string, logger: Logger): Promise<void> {
  const applied = (await client.execute('SELECT name FROM _migrations ORDER BY id')).rows.map((row) => row['name'])
  if (applied.some((name, index) => name !== legacyNames[index]) || applied.length > legacyNames.length) {
    throw new Error('Unknown or out-of-order legacy database migrations; refusing to upgrade')
  }

  for (const name of legacyNames.slice(applied.length)) {
    logger.info({ migration: name }, 'Applying legacy compatibility migration')
    const statements = migrationStatements(join(folder, 'legacy', `${name}.sql`))
    // Foreign keys MUST be disabled before BEGIN. The previous migration runner
    // did this inside its transaction, cascading away exchange history at 005/010.
    await client.execute('PRAGMA foreign_keys = OFF')
    try {
      const tx = await client.transaction('write')
      try {
        for (const statement of statements) {
          await tx.execute(statement)
        }
        const violations = await tx.execute('PRAGMA foreign_key_check')
        if (violations.rows.length > 0) {
          throw new Error(`Foreign key check failed during ${name}`)
        }
        await tx.execute({ sql: 'INSERT INTO _migrations (name) VALUES (?)', args: [name] })
        await tx.commit()
      } catch (error) {
        await tx.rollback()
        throw error
      }
    } finally {
      await client.execute('PRAGMA foreign_keys = ON')
    }
  }
}

async function adoptLegacyDatabase(client: Client, folder: string, logger: Logger): Promise<void> {
  if (!(await hasTable(client, '_migrations')) || (await hasTable(client, '__drizzle_migrations'))) {
    return
  }

  await assertForeignKeys(client)
  await finishLegacyMigrations(client, folder, logger)
  await assertForeignKeys(client)

  const [baseline] = readMigrationFiles({ migrationsFolder: folder })
  if (!baseline) {
    throw new Error('Missing Drizzle baseline migration')
  }

  // The baseline describes the final legacy schema. Mark it as already applied
  // atomically; all later schema changes are handled by Drizzle migrations.
  await client.batch(
    [
      {
        sql: 'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)',
        args: [],
      },
      {
        sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        args: [baseline.hash, baseline.folderMillis],
      },
    ],
    'write',
  )
  logger.info('Adopted existing Sentinel database into Drizzle migrations')
}

export async function openDrizzleDatabase(
  dataDir: string,
  logger: Logger,
): Promise<{
  db: ReturnType<typeof drizzle<typeof schema>>
  client: Client
  close(): void
}> {
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, 'sentinel.db')
  logger.info({ path: dbPath }, 'Opening local libSQL database')
  // A single connection ensures PRAGMA settings and compatibility upgrades
  // apply consistently. There is no remote URL, token or replication service.
  const client = createClient({ url: pathToFileURL(dbPath).href, concurrency: 1 })
  try {
    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('PRAGMA foreign_keys = ON')
    const folder = migrationsFolder()
    const db = drizzle({ client, schema })
    await adoptLegacyDatabase(client, folder, logger)
    await migrate(db, { migrationsFolder: folder })
    await assertForeignKeys(client)
    return {
      db,
      client,
      close: (): void => {
        client.close()
      },
    }
  } catch (error) {
    client.close()
    throw error
  }
}
