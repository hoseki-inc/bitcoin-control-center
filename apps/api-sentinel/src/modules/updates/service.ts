import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { Logger } from 'pino'
import { z } from 'zod'

/** The website answers with the newest release's tag, for example { "tag": "v0.6.0_0" }. */
export const LATEST_RELEASE_URL = 'https://www.bitcoincontrolcenter.com/latest.json'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
// Timers pause while a computer sleeps, so wake hourly and compare the clock instead of waiting a day.
const WAKE_INTERVAL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000

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
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Checks the website once a day for a newer desktop release, so the app can show a notice. It never
 * downloads or installs anything. The request carries no app or wallet information.
 */
export class ReleaseCheckService {
  private readonly logger: Logger
  private readonly installed: ReleaseVersion | null
  private readonly fetch: Fetch
  private newer: ReleaseVersion | null = null
  private lastCheck: number | null = null
  private checking: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  /** Ends a request still running at shutdown. */
  private readonly stopping = new AbortController()
  private stopped = false

  public constructor(deps: {
    logger: Logger
    /** The running desktop release, such as `0.6.0:0`. Without it, the check stays off. */
    installedVersion?: string
    /** Tests replace the network. */
    fetch?: Fetch
  }) {
    this.logger = deps.logger.child({ module: 'release-check' })
    this.installed =
      deps.installedVersion === undefined ? null : parseInstalledVersion(deps.installedVersion).unwrapOr(null)
    this.fetch = deps.fetch ?? (async (url, init): Promise<Response> => fetch(url, init))
  }

  public status(): ReleaseCheckStatus {
    return { newVersion: this.newer ? displayVersion(this.newer) : null }
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

  /** Checks when the last check is a day old, or the clock moved back. Never runs two at once. */
  public async checkIfDue(now = Date.now()): Promise<void> {
    if (this.stopped || this.checking) {
      return
    }
    if (this.lastCheck !== null && now >= this.lastCheck && now - this.lastCheck < CHECK_INTERVAL_MS) {
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
    this.lastCheck = now
    const latest = await this.fetchLatest()
    if (this.stopped) {
      return
    }
    if (latest.isErr()) {
      // Keep any release already found, and try again at the next hourly wake rather than in a day,
      // so starting offline does not hold the notice back.
      this.lastCheck = null
      this.logger.warn({ reason: latest.unwrapErr().message }, 'Could not check for a new release')
      return
    }
    const release = latest.unwrap()
    this.newer = isNewerRelease(release, installed) ? release : null
    this.logger.info({ newer: this.newer !== null }, 'Checked for a new release')
  }

  private async fetchLatest(): Promise<Result<ReleaseVersion, Error>> {
    let response: Response
    try {
      response = await this.fetch(LATEST_RELEASE_URL, {
        // Only the request itself: Sentinel keeps no cookies, and the app version is not sent.
        headers: { Accept: 'application/json' },
        signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      })
    } catch {
      return Err(new Error('The release check could not reach the website'))
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return Err(new Error(`Release check failed with status ${response.status}`))
    }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return Err(new Error('The release check did not return JSON'))
    }
    const body = parseUnknown(LatestReleaseSchema, json)
    if (body.isErr()) {
      return Err(new Error('The release check returned an unexpected response'))
    }
    return parseReleaseTag(body.unwrap().tag)
  }
}
