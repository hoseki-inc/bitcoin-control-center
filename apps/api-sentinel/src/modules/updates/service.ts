import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { Logger } from 'pino'
import { z } from 'zod'

/** The website answers with the newest release's tag, for example { "tag": "v0.6.0_0" }. */
export const LATEST_RELEASE_URL = 'https://www.bitcoincontrolcenter.com/latest.json'
const HOUR_MS = 60 * 60 * 1000
const CHECK_INTERVAL_MS = 24 * HOUR_MS
// Timers pause while a computer sleeps, so wake hourly and compare the clock instead of waiting a day.
const WAKE_INTERVAL_MS = HOUR_MS
const REQUEST_TIMEOUT_MS = 30_000
// The answer is a few dozen bytes. Stop reading well before a large or decompression-bomb body could
// exhaust memory, since Sentinel runs inside the desktop app.
const MAX_BODY_BYTES = 4096

const LatestReleaseSchema = z.object({ tag: z.string() })

/** A release version: major.minor.patch, plus the package revision that tags carry as `_N`. */
export interface ReleaseVersion {
  major: number
  minor: number
  patch: number
  revision: number
}

function toVersion(match: RegExpExecArray | null): Result<ReleaseVersion, Error> {
  if (!match) {
    return Err(new Error('Unrecognized release version'))
  }
  const [major, minor, patch, revision] = match.slice(1).map(Number)
  if (major === undefined || minor === undefined || patch === undefined || revision === undefined) {
    return Err(new Error('Unrecognized release version'))
  }
  return Ok({ major, minor, patch, revision })
}

/** A release tag, such as `v0.6.0_0`. */
export function parseReleaseTag(tag: string): Result<ReleaseVersion, Error> {
  return toVersion(/^v(\d{1,6})\.(\d{1,6})\.(\d{1,6})_(\d{1,6})$/.exec(tag))
}

/** The version the desktop build records, such as `0.6.0:0`. */
export function parseInstalledVersion(version: string): Result<ReleaseVersion, Error> {
  return toVersion(/^(\d{1,6})\.(\d{1,6})\.(\d{1,6}):(\d{1,6})$/.exec(version))
}

export function isNewerRelease(candidate: ReleaseVersion, installed: ReleaseVersion): boolean {
  for (const part of ['major', 'minor', 'patch', 'revision'] as const) {
    if (candidate[part] !== installed[part]) {
      return candidate[part] > installed[part]
    }
  }
  return false
}

