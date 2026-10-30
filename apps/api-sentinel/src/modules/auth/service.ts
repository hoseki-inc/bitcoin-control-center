import { createHash, randomBytes } from 'node:crypto'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb } from '../../db/drizzle'
import { profiles } from '../../db/schema'
import { type Pin, hashPin, verifyPin } from './pin'

/**
 * The platform that turned PINs on. Its rules: StartOS sets the first PIN from an action, so the first visitor can't,
 * and accepts the PIN only over an encrypted connection.
 */
export type PinPlatform = 'startos' | 'umbrel' | 'desktop'

/** Wrong PINs allowed before any delay. */
export const FREE_ATTEMPTS = 5
const FIRST_DELAY_MS = 30 * 1000
const MAX_DELAY_MS = 60 * 60 * 1000
// Sessions exist only after a correct PIN, so this only bounds a long-running server's memory.
const MAX_SESSIONS = 500
const OWNER_ID = 'owner'

/** Who is asking: the browser's cookie key, the tab's ID, and whether the connection is encrypted. */
export interface Visitor {
  browserKey: string | null
  tabId: string | null
  encrypted: boolean
}

/** One signed-in tab. It lasts until the tab locks, Sign out everywhere, or Sentinel restarts. */
export interface Session {
  readonly key: string
  /** When the PIN was last entered in this tab, for actions that ask for it again. */
  pinVerifiedAt: number
}

/** Answers to a PIN that the person sees; `retryAfterMs` on a wrong PIN is set when it started a delay. */
export type PinRefusal =
  | { reason: 'wrong'; freeAttemptsLeft: number; retryAfterMs: number | null }
  | { reason: 'wait'; retryAfterMs: number }

export type PinFailure =
  | PinRefusal
  | { reason: 'no-tab' | 'insecure' | 'not-set' | 'already-set' | 'setup-unavailable' }

export type AuthStatus =
  | { platform: null }
  | {
      platform: PinPlatform
      state: 'insecure' | 'no-pin' | 'signed-out' | 'signed-in'
      /** Time left in a wrong-PIN delay, if one is running. */
      retryAfterMs: number | null
      /** The platform cleared a forgotten PIN and no new one is set yet. */
      pinWasReset: boolean
    }

type Owner = typeof profiles.$inferSelect

export function delayAfter(failedAttempts: number): number {
  if (failedAttempts < FREE_ATTEMPTS) {
    return 0
  }
  return Math.min(FIRST_DELAY_MS * 2 ** (failedAttempts - FREE_ATTEMPTS), MAX_DELAY_MS)
}

/**
 * The owner's PIN, wrong-PIN delays and signed-in tabs. Delays count every attempt from every device and persist
 * across restarts; sessions are kept in memory only, so a restart signs everyone out.
 */
export class AuthService {
  public readonly platform: PinPlatform | null
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly now: () => number
  private readonly hash: (pin: Pin) => Promise<string>
  private readonly sessions = new Map<string, Session>()
  private queue: Promise<unknown> = Promise.resolve()
  private pinWasReset = false

  public constructor(
    db: SentinelDb,
    logger: Logger,
    platform: PinPlatform | null,
    now: () => number = Date.now,
    hash: (pin: Pin) => Promise<string> = hashPin,
  ) {
    this.db = db
    this.logger = logger
    this.platform = platform
    this.now = now
    this.hash = hash
  }

  public async status(visitor: Visitor): Promise<AuthStatus> {
    const { platform } = this
    if (platform === null) {
      return { platform: null }
    }
    return this.withOwner((owner) => ({
      platform,
      state: this.refuses(visitor)
        ? 'insecure'
        : owner.pinHash === null
          ? 'no-pin'
          : this.find(visitor)
            ? 'signed-in'
            : 'signed-out',
      retryAfterMs: this.retryAfter(owner),
      pinWasReset: this.pinWasReset,
    }))
  }

  /** This tab's session, or null while PINs are off. */
  public authorize(visitor: Visitor): Result<Session | null, 'insecure' | 'signed-out'> {
    if (this.platform === null) {
      return Ok(null)
    }
    if (this.refuses(visitor)) {
      return Err('insecure')
    }
    const session = this.find(visitor)
    return session ? Ok(session) : Err('signed-out')
  }

  /** Signs this tab in. Returns the browser key to set as the cookie. */
  public async signIn(pin: Pin, visitor: Visitor): Promise<Result<string, PinFailure>> {
    const admitted = this.admit(visitor)
    if (admitted.isErr()) {
      return Err(admitted.unwrapErr())
    }
    const checked = await this.withOwner(async (owner) => this.check(owner, pin))
    return checked.map(() => this.open(visitor.browserKey, admitted.unwrap()))
  }

  /** The first PIN, set in the app where the platform allows it. Signs this tab in, like `signIn`. */
  public async setFirstPin(pin: Pin, visitor: Visitor): Promise<Result<string, PinFailure>> {
    if (this.platform === 'startos') {
      return Err({ reason: 'setup-unavailable' })
    }
    const admitted = this.admit(visitor)
    if (admitted.isErr()) {
      return Err(admitted.unwrapErr())
    }
    return this.withOwner(async (owner) => {
      if (owner.pinHash !== null) {
        return Err({ reason: 'already-set' })
      }
      // Hashed only while setup is open, so calling this costs the server nothing once a PIN is set.
      await this.update({ pinHash: await this.hash(pin), pinSetAt: this.now(), failedAttempts: 0, nextAttemptAt: null })
      this.pinWasReset = false
      this.logger.info('PIN set')
      return Ok(this.open(visitor.browserKey, admitted.unwrap()))
    })
  }

