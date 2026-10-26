import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parse } from '@hoseki/packages/result/lib/parse'
import type { Logger } from 'pino'
import { PIN_HASH_PATTERN, Pin, hashPin } from './pin'
import type { AuthService } from './service'

// Platform tools run outside the server, so they leave a request in the data folder that Sentinel applies when it
// next starts. Neither file ever holds a PIN in plain text. The desktop app writes the reset request itself.
const RESET_REQUEST = 'reset-pin'
const PIN_REQUEST = 'new-pin'

function writePrivateFile(dataDir: string, name: string, value: string): void {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, name)
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tempPath, `${value}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

export type PinCommand = 'reset-pin' | 'set-pin'

export function isPinCommand(value: string | undefined): value is PinCommand {
  return value === 'reset-pin' || value === 'set-pin'
}

/**
 * `reset-pin` clears the PIN, keeping all data, so the next visit sets a new one. `set-pin` replaces it with the PIN
 * from `readPin` (stdin: arguments are visible to other processes). Both take effect when Sentinel next starts.
 * Returns the message to print.
 */
export async function runPinCommand(
  command: PinCommand,
  dataDir: string,
  readPin: () => Promise<string>,
): Promise<Result<string, string>> {
  if (command === 'reset-pin') {
    writePrivateFile(dataDir, RESET_REQUEST, 'reset')
    return Ok('The PIN will be cleared when Bitcoin Control Center restarts. Your data is kept.')
  }
  const pin = parse(Pin, (await readPin()).trim())
  if (pin.isErr()) {
    return Err(pin.unwrapErr().message)
  }
  writePrivateFile(dataDir, PIN_REQUEST, await hashPin(pin.unwrap()))
  return Ok('The new PIN applies when Bitcoin Control Center restarts.')
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
