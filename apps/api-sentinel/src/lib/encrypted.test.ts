import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../db/drizzle'
import { settings } from '../db/schema'
import { loadCredentialEncryptionKey } from './encrypted'

const logger = pino({ level: 'silent' })
const legacyKey = '01'.repeat(32)
const fileKey = '02'.repeat(32)

async function profile(): Promise<{ dataDir: string; db: SentinelDb; secrets: string; keyPath: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'sentinel-credential-key-'))
  const db = await openDrizzleDatabase(dataDir, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  const secrets = join(dataDir, 'secrets')
  return { dataDir, db, secrets, keyPath: join(secrets, 'exchange-credentials.key') }
}

it('keeps an existing key file authoritative and removes the obsolete database copy', async () => {
  const { dataDir, db, secrets, keyPath } = await profile()
  mkdirSync(secrets)
  writeFileSync(keyPath, `${fileKey}\n`, { mode: 0o600 })
  await db.insert(settings).values({ key: 'encryption_key', value: legacyKey })
  const result = await loadCredentialEncryptionKey({ dataDir, db, logger })
  expect(result.key).toBe(fileKey)
  expect(readFileSync(keyPath, 'utf8')).toBe(`${fileKey}\n`)
  await expect(db.select().from(settings).where(eq(settings.key, 'encryption_key'))).resolves.toEqual([])
})

it('does not overwrite or remove an invalid legacy key when adoption fails', async () => {
  const { dataDir, db, keyPath } = await profile()
  await db.insert(settings).values({ key: 'encryption_key', value: 'invalid-key' })
  await expect(loadCredentialEncryptionKey({ dataDir, db, logger })).rejects.toThrow('Invalid exchange credential')
  expect(existsSync(keyPath)).toBe(false)
  await expect(db.select().from(settings).where(eq(settings.key, 'encryption_key'))).resolves.toEqual([
    { key: 'encryption_key', value: 'invalid-key' },
  ])
})

it('keeps the database key if writing its new secret file fails', async () => {
  const { dataDir, db, secrets } = await profile()
  writeFileSync(secrets, 'Not a directory')
  await db.insert(settings).values({ key: 'encryption_key', value: legacyKey })
  await expect(loadCredentialEncryptionKey({ dataDir, db, logger })).rejects.toThrow(/EEXIST|ENOTDIR/)
  await expect(db.select().from(settings).where(eq(settings.key, 'encryption_key'))).resolves.toEqual([
    { key: 'encryption_key', value: legacyKey },
  ])
})

it('preserves explicit restore-marker rotation instead of adopting a marked legacy key', async () => {
  const { dataDir, db, secrets, keyPath } = await profile()
  mkdirSync(secrets)
  writeFileSync(keyPath, `${fileKey}\n`, { mode: 0o600 })
  const marker = join(secrets, 'exchange-credentials.restored')
  writeFileSync(marker, '')
  await db.insert(settings).values({ key: 'encryption_key', value: legacyKey })
  const result = await loadCredentialEncryptionKey({ dataDir, db, logger })
  expect(result.key).not.toBe(fileKey)
  expect(result.key).not.toBe(legacyKey)
  expect(readFileSync(keyPath, 'utf8')).toBe(`${result.key}\n`)
  expect(existsSync(marker)).toBe(false)
  await expect(db.select().from(settings).where(eq(settings.key, 'encryption_key'))).resolves.toEqual([])
})
