import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { profiles } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { hashPin } from './pin'
import { AuthService, IDLE_LIMIT_MS, type PinPlatform, type SignedIn, delayAfter } from './service'

const PIN = '482915'
const TAB = 'tab-aaaaaaaaaaaaaaaa'
const OTHER_TAB = 'tab-bbbbbbbbbbbbbbbb'

async function setup(platform: PinPlatform = 'desktop') {
  const { db, logger } = await setupServiceDatabase()
  const clock = { now: 1_700_000_000_000 }
  const create = (): AuthService => new AuthService(db, logger, platform, () => clock.now)
  return { db, clock, auth: create(), create }
}

async function withPin(auth: AuthService): Promise<SignedIn> {
  return (await auth.setFirstPin(PIN, null, TAB)).expect('first PIN')
}

describe('delayAfter', () => {
  it('allows five free tries, then doubles from 30 seconds up to an hour', () => {
    expect([1, 4, 5, 6, 7, 11, 12, 30].map(delayAfter)).toEqual([
      0, 0, 30_000, 60_000, 120_000, 1_920_000, 3_600_000, 3_600_000,
    ])
  })
})

describe('first PIN', () => {
  it('is set once, signs the tab in, and is stored only as a hash', async () => {
    const { db, auth } = await setup()
    const signedIn = await withPin(auth)
    expect(auth.resolve(signedIn.browserKey, TAB)).toBe(signedIn.session)

    const [row] = await db.select().from(profiles)
    expect(row?.pinHash).toMatch(/^scrypt\$/)
    expect(row?.pinHash).not.toContain(PIN)

    expect((await auth.setFirstPin('111111', null, OTHER_TAB)).unwrapErr()).toEqual({ kind: 'already_set' })
  })

  it('costs no hash once a PIN is set', async () => {
    const { db, logger } = await setupServiceDatabase()
    const hash = vi.fn(hashPin)
    const auth = new AuthService(db, logger, 'desktop', Date.now, hash)
    await withPin(auth)
    hash.mockClear()
    expect((await auth.setFirstPin('111111', null, OTHER_TAB)).unwrapErr()).toEqual({ kind: 'already_set' })
    expect(hash).not.toHaveBeenCalled()
  })

  it('cannot be set in the app where the platform sets it', async () => {
    const { auth } = await setup('startos')
    expect((await auth.setFirstPin(PIN, null, TAB)).unwrapErr()).toEqual({ kind: 'setup_unavailable' })
  })

  it('must be six digits', async () => {
    const { auth } = await setup()
    expect((await auth.setFirstPin('12ab56', null, TAB)).unwrapErr()).toEqual({ kind: 'malformed' })
  })
})

describe('signing in', () => {
  it('needs a PIN to be set first', async () => {
    const { auth } = await setup()
    expect((await auth.signIn(PIN, null, TAB)).unwrapErr()).toEqual({ kind: 'not_set' })
  })

  it('opens a session bound to the browser key and the tab', async () => {
    const { auth } = await setup()
    await withPin(auth)
    const { browserKey, session } = (await auth.signIn(PIN, null, OTHER_TAB)).expect('sign in')
    expect(auth.resolve(browserKey, OTHER_TAB)).toBe(session)
    expect(auth.resolve(browserKey, 'tab-cccccccccccccccc')).toBeNull()
    expect(auth.resolve(null, OTHER_TAB)).toBeNull()
  })

  it('keeps the browser key when another tab in the same browser signs in', async () => {
    const { auth } = await setup()
    const first = await withPin(auth)
    const second = (await auth.signIn(PIN, first.browserKey, OTHER_TAB)).expect('sign in')
    expect(second.browserKey).toBe(first.browserKey)
    expect(auth.resolve(first.browserKey, TAB)).not.toBeNull()
    expect(auth.resolve(first.browserKey, OTHER_TAB)).not.toBeNull()
  })

  it('does not count a malformed PIN as a guess', async () => {
    const { db, auth } = await setup()
    await withPin(auth)
    expect((await auth.signIn('abcdef', null, TAB)).unwrapErr()).toEqual({ kind: 'malformed' })
    const [row] = await db.select().from(profiles)
    expect(row?.failedAttempts).toBe(0)
  })
})