/** Shown as on the website; a revision only appears when it is not the first. */
export function displayVersion(version: ReleaseVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`
  return version.revision === 0 ? base : `${base}_${version.revision}`
}

export interface ReleaseCheckStatus {
  /** A newer release's version, or null when none is known. */
  newVersion: string | null
  /** True until the first check since launch has finished, so the window can ask again soon. */
  pending: boolean
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** Why a check failed: the website could not be reached, or it answered with something unusable. */
type CheckFailure = { kind: 'unreachable' | 'bad-answer'; message: string }

function unreachable(message: string): Result<never, CheckFailure> {
  return Err({ kind: 'unreachable', message })
}

function badAnswer(message: string): Result<never, CheckFailure> {
  return Err({ kind: 'bad-answer', message })
}

/** Reads at most `limit` bytes of a body as text, or fails once the body is longer. */
async function readLimitedText(response: Response, limit: number): Promise<Result<string, CheckFailure>> {
  const reader = response.body?.getReader()
  if (!reader) {
    return Ok('')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => undefined)
        return badAnswer('The release check response was too large')
      }
      chunks.push(value)
    }
  } catch {
    return unreachable('The release check could not finish reading the response')
  }
  return Ok(new TextDecoder().decode(Buffer.concat(chunks)))
}

/**
 * Checks the website once a day for a newer desktop release, so the app can show a notice. It never
 * downloads or installs anything. The request carries no app or wallet information.
 */
export class ReleaseCheckService {
  private readonly logger: Logger
  private readonly installed: ReleaseVersion | null
  private readonly fetch: Fetch
  private newer: ReleaseVersion | null = null
  /** When the next check is due; null means now. */
  private dueAt: number | null = null
  /** When the last check started, to notice a clock set back. */
  private checkedAt: number | null = null
  /** Unusable answers in a row, which space out retries up to a day. */
  private badAnswers = 0
  private finishedFirstCheck = false
  private checking: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  /** Ends a request still running at shutdown. */
  private readonly stopping = new AbortController()
  private stopped = false

  public constructor(deps: {
    logger: Logger
    /**
     * The running desktop release, such as `0.6.0:0`. Without it, the check stays off. Desktop
     * passes an empty string when a packaged build's version is missing, which is logged.
     */
    installedVersion?: string
    /** Tests replace the network. */
    fetch?: Fetch
  }) {
    this.logger = deps.logger.child({ module: 'release-check' })
    const installed = deps.installedVersion === undefined ? null : parseInstalledVersion(deps.installedVersion)
    if (installed?.isErr() === true) {
      this.logger.warn('Release checks are off: this desktop build has no valid release version')
    }
    this.installed = installed?.unwrapOr(null) ?? null
    this.fetch = deps.fetch ?? (async (url, init): Promise<Response> => fetch(url, init))
  }

  public status(): ReleaseCheckStatus {
    return {
      newVersion: this.newer ? displayVersion(this.newer) : null,
      pending: this.installed !== null && !this.finishedFirstCheck && !this.stopped,
    }
  }

  /** Check now, then about once a day while running. */
  public start(): void {
    if (this.installed === null || this.timer !== undefined || this.stopped) {
      return
    }
    void this.checkIfDue()
    this.timer = setInterval(() => void this.checkIfDue(), WAKE_INTERVAL_MS)
  }

  public stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.stopping.abort()
  }

  /** Checks when the next check is due, or the clock moved back. Never runs two at once. */
  public async checkIfDue(now = Date.now()): Promise<void> {
    if (this.stopped || this.checking) {
      return
    }
    const clockMovedBack = this.checkedAt !== null && now < this.checkedAt
    if (this.dueAt !== null && now < this.dueAt && !clockMovedBack) {
      return
    }
    this.checking = this.check(now).finally(() => {
      this.checking = null
    })
    await this.checking
  }

  private async check(now: number): Promise<void> {
    const installed = this.installed
    if (!installed) {
      return
    }
    this.checkedAt = now
    const latest = await this.fetchLatest()
    if (this.stopped) {
      return
    }
    this.finishedFirstCheck = true
    if (latest.isErr()) {
      const failure = latest.unwrapErr()
      if (failure.kind === 'unreachable') {
        // Offline or a network that is not ready yet: try again at the next hourly wake.
        this.dueAt = now + HOUR_MS
      } else {
        // The website answered but not usefully: wait longer each time, up to a day.
        this.badAnswers += 1
        this.dueAt = now + Math.min(HOUR_MS * 2 ** (this.badAnswers - 1), CHECK_INTERVAL_MS)
      }
      // Keep any release already found.
      this.logger.warn({ reason: failure.message }, 'Could not check for a new release')
      return
    }
    this.badAnswers = 0
    this.dueAt = now + CHECK_INTERVAL_MS
    const release = latest.unwrap()
    this.newer = isNewerRelease(release, installed) ? release : null
    this.logger.info({ newer: this.newer !== null }, 'Checked for a new release')
  }

  private async fetchLatest(): Promise<Result<ReleaseVersion, CheckFailure>> {
    let response: Response
    try {
      response = await this.fetch(LATEST_RELEASE_URL, {
        // Only the request itself: Sentinel keeps no cookies, and the app version is not sent.
        headers: { Accept: 'application/json' },
        // The address is fixed, so a redirect is never followed; it counts as an unusable answer.
        redirect: 'manual',
        signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
    } catch {
      return unreachable('The release check could not reach the website')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return badAnswer(`Release check failed with status ${response.status}`)
    }
    const text = await readLimitedText(response, MAX_BODY_BYTES)
    if (text.isErr()) {
      return Err(text.unwrapErr())
    }
    let json: unknown
    try {
      json = JSON.parse(text.unwrap())
    } catch {
      return badAnswer('The release check did not return JSON')
    }
    const body = parseUnknown(LatestReleaseSchema, json)
    if (body.isErr()) {
      return badAnswer('The release check returned an unexpected response')
    }
    const tag = parseReleaseTag(body.unwrap().tag)
    return tag.isErr() ? badAnswer('The release check returned an unrecognized version') : Ok(tag.unwrap())
  }
}
