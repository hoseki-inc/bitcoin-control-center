import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb } from '../../db/drizzle'
import { profiles } from '../../db/schema'
import { hashPin, isPin, verifyPin } from './pin'

export const OWNER_ID = 'owner'

/** A session ends after this long without the person using the app. Background refreshes don't count. */
export const IDLE_LIMIT_MS = 60 * 60 * 1000
/** Wrong PINs allowed before any delay. */
export const FREE_ATTEMPTS = 5
const FIRST_DELAY_MS = 30 * 1000
const MAX_DELAY_MS = 60 * 60 * 1000
// Sessions exist only after a correct PIN, so this only bounds a long-running server's memory.
const MAX_SESSIONS = 500

/** How someone who forgot the PIN gets back in, which the Forgot PIN screen explains. */
export type PinRecovery = 'startos' | 'umbrel' | 'admin' | 'none'

/** Set by each platform. Off, every route stays open, as before PINs existed. */
export interface AuthPolicy {
  required: boolean
  /** The app may set the first PIN. StartOS sets it from an action instead, so the first visitor can't. */
  inAppSetup: boolean
  /** Refuse sign-in and signed-in routes over plain HTTP. */
  httpsOnly: boolean
  recovery: PinRecovery
}

export const DEFAULT_AUTH_POLICY: AuthPolicy = { required: false, inAppSetup: true, httpsOnly: false, recovery: 'none' }

export const PLATFORM_AUTH_POLICIES = {
  startos: { required: true, inAppSetup: false, httpsOnly: true, recovery: 'startos' },
  umbrel: { required: true, inAppSetup: true, httpsOnly: false, recovery: 'umbrel' },
  desktop: { required: true, inAppSetup: true, httpsOnly: false, recovery: 'admin' },
} as const satisfies Record<string, AuthPolicy>

/** One signed-in tab. The browser key (cookie) and tab ID (header) must both match. */
export interface Session {
  id: string
  profileId: string
  browserKeyHash: string
  tabId: string
  createdAt: number
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
  required: boolean
  pinSet: boolean
  inAppSetup: boolean
  recovery: PinRecovery
  /** This request came over plain HTTP where the platform needs HTTPS, so signing in is refused. */
  needsHttps: boolean
  signedIn: boolean
  /** Time left in a wrong-PIN delay, if one is running. */
  retryAfterMs: number | null
}

export interface SignedIn {
  session: Session
  /** The browser key to set as the cookie: the existing one, or a new one for this browser. */
  browserKey: string
}

type ProfileRow = typeof profiles.$inferSelect

export function hashBrowserKey(browserKey: string): string {
  return createHash('sha256').update(browserKey).digest('hex')
}

export function delayAfter(failedAttempts: number): number {
  if (failedAttempts < FREE_ATTEMPTS) {
    return 0
  }
  return Math.min(FIRST_DELAY_MS * 2 ** (failedAttempts - FREE_ATTEMPTS), MAX_DELAY_MS)
}

/**
 * The owner's PIN, wrong-PIN delays and signed-in tabs. Delays count every attempt from every device, and
 * persist across restarts; sessions are kept in memory only.
 */
export class AuthService {
  public readonly policy: AuthPolicy
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly now: () => number
  private readonly hash: (pin: string) => Promise<string>
  private readonly sessions = new Map<string, Session>()
  private pending: Promise<unknown> = Promise.resolve()

  public constructor(
    db: SentinelDb,
    logger: Logger,
    policy: AuthPolicy,
    now: () => number = Date.now,
    hash: (pin: string) => Promise<string> = hashPin,
  ) {
    this.db = db
    this.logger = logger
    this.policy = policy
    this.now = now
    this.hash = hash
  }

