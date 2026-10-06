import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { DailyRatesService } from './daily_rates'
import { PriceService, type SavedPriceSettings, readPriceSettings } from './service'

const logger = pino({ level: 'silent' })
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  // Only the wall clock is faked; request and lookup time limits use real timers.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })

  await run()
}

const NOW = new Date('2026-09-29T17:00:00Z')
const NOW_SECONDS = NOW.getTime() / 1000
const MEMPOOL = 'mempool.space'
const LOCAL_MEMPOOL = 'mempool.local'
const BLOCK = 'pricing.bitcoin.block.xyz'
const COINBASE = 'api.coinbase.com'
const COINGECKO = 'api.coingecko.com'

const prices = {
  mempool: (usd: number, time = NOW_SECONDS) => Response.json({ time, USD: usd, EUR: 1 }),
  block: (amount: string, time = NOW_SECONDS, headers?: HeadersInit) =>
    Response.json(
      {
        amount,
        base: 'BTC',
        currency: 'USD',
        last_updated_at_in_utc_epoch_seconds: String(time),
        version: '1',
      },
      { headers },
    ),
  coinbase: (amount: string) => Response.json({ data: { amount, base: 'BTC', currency: 'USD' } }),
  coingecko: (usd: number) => Response.json({ bitcoin: { usd, last_updated_at: NOW_SECONDS } }),
}
const refused = (): Response => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })
const never = async (): Promise<Response> => new Promise<Response>(() => undefined)

/** Answers each price host with its reply; any other host is unavailable. */
function stubPrices(replies: Record<string, () => Response | Error | Promise<Response>>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const reply = await (replies[new URL(url).host]?.() ?? new Response('unavailable', { status: 503 }))
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  })
  vi.stubGlobal('fetch', fetch)
  return {
    hosts: () => fetch.mock.calls.map(([url]) => new URL(url).host),
    urls: () => fetch.mock.calls.map(([url]) => url),
  }
}

function priceService(
  settings: Partial<SavedPriceSettings> = {},
  mempoolApiUrl = 'https://mempool.space',
  limits: { requestTimeoutMs?: number; lookupTimeoutMs?: number; lastKnownWaitMs?: number } = {},
) {
  const current: SavedPriceSettings = { source: undefined, fallbacks: true, ...settings }
  return {
    service: new PriceService({
      logger,
      mempoolApiUrl,
      settings: () => current,
      requestTimeoutMs: limits.requestTimeoutMs ?? 20,
      lookupTimeoutMs: limits.lookupTimeoutMs,
      lastKnownWaitMs: limits.lastKnownWaitMs,
    }),
    settings: current,
  }
}

/** Replies that stay pending until released, one per request in the order they were made. */
function heldReplies() {
  const releases: Array<(response: Response) => void> = []
  return {
    next: async (): Promise<Response> =>
      new Promise<Response>((resolve) => {
        releases.push(resolve)
      }),
    /** Answers every request still waiting. */
    release: (response: () => Response) => {
      for (const resolve of releases.splice(0)) {
        resolve(response())
      }
    },
    count: () => releases.length,
  }
}

/** Elapsed time is measured on the real monotonic clock too, so a price can age by a few real milliseconds. */
function expectAbout(date: Date, expected: number): void {
  expect(Math.abs(date.getTime() - expected)).toBeLessThan(1000)
}

