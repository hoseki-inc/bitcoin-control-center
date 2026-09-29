import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Client } from '@libsql/client'
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

export async function openDrizzleDatabase(
  dataDir: string,
  logger: Logger,
): Promise<{
  db: SentinelDb
  client: Client
  close(): void
}> {
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
