import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { hashPin, isPin } from './pin'
import type { AuthService } from './service'

// Platform tools run outside the server, so they leave a request in the data folder that Sentinel
// applies when it next starts. Neither file ever holds a PIN in plain text.
const RESET_REQUEST = 'reset-pin'
const PIN_REQUEST = 'new-pin'
const PIN_HASH_PATTERN = /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/

function writePrivateFile(path: string, value: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tempPath, `${value}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

/** Clears the PIN at the next start, so the next visit sets a new one. Data is kept. */
export function requestPinReset(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true })
  writePrivateFile(join(dataDir, RESET_REQUEST), 'reset')
}

/** Replaces the PIN at the next start. Only the hash is written. */
export async function requestNewPin(dataDir: string, pin: string): Promise<Result<void, Error>> {
  if (!isPin(pin)) {
    return Err(new Error('The PIN must be exactly 6 digits'))
  }
  mkdirSync(dataDir, { recursive: true })
  writePrivateFile(join(dataDir, PIN_REQUEST), await hashPin(pin))
  return Ok(undefined)
}

/** Applies a pending reset, then a pending new PIN, and removes both requests. */
export async function applyPlatformRequests(dataDir: string, auth: AuthService, logger: Logger): Promise<void> {
  const resetPath = join(dataDir, RESET_REQUEST)
  if (existsSync(resetPath)) {
    await auth.setPlatformPin(null)
    rmSync(resetPath, { force: true })
  }

  const pinPath = join(dataDir, PIN_REQUEST)
  if (existsSync(pinPath)) {
    const pinHash = readFileSync(pinPath, 'utf8').trim()
    if (PIN_HASH_PATTERN.test(pinHash)) {
      await auth.setPlatformPin(pinHash)
    } else {
      logger.warn('Ignored an unreadable PIN request')
    }
    rmSync(pinPath, { force: true })
  }
}
