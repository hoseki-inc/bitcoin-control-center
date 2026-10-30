import { parse } from '@hoseki/packages/result/lib/parse'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { profiles } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { Pin, hashPin } from './pin'
import { AuthService, type PinPlatform, type Session, delayAfter } from './service'

const TAB = 'tab-aaaaaaaaaaaaaaaa'
const OTHER_TAB = 'tab-bbbbbbbbbbbbbbbb'
const HOUR = 60 * 60 * 1000

function pin(value: string): Pin {
  return parse(Pin, value).expect('a PIN')
}

const PIN = pin('482915')
const WRONG = pin('000000')

function visitor(browserKey: string | null, tabId: string | null = TAB, encrypted = true) {
  return { browserKey, tabId, encrypted }
}

async function setup(platform: PinPlatform | null = 'desktop', hash = hashPin) {
  const { db, logger } = await setupServiceDatabase()
  const clock = { now: 1_700_000_000_000 }
  const create = (): AuthService => new AuthService(db, logger, platform, () => clock.now, hash)
  return { db, clock, auth: create(), create }
}

/** The session for this browser and tab, or null. */
function sessionOf(auth: AuthService, browserKey: string | null, tabId = TAB): Session | null {
  const authorized = auth.authorize(visitor(browserKey, tabId))
  return authorized.isOk() ? authorized.unwrap() : null
}

/** Sets the first PIN from TAB and returns the browser key. */
async function withPin(auth: AuthService): Promise<string> {
  return (await auth.setFirstPin(PIN, visitor(null))).expect('first PIN')
}

async function setDeadline(db: Awaited<ReturnType<typeof setup>>['db'], nextAttemptAt: number): Promise<void> {
  await db.update(profiles).set({ failedAttempts: 9, nextAttemptAt }).where(eq(profiles.id, 'owner'))
}

describe('delayAfter', () => {
  it('allows five free tries, then doubles from 30 seconds up to an hour', () => {
    expect([1, 4, 5, 6, 7, 11, 12, 30].map(delayAfter)).toEqual([
      0, 0, 30_000, 60_000, 120_000, 1_920_000, 3_600_000, 3_600_000,
    ])
  })
})

describe('status', () => {
  it('reports a reset until the new PIN is set', async () => {
    const { auth } = await setup('umbrel')
    await auth.setPlatformPin(null)
    await expect(auth.status(visitor(null))).resolves.toMatchObject({ state: 'no-pin', pinWasReset: true })
    await withPin(auth)
    await expect(auth.status(visitor(null))).resolves.toMatchObject({ pinWasReset: false })
  })

  it('reports PINs off, no PIN yet, signed out and signed in', async () => {
    await expect((await setup(null)).auth.status(visitor(null))).resolves.toEqual({ platform: null })

    const { auth } = await setup('umbrel')
    await expect(auth.status(visitor(null))).resolves.toEqual({
      platform: 'umbrel',
      state: 'no-pin',
      retryAfterMs: null,
      pinWasReset: false,
    })
    const browserKey = await withPin(auth)
    await expect(auth.status(visitor(browserKey))).resolves.toMatchObject({ state: 'signed-in' })
    await expect(auth.status(visitor(browserKey, OTHER_TAB))).resolves.toMatchObject({ state: 'signed-out' })
  })

  it('reports an unencrypted connection on StartOS, and never as signed in', async () => {
    const { auth } = await setup('startos')
    await auth.setPlatformPin(await hashPin(PIN))
    const browserKey = (await auth.signIn(PIN, visitor(null))).expect('sign in')
    await expect(auth.status(visitor(browserKey, TAB, false))).resolves.toMatchObject({ state: 'insecure' })
    expect(auth.authorize(visitor(browserKey, TAB, false)).unwrapErr()).toBe('insecure')
    await expect(auth.status(visitor(browserKey))).resolves.toMatchObject({ state: 'signed-in' })
  })

  it('leaves every route open while PINs are off', async () => {
    const { auth } = await setup(null)
    expect(auth.authorize(visitor(null, null, false)).unwrap()).toBeNull()
  })
})

