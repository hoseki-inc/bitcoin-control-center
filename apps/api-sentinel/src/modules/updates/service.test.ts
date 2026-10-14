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
  it('reports a newer release after checking, sending only a plain request that follows no redirects', async () => {
    const { service, fetch } = setup()
    expect(service.status()).toEqual({ newVersion: null, pending: true })
    await service.checkIfDue()
    expect(service.status()).toEqual({ newVersion: '0.6.0', pending: false })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toEqual({ Accept: 'application/json' })
    expect(init?.redirect).toBe('manual')
  })

  it('stays quiet when the installed release is current or newer', async () => {
    const { service } = setup('0.6.0:0')
    await service.checkIfDue()
    expect(service.status().newVersion).toBeNull()
  })

  it('never checks or waits for a check without a release version, as in runs from source', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { service, fetch } = setup(null)
    service.start()
    expect(vi.getTimerCount()).toBe(0)
    await service.checkIfDue()
    expect(service.status()).toEqual({ newVersion: null, pending: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('logs that checks are off only when a packaged build has no valid version', () => {
    const lines: string[] = []
    const recording = pino(
      { level: 'warn' },
      {
        write: (line: string): void => {
          lines.push(line)
        },
      },
    )
    new ReleaseCheckService({ logger: recording })
    new ReleaseCheckService({ logger: recording, installedVersion: '0.5.0:0' })
    expect(lines).toEqual([])
    new ReleaseCheckService({ logger: recording, installedVersion: '' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Release checks are off')
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

  it('runs one check at a time', async () => {
    let answer: ((response: Response) => void) | undefined
    const { service, fetch } = setup(
      '0.5.0:0',
      async () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const first = service.checkIfDue()
    const second = service.checkIfDue()
    await vi.waitFor(() => {
      expect(answer).toBeDefined()
    })
    answer?.(Response.json({ tag: 'v0.6.0_0' }))
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['an error status', async (): Promise<Response> => new Response('', { status: 503 })],
    ['a redirect', async (): Promise<Response> => new Response(null, { status: 302, headers: { Location: '/' } })],
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

  it('stops reading a response larger than a release answer needs', async () => {
    let pulls = 0
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulls += 1
        controller.enqueue(new Uint8Array(1024).fill(0x5b))
      },
    })
    const { service } = setup('0.5.0:0', async () => new Response(endless, { status: 200 }))
    await service.checkIfDue()
    expect(pulls).toBeLessThan(10)
    expect(service.status()).toEqual({ newVersion: null, pending: false })
  })

  it('releases the body of an error response', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const { service } = setup('0.5.0:0', async () => new Response(body, { status: 503 }))
    await service.checkIfDue()
    expect(cancel).toHaveBeenCalled()
  })

  it('tries again at the next hourly wake when the website cannot be reached', async () => {
    const { service, fetch } = setup()
    fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    const start = Date.now()
    await service.checkIfDue(start)
    expect(service.status()).toEqual({ newVersion: null, pending: false })
    await service.checkIfDue(start + HOUR)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(service.status().newVersion).toBe('0.6.0')
  })

  it('waits longer after each unusable answer, up to a day, and resets after a good one', async () => {
    const { service, fetch } = setup()
    fetch.mockImplementation(async () => new Response('', { status: 503 }))
    let now = Date.now()
    const callsAfter = async (wait: number): Promise<number> => {
      now += wait
      await service.checkIfDue(now)
      return fetch.mock.calls.length
    }
    await expect(callsAfter(0)).resolves.toBe(1)
    await expect(callsAfter(HOUR)).resolves.toBe(2)
    await expect(callsAfter(HOUR)).resolves.toBe(2)
    await expect(callsAfter(HOUR)).resolves.toBe(3)
    await expect(callsAfter(3 * HOUR)).resolves.toBe(3)
    await expect(callsAfter(HOUR)).resolves.toBe(4)
    for (const wait of [8, 16, 24, 24]) {
      await callsAfter(wait * HOUR)
    }
    expect(fetch).toHaveBeenCalledTimes(8)
    // Capped at a day.
    await expect(callsAfter(DAY - 1)).resolves.toBe(8)
    await expect(callsAfter(1)).resolves.toBe(9)
    fetch.mockImplementation(async () => Response.json({ tag: 'v0.6.0_0' }))
    await expect(callsAfter(DAY)).resolves.toBe(10)
    fetch.mockImplementation(async () => new Response('', { status: 503 }))
    await expect(callsAfter(DAY)).resolves.toBe(11)
    await expect(callsAfter(HOUR)).resolves.toBe(12)
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
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores an answer that arrives after it stopped', async () => {
    let answer: ((response: Response) => void) | undefined
    let signal: AbortSignal | undefined
    const { service } = setup(
      '0.5.0:0',
      async (_url, init) =>
        new Promise<Response>((resolve) => {
          signal = init.signal ?? undefined
          answer = resolve
        }),
    )
    const checking = service.checkIfDue()
    await vi.waitFor(() => {
      expect(answer).toBeDefined()
    })
    service.stop()
    expect(signal?.aborted).toBe(true)
    answer?.(Response.json({ tag: 'v0.6.0_0' }))
    await checking
    expect(service.status()).toEqual({ newVersion: null, pending: false })
  })
})
