import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { applyPlatformRequests, requestNewPin, requestPinReset } from './platform'
import { AuthService } from './service'

const TAB = 'tab-aaaaaaaaaaaaaaaa'

async function setup() {
  const { db, logger } = await setupServiceDatabase()
  const dataDir = mkdtempSync(join(tmpdir(), 'sentinel-pin-requests-'))
  onTestFinished(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })
  const auth = new AuthService(db, logger, 'startos')
  return { auth, dataDir, apply: async () => applyPlatformRequests(dataDir, auth, logger) }
}

describe('platform PIN requests', () => {
  it('store only a hash of a new PIN, readable by the owner only, and apply it at the next start', async () => {
    const { auth, dataDir, apply } = await setup()
    expect((await requestNewPin(dataDir, '482915')).isOk()).toBe(true)

    const path = join(dataDir, 'new-pin')
    expect(readFileSync(path, 'utf8')).toMatch(/^scrypt\$/)
    expect(statSync(path).mode & 0o777).toBe(0o600)

    await apply()
    expect(existsSync(path)).toBe(false)
    expect((await auth.signIn('482915', null, TAB)).isOk()).toBe(true)
  })

  it('refuse a PIN that is not six digits', async () => {
    const { dataDir } = await setup()
    expect((await requestNewPin(dataDir, '48291a')).isErr()).toBe(true)
    expect(existsSync(join(dataDir, 'new-pin'))).toBe(false)
  })

  it('clear the PIN on a reset request', async () => {
    const { auth, dataDir, apply } = await setup()
    await requestNewPin(dataDir, '482915')
    await apply()

    requestPinReset(dataDir)
    await apply()
    expect(existsSync(join(dataDir, 'reset-pin'))).toBe(false)
    expect((await auth.status(null, null, true)).pinSet).toBe(false)
  })

  it('ignore and remove a request that is not a hash', async () => {
    const { auth, dataDir, apply } = await setup()
    writeFileSync(join(dataDir, 'new-pin'), '482915\n')
    await apply()
    expect(existsSync(join(dataDir, 'new-pin'))).toBe(false)
    expect((await auth.status(null, null, true)).pinSet).toBe(false)
  })
})
