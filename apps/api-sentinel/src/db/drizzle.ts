import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { InArgs, InStatement } from '@libsql/client'
import { createClient } from '@libsql/client/sqlite3'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Logger } from 'pino'
import { migrationsTable, prepareMigrationJournal } from './migration-journal'

export type SentinelDb = ReturnType<typeof drizzle>
export type SentinelTx = Parameters<Parameters<SentinelDb['transaction']>[0]>[0]

// esbuild places both entry points in dist/; during development this module
// lives in src/db/. Never resolve migration files from process.cwd().
function migrationsFolder(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const bundledFolder = join(moduleDir, 'drizzle')
  return existsSync(bundledFolder) ? bundledFolder : join(moduleDir, '..', '..', 'drizzle')
}

export async function openDrizzleDatabase(dataDir: string, logger: Logger): Promise<SentinelDb> {
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, 'sentinel.db')
  logger.info({ path: dbPath }, 'Opening local libSQL database')
  // One local connection; the configured busy timeout applies to replacements too.
  // There is no remote URL, token or replication service.
  const client = createClient({ url: pathToFileURL(dbPath).href, concurrency: 1, timeout: 5000 })
  try {
    const db = drizzle({ client })
    // WAL persists in the file; initialize it here for new databases.
    await db.run(sql`PRAGMA journal_mode = WAL`)
    const folder = migrationsFolder()
    const journal = await prepareMigrationJournal(db, folder)
    if (journal.isErr()) {
      throw journal.unwrapErr()
    }
    // The pinned native libSQL build enables foreign keys by default, including
    // on reconnect. Its migration runner also restores enforcement after batches.
    await migrate(db, { migrationsFolder: folder, migrationsTable })

    // libSQL rejects queries while an interactive transaction owns its only
    // connection. Queue ordinary queries and whole transactions together;
    // queries on the transaction's own client bypass this queue.
    let pending = Promise.resolve()
    async function serial<T>(run: () => Promise<T>): Promise<T> {
      const result = pending.then(run)
      pending = result.then(
        () => {},
        () => {},
      )
      return result
    }
    const execute = client.execute.bind(client)
    const batch = client.batch.bind(client)
    const transaction = db.transaction.bind(db)
    client.execute = async (...args: [InStatement] | [string, InArgs?]) =>
      serial(async () => (args.length === 2 ? execute(args[0], args[1]) : execute(args[0])))
    client.batch = async (statements, mode) => serial(async () => batch(statements, mode))
    db.transaction = async (run, config) => serial(async () => transaction(run, config))
    return db
  } catch (error) {
    client.close()
    throw error
  }
}
