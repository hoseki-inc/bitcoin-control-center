import { createHash, randomBytes } from 'node:crypto'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb } from '../../db/drizzle'
import { profiles } from '../../db/schema'
import { hashPin, isPin, verifyPin } from './pin'

const OWNER_ID = 'owner'

/** A session ends after this long without the person using the app. Background refreshes don't count. */
export const IDLE_LIMIT_MS = 60 * 60 * 1000
/** Wrong PINs allowed before any delay. */
export const FREE_ATTEMPTS = 5
const FIRST_DELAY_MS = 30 * 1000
const MAX_DELAY_MS = 60 * 60 * 1000
// Sessions exist only after a correct PIN, so this only bounds a long-running server's memory.
const MAX_SESSIONS = 500

/** The platform that turned PINs on. Without one, every route stays open, as before PINs existed. */
export type PinPlatform = 'startos' | 'umbrel' | 'desktop'

/** One signed-in tab, stored under a key built from the browser key (cookie) and the tab ID (header). */
export interface Session {
  readonly key: string
  lastActiveAt: number
  /** When the PIN was last entered in this tab, for actions that ask for it again. */
  pinVerifiedAt: number
}

export type PinFailure =
  | { kind: 'malformed' }
  | { kind: 'not_set' }
  | { kind: 'already_set' }
  | { kind: 'setup_unavailable' }
  /** `retryAfterMs` is set when this wrong PIN started a delay. */
  | { kind: 'wrong'; freeAttemptsLeft: number; retryAfterMs: number | null }
  | { kind: 'wait'; retryAfterMs: number }

export interface AuthStatus {
  platform: PinPlatform | null
  pinSet: boolean
  /** The app may set the first PIN. StartOS sets it from an action instead, so the first visitor can't. */
  inAppSetup: boolean
  /** Plain HTTP where the platform needs an encrypted connection, so signing in is refused. */
  insecure: boolean
  signedIn: boolean
  /** Time left in a wrong-PIN delay, if one is running. */
  retryAfterMs: number | null
}

export interface SignedIn {
  session: Session
  /** The browser key to set as the cookie: the existing one, or a new one for this browser. */
  browserKey: string
}

type Owner = typeof profiles.$inferSelect

export function delayAfter(failedAttempts: number): number {
  if (failedAttempts < FREE_ATTEMPTS) {
    return 0
  }
  return Math.min(FIRST_DELAY_MS * 2 ** (failedAttempts - FREE_ATTEMPTS), MAX_DELAY_MS)
}

function sessionKey(browserKey: string, tabId: string): string {
  return `${createHash('sha256').update(browserKey).digest('hex')}:${tabId}`
}

/**
 * The owner's PIN, wrong-PIN delays and signed-in tabs. Delays count every attempt from every device, and
 * persist across restarts; sessions are kept in memory only.
 */
export class AuthService {
  public readonly platform: PinPlatform | null
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly now: () => number
  private readonly hash: (pin: string) => Promise<string>
  private readonly sessions = new Map<string, Session>()
  private queue: Promise<unknown> = Promise.resolve()

  public constructor(
    db: SentinelDb,
    logger: Logger,
    platform: PinPlatform | null,
    now: () => number = Date.now,
    hash: (pin: string) => Promise<string> = hashPin,
  ) {
    this.db = db
    this.logger = logger
    this.platform = platform
    this.now = now
    this.hash = hash
  }

  public get required(): boolean {
    return this.platform !== null
  }

  public get inAppSetup(): boolean {
    return this.platform !== 'startos'
  }

  /** StartOS accepts the PIN only over an encrypted connection: HTTPS, or a Tor onion address. */
  public refuses(encrypted: boolean): boolean {
    return this.platform === 'startos' && !encrypted
  }

