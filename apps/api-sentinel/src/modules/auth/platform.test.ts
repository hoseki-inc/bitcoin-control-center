import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@hoseki/packages/result/lib/parse'
import { describe, expect, it, onTestFinished } from 'vitest'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { Pin } from './pin'
import { applyPlatformRequests, isPinCommand, runPinCommand } from './platform'
import { AuthService } from './service'

const PIN = parse(Pin, '482915').expect('a PIN')
const VISITOR = { browserKey: null, tabId: 'tab-aaaaaaaaaaaaaaaa', encrypted: true }

async function setup() {
  const { db, logger } = await setupServiceDatabase()
  const dataDir = mkdtempSync(join(tmpdir(), 'sentinel-pin-requests-'))
  onTestFinished(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })
  const auth = new AuthService(db, logger, 'startos')
  return {
    auth,
    dataDir,
    run: async (command: 'reset-pin' | 'set-pin', input = '') => runPinCommand(command, dataDir, async () => input),
    apply: async () => applyPlatformRequests(dataDir, auth, logger),
  }
}

describe('PIN commands', () => {
  it('are reset-pin and set-pin only', () => {
    expect(['reset-pin', 'set-pin', 'serve', undefined].map(isPinCommand)).toEqual([true, true, false, false])
  })

  it('store only a hash of a new PIN, readable by the owner only, and apply it at the next start', async () => {
    const { auth, dataDir, run, apply } = await setup()
    expect((await run('set-pin', '482915\n')).unwrap()).toBe(
      'The new PIN applies when Bitcoin Control Center restarts.',
    )

    const path = join(dataDir, 'new-pin')
    expect(readFileSync(path, 'utf8')).toMatch(/^scrypt\$/)
    expect(statSync(path).mode & 0o777).toBe(0o600)

    await apply()
    expect(existsSync(path)).toBe(false)
    expect((await auth.signIn(PIN, VISITOR)).isOk()).toBe(true)
  })

  it('refuse a PIN that is not six digits', async () => {
    const { dataDir, run } = await setup()
    expect((await run('set-pin', '48291a')).unwrapErr()).toBe('The PIN must be exactly 6 digits')
    expect(existsSync(join(dataDir, 'new-pin'))).toBe(false)
  })

  it('clear the PIN on a reset request, keeping the data', async () => {
    const { auth, dataDir, run, apply } = await setup()
    await run('set-pin', '482915')
    await apply()

    expect((await run('reset-pin')).unwrap()).toBe(
      'The PIN will be cleared when Bitcoin Control Center restarts. Your data is kept.',
    )
    await apply()
    expect(existsSync(join(dataDir, 'reset-pin'))).toBe(false)
    await expect(auth.status(VISITOR)).resolves.toMatchObject({ state: 'no-pin' })
  })

  it('apply a reset before a new PIN left beside it', async () => {
    const { auth, run, apply } = await setup()
    await run('set-pin', '482915')
    await run('reset-pin')
    await apply()
    expect((await auth.signIn(PIN, VISITOR)).isOk()).toBe(true)
  })

  it('ignore and remove a request that is not a hash', async () => {
    const { auth, dataDir, apply } = await setup()
    writeFileSync(join(dataDir, 'new-pin'), '482915\n')
    await apply()
    expect(existsSync(join(dataDir, 'new-pin'))).toBe(false)
    await expect(auth.status(VISITOR)).resolves.toMatchObject({ state: 'no-pin' })
  })
})