  /** PIN checks run one at a time, so parallel guesses can't race the attempt counter. */
  private async serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.pending.then(run)
    this.pending = result.then(
      () => {},
      () => {},
    )
    return result
  }

  private async owner(): Promise<ProfileRow> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.id, OWNER_ID))
    if (row) {
      return row
    }
    // The migration creates the owner; recreate it if the row was removed by hand.
    await this.db.insert(profiles).values({ id: OWNER_ID, role: 'owner' }).onConflictDoNothing()
    const [created] = await this.db.select().from(profiles).where(eq(profiles.id, OWNER_ID))
    if (!created) {
      throw new Error('The owner profile is missing')
    }
    return created
  }

  private retryAfter(row: ProfileRow): number | null {
    const left = (row.nextAttemptAt ?? 0) - this.now()
    return left > 0 ? left : null
  }

  public async status(browserKey: string | null, tabId: string | null, secure: boolean): Promise<AuthStatus> {
    const row = await this.owner()
    const needsHttps = this.needsHttps(secure)
    return {
      required: this.policy.required,
      pinSet: row.pinHash !== null,
      inAppSetup: this.policy.inAppSetup,
      recovery: this.policy.recovery,
      needsHttps,
      signedIn: !needsHttps && this.resolve(browserKey, tabId) !== null,
      retryAfterMs: this.retryAfter(row),
    }
  }

  public needsHttps(secure: boolean): boolean {
    return this.policy.required && this.policy.httpsOnly && !secure
  }

  /** The signed-in session for this browser and tab, or null. An idle session ends here. */
  public resolve(browserKey: string | null, tabId: string | null): Session | null {
    if (browserKey === null || tabId === null) {
      return null
    }
    const key = sessionKey(hashBrowserKey(browserKey), tabId)
    const session = this.sessions.get(key)
    if (!session) {
      return null
    }
    if (this.now() - session.lastActiveAt > IDLE_LIMIT_MS) {
      this.sessions.delete(key)
      return null
    }
    return session
  }

  /** Real use of the app (typing, clicking) keeps the session open; background refreshes don't call this. */
  public touch(session: Session): void {
    session.lastActiveAt = this.now()
  }

  private open(browserKey: string | null, tabId: string): SignedIn {
    const key = browserKey ?? randomBytes(32).toString('base64url')
    const browserKeyHash = hashBrowserKey(key)
    const now = this.now()
    const session: Session = {
      id: randomUUID(),
      profileId: OWNER_ID,
      browserKeyHash,
      tabId,
      createdAt: now,
      lastActiveAt: now,
      pinVerifiedAt: now,
    }
    this.sessions.set(sessionKey(browserKeyHash, tabId), session)
    this.prune()
    return { session, browserKey: key }
  }

  private prune(): void {
    const now = this.now()
    for (const [key, session] of this.sessions) {
      if (now - session.lastActiveAt > IDLE_LIMIT_MS) {
        this.sessions.delete(key)
      }
    }
    // Maps iterate in insertion order, so this drops the oldest sessions first.
    for (const key of this.sessions.keys()) {
      if (this.sessions.size <= MAX_SESSIONS) {
        break
      }
      this.sessions.delete(key)
    }
  }

  /** Checks a PIN against the owner's, applying and recording the wrong-PIN delay. */
  private async check(pin: string): Promise<Result<void, PinFailure>> {
    if (!isPin(pin)) {
      // Not a guess: a malformed PIN costs no attempt and no hashing.
      return Err({ kind: 'malformed' })
    }
    return this.serial(async () => {
      const row = await this.owner()
      if (row.pinHash === null) {
        return Err({ kind: 'not_set' })
      }
      const wait = this.retryAfter(row)
      if (wait !== null) {
        return Err({ kind: 'wait', retryAfterMs: wait })
      }
      if (await verifyPin(pin, row.pinHash)) {
        if (row.failedAttempts !== 0 || row.nextAttemptAt !== null) {
          await this.db
            .update(profiles)
            .set({ failedAttempts: 0, nextAttemptAt: null })
            .where(eq(profiles.id, OWNER_ID))
        }
        return Ok(undefined)
      }
      const failedAttempts = row.failedAttempts + 1
      const delay = delayAfter(failedAttempts)
      await this.db
        .update(profiles)
        .set({ failedAttempts, nextAttemptAt: delay > 0 ? this.now() + delay : null })
        .where(eq(profiles.id, OWNER_ID))
      this.logger.info({ failedAttempts, delayMs: delay }, 'Wrong PIN')
      return Err({
        kind: 'wrong',
        freeAttemptsLeft: Math.max(0, FREE_ATTEMPTS - failedAttempts),
        retryAfterMs: delay > 0 ? delay : null,
      })
    })
  }

  public async signIn(pin: string, browserKey: string | null, tabId: string): Promise<Result<SignedIn, PinFailure>> {
    const checked = await this.check(pin)
    if (checked.isErr()) {
      return Err(checked.unwrapErr())
    }
    return Ok(this.open(browserKey, tabId))
  }

  /** The first PIN, set in the app where the platform allows it. Signs this tab in. */
  public async setFirstPin(
    pin: string,
    browserKey: string | null,
    tabId: string,
  ): Promise<Result<SignedIn, PinFailure>> {
    if (!this.policy.inAppSetup) {
      return Err({ kind: 'setup_unavailable' })
    }
    if (!isPin(pin)) {
      return Err({ kind: 'malformed' })
    }
    return this.serial(async () => {
      const row = await this.owner()
      if (row.pinHash !== null) {
        return Err({ kind: 'already_set' })
      }
      // Hashed only once setup is still open, so anyone can call this without costing the server a hash.
      const pinHash = await this.hash(pin)
      await this.db
        .update(profiles)
        .set({ pinHash, pinSetAt: this.now(), failedAttempts: 0, nextAttemptAt: null })
        .where(eq(profiles.id, OWNER_ID))
      this.logger.info('PIN set')
      return Ok(this.open(browserKey, tabId))
    })
  }

  /** For actions that ask for the PIN again. Counts toward the same delays as sign-in. */
  public async confirm(session: Session, pin: string): Promise<Result<void, PinFailure>> {
    const checked = await this.check(pin)
    if (checked.isOk()) {
      const now = this.now()
      session.pinVerifiedAt = now
      session.lastActiveAt = now
    }
    return checked
  }

  /** Changes the owner's PIN after checking the current one. Every other tab and browser is signed out. */
  public async changePin(session: Session, currentPin: string, newPin: string): Promise<Result<void, PinFailure>> {
    if (!isPin(newPin)) {
      return Err({ kind: 'malformed' })
    }
    const checked = await this.confirm(session, currentPin)
    if (checked.isErr()) {
      return checked
    }
    const pinHash = await this.hash(newPin)
    await this.serial(async () => {
      await this.db.update(profiles).set({ pinHash, pinSetAt: this.now() }).where(eq(profiles.id, OWNER_ID))
    })
    for (const [key, other] of this.sessions) {
      if (other !== session) {
        this.sessions.delete(key)
      }
    }
    this.logger.info('PIN changed')
    return Ok(undefined)
  }

  public pinEnteredWithin(session: Session, maxAgeMs: number): boolean {
    return this.now() - session.pinVerifiedAt <= maxAgeMs
  }

  /** Locks this tab only. */
  public lock(session: Session): void {
    this.sessions.delete(sessionKey(session.browserKeyHash, session.tabId))
  }

  /** Signs out every tab on every browser and device, this one included. */
  public signOutEverywhere(): void {
    this.endAllSessions()
    this.logger.info('Signed out everywhere')
  }

  public endAllSessions(): void {
    this.sessions.clear()
  }

  /** The platform set a new PIN (already hashed). Clears the delay and signs everyone out. */
  public async replacePinHash(pinHash: string): Promise<void> {
    await this.serial(async () => {
      await this.db
        .update(profiles)
        .set({ pinHash, pinSetAt: this.now(), failedAttempts: 0, nextAttemptAt: null })
        .where(eq(profiles.id, OWNER_ID))
    })
    this.endAllSessions()
    this.logger.info('PIN replaced by the platform')
  }

  /** The platform cleared the PIN, so the next visit sets a new one. Data is kept. */
  public async clearPin(): Promise<void> {
    await this.serial(async () => {
      await this.db
        .update(profiles)
        .set({ pinHash: null, pinSetAt: null, failedAttempts: 0, nextAttemptAt: null })
        .where(eq(profiles.id, OWNER_ID))
    })
    this.endAllSessions()
    this.logger.info('PIN cleared by the platform')
  }
}

function sessionKey(browserKeyHash: string, tabId: string): string {
  return `${browserKeyHash}:${tabId}`
}