describe('wrong PINs', () => {
  it('start a delay after five, refuse attempts during it without counting them, and reset after a success', async () => {
    const { db, clock, auth } = await setup()
    await withPin(auth)

    for (const left of [4, 3, 2, 1]) {
      expect((await auth.signIn('000000', null, TAB)).unwrapErr()).toEqual({
        kind: 'wrong',
        freeAttemptsLeft: left,
        retryAfterMs: null,
      })
    }
    expect((await auth.signIn('000000', null, TAB)).unwrapErr()).toEqual({
      kind: 'wrong',
      freeAttemptsLeft: 0,
      retryAfterMs: 30_000,
    })

    // Even the right PIN waits, and the refused attempt doesn't count.
    clock.now += 10_000
    expect((await auth.signIn(PIN, null, TAB)).unwrapErr()).toEqual({ kind: 'wait', retryAfterMs: 20_000 })
    expect((await auth.status(null, null, true)).retryAfterMs).toBe(20_000)

    clock.now += 20_000
    expect((await auth.signIn('000000', null, TAB)).unwrapErr()).toMatchObject({ retryAfterMs: 60_000 })

    clock.now += 60_000
    expect((await auth.signIn(PIN, null, TAB)).isOk()).toBe(true)
    const [row] = await db.select().from(profiles)
    expect(row).toMatchObject({ failedAttempts: 0, nextAttemptAt: null })
  })

  it('are counted across restarts', async () => {
    const { auth, create } = await setup()
    await withPin(auth)
    for (let i = 0; i < 5; i += 1) {
      await auth.signIn('000000', null, TAB)
    }
    expect((await create().signIn(PIN, null, TAB)).unwrapErr()).toMatchObject({ kind: 'wait' })
  })

  it('are counted one at a time when guesses arrive together', async () => {
    const { db, auth } = await setup()
    await withPin(auth)
    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => auth.signIn(`00000${i}`, null, `tab-${i}aaaaaaaaaaaaaaaa`)),
    )
    expect(results.filter((result) => result.isErr() && result.unwrapErr().kind === 'wrong')).toHaveLength(5)
    expect(results.filter((result) => result.isErr() && result.unwrapErr().kind === 'wait')).toHaveLength(3)
    const [row] = await db.select().from(profiles)
    expect(row?.failedAttempts).toBe(5)
  })
})

describe('sessions', () => {
  it('end after an hour without activity, and touching keeps them open', async () => {
    const { clock, auth } = await setup()
    const { browserKey, session } = await withPin(auth)

    clock.now += IDLE_LIMIT_MS - 1000
    auth.touch(session)
    clock.now += IDLE_LIMIT_MS - 1000
    expect(auth.resolve(browserKey, TAB)).toBe(session)

    clock.now += 2000
    expect(auth.resolve(browserKey, TAB)).toBeNull()
  })

  it('lock one tab, or sign out everywhere', async () => {
    const { auth } = await setup()
    const first = await withPin(auth)
    const second = (await auth.signIn(PIN, first.browserKey, OTHER_TAB)).expect('sign in')
    const elsewhere = (await auth.signIn(PIN, null, TAB)).expect('sign in')

    auth.lock(first.session)
    expect(auth.resolve(first.browserKey, TAB)).toBeNull()
    expect(auth.resolve(first.browserKey, OTHER_TAB)).toBe(second.session)

    auth.signOutEverywhere()
    expect(auth.resolve(first.browserKey, OTHER_TAB)).toBeNull()
    expect(auth.resolve(elsewhere.browserKey, TAB)).toBeNull()
  })

  it('record when the PIN was last entered', async () => {
    const { clock, auth } = await setup()
    const { session } = await withPin(auth)
    clock.now += 120_000
    expect(auth.pinEnteredWithin(session, 60_000)).toBe(false)
    expect((await auth.confirm(session, PIN)).isOk()).toBe(true)
    expect(auth.pinEnteredWithin(session, 60_000)).toBe(true)
  })
})