describe('first PIN', () => {
  it('is set once, signs the tab in, and is stored only as a hash', async () => {
    const { db, auth } = await setup()
    const browserKey = await withPin(auth)
    expect(sessionOf(auth, browserKey)).not.toBeNull()

    const [row] = await db.select().from(profiles)
    expect(row?.pinHash).toMatch(/^scrypt\$/)
    expect(row?.pinHash).not.toContain(PIN)

    expect((await auth.setFirstPin(pin('111111'), visitor(null, OTHER_TAB))).unwrapErr()).toEqual({
      reason: 'already-set',
    })
  })

  it('costs no hash once a PIN is set', async () => {
    const hash = vi.fn(hashPin)
    const { auth } = await setup('desktop', hash)
    await withPin(auth)
    hash.mockClear()
    expect((await auth.setFirstPin(pin('111111'), visitor(null, OTHER_TAB))).isErr()).toBe(true)
    expect(hash).not.toHaveBeenCalled()
  })

  it('cannot be set in the app on StartOS, which sets it from an action', async () => {
    const { auth } = await setup('startos')
    expect((await auth.setFirstPin(PIN, visitor(null))).unwrapErr()).toEqual({ reason: 'setup-unavailable' })
  })

  it('needs this tab’s ID', async () => {
    const { auth } = await setup()
    expect((await auth.setFirstPin(PIN, visitor(null, null))).unwrapErr()).toEqual({ reason: 'no-tab' })
  })
})

describe('signing in', () => {
  it('needs a PIN to be set first', async () => {
    const { auth } = await setup()
    expect((await auth.signIn(PIN, visitor(null))).unwrapErr()).toEqual({ reason: 'not-set' })
  })

  it('opens a session bound to the browser key and the tab', async () => {
    const { auth } = await setup()
    await withPin(auth)
    const browserKey = (await auth.signIn(PIN, visitor(null, OTHER_TAB))).expect('sign in')
    expect(sessionOf(auth, browserKey, OTHER_TAB)).not.toBeNull()
    expect(sessionOf(auth, browserKey, 'tab-cccccccccccccccc')).toBeNull()
    expect(sessionOf(auth, null, OTHER_TAB)).toBeNull()
  })

  it('keeps the browser key when another tab in the same browser signs in', async () => {
    const { auth } = await setup()
    const browserKey = await withPin(auth)
    expect((await auth.signIn(PIN, visitor(browserKey, OTHER_TAB))).expect('sign in')).toBe(browserKey)
    expect(sessionOf(auth, browserKey)).not.toBeNull()
    expect(sessionOf(auth, browserKey, OTHER_TAB)).not.toBeNull()
  })

  it('refuses an unencrypted connection on StartOS', async () => {
    const { auth } = await setup('startos')
    await auth.setPlatformPin(await hashPin(PIN))
    expect((await auth.signIn(PIN, visitor(null, TAB, false))).unwrapErr()).toEqual({ reason: 'insecure' })
  })
})

