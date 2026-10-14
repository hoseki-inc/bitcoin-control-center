import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  LATEST_RELEASE_URL,
  ReleaseCheckService,
  displayVersion,
  isNewerRelease,
  parseInstalledVersion,
  parseReleaseTag,
} from './service'

const logger = pino({ level: 'silent' })
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type Fetch = (url: string, init: RequestInit) => Promise<Response>

interface Harness {
  service: ReleaseCheckService
  fetch: ReturnType<typeof vi.fn<Fetch>>
}

function setup(
  installedVersion: string | null = '0.5.0:0',
  respond: Fetch = async () => Response.json({ tag: 'v0.6.0_0' }),
): Harness {
  const fetch = vi.fn<Fetch>(respond)
  const service = new ReleaseCheckService({ logger, installedVersion: installedVersion ?? undefined, fetch })
  onTestFinished(() => {
    service.stop()
  })
  return { service, fetch }
}

describe('release versions', () => {
  it('reads release tags and the version desktop builds record', () => {
    expect(parseReleaseTag('v0.6.0_1').unwrap()).toEqual({ major: 0, minor: 6, patch: 0, revision: 1 })
    expect(parseInstalledVersion('0.6.0:1').unwrap()).toEqual({ major: 0, minor: 6, patch: 0, revision: 1 })
    for (const tag of ['0.6.0_0', 'v0.6.0', 'v0.6.0_0-beta', 'v0.6_0', '']) {
      expect(parseReleaseTag(tag).isErr()).toBe(true)
    }
    expect(parseInstalledVersion('0.0.0-dev').isErr()).toBe(true)
  })

  it('compares every part in order, including the package revision', () => {
    const installed = parseInstalledVersion('1.2.3:0').unwrap()
    const newer = (tag: string): boolean => isNewerRelease(parseReleaseTag(tag).unwrap(), installed)
    expect(newer('v1.2.3_1')).toBe(true)
    expect(newer('v1.2.4_0')).toBe(true)
    expect(newer('v1.10.0_0')).toBe(true)
    expect(newer('v2.0.0_0')).toBe(true)
    expect(newer('v1.2.3_0')).toBe(false)
    expect(newer('v1.2.2_9')).toBe(false)
    expect(newer('v0.9.9_0')).toBe(false)
  })

  it('shows a revision only when it is not the first', () => {
    expect(displayVersion(parseReleaseTag('v0.6.0_0').unwrap())).toBe('0.6.0')
    expect(displayVersion(parseReleaseTag('v0.6.0_2').unwrap())).toBe('0.6.0_2')
  })
})

describe('release check', () => {
  it('reports a newer release after checking, sending only a plain request', async () => {
    const { service, fetch } = setup()
    expect(service.status()).toEqual({ newVersion: null })
    await service.checkIfDue()
    expect(service.status()).toEqual({ newVersion: '0.6.0' })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toEqual({ Accept: 'application/json' })
  })

  it('stays quiet when the installed release is current or newer', async () => {
    const { service } = setup('0.6.0:0')
    await service.checkIfDue()
    expect(service.status().newVersion).toBeNull()
  })

  it('never checks without a release version, as in runs from source', async () => {
    const { service, fetch } = setup(null)
    service.start()
    await service.checkIfDue()
    expect(service.status()).toEqual({ newVersion: null })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks about once a day', async () => {
    const { service, fetch } = setup()
    const start = Date.now()
    await service.checkIfDue(start)
    await service.checkIfDue(start + DAY - 1)
    expect(fetch).toHaveBeenCalledOnce()
    await service.checkIfDue(start + DAY)
    expect(fetch).toHaveBeenCalledTimes(2)
    // A clock set back does not hold the next check off for a day.
    await service.checkIfDue(start)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['an error status', async (): Promise<Response> => new Response('', { status: 503 })],
    ['an unexpected body', async (): Promise<Response> => Response.json({ version: '0.6.0' })],
    ['an unrecognized tag', async (): Promise<Response> => Response.json({ tag: 'latest' })],
    [
      'a network failure',
      async (): Promise<Response> => {
        throw new TypeError('fetch failed')
      },
    ],
    ['a body that is not JSON', async (): Promise<Response> => new Response('<html>Not found</html>', { status: 200 })],
  ])('ignores %s and keeps a release already found', async (_name, failure) => {
    const { service, fetch } = setup()
    const start = Date.now()
    await service.checkIfDue(start)
    fetch.mockImplementation(failure)
    await service.checkIfDue(start + DAY)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(service.status().newVersion).toBe('0.6.0')
  })

  it('tries again at the next hourly wake after a failed check, not a day later', async () => {
    const { service, fetch } = setup()
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    const start = Date.now()
    await service.checkIfDue(start)
    expect(service.status().newVersion).toBeNull()
    await service.checkIfDue(start + HOUR)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(service.status().newVersion).toBe('0.6.0')
  })

  it('checks at start, then once a day on its hourly wake, until stopped', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { service, fetch } = setup()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(DAY - HOUR)
    expect(fetch).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(fetch).toHaveBeenCalledTimes(2)
    service.stop()
    await vi.advanceTimersByTimeAsync(2 * DAY)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('ends a request still running when stopped, and shows nothing from it', async () => {
    let signal: AbortSignal | undefined
    const { service } = setup(
      '0.5.0:0',
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init.signal ?? undefined
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const checking = service.checkIfDue()
    await vi.waitFor(() => {
      expect(signal).toBeDefined()
    })
    service.stop()
    await checking
    expect(signal?.aborted).toBe(true)
    expect(service.status().newVersion).toBeNull()
  })
})