  /** For actions that ask for the PIN again. Counts toward the same delays as sign-in. */
  public async confirm(session: Session, pin: Pin): Promise<Result<void, PinFailure>> {
    const checked = await this.withOwner(async (owner) => this.check(owner, pin))
    if (checked.isOk()) {
      this.verified(session)
    }
    return checked
  }

  /** Changes the PIN after checking the current one. Every other tab and browser is signed out. */
  public async changePin(session: Session, current: Pin, next: Pin): Promise<Result<void, PinFailure>> {
    return this.withOwner(async (owner) => {
      const checked = await this.check(owner, current)
      if (checked.isErr()) {
        return checked
      }
      await this.update({ pinHash: await this.hash(next), pinSetAt: this.now() })
      this.verified(session)
      // Removes the others rather than re-adding this one, which a Sign out everywhere meanwhile has ended.
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

  /** Signs out every tab on every browser and device, this one included. */
  public signOutEverywhere(): void {
    this.sessions.clear()
    this.logger.info('Signed out everywhere')
  }

  /** The platform set a new PIN (already hashed), or cleared it so the next visit sets one. Signs everyone out. */
  public async setPlatformPin(pinHash: string | null): Promise<void> {
    await this.withOwner(async () => {
      await this.update({
        pinHash,
        pinSetAt: pinHash === null ? null : this.now(),
        failedAttempts: 0,
        nextAttemptAt: null,
      })
    })
    this.sessions.clear()
    this.pinWasReset = pinHash === null
    this.logger.info(pinHash === null ? 'PIN cleared by the platform' : 'PIN replaced by the platform')
  }

  /** Reads and writes of the owner run one at a time, so parallel guesses can't race the attempt counter. */
  private async withOwner<T>(run: (owner: Owner) => Promise<T> | T): Promise<T> {
    const result = this.queue.then(async () => run(await this.readOwner()))
    this.queue = result.catch(() => undefined)
    return result
  }

  /** A deadline more than the longest delay away was set while the clock ran ahead; it moves to an hour from now. */
  private async readOwner(): Promise<Owner> {
    const [owner] = await this.db.select().from(profiles).where(eq(profiles.id, OWNER_ID))
    if (!owner) {
      throw new Error('The owner profile is missing')
    }
    const latest = this.now() + MAX_DELAY_MS
    if (owner.nextAttemptAt !== null && owner.nextAttemptAt > latest) {
      await this.update({ nextAttemptAt: latest })
      return { ...owner, nextAttemptAt: latest }
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

  /** Checks a PIN against the owner's, applying and recording the wrong-PIN delay. Runs inside `withOwner`. */
  private async check(owner: Owner, pin: Pin): Promise<Result<void, PinFailure>> {
    if (owner.pinHash === null) {
      return Err({ reason: 'not-set' })
    }
    const wait = this.retryAfter(owner)
    if (wait !== null) {
      return Err({ reason: 'wait', retryAfterMs: wait })
    }
    if (await verifyPin(pin, owner.pinHash)) {
      await this.update({ failedAttempts: 0, nextAttemptAt: null })
      return Ok(undefined)
    }
    const failedAttempts = owner.failedAttempts + 1
    const delay = delayAfter(failedAttempts)
    await this.update({ failedAttempts, nextAttemptAt: delay > 0 ? this.now() + delay : null })
    this.logger.info({ failedAttempts, delayMs: delay }, 'Wrong PIN')
    return Err({
      reason: 'wrong',
      freeAttemptsLeft: Math.max(0, FREE_ATTEMPTS - failedAttempts),
      retryAfterMs: delay > 0 ? delay : null,
    })
  }

  private refuses(visitor: Visitor): boolean {
    return this.platform === 'startos' && !visitor.encrypted
  }

  /** Sign-in needs this tab's ID, over a connection the platform accepts. */
  private admit(visitor: Visitor): Result<string, PinFailure> {
    if (visitor.tabId === null) {
      return Err({ reason: 'no-tab' })
    }
    return this.refuses(visitor) ? Err({ reason: 'insecure' }) : Ok(visitor.tabId)
  }

  /** The signed-in session for this browser and tab, or null. */
  private find({ browserKey, tabId }: Visitor): Session | null {
    return browserKey === null || tabId === null ? null : (this.sessions.get(sessionKey(browserKey, tabId)) ?? null)
  }

  private open(browserKey: string | null, tabId: string): string {
    const key = browserKey ?? randomBytes(32).toString('base64url')
    const session: Session = { key: sessionKey(key, tabId), pinVerifiedAt: this.now() }
    this.sessions.set(session.key, session)
    // Maps iterate in insertion order, so the first is the oldest.
    const [oldest] = this.sessions.keys()
    if (this.sessions.size > MAX_SESSIONS && oldest !== undefined) {
      this.sessions.delete(oldest)
    }
    return key
  }

  private verified(session: Session): void {
    session.pinVerifiedAt = this.now()
  }
}

function sessionKey(browserKey: string, tabId: string): string {
  return `${createHash('sha256').update(browserKey).digest('hex')}:${tabId}`
}