describe('wrong PINs', () => {
  it('start a delay after five, refuse attempts during it without counting them, and reset after a success', async () => {
    const { db, clock, auth } = await setup()
    await withPin(auth)

    for (const left of [4, 3, 2, 1]) {
      expect((await auth.signIn(WRONG, visitor(null))).unwrapErr()).toEqual({
        reason: 'wrong',
        freeAttemptsLeft: left,
        retryAfterMs: null,
      })
    }
    expect((await auth.signIn(WRONG, visitor(null))).unwrapErr()).toEqual({
      reason: 'wrong',
      freeAttemptsLeft: 0,
      retryAfterMs: 30_000,
    })

    // Even the right PIN waits, and the refused attempt doesn't count.
    clock.now += 10_000
    expect((await auth.signIn(PIN, visitor(null))).unwrapErr()).toEqual({ reason: 'wait', retryAfterMs: 20_000 })
    await expect(auth.status(visitor(null))).resolves.toMatchObject({ retryAfterMs: 20_000 })

    clock.now += 20_000
    expect((await auth.signIn(WRONG, visitor(null))).unwrapErr()).toMatchObject({ retryAfterMs: 60_000 })

    clock.now += 60_000
    expect((await auth.signIn(PIN, visitor(null))).isOk()).toBe(true)
    const [row] = await db.select().from(profiles)
    expect(row).toMatchObject({ failedAttempts: 0, nextAttemptAt: null })
  })

  it('are counted across restarts', async () => {
    const { auth, create } = await setup()
    await withPin(auth)
    for (let i = 0; i < 5; i += 1) {
      await auth.signIn(WRONG, visitor(null))
    }
    expect((await create().signIn(PIN, visitor(null))).unwrapErr()).toMatchObject({ reason: 'wait' })
  })

  it('are counted one at a time when guesses arrive together', async () => {
    const { db, auth } = await setup()
    await withPin(auth)
    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, i) =>
        auth.signIn(pin(`00000${i}`), visitor(null, `tab-${i}aaaaaaaaaaaaaaaa`)),
      ),
    )
    const reasons = results.map((result) => (result.isErr() ? result.unwrapErr().reason : 'ok'))
    expect(reasons.filter((reason) => reason === 'wrong')).toHaveLength(5)
    expect(reasons.filter((reason) => reason === 'wait')).toHaveLength(3)
    const [row] = await db.select().from(profiles)
    expect(row?.failedAttempts).toBe(5)
  })

  it('count in Change PIN and confirmations too', async () => {
    const { auth } = await setup()
    const session = sessionOf(auth, await withPin(auth))
    if (!session) {
      throw new Error('Expected a session')
    }
    for (let i = 0; i < 4; i += 1) {
      await auth.confirm(session, WRONG)
    }
    expect((await auth.changePin(session, WRONG, pin('135790'))).unwrapErr()).toMatchObject({
      reason: 'wrong',
      retryAfterMs: 30_000,
    })
    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).unwrapErr()).toMatchObject({ reason: 'wait' })
  })
})

describe('wrong-PIN delays', () => {
  it('never run longer than an hour from now, even after the clock moves back', async () => {
    const { db, clock, auth } = await setup()
    await withPin(auth)
    // A delay recorded while the clock ran two days ahead.
    await setDeadline(db, clock.now + 48 * HOUR)

    // The sign-in screen asks first, and the hour it shows is the hour served.
    await expect(auth.status(visitor(null))).resolves.toMatchObject({ retryAfterMs: HOUR })
    clock.now += HOUR - 1000
    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).unwrapErr()).toEqual({
      reason: 'wait',
      retryAfterMs: 1000,
    })
    clock.now += 2000
    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).isOk()).toBe(true)
  })

  it('cap a far-off deadline on a sign-in attempt too', async () => {
    const { db, clock, auth } = await setup()
    await withPin(auth)
    await setDeadline(db, clock.now + 48 * HOUR)

    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).unwrapErr()).toEqual({
      reason: 'wait',
      retryAfterMs: HOUR,
    })
    clock.now += HOUR + 1000
    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).isOk()).toBe(true)
  })
})

