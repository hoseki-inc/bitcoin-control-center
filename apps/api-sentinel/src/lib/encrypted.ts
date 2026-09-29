import * as crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Err, Ok, Result, parse } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../db/drizzle'
import { settings } from '../db/schema'

const algorithm = 'aes-256-cbc' as const
const encoding = 'hex' as const
const legacySettingsKey = 'encryption_key'
const keyFileName = 'exchange-credentials.key'
const restoreMarkerFileName = 'exchange-credentials.restored'
const hexKeyPattern = /^[a-f0-9]{64}$/i

/** `${iv}_${ciphertext}` */
export const CiphertextBlob = z
  .string()
  .regex(/^[a-f0-9]{32}_[a-f0-9]+$/, { message: 'Invalid ciphertext blob' })
  .brand('CiphertextBlob')
export type CiphertextBlob = z.infer<typeof CiphertextBlob>

let _key: Uint8Array | null = null

/**
 * Initialize the encryption module with a hex-encoded 256-bit key.
 * Must be called before any encrypt/decrypt operations.
 */
export function initEncryption(hexKey: string): void {
  _key = new Uint8Array(Buffer.from(hexKey, encoding))
}

function getKey(): Uint8Array {
  if (!_key) {
    throw new Error('Encryption not initialized. Call initEncryption() first.')
  }
  return _key
}

/**
 * Generate a new random 256-bit encryption key as a hex string.
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString(encoding)
}

export interface CredentialEncryptionKeyResult {
  key: string
  keyPath: string
}

function normalizeEncryptionKey(rawKey: string): string {
  const key = rawKey.trim()
  if (!hexKeyPattern.test(key)) {
    throw new Error('Invalid exchange credential encryption key')
  }
  return key.toLowerCase()
}

function writeSecretFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tempPath, `${value}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(tempPath, path)
  } catch (err) {
    rmSync(tempPath, { force: true })
    throw err
  }
}

export async function loadCredentialEncryptionKey(deps: {
  dataDir: string
  db: SentinelDb
  logger: Logger
}): Promise<CredentialEncryptionKeyResult> {
  const secretsDir = join(deps.dataDir, 'secrets')
  const keyPath = join(secretsDir, keyFileName)
  const restoreMarkerPath = join(secretsDir, restoreMarkerFileName)

  if (existsSync(restoreMarkerPath)) {
    rmSync(keyPath, { force: true })
    await deps.db.delete(settings).where(eq(settings.key, legacySettingsKey))
    rmSync(restoreMarkerPath, { force: true })
    deps.logger.info('Reset exchange credential encryption key after backup restore')
  }

  if (existsSync(keyPath)) {
    const key = normalizeEncryptionKey(readFileSync(keyPath, 'utf8'))
    await deps.db.delete(settings).where(eq(settings.key, legacySettingsKey))
    return { key, keyPath }
  }

  const [legacyKey] = await deps.db.select().from(settings).where(eq(settings.key, legacySettingsKey))
  if (legacyKey !== undefined && legacyKey.value !== '') {
    const key = normalizeEncryptionKey(legacyKey.value)
    writeSecretFile(keyPath, key)
    await deps.db.delete(settings).where(eq(settings.key, legacySettingsKey))
    deps.logger.info({ keyPath }, 'Moved exchange credential encryption key out of SQLite')
    return { key, keyPath }
  }

  const key = generateEncryptionKey()
  writeSecretFile(keyPath, key)
  deps.logger.info({ keyPath }, 'Generated new exchange credential encryption key')
  return { key, keyPath }
}

export class Encrypted {
  public readonly blob: CiphertextBlob

  private constructor(blob: CiphertextBlob) {
    this.blob = blob
  }

  public static from(blob: CiphertextBlob): Encrypted {
    return new Encrypted(blob)
  }

  public static fromString(string: string): Result<Encrypted, Error> {
    const parsed = parse(CiphertextBlob, string)
    if (parsed.isErr()) {
      return Err(parsed.unwrapErr())
    }
    return Ok(Encrypted.from(parsed.unwrap()))
  }

  public static encrypt(plaintext: string): Result<Encrypted, Error> {
    return Result.fromThrowable(() => {
      const key = getKey()
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv(algorithm, key, new Uint8Array(iv))
      const part1 = cipher.update(plaintext)
      const part2 = cipher.final()
      const combined = new Uint8Array(part1.length + part2.length)
      combined.set(new Uint8Array(part1), 0)
      combined.set(new Uint8Array(part2), part1.length)
      const blob = parse(CiphertextBlob, `${iv.toString(encoding)}_${Buffer.from(combined).toString(encoding)}`).expect(
        'generated ciphertext should have a valid format',
      )
      return new Encrypted(blob)
    })
  }

  public decrypt(): Result<string, Error> {
    return Result.fromThrowable(() => {
      const key = getKey()
      const [ivHex, ciphertextHex] = this.blob.split('_')
      if (ivHex == null || ivHex === '' || ciphertextHex == null || ciphertextHex === '') {
        throw new Error('Malformed ciphertext blob')
      }
      const decipher = crypto.createDecipheriv(algorithm, key, new Uint8Array(Buffer.from(ivHex, encoding)))
      const part1 = decipher.update(new Uint8Array(Buffer.from(ciphertextHex, encoding)))
      const part2 = decipher.final()
      const combined = new Uint8Array(part1.length + part2.length)
      combined.set(new Uint8Array(part1), 0)
      combined.set(new Uint8Array(part2), part1.length)
      return Buffer.from(combined).toString()
    })
  }
}