  /** One owner operation at a time, so parallel guesses can't race the attempt counter. */
  private async withOwner<T>(run: (owner: Owner) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => run(await this.readOwner()))
    this.queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  private async readOwner(): Promise<Owner> {
    const select = async (): Promise<Owner | undefined> =>
      (await this.db.select().from(profiles).where(eq(profiles.id, OWNER_ID)))[0]
    let owner = await select()
    if (!owner) {
      // The migration creates the owner; recreate it if the row was removed by hand.
      await this.db.insert(profiles).values({ id: OWNER_ID, role: 'owner' }).onConflictDoNothing()
      owner = await select()
    }
    if (!owner) {
      throw new Error('The owner profile is missing')
    }
    // A deadline further off than the longest delay was set while the clock ran ahead: bring it to the longest
    // delay from now, so the wait shown is the wait served.
    if (owner.nextAttemptAt !== null && owner.nextAttemptAt - this.now() > MAX_DELAY_MS) {
      const nextAttemptAt = this.now() + MAX_DELAY_MS
      await this.update({ nextAttemptAt })
      return { ...owner, nextAttemptAt }
    }
    return owner
  }

  private async update(values: Partial<Owner>): Promise<void> {
    await this.db.update(profiles).set(values).where(eq(profiles.id, OWNER_ID))
  }

  private retryAfter(owner: Owner): number | null {
    const left = (owner.nextAttemptAt ?? 0) - this.now()
    return left > 0 ? left : null
  }

  public async status(browserKey: string | null, tabId: string | null, encrypted: boolean): Promise<AuthStatus> {
    return this.withOwner(async (owner) => {
      const insecure = this.refuses(encrypted)
      return {
        platform: this.platform,
        pinSet: owner.pinHash !== null,
        inAppSetup: this.inAppSetup,
        insecure,
        signedIn: !insecure && this.resolve(browserKey, tabId) !== null,
        retryAfterMs: this.retryAfter(owner),
      }
    })
  }

  /** The signed-in session for this browser and tab, or null. An idle session ends here. */
  public resolve(browserKey: string | null, tabId: string | null): Session | null {
    if (browserKey === null || tabId === null) {
      return null
    }
    const key = sessionKey(browserKey, tabId)
    const session = this.sessions.get(key)
    if (session && this.now() - session.lastActiveAt > IDLE_LIMIT_MS) {
      this.sessions.delete(key)
      return null
    }
    return session ?? null
  }

  /** Real use of the app (typing, clicking) keeps the session open; background refreshes don't call this. */
  public touch(session: Session): void {
    session.lastActiveAt = this.now()
  }

  private open(browserKey: string | null, tabId: string): SignedIn {
    const key = browserKey ?? randomBytes(32).toString('base64url')
    const now = this.now()
    const session: Session = { key: sessionKey(key, tabId), lastActiveAt: now, pinVerifiedAt: now }
    this.sessions.set(session.key, session)
    for (const [other, { lastActiveAt }] of this.sessions) {
      if (now - lastActiveAt > IDLE_LIMIT_MS) {
        this.sessions.delete(other)
      }
    }
    // Maps iterate in insertion order, so this drops the oldest sessions first.
    for (const other of this.sessions.keys()) {
      if (this.sessions.size <= MAX_SESSIONS) {
        break
      }
      this.sessions.delete(other)
    }
    return { session, browserKey: key }
  }

  /** Checks a PIN against the owner's, applying and recording the wrong-PIN delay. Runs inside `withOwner`. */
  private async verify(owner: Owner, pin: string): Promise<Result<void, PinFailure>> {
    if (owner.pinHash === null) {
      return Err({ kind: 'not_set' })
    }
    const wait = this.retryAfter(owner)
    if (wait !== null) {
      return Err({ kind: 'wait', retryAfterMs: wait })
    }
    if (await verifyPin(pin, owner.pinHash)) {
      if (owner.failedAttempts !== 0 || owner.nextAttemptAt !== null) {
        await this.update({ failedAttempts: 0, nextAttemptAt: null })
      }
      return Ok(undefined)
    }
    const failedAttempts = owner.failedAttempts + 1
    const delay = delayAfter(failedAttempts)
    await this.update({ failedAttempts, nextAttemptAt: delay > 0 ? this.now() + delay : null })
    this.logger.info({ failedAttempts, delayMs: delay }, 'Wrong PIN')
    return Err({
      kind: 'wrong',
      freeAttemptsLeft: Math.max(0, FREE_ATTEMPTS - failedAttempts),
      retryAfterMs: delay > 0 ? delay : null,
    })
  }

