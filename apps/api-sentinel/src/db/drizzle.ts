import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { InArgs, InStatement } from '@libsql/client'
import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import type { Logger } from 'pino'

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
  // A single connection keeps PRAGMA settings consistent. There is no remote
  // URL, token or replication service.
  const client = createClient({ url: pathToFileURL(dbPath).href, concurrency: 1 })
  try {
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute('PRAGMA journal_mode = WAL')
    const db = drizzle({ client })
    await migrate(db, { migrationsFolder: migrationsFolder() })

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
