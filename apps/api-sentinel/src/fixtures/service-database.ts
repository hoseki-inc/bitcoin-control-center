import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino, { type Logger } from 'pino'
import { onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../db/drizzle'

interface ServiceDatabase {
  db: SentinelDb
  logger: Logger
}

export async function setupServiceDatabase(): Promise<ServiceDatabase> {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-service-test-'))
  const logger = pino({ level: 'silent' })
  const database = await openDrizzleDatabase(directory, logger)

  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })

    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-02-10T12:00:00.000Z'))

  return { db: database, logger }
}