describe('sessions', () => {
  it('stay open however long the tab sits unused', async () => {
    const { clock, auth } = await setup()
    const browserKey = await withPin(auth)
    const session = sessionOf(auth, browserKey)
    clock.now += 30 * 24 * HOUR
    expect(sessionOf(auth, browserKey)).toBe(session)
  })

  it('lock one tab, or sign out everywhere', async () => {
    const { auth } = await setup()
    const browserKey = await withPin(auth)
    await auth.signIn(PIN, visitor(browserKey, OTHER_TAB))
    const elsewhere = (await auth.signIn(PIN, visitor(null))).expect('sign in')

    const session = sessionOf(auth, browserKey)
    if (!session) {
      throw new Error('Expected a session')
    }
    auth.lock(session)
    expect(sessionOf(auth, browserKey)).toBeNull()
    expect(sessionOf(auth, browserKey, OTHER_TAB)).not.toBeNull()

    auth.signOutEverywhere()
    expect(sessionOf(auth, browserKey, OTHER_TAB)).toBeNull()
    expect(sessionOf(auth, elsewhere)).toBeNull()
  })

  it('record when the PIN was last entered', async () => {
    const { clock, auth } = await setup()
    const session = sessionOf(auth, await withPin(auth))
    if (!session) {
      throw new Error('Expected a session')
    }
    clock.now += 120_000
    expect(auth.pinEnteredWithin(session, 60_000)).toBe(false)
    expect((await auth.confirm(session, PIN)).isOk()).toBe(true)
    expect(auth.pinEnteredWithin(session, 60_000)).toBe(true)
  })
})

describe('changing the PIN', () => {
  it('needs the current PIN and signs out everything but this tab', async () => {
    const { auth } = await setup()
    const mine = await withPin(auth)
    const other = (await auth.signIn(PIN, visitor(null, OTHER_TAB))).expect('sign in')
    const session = sessionOf(auth, mine)
    if (!session) {
      throw new Error('Expected a session')
    }

    expect((await auth.changePin(session, WRONG, pin('135790'))).unwrapErr()).toMatchObject({ reason: 'wrong' })
    expect(sessionOf(auth, other, OTHER_TAB)).not.toBeNull()
    expect((await auth.changePin(session, PIN, pin('135790'))).isOk()).toBe(true)

    expect(sessionOf(auth, mine)).toBe(session)
    expect(sessionOf(auth, other, OTHER_TAB)).toBeNull()
    expect((await auth.signIn(PIN, visitor(null, OTHER_TAB))).isErr()).toBe(true)
    expect((await auth.signIn(pin('135790'), visitor(null, OTHER_TAB))).isOk()).toBe(true)
  })

  it('stays signed out when Sign out everywhere lands while the new PIN is saved', async () => {
    let hashes = 0
    let release = (): void => {}
    const { auth } = await setup('desktop', async (value) => {
      hashes += 1
      if (hashes === 2) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return hashPin(value)
    })
    const mine = await withPin(auth)
    const session = sessionOf(auth, mine)
    if (!session) {
      throw new Error('Expected a session')
    }

    const changing = auth.changePin(session, PIN, pin('135790'))
    await vi.waitFor(() => {
      expect(hashes).toBe(2)
    })
    auth.signOutEverywhere()
    release()
    expect((await changing).isOk()).toBe(true)
    expect(sessionOf(auth, mine)).toBeNull()
  })
})

describe('platform changes', () => {
  it('replace the PIN, clear the delay and sign everyone out', async () => {
    const { db, auth } = await setup()
    const browserKey = await withPin(auth)
    for (let i = 0; i < 6; i += 1) {
      await auth.signIn(WRONG, visitor(null))
    }

    await auth.setPlatformPin(await hashPin(pin('246802')))
    expect(sessionOf(auth, browserKey)).toBeNull()
    const [row] = await db.select().from(profiles)
    expect(row).toMatchObject({ failedAttempts: 0, nextAttemptAt: null })
    expect((await auth.signIn(pin('246802'), visitor(null))).isOk()).toBe(true)
  })

  it('clear the PIN so the next visit sets a new one', async () => {
    const { auth } = await setup()
    const browserKey = await withPin(auth)
    await auth.setPlatformPin(null)
    expect(sessionOf(auth, browserKey)).toBeNull()
    await expect(auth.status(visitor(null))).resolves.toMatchObject({ state: 'no-pin' })
    expect((await auth.setFirstPin(pin('246802'), visitor(null))).isOk()).toBe(true)
  })
})