describe('wrong-PIN delays', () => {
  it('never run longer than an hour from now, even after the clock moves back', async () => {
    const hour = 60 * 60 * 1000
    const { db, clock, auth } = await setup()
    await withPin(auth)
    // A delay recorded while the clock ran two days ahead.
    await db
      .update(profiles)
      .set({ failedAttempts: 9, nextAttemptAt: clock.now + 48 * hour })
      .where(eq(profiles.id, 'owner'))

    // The sign-in screen asks first, and the hour it shows is the hour served.
    expect((await auth.status(null, null, true)).retryAfterMs).toBe(hour)
    clock.now += hour - 1000
    expect((await auth.signIn(PIN, null, OTHER_TAB)).unwrapErr()).toEqual({ kind: 'wait', retryAfterMs: 1000 })
    clock.now += 2000
    expect((await auth.signIn(PIN, null, OTHER_TAB)).isOk()).toBe(true)
  })
})

describe('changing the PIN', () => {
  it('needs the current PIN and signs out everything but this tab', async () => {
    const { auth } = await setup()
    const mine = await withPin(auth)
    const other = (await auth.signIn(PIN, null, OTHER_TAB)).expect('sign in')

    expect((await auth.changePin(mine.session, '000000', '135790')).unwrapErr()).toMatchObject({ kind: 'wrong' })
    expect((await auth.changePin(mine.session, PIN, '13579')).unwrapErr()).toEqual({ kind: 'malformed' })
    expect((await auth.changePin(mine.session, PIN, '135790')).isOk()).toBe(true)

    expect(auth.resolve(mine.browserKey, TAB)).toBe(mine.session)
    expect(auth.resolve(other.browserKey, OTHER_TAB)).toBeNull()
    expect((await auth.signIn('135790', null, OTHER_TAB)).isOk()).toBe(true)
  })
})

describe('platform changes', () => {
  it('replace the PIN, clear the delay and sign everyone out', async () => {
    const { db, auth } = await setup()
    const { browserKey } = await withPin(auth)
    for (let i = 0; i < 6; i += 1) {
      await auth.signIn('000000', null, TAB)
    }

    await auth.setPlatformPin(await hashPin('246802'))
    expect(auth.resolve(browserKey, TAB)).toBeNull()
    const [row] = await db.select().from(profiles).where(eq(profiles.id, 'owner'))
    expect(row).toMatchObject({ failedAttempts: 0, nextAttemptAt: null })
    expect((await auth.signIn('246802', null, TAB)).isOk()).toBe(true)
  })

  it('clear the PIN so the next visit sets a new one', async () => {
    const { auth } = await setup()
    const { browserKey } = await withPin(auth)
    await auth.setPlatformPin(null)
    expect(auth.resolve(browserKey, TAB)).toBeNull()
    await expect(auth.status(null, null, true)).resolves.toMatchObject({ pinSet: false })
    expect((await auth.setFirstPin('246802', null, TAB)).isOk()).toBe(true)
  })
})

describe('HTTPS only', () => {
  it('reports plain HTTP as needing HTTPS, and never as signed in', async () => {
    const { auth } = await setup('startos')
    await auth.setPlatformPin(await hashPin('246802'))
    const { browserKey } = (await auth.signIn('246802', null, TAB)).expect('sign in')
    await expect(auth.status(browserKey, TAB, false)).resolves.toMatchObject({ insecure: true, signedIn: false })
    await expect(auth.status(browserKey, TAB, true)).resolves.toMatchObject({ insecure: false, signedIn: true })
  })
})
