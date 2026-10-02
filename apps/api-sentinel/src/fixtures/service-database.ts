import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import pino, { type Logger } from 'pino'
import { onTestFinished, vi } from 'vitest'
import { initDatabase } from '../db'

interface ServiceDatabase {
  db: Database.Database
  logger: Logger
}

export function setupServiceDatabase(): ServiceDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-service-test-'))
  const logger = pino({ level: 'silent' })
  const database = initDatabase(directory, logger)

  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })

    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-02-10T12:00:00.000Z'))

  return { db: database.db, logger }
}