  private async check(pin: string): Promise<Result<void, PinFailure>> {
    // Not a guess: a malformed PIN costs no attempt and no hashing.
    return isPin(pin) ? this.withOwner(async (owner) => this.verify(owner, pin)) : Err({ kind: 'malformed' })
  }

  public async signIn(pin: string, browserKey: string | null, tabId: string): Promise<Result<SignedIn, PinFailure>> {
    return (await this.check(pin)).map(() => this.open(browserKey, tabId))
  }

  /** The first PIN, set in the app where the platform allows it. Signs this tab in. */
  public async setFirstPin(
    pin: string,
    browserKey: string | null,
    tabId: string,
  ): Promise<Result<SignedIn, PinFailure>> {
    if (!this.inAppSetup) {
      return Err({ kind: 'setup_unavailable' })
    }
    if (!isPin(pin)) {
      return Err({ kind: 'malformed' })
    }
    return this.withOwner(async (owner) => {
      if (owner.pinHash !== null) {
        return Err({ kind: 'already_set' })
      }
      // Hashed only while setup is still open, so anyone can call this without costing the server a hash.
      await this.update({ pinHash: await this.hash(pin), pinSetAt: this.now(), failedAttempts: 0, nextAttemptAt: null })
      this.logger.info('PIN set')
      return Ok(this.open(browserKey, tabId))
    })
  }

  /** For actions that ask for the PIN again. Counts toward the same delays as sign-in. */
  public async confirm(session: Session, pin: string): Promise<Result<void, PinFailure>> {
    const checked = await this.check(pin)
    if (checked.isOk()) {
      session.pinVerifiedAt = this.now()
      session.lastActiveAt = session.pinVerifiedAt
    }
    return checked
  }

  /** Changes the owner's PIN after checking the current one. Every other tab and browser is signed out. */
  public async changePin(session: Session, currentPin: string, newPin: string): Promise<Result<void, PinFailure>> {
    if (!isPin(currentPin) || !isPin(newPin)) {
      return Err({ kind: 'malformed' })
    }
    return this.withOwner(async (owner) => {
      const verified = await this.verify(owner, currentPin)
      if (verified.isErr()) {
        return verified
      }
      await this.update({ pinHash: await this.hash(newPin), pinSetAt: this.now() })
      session.pinVerifiedAt = this.now()
      session.lastActiveAt = session.pinVerifiedAt
      for (const key of this.sessions.keys()) {
        if (key !== session.key) {
          this.sessions.delete(key)
        }
      }
      this.logger.info('PIN changed')
      return Ok(undefined)
    })
  }

  public pinEnteredWithin(session: Session, maxAgeMs: number): boolean {
    return this.now() - session.pinVerifiedAt <= maxAgeMs
  }

  /** Locks this tab only. */
  public lock(session: Session): void {
    this.sessions.delete(session.key)
  }

  /** Signs out every tab on every browser and device. */
  public signOutEverywhere(): void {
    this.sessions.clear()
    this.logger.info('Signed out everywhere')
  }

  /** The platform set a new PIN (already hashed), or cleared it so the next visit sets one. Data is kept. */
  public async setPlatformPin(pinHash: string | null): Promise<void> {
    await this.withOwner(async () =>
      this.update({ pinHash, pinSetAt: pinHash === null ? null : this.now(), failedAttempts: 0, nextAttemptAt: null }),
    )
    this.sessions.clear()
    this.logger.info(pinHash === null ? 'PIN cleared by the platform' : 'PIN replaced by the platform')
  }
}