/** Lets a released reply and the callbacks after it run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('current price', () => {
  it('reads and caches the price from a self-hosted mempool by default, with its own timestamp', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [LOCAL_MEMPOOL]: () => prices.mempool(12345.67, NOW_SECONDS - 300) })
      const { service } = priceService({}, 'http://mempool.local/')
      const price = (await service.getCurrentBtcPrice()).expect('price')
      expect(price.value.toString()).toBe('12345.67')
      expect(price.source).toBe('mempool')
      expect(price.lastKnown).toBe(false)
      expectAbout(price.asOf, NOW.getTime() - 300_000)
      expect((await service.getCurrentBtcPrice()).expect('cached').value.toString()).toBe('12345.67')
      expect(fetch.hosts()).toEqual([LOCAL_MEMPOOL])
    })
  })

  it.each([
    [undefined, BLOCK, () => prices.block('83086.98'), 'block', '83086.98'],
    ['mempool', BLOCK, () => prices.block('83086.98'), 'block', '83086.98'],
    ['mempool.space', MEMPOOL, () => prices.mempool(83000), 'mempool.space', '83000'],
    ['coinbase', COINBASE, () => prices.coinbase('83000.5'), 'coinbase', '83000.5'],
    ['coingecko', COINGECKO, () => prices.coingecko(82999), 'coingecko', '82999'],
  ] as const)(
    'without a self-hosted mempool, reads a saved %s choice from %s',
    async (saved, host, reply, source, value) => {
      await withTestSetup(async () => {
        const fetch = stubPrices({ [host]: reply })
        const price = (await priceService({ source: saved }).service.getCurrentBtcPrice()).expect('price')
        expect(price.value.toString()).toBe(value)
        expect(price.source).toBe(source)
        expect(fetch.hosts()).toEqual([host])
      })
    },
  )

  it('falls back to Block, public mempool.space, Coinbase and CoinGecko in order', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [COINGECKO]: () => prices.coingecko(82999) })
      const price = (await priceService({}, 'http://mempool.local').service.getCurrentBtcPrice()).expect('fallback')
      expect(price.source).toBe('coingecko')
      expect(fetch.hosts()).toEqual([LOCAL_MEMPOOL, BLOCK, MEMPOOL, COINBASE, COINGECKO])
    })
  })

  it('tries the other sources in order after a chosen source fails', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [COINBASE]: refused, [MEMPOOL]: () => prices.mempool(83000) })
      const price = (await priceService({ source: 'coinbase' }).service.getCurrentBtcPrice()).expect('fallback')
      expect(price.source).toBe('mempool.space')
      expect(fetch.hosts()).toEqual([COINBASE, BLOCK, MEMPOOL])
    })
  })

  it('uses only the chosen source when fallbacks are off', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [LOCAL_MEMPOOL]: refused, [BLOCK]: () => prices.block('83086.98') })
      const result = await priceService({ fallbacks: false }, 'http://mempool.local').service.getCurrentBtcPrice()
      expect(result.expectErr('no fallback').message).toBe(
        'No BTC price available: Your mempool server (mempool.local) price error: 429 Too Many Requests',
      )
      expect(fetch.hosts()).toEqual([LOCAL_MEMPOOL])
    })
  })

  it('waits before asking a source again after it refused', async () => {
    await withTestSetup(async () => {
      let block = refused
      const fetch = stubPrices({ [BLOCK]: () => block() })
      const { service } = priceService({ fallbacks: false })
      const message = 'No BTC price available: Block price error: 429 Too Many Requests'
      expect((await service.getCurrentBtcPrice()).expectErr('refused').message).toBe(message)
      expect((await service.getCurrentBtcPrice()).expectErr('still waiting').message).toBe(message)
      expect(fetch.hosts()).toEqual([BLOCK])

      block = () => prices.block('12345', NOW_SECONDS + 30)
      vi.advanceTimersByTime(30_000)
      expect((await service.getCurrentBtcPrice()).expect('recovered').value.toString()).toBe('12345')
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('asks again right away after a network error, which is no rate limit', async () => {
    await withTestSetup(async () => {
      let block: () => Response | Error = () => new TypeError('fetch failed')
      const fetch = stubPrices({ [BLOCK]: () => block() })
      const { service } = priceService({ fallbacks: false })
      expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
      block = () => prices.block('83000')
      expect((await service.getCurrentBtcPrice()).expect('recovered').value.toString()).toBe('83000')
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('reports why a request could not be made', async () => {
    await withTestSetup(async () => {
      stubPrices({
        [BLOCK]: () => new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') }),
      })
      const result = await priceService({ fallbacks: false }).service.getCurrentBtcPrice()
      expect(result.expectErr('network failure').message).toBe(
        'No BTC price available: Block price request failed: fetch failed: connect ECONNREFUSED 127.0.0.1:443',
      )
    })
  })

  it('waits for a fresh quote after cache expiry and shares it across callers', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      let answer = true
      const fetch = stubPrices({ [BLOCK]: async () => (answer ? prices.block('83000') : block.next()) })
      const { service } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('first').value.toString()).toBe('83000')

      answer = false
      vi.advanceTimersByTime(61_000)
      const first = service.getCurrentBtcPrice()
      const second = service.getCurrentBtcPrice()
      await settle()
      expect(block.count()).toBe(1)
      block.release(() => prices.block('84000', NOW_SECONDS + 61))
      for (const pending of [first, second]) {
        const fresh = (await pending).expect('refreshed')
        expect(fresh.value.toString()).toBe('84000')
        expect(fresh.lastKnown).toBe(false)
      }
      expect((await service.getCurrentBtcPrice()).expect('refreshed').value.toString()).toBe('84000')
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('keeps the last price, marked as last known, for up to 30 minutes while every source fails', async () => {
    await withTestSetup(async () => {
      let available = true
      stubPrices({ [BLOCK]: () => (available ? prices.block('83000', NOW_SECONDS - 600) : refused()) })
      const { service } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('fresh').lastKnown).toBe(false)

      available = false
      vi.advanceTimersByTime(61_000)
      const last = (await service.getCurrentBtcPrice()).expect('last known')
      expect(last.value.toString()).toBe('83000')
      expect(last.lastKnown).toBe(true)

      vi.advanceTimersByTime(19 * 60_000)
      expect((await service.getCurrentBtcPrice()).expectErr('too old').message).toContain('No BTC price available')
    })
  })

  it('waits only briefly for fallbacks when a recent price is available', async () => {
    await withTestSetup(async () => {
      let blockUp = true
      stubPrices({ [BLOCK]: () => (blockUp ? prices.block('83000') : refused()), [MEMPOOL]: never, [COINBASE]: never })
      const { service } = priceService({}, undefined, { requestTimeoutMs: 5000, lastKnownWaitMs: 50 })
      expect((await service.getCurrentBtcPrice()).isOk()).toBe(true)
      blockUp = false
      vi.advanceTimersByTime(61_000)
      await service.getCurrentBtcPrice()
      await settle()

      // Block has failed and every fallback hangs: answer with the last known price instead of waiting 15 s.
      const started = performance.now()
      const last = (await service.getCurrentBtcPrice()).expect('last known')
      expect(last.lastKnown).toBe(true)
      expect(performance.now() - started).toBeLessThan(1000)
    })
  })

  it('rejects an expired self-hosted quote and tries the next source', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({
        [LOCAL_MEMPOOL]: () => prices.mempool(70000, NOW_SECONDS - 2 * 3600),
        [BLOCK]: () => prices.block('83086.98'),
      })
      const price = (await priceService({}, 'http://mempool.local').service.getCurrentBtcPrice()).expect('fresh')
      expect(price.source).toBe('block')
      expect(fetch.hosts()).toEqual([LOCAL_MEMPOOL, BLOCK])

      const result = await priceService({ fallbacks: false }, 'http://mempool.local').service.getCurrentBtcPrice()
      expect(result.expectErr('too old').message).toBe(
        'No BTC price available: Your mempool server (mempool.local) price is 120 minutes old',
      )
    })
  })

  it('ages a price by the clock of the source, so a fast local clock does not reject it', async () => {
    await withTestSetup(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 45 * 60_000))
      stubPrices({ [BLOCK]: () => prices.block('83000', NOW_SECONDS - 10, { date: NOW.toUTCString() }) })
      const price = (await priceService({ fallbacks: false }).service.getCurrentBtcPrice()).expect('accepted')
      expect(price.value.toString()).toBe('83000')
      expectAbout(price.asOf, Date.now() - 10_000)
    })
  })

  it('does not report a price as newer than when the source sent it', async () => {
    await withTestSetup(async () => {
      stubPrices({ [BLOCK]: () => prices.block('83086.98', NOW_SECONDS + 3600) })
      const price = (await priceService().service.getCurrentBtcPrice()).expect('price')
      expectAbout(price.asOf, NOW.getTime())
      expect(price.asOf.getTime()).toBeLessThanOrEqual(NOW.getTime())
    })
  })

  it('makes one request per source for concurrent callers', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: () => prices.block('83000') })
      const { service } = priceService()
      const results = await Promise.all([service.getCurrentBtcPrice(), service.getCurrentBtcPrice()])
      expect(results.map((result) => result.expect('price').value.toString())).toEqual(['83000', '83000'])
      expect(fetch.hosts()).toEqual([BLOCK])
    })
  })

  it('keeps the price of each source when the source or fallbacks change and change back', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: () => prices.block('83000'), [COINBASE]: () => prices.coinbase('83100') })
      const { service, settings } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('block').source).toBe('block')
      settings.fallbacks = false
      expect((await service.getCurrentBtcPrice()).expect('fallbacks off').source).toBe('block')
      settings.source = 'coinbase'
      expect((await service.getCurrentBtcPrice()).expect('coinbase').source).toBe('coinbase')
      settings.source = 'block'
      expect((await service.getCurrentBtcPrice()).expect('block again').value.toString()).toBe('83000')
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('keeps the last known price of a source after switching away and back while it is down', async () => {
    await withTestSetup(async () => {
      let blockUp = true
      stubPrices({
        [BLOCK]: () => (blockUp ? prices.block('83000') : refused()),
        [COINBASE]: () => prices.coinbase('83100'),
      })
      const { service, settings } = priceService({ fallbacks: false })
      expect((await service.getCurrentBtcPrice()).isOk()).toBe(true)
      blockUp = false
      vi.advanceTimersByTime(61_000)
      await service.getCurrentBtcPrice()
      await settle()

      settings.source = 'coinbase'
      expect((await service.getCurrentBtcPrice()).expect('coinbase').source).toBe('coinbase')
      settings.source = 'block'
      const last = (await service.getCurrentBtcPrice()).expect('last known')
      expect(last.source).toBe('block')
      expect(last.lastKnown).toBe(true)
    })
  })

  it('moves on to the next source when one never answers', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: never, [MEMPOOL]: () => prices.mempool(83000) })
      const { service } = priceService()
      const results = await Promise.all([service.getCurrentBtcPrice(), service.getCurrentBtcPrice()])
      expect(results.map((result) => result.expect('fallback').source)).toEqual(['mempool.space', 'mempool.space'])
      expect(fetch.hosts()).toEqual([BLOCK, MEMPOOL])
    })
  })

  it('moves on to the next source when a response body never finishes', async () => {
    await withTestSetup(async () => {
      stubPrices({
        [BLOCK]: () => new Response(new ReadableStream({ start: () => undefined })),
        [MEMPOOL]: () => prices.mempool(83000),
      })
      expect((await priceService().service.getCurrentBtcPrice()).expect('fallback').source).toBe('mempool.space')
      expect(
        (await priceService({ fallbacks: false }).service.getCurrentBtcPrice()).expectErr('timed out').message,
      ).toBe('No BTC price available: Block price request failed: no response within 0.02 seconds')
    })
  })

  it('answers each caller within its own time limit, without counting that against the source', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next })
      const { service } = priceService({ fallbacks: false }, undefined, { requestTimeoutMs: 5000, lookupTimeoutMs: 40 })
      const result = await service.getCurrentBtcPrice()
      expect(result.expectErr('out of time').message).toBe('No BTC price available: Block did not answer in time')

      // Block was only waited for, not failed: the next caller keeps waiting on the same request.
      const next = service.getCurrentBtcPrice()
      block.release(() => prices.block('83000'))
      expect((await next).expect('answered').value.toString()).toBe('83000')
      expect(fetch.hosts()).toEqual([BLOCK])
    })
  })

  it('follows a settings change at once, within the original time limit of the caller', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: never, [COINBASE]: never })
      const { service, settings } = priceService({ fallbacks: false }, undefined, {
        requestTimeoutMs: 5000,
        lookupTimeoutMs: 300,
      })
      const started = performance.now()
      const before = service.getCurrentBtcPrice()
      await new Promise((resolve) => {
        setTimeout(resolve, 150)
      })
      settings.source = 'coinbase'
      service.settingsUpdated()
      const after = service.getCurrentBtcPrice()

      expect((await before).expectErr('out of time').message).toBe(
        'No BTC price available: Coinbase did not answer in time',
      )
      expect(performance.now() - started).toBeLessThan(420)
      expect((await after).isErr()).toBe(true)
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('answers a waiting caller from the new source without waiting for the old one', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: never, [COINBASE]: () => prices.coinbase('83105.04') })
      const { service, settings } = priceService({ fallbacks: false }, undefined, { requestTimeoutMs: 5000 })
      const started = performance.now()
      const before = service.getCurrentBtcPrice()
      await settle()
      settings.source = 'coinbase'
      service.settingsUpdated()
      expect((await before).expect('new source').source).toBe('coinbase')
      expect(performance.now() - started).toBeLessThan(1000)
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('restarts when settings change during an asynchronous settings read', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [COINBASE]: () => prices.coinbase('83105.04') })
      const saved: SavedPriceSettings = { source: 'block', fallbacks: false }
      let release = (): void => undefined
      const firstRead = new Promise<SavedPriceSettings>((resolve) => {
        release = (): void => {
          resolve({ source: 'block', fallbacks: true })
        }
      })
      let reads = 0
      const service = new PriceService({
        logger,
        mempoolApiUrl: 'https://mempool.space',
        settings: async () => (reads++ === 0 ? firstRead : saved),
      })
      const pending = service.getCurrentBtcPrice()
      await settle()
      saved.source = 'coinbase'
      service.settingsUpdated()
      release()
      expect((await pending).expect('new source').source).toBe('coinbase')
      expect(fetch.hosts()).toEqual([COINBASE])
    })
  })

  it('records a refusal that arrives after the settings changed, so the source is not asked again at once', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next, [MEMPOOL]: () => prices.mempool(83000) })
      const { service, settings } = priceService()
      const before = service.getCurrentBtcPrice()
      await settle()
      expect(block.count()).toBe(1)

      settings.fallbacks = false
      service.settingsUpdated()
      block.release(refused)
      const message = 'No BTC price available: Block price error: 429 Too Many Requests'
      expect((await before).expectErr('no fallback').message).toBe(message)
      expect((await service.getCurrentBtcPrice()).expectErr('still waiting').message).toBe(message)
      expect(fetch.hosts()).toEqual([BLOCK])
    })
  })

  it('never sends credentials from MEMPOOL_API_URL or repeats them in errors', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({})
      const { service } = priceService({ fallbacks: false }, 'http://alice:s3cret@mempool.local:8999')
      expect((await service.options()).sources[0]).toEqual({
        name: 'mempool',
        label: 'Your mempool server (mempool.local:8999)',
      })
      const result = await service.getCurrentBtcPrice()
      expect(result.expectErr('unavailable').message).not.toContain('s3cret')
      expect(fetch.urls()).toEqual(['http://mempool.local:8999/api/v1/prices'])
    })
  })

  it('releases the connection of a refused request', async () => {
    await withTestSetup(async () => {
      let cancelled = false
      stubPrices({
        [BLOCK]: () =>
          new Response(
            new ReadableStream({
              cancel: () => {
                cancelled = true
              },
            }),
            { status: 429, statusText: 'Too Many Requests' },
          ),
      })
      await priceService({ fallbacks: false }).service.getCurrentBtcPrice()
      expect(cancelled).toBe(true)
    })
  })

  it.each(['http://mempool.space', 'https://mempool.space/api/', 'https://www.mempool.space'])(
    'treats %s as public mempool.space rather than your own server',
    async (url) => {
      await withTestSetup(async () => {
        const options = await priceService({}, url).service.options()
        expect(options.selected).toBe('block')
        expect(options.sources.map(({ name }) => name)).toEqual(['block', 'mempool.space', 'coinbase', 'coingecko'])
      })
    },
  )

  it('lists the available sources in fallback order for Settings', async () => {
    await withTestSetup(async () => {
      const { service } = priceService({ fallbacks: false }, 'http://mempool.local')
      await expect(service.options()).resolves.toEqual({
        selected: 'mempool',
        fallbacks: false,
        sources: [
          { name: 'mempool', label: 'Your mempool server (mempool.local)' },
          { name: 'block', label: 'Block' },
          { name: 'mempool.space', label: 'mempool.space' },
          { name: 'coinbase', label: 'Coinbase' },
          { name: 'coingecko', label: 'CoinGecko' },
        ],
      })
      expect(service.isAvailable('mempool')).toBe(true)
      expect(priceService().service.isAvailable('mempool')).toBe(false)
    })
  })

  it.each([
    ['mempool.space', MEMPOOL, 'mempool.space', [null, {}, { USD: null }, { USD: '12345' }, { USD: 0 }, { USD: -1 }]],
    [
      'block',
      BLOCK,
      'Block',
      [{ amount: 83000, base: 'BTC', currency: 'USD' }, { amount: '0', base: 'BTC', currency: 'USD' }, { amount: '1' }],
    ],
    ['coinbase', COINBASE, 'Coinbase', [{ data: { amount: 'NaN', currency: 'USD' } }, { data: { amount: '1' } }]],
    ['coingecko', COINGECKO, 'CoinGecko', [{ bitcoin: { usd: '12345' } }, { bitcoin: null }]],
  ] as const)('rejects an invalid %s price', async (source, host, label, bodies) => {
    for (const body of bodies) {
      await withTestSetup(async () => {
        stubPrices({ [host]: () => Response.json(body) })
        const result = await priceService({ source, fallbacks: false }).service.getCurrentBtcPrice()
        expect(result.expectErr(JSON.stringify(body)).message).toBe(
          `No BTC price available: BTC price not found in ${label} response`,
        )
      })
    }
  })

  it.each([
    [{}, { source: undefined, fallbacks: true }],
    [
      { price_source: 'block', price_fallbacks_enabled: 'false' },
      { source: 'block', fallbacks: false },
    ],
    [
      { price_source: 'kraken', price_fallbacks_enabled: 'no' },
      { source: undefined, fallbacks: true },
    ],
  ])('reads saved price settings %j', async (saved, expected) => {
    const values = new Map(Object.entries(saved))
    await expect(readPriceSettings((key) => values.get(key))).resolves.toEqual(expected)
    await expect(readPriceSettings(async (key) => values.get(key))).resolves.toEqual(expected)
  })
})

describe('daily price response validation', () => {
  async function dailyRates(): Promise<DailyRatesService> {
    const directory = mkdtempSync(join(tmpdir(), 'sentinel-daily-validation-'))
    const database = await openDrizzleDatabase(directory, logger)
    onTestFinished(() => {
      database.$client.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return new DailyRatesService({
      db: database,
      logger,
      mempoolApiUrl: 'https://example.invalid',
      allowPublicFallback: () => false,
    })
  }
  it('restores daily decimal rates from a valid historical response', async () => {
    await withTestSetup(async () => {
      const date = new Date('2024-01-02T00:00:00Z')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ prices: [{ time: date.getTime() / 1000, USD: 42000.25 }], extra: true })),
      )
      const result = await (await dailyRates()).getDailyRates(date, date)
      expect(result.expect('valid rates').rates['2024-01-02']?.close.toString()).toBe('42000.25')
    })
  })

  it.each([
    null,
    { prices: {} },
    { prices: [{ time: 'yesterday', USD: 42000 }] },
    { prices: [{ time: 1704153600, USD: '42000' }] },
  ])('returns missing-data errors for malformed historical prices: %j', async (body) => {
    await withTestSetup(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body)),
      )
      const date = new Date('2024-01-02T00:00:00Z')
      const result = await (await dailyRates()).getDailyRates(date, date)
      expect(result.expectErr('invalid response').message).toMatch(/No (usable )?USD (quote|price)/)
    })
  })
})

describe('price refresh regressions', () => {
  it('accepts hourly self-hosted prices throughout their update cycle, but expires them after a missed update', async () => {
    await withTestSetup(async () => {
      stubPrices({ [LOCAL_MEMPOOL]: () => prices.mempool(83000) })
      const { service } = priceService({ fallbacks: false }, 'http://mempool.local')
      for (const minutes of [0, 29, 30, 45, 59, 64]) {
        vi.setSystemTime(NOW.getTime() + minutes * 60_000)
        expect((await service.getCurrentBtcPrice()).expect(`minute ${minutes}`).value.toString()).toBe('83000')
      }
      vi.setSystemTime(NOW.getTime() + 65 * 60_000)
      expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
    })
  })

  it('includes HTTP cache age without depending on the local wall clock', async () => {
    await withTestSetup(async () => {
      vi.setSystemTime(NOW.getTime() + 45 * 60_000)
      const fetch = stubPrices({
        [BLOCK]: () =>
          prices.block('70000', NOW_SECONDS - 31 * 60, {
            date: new Date(NOW.getTime() - 2 * 60_000).toUTCString(),
            age: '120',
          }),
        [MEMPOOL]: () => Response.json({ USD: 83000, time: NOW_SECONDS }, { headers: { date: NOW.toUTCString() } }),
      })
      expect((await priceService().service.getCurrentBtcPrice()).expect('fresh fallback').source).toBe('mempool.space')
      expect(fetch.hosts()).toEqual([BLOCK, MEMPOOL])
    })
  })

  it('refreshes a healthy fallback on every cache expiry despite a slow failing primary', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      let calls = 0
      let fallbackPrice = 83000
      const fetch = stubPrices({
        [BLOCK]: async () => {
          if (calls++ > 0) {
            await new Promise((resolve) => {
              setTimeout(resolve, 4000)
            })
          }
          return refused()
        },
        [MEMPOOL]: () => prices.mempool(fallbackPrice, Date.now() / 1000),
      })
      const { service } = priceService({}, undefined, { requestTimeoutMs: 10_000 })
      await service.getCurrentBtcPrice()
      for (let minute = 1; minute <= 29; minute++) {
        await vi.advanceTimersByTimeAsync(minute * 60_000 - performance.now())
        fallbackPrice++
        const pending = service.getCurrentBtcPrice()
        await vi.advanceTimersByTimeAsync(3000)
        const price = (await pending).expect('refreshed fallback')
        expect(price.value.toNumber()).toBe(fallbackPrice)
        expect(price.lastKnown).toBe(false)
      }
      expect(fetch.hosts().filter((host) => host === MEMPOOL)).toHaveLength(30)
      await vi.advanceTimersByTimeAsync(1000)
    })
  })

  it('shares the short wait with later callers and still waits fully when verifying a new primary', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      const fetch = stubPrices({
        [BLOCK]: () => prices.block('83000'),
        [COINBASE]: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 4000)
          })
          return prices.coinbase('85000')
        },
      })
      const { service, settings } = priceService({}, undefined, { requestTimeoutMs: 10_000 })
      await service.getCurrentBtcPrice()
      settings.source = 'coinbase'
      service.settingsUpdated()
      const first = service.getCurrentBtcPrice()
      const checked = service.getCurrentBtcPrice({ verifyPrimary: true })
      await vi.advanceTimersByTimeAsync(2000)
      const second = service.getCurrentBtcPrice()
      await vi.advanceTimersByTimeAsync(1000)
      for (const pending of [first, second]) {
        const fallback = (await pending).expect('fresh cached fallback')
        expect(fallback.source).toBe('block')
        expect(fallback.lastKnown).toBe(false)
      }
      await vi.advanceTimersByTimeAsync(1000)
      expect((await checked).expect('verified primary').source).toBe('coinbase')
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('does not verify a now-failing source from its cache, or mark that cache current afterward', async () => {
    await withTestSetup(async () => {
      let available = true
      const fetch = stubPrices({ [BLOCK]: () => (available ? prices.block('83000') : refused()) })
      const { service } = priceService({ fallbacks: false })
      await service.getCurrentBtcPrice()
      available = false
      expect((await service.getCurrentBtcPrice({ verifyPrimary: true })).expect('last known').lastKnown).toBe(true)
      expect((await service.getCurrentBtcPrice()).expect('still last known').lastKnown).toBe(true)
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('does not start another source after the caller deadline', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      const fetch = stubPrices({ [BLOCK]: never })
      const { service } = priceService({}, undefined, { requestTimeoutMs: 100, lookupTimeoutMs: 10 })
      const pending = service.getCurrentBtcPrice()
      await vi.advanceTimersByTimeAsync(10)
      expect((await pending).isErr()).toBe(true)
      expect(fetch.hosts()).toEqual([BLOCK])
      await vi.advanceTimersByTimeAsync(90)
    })
  })

  it.each([
    ['block', BLOCK, () => prices.block('83000', 9e12)],
    ['mempool.space', MEMPOOL, () => prices.mempool(83000, 9e12)],
    ['mempool.space', MEMPOOL, () => new Response('{"USD":1e400}')],
    ['coingecko', COINGECKO, () => new Response('{"bitcoin":{"usd":1e400}}')],
    ['block', BLOCK, () => prices.block('abc')],
    ['block', BLOCK, () => prices.block('')],
    ['block', BLOCK, () => prices.block('9'.repeat(400))],
    ['block', BLOCK, () => prices.block(`0.${'0'.repeat(400)}1`)],
    ['coinbase', COINBASE, () => prices.coinbase('abc')],
  ] as const)(
    'rejects malformed %s data, tries a fallback, and observes the failure cooldown',
    async (source, host, reply) => {
      await withTestSetup(async () => {
        const fetch = stubPrices({
          [LOCAL_MEMPOOL]: () => prices.mempool(84000),
          [host]: reply,
        })
        const { service } = priceService({ source }, 'http://mempool.local')
        for (let call = 0; call < 2; call++) {
          const price = (await service.getCurrentBtcPrice()).expect('valid fallback')
          expect(price.source).toBe('mempool')
          expect(price.value.isFinite()).toBe(true)
          expect(Number.isFinite(price.asOf.getTime())).toBe(true)
        }
        expect(fetch.hosts()).toEqual([host, LOCAL_MEMPOOL])
      })
    },
  )
})

describe('price service rules', () => {
  it('serves a recovered source from its cache again', async () => {
    await withTestSetup(async () => {
      let block: () => Response | Error = () => new TypeError('fetch failed')
      const fetch = stubPrices({ [BLOCK]: () => block() })
      const { service } = priceService({ fallbacks: false })
      expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
      block = () => prices.block('83000')
      expect((await service.getCurrentBtcPrice()).expect('recovered').lastKnown).toBe(false)
      expect((await service.getCurrentBtcPrice()).expect('cached').value.toString()).toBe('83000')
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('falls back to the newest recent price of the allowed sources', async () => {
    await withTestSetup(async () => {
      const up = { block: true, mempool: true }
      stubPrices({
        [BLOCK]: () => (up.block ? prices.block('83000', NOW_SECONDS - 600) : refused()),
        [MEMPOOL]: () => (up.mempool ? prices.mempool(84000) : refused()),
      })
      const { service } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('Block').source).toBe('block')
      up.block = false
      vi.advanceTimersByTime(61_000)
      expect((await service.getCurrentBtcPrice()).expect('fallback').source).toBe('mempool.space')
      up.mempool = false
      vi.advanceTimersByTime(61_000)
      expect((await service.getCurrentBtcPrice()).expect('last known')).toMatchObject({
        source: 'mempool.space',
        lastKnown: true,
      })
    })
  })

  it('waits for a slow source when there is no recent price to fall back on', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      const fetch = stubPrices({
        [BLOCK]: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 5000)
          })
          return prices.block('83000')
        },
        [MEMPOOL]: () => prices.mempool(84000),
      })
      const pending = priceService({}, undefined, { requestTimeoutMs: 10_000 }).service.getCurrentBtcPrice()
      await vi.advanceTimersByTimeAsync(5000)
      expect((await pending).expect('slow primary').source).toBe('block')
      expect(fetch.hosts()).toEqual([BLOCK])
    })
  })

  it('does not reuse a cached price that has passed its maximum age', async () => {
    await withTestSetup(async () => {
      let available = true
      const fetch = stubPrices({ [BLOCK]: () => (available ? prices.block('83000', NOW_SECONDS - 1770) : refused()) })
      const { service } = priceService({ fallbacks: false })
      expect((await service.getCurrentBtcPrice()).expect('29.5 minutes old').lastKnown).toBe(false)
      available = false
      vi.advanceTimersByTime(40_000)
      expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('ages a price by the Age a cache reports when the source sends no clock', async () => {
    await withTestSetup(async () => {
      let age = '1900'
      stubPrices({
        [COINBASE]: () => Response.json({ data: { amount: '83000', currency: 'USD' } }, { headers: { age } }),
        [MEMPOOL]: () => Response.json({ USD: 84000, time: NOW_SECONDS - 60 }, { headers: { age: '60' } }),
      })
      const { service } = priceService({ source: 'coinbase', fallbacks: false })
      expect((await service.getCurrentBtcPrice()).expectErr('too old').message).toBe(
        'No BTC price available: Coinbase price is 32 minutes old',
      )
      age = '60'
      vi.advanceTimersByTime(30_000)
      expectAbout((await service.getCurrentBtcPrice()).expect('cached').asOf, Date.now() - 60_000)

      // A quote's own timestamp already includes the time a cache held it.
      const quoted = (await priceService({ source: 'mempool.space' }).service.getCurrentBtcPrice()).expect('quote')
      expectAbout(quoted.asOf, NOW.getTime() - 60_000)
    })
  })

  it('aborts a request that does not answer in time', async () => {
    await withTestSetup(async () => {
      let signal: AbortSignal | null | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          signal = init?.signal
          return never()
        }),
      )
      const result = await priceService({ fallbacks: false }).service.getCurrentBtcPrice()
      expect(result.expectErr('timed out').message).toContain('no response within')
      expect(signal?.aborted).toBe(true)
    })
  })

  it.each(['', 'umbrel.local:3006', 'http://alice:pa/ss@mempool.local:99999'])(
    'does not offer MEMPOOL_API_URL %j, which is not an http(s) URL, as your server',
    async (url) => {
      await withTestSetup(async () => {
        const fetch = stubPrices({ [BLOCK]: refused })
        const lines: string[] = []
        const service = new PriceService({
          logger: pino(
            { level: 'debug' },
            {
              write: (line: string) => {
                lines.push(line)
              },
            },
          ),
          mempoolApiUrl: url,
          settings: () => ({ source: undefined, fallbacks: false }),
        })
        expect((await service.options()).sources.map(({ name }) => name)).toEqual([
          'block',
          'mempool.space',
          'coinbase',
          'coingecko',
        ])
        const error = (await service.getCurrentBtcPrice()).expectErr('refused').message
        expect(fetch.hosts()).toEqual([BLOCK])
        expect(lines.join('')).toContain('MEMPOOL_API_URL is not an http(s) URL')
        // Neither Settings, the returned error nor the log repeats the configured value.
        for (const text of [JSON.stringify(await service.options()), error, ...lines]) {
          expect(text).not.toContain('pa/ss')
          expect(text).not.toContain('umbrel.local')
        }
      })
    },
  )

  it('uses a fallback that answers after the caller has moved on to the next source', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      let blockUp = true
      const after = async (ms: number, reply: () => Response): Promise<Response> => {
        await new Promise((resolve) => {
          setTimeout(resolve, ms)
        })
        return reply()
      }
      stubPrices({
        [BLOCK]: () => (blockUp ? prices.block('83000') : refused()),
        // Each fallback is waited on for 3 seconds: mempool.space refuses at 4 s, after the caller has moved
        // on; Coinbase answers at 7 s, while the caller waits on CoinGecko, which refuses at 8 s.
        [MEMPOOL]: async () => after(4000, refused),
        [COINBASE]: async () => after(4000, () => prices.coinbase('85000')),
        [COINGECKO]: async () => after(2000, refused),
      })
      const { service } = priceService({}, undefined, { requestTimeoutMs: 10_000 })
      await service.getCurrentBtcPrice()
      blockUp = false
      await vi.advanceTimersByTimeAsync(61_000)
      const pending = service.getCurrentBtcPrice({ verifyPrimary: true })
      await vi.advanceTimersByTimeAsync(8000)
      expect((await pending).expect('late fallback')).toMatchObject({ source: 'coinbase', lastKnown: false })
    })
  })

  it('reports each address of a host that refused the connection', async () => {
    await withTestSetup(async () => {
      const cause = new AggregateError([
        new Error('connect ECONNREFUSED ::1:8999'),
        new Error('connect ECONNREFUSED 127.0.0.1:8999'),
      ])
      stubPrices({ [LOCAL_MEMPOOL]: () => new TypeError('fetch failed', { cause }) })
      const result = await priceService({ fallbacks: false }, 'http://mempool.local').service.getCurrentBtcPrice()
      expect(result.expectErr('refused').message).toBe(
        'No BTC price available: Your mempool server (mempool.local) price request failed: fetch failed: ' +
          'connect ECONNREFUSED ::1:8999; connect ECONNREFUSED 127.0.0.1:8999',
      )
    })
  })

  it('logs every source it contacted', async () => {
    await withTestSetup(async () => {
      stubPrices({ [BLOCK]: refused, [MEMPOOL]: () => prices.mempool(83000) })
      const lines: string[] = []
      const service = new PriceService({
        logger: pino(
          { level: 'debug' },
          {
            write: (line: string) => {
              lines.push(line)
            },
          },
        ),
        mempoolApiUrl: 'https://mempool.space',
        settings: () => ({ source: undefined, fallbacks: true }),
      })
      await service.getCurrentBtcPrice()
      expect(lines).toEqual([
        expect.stringMatching(/"source":"block".*"msg":"BTC price source failed"/),
        expect.stringMatching(/"source":"mempool.space".*"msg":"Fetched BTC price"/),
      ])
    })
  })
})

describe('price age limits', () => {
  const after = async (ms: number, reply: () => Response): Promise<Response> => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
    return reply()
  }

  it('treats a cached response as at least as old as its Age, even when the quote is timestamped later', async () => {
    await withTestSetup(async () => {
      stubPrices({
        [BLOCK]: () =>
          prices.block('70000', NOW_SECONDS - 29 * 60, {
            date: new Date(NOW.getTime() - 31 * 60_000).toUTCString(),
            age: '1860',
          }),
        [MEMPOOL]: () => prices.mempool(83000),
      })
      const price = (await priceService({ source: 'block' }).service.getCurrentBtcPrice()).expect('fallback')
      expect({ source: price.source, value: price.value.toString() }).toEqual({
        source: 'mempool.space',
        value: '83000',
      })
    })
  })

  it('does not return a late answer that expired while later sources were tried', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      let seeding = true
      stubPrices({
        [BLOCK]: () => (seeding ? prices.block('83000', Math.floor(Date.now() / 1000)) : refused()),
        [MEMPOOL]: async () => after(4000, () => prices.mempool(70000, Math.floor(Date.now() / 1000) - 1799)),
        [COINBASE]: never,
        [COINGECKO]: async () => after(2000, refused),
      })
      const { service } = priceService({ source: 'block' }, undefined, { requestTimeoutMs: 10_000 })
      await service.getCurrentBtcPrice()
      seeding = false
      await vi.advanceTimersByTimeAsync(61_000)
      const pending = service.getCurrentBtcPrice()
      await vi.advanceTimersByTimeAsync(8000)
      expect((await pending).expect('last known')).toMatchObject({ source: 'block', lastKnown: true })
      await vi.advanceTimersByTimeAsync(10_000)
    })
  })

  it('does not return a late answer that aged out while the computer slept', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ now: NOW })
      let seeding = true
      stubPrices({
        [BLOCK]: () => (seeding ? prices.block('83000') : refused()),
        [MEMPOOL]: async () => after(4000, () => prices.mempool(70000, Math.floor(Date.now() / 1000))),
        [COINBASE]: never,
        [COINGECKO]: async () => after(2000, refused),
      })
      const { service } = priceService({ source: 'block' }, undefined, { requestTimeoutMs: 10_000 })
      await service.getCurrentBtcPrice()
      seeding = false
      await vi.advanceTimersByTimeAsync(61_000)
      const pending = service.getCurrentBtcPrice()
      await vi.advanceTimersByTimeAsync(4000)
      // The wall clock keeps running during sleep while the monotonic clock can pause.
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60_000))
      await vi.advanceTimersByTimeAsync(4000)
      expect((await pending).isErr()).toBe(true)
      await vi.advanceTimersByTimeAsync(10_000)
    })
  })
})
