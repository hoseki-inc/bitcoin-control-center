import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { DailyRatesService } from './daily_rates'
import { PriceService, type SavedPriceSettings, readPriceSettings } from './service'

const logger = pino({ level: 'silent' })
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
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
  block: (amount: string, time = NOW_SECONDS) =>
    Response.json({
      amount,
      base: 'BTC',
      currency: 'USD',
      last_updated_at_in_utc_epoch_seconds: String(time),
      version: '1',
    }),
  coinbase: (amount: string) => Response.json({ data: { amount, base: 'BTC', currency: 'USD' } }),
  coingecko: (usd: number) => Response.json({ bitcoin: { usd, last_updated_at: NOW_SECONDS } }),
}
const refused = (): Response => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })

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
  return { hosts: () => fetch.mock.calls.map(([url]) => new URL(url).host) }
}

function priceService(settings: Partial<SavedPriceSettings> = {}, mempoolApiUrl = 'https://mempool.space') {
  const current: SavedPriceSettings = { source: undefined, fallbacks: true, ...settings }
  return {
    service: new PriceService({ logger, mempoolApiUrl, settings: () => current, requestTimeoutMs: 20 }),
    settings: current,
  }
}

/** Replies that stay pending until released, one per request in the order they were made. */
function heldReplies() {
  const releases: Array<((response: Response) => void) | null> = []
  return {
    next: async (): Promise<Response> =>
      new Promise<Response>((resolve) => {
        releases.push(resolve)
      }),
    /** Answers every request still waiting. */
    release: (response: () => Response) => {
      releases.forEach((resolve, index) => {
        resolve?.(response())
        releases[index] = null
      })
    },
    /** Answers the request made at `index` (0 is the first). */
    releaseAt: (index: number, response: Response) => {
      releases[index]?.(response)
      releases[index] = null
    },
    count: () => releases.length,
  }
}

/** Lets pending promise callbacks run, so a released reply reaches the service. */
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
      expect(price.asOf).toEqual(new Date(NOW.getTime() - 300_000))
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

  it('waits before asking a failed source again', async () => {
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

  it('keeps the last price for up to 30 minutes after it was set while every source fails', async () => {
    await withTestSetup(async () => {
      let available = true
      stubPrices({ [BLOCK]: () => (available ? prices.block('83000', NOW_SECONDS - 600) : refused()) })
      const { service } = priceService()
      const fresh = (await service.getCurrentBtcPrice()).expect('fresh')
      expect(fresh.value.toString()).toBe('83000')
      expect(fresh.lastKnown).toBe(false)

      available = false
      vi.advanceTimersByTime(19 * 60_000)
      const last = (await service.getCurrentBtcPrice()).expect('last known')
      expect(last.value.toString()).toBe('83000')
      expect(last.lastKnown).toBe(true)

      vi.advanceTimersByTime(60_000)
      expect((await service.getCurrentBtcPrice()).expectErr('too old').message).toContain('No BTC price available')
    })
  })

  it('applies a changed source on the next request', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: () => prices.block('83086.98'), [MEMPOOL]: () => prices.mempool(83000) })
      const { service, settings } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('default').source).toBe('block')
      settings.source = 'mempool.space'
      expect((await service.getCurrentBtcPrice()).expect('changed').source).toBe('mempool.space')
      expect(fetch.hosts()).toEqual([BLOCK, MEMPOOL])
    })
  })

  it('shares one lookup between concurrent requests', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({ [BLOCK]: () => prices.block('83000') })
      const { service } = priceService()
      const results = await Promise.all([service.getCurrentBtcPrice(), service.getCurrentBtcPrice()])
      expect(results.map((result) => result.expect('price').value.toString())).toEqual(['83000', '83000'])
      expect(fetch.hosts()).toEqual([BLOCK])
    })
  })

  it('does not report a price as newer than when it was fetched', async () => {
    await withTestSetup(async () => {
      stubPrices({ [BLOCK]: () => prices.block('83086.98', NOW_SECONDS + 3600) })
      const price = (await priceService().service.getCurrentBtcPrice()).expect('price')
      expect(price.asOf).toEqual(NOW)
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

  it('reports a price request that cannot be made', async () => {
    await withTestSetup(async () => {
      stubPrices({ [BLOCK]: () => new TypeError('fetch failed') })
      const result = await priceService({ fallbacks: false }).service.getCurrentBtcPrice()
      expect(result.expectErr('network failure').message).toBe(
        'No BTC price available: Block price request failed: fetch failed',
      )
    })
  })

  it('moves on to the next source when one never answers', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({
        [BLOCK]: async () => new Promise<Response>(() => undefined),
        [MEMPOOL]: () => prices.mempool(83000),
      })
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
      const { service } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('fallback').source).toBe('mempool.space')
      const onlyBlock = priceService({ fallbacks: false })
      expect((await onlyBlock.service.getCurrentBtcPrice()).expectErr('timed out').message).toBe(
        'No BTC price available: Block price request failed: no response within 0.02 seconds',
      )
    })
  })

  it('rejects a price older than 30 minutes and tries the next source', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({
        [LOCAL_MEMPOOL]: () => prices.mempool(70000, NOW_SECONDS - 3600),
        [BLOCK]: () => prices.block('83086.98'),
      })
      const price = (await priceService({}, 'http://mempool.local').service.getCurrentBtcPrice()).expect('fresh')
      expect(price.source).toBe('block')
      expect(fetch.hosts()).toEqual([LOCAL_MEMPOOL, BLOCK])

      const result = await priceService({ fallbacks: false }, 'http://mempool.local').service.getCurrentBtcPrice()
      expect(result.expectErr('too old').message).toBe(
        'No BTC price available: Your mempool server (mempool.local) price is 60 minutes old',
      )
    })
  })

  it('does not serve a cached price past 30 minutes old', async () => {
    await withTestSetup(async () => {
      let time = NOW_SECONDS - 29 * 60 - 45
      const fetch = stubPrices({ [BLOCK]: () => prices.block('83000', time) })
      const { service } = priceService()
      expect((await service.getCurrentBtcPrice()).expect('first').value.toString()).toBe('83000')

      time = NOW_SECONDS + 30
      vi.advanceTimersByTime(30_000)
      expect((await service.getCurrentBtcPrice()).expect('refreshed').asOf).toEqual(new Date(NOW.getTime() + 30_000))
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it('uses the new source when it changes while a lookup is in progress', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next, [COINBASE]: () => prices.coinbase('83105.04') })
      const { service, settings } = priceService({ fallbacks: false })
      const before = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })

      settings.source = 'coinbase'
      const after = await service.getCurrentBtcPrice()
      block.release(() => prices.block('83086.98'))
      expect(after.expect('new source').source).toBe('coinbase')
      expect((await before).expect('restarted').source).toBe('coinbase')
      expect((await service.getCurrentBtcPrice()).expect('cached').source).toBe('coinbase')
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('stops an earlier lookup from trying fallbacks after they are turned off', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next, [MEMPOOL]: () => prices.mempool(83000) })
      const { service, settings } = priceService()
      const before = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })

      settings.fallbacks = false
      const after = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(2)
      })
      block.release(refused)
      const message = 'No BTC price available: Block price error: 429 Too Many Requests'
      expect((await after).expectErr('no fallback').message).toBe(message)
      expect((await before).expectErr('no fallback').message).toBe(message)
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
    })
  })

  it.each([
    ['after the new source answered', true],
    ['before anything asked the new source', false],
  ])('hands a lookup over to the new source when the old final source fails %s', async (_label, askedNewSource) => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next, [COINBASE]: () => prices.coinbase('83105.04') })
      const { service, settings } = priceService({ fallbacks: false })
      const before = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })

      settings.source = 'coinbase'
      if (askedNewSource) {
        expect((await service.getCurrentBtcPrice()).expect('new source').source).toBe('coinbase')
      }
      block.release(refused)
      const handedOver = (await before).expect('handed over')
      expect(handedOver.source).toBe('coinbase')
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE])
    })
  })

  it('does not report an old cached price after the source changes and the old request fails', async () => {
    await withTestSetup(async () => {
      let blockAnswers = true
      const block = heldReplies()
      stubPrices({
        [BLOCK]: async () => (blockAnswers ? prices.block('83000') : block.next()),
        [COINBASE]: () => prices.coinbase('83105.04'),
      })
      const { service, settings } = priceService({ fallbacks: false })
      expect((await service.getCurrentBtcPrice()).expect('cached').source).toBe('block')

      blockAnswers = false
      vi.advanceTimersByTime(61_000)
      const before = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })
      settings.source = 'coinbase'
      block.release(refused)
      const price = (await before).expect('current source')
      expect(price.source).toBe('coinbase')
      expect(price.lastKnown).toBe(false)
    })
  })

  it('keeps a newer price when an older lookup for the same source finishes last', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next, [COINBASE]: () => prices.coinbase('83105.04') })
      const { service, settings } = priceService({ fallbacks: false })
      const first = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })

      settings.source = 'coinbase'
      expect((await service.getCurrentBtcPrice()).expect('coinbase').source).toBe('coinbase')
      settings.source = 'block'
      const second = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(2)
      })

      block.releaseAt(1, prices.block('85000'))
      expect((await second).expect('newer').value.toString()).toBe('85000')
      block.releaseAt(0, prices.block('83000'))
      await settle()
      expect((await first).expect('handed over').value.toString()).toBe('85000')
      expect((await service.getCurrentBtcPrice()).expect('cached').value.toString()).toBe('85000')
      expect(fetch.hosts()).toEqual([BLOCK, COINBASE, BLOCK])
    })
  })

  it('stops trying sources once the whole lookup runs out of time', async () => {
    await withTestSetup(async () => {
      const fetch = stubPrices({
        [BLOCK]: async () => new Promise<Response>(() => undefined),
        [MEMPOOL]: async () => new Promise<Response>(() => undefined),
        [COINBASE]: () => prices.coinbase('83105.04'),
      })
      const service = new PriceService({
        logger,
        mempoolApiUrl: 'https://mempool.space',
        settings: () => ({ source: undefined, fallbacks: true }),
        requestTimeoutMs: 40,
        lookupTimeoutMs: 60,
      })
      const result = await service.getCurrentBtcPrice()
      // Which source the deadline stops at depends on timer precision; that it stops before Coinbase does not.
      expect(result.expectErr('out of time').message).toContain('not tried: no price within 0.06 seconds')
      expect(fetch.hosts()).not.toContain(COINBASE)
    })
  })

  it('keeps the time limit when a lookup hands over after a settings change', async () => {
    await withTestSetup(async () => {
      stubPrices({
        [BLOCK]: async () => new Promise<Response>(() => undefined),
        [COINBASE]: async () => new Promise<Response>(() => undefined),
      })
      const current: SavedPriceSettings = { source: undefined, fallbacks: false }
      const service = new PriceService({
        logger,
        mempoolApiUrl: 'https://mempool.space',
        settings: () => current,
        requestTimeoutMs: 300,
        lookupTimeoutMs: 400,
      })
      const started = performance.now()
      const before = service.getCurrentBtcPrice()
      current.source = 'coinbase'
      expect((await before).isErr()).toBe(true)
      // Without the carried deadline, Coinbase would get a full 300 ms after Block's 300 ms.
      expect(performance.now() - started).toBeLessThan(550)
    })
  })

  it('does not let a superseded answer clear the wait a newer refusal set', async () => {
    await withTestSetup(async () => {
      const block = heldReplies()
      const fetch = stubPrices({ [BLOCK]: block.next })
      const { service, settings } = priceService()
      const before = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(1)
      })

      settings.fallbacks = false
      const after = service.getCurrentBtcPrice()
      await vi.waitFor(() => {
        expect(block.count()).toBe(2)
      })
      block.releaseAt(1, refused())
      expect((await after).expectErr('refused').message).toBe(
        'No BTC price available: Block price error: 429 Too Many Requests',
      )
      block.releaseAt(0, prices.block('83000'))
      expect((await before).isErr()).toBe(true)
      expect(fetch.hosts()).toEqual([BLOCK, BLOCK])
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
        const options = priceService({}, url).service.options()
        expect(options.selected).toBe('block')
        expect(options.sources.map(({ name }) => name)).toEqual(['block', 'mempool.space', 'coinbase', 'coingecko'])
      })
    },
  )

  it('lists the available sources in fallback order for Settings', async () => {
    await withTestSetup(async () => {
      expect(priceService({ fallbacks: false }, 'http://mempool.local').service.options()).toEqual({
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
      expect(
        priceService()
          .service.options()
          .sources.map(({ name }) => name),
      ).toEqual(['block', 'mempool.space', 'coinbase', 'coingecko'])
    })
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
  ])('reads saved price settings %j', (saved, expected) => {
    const values = new Map(Object.entries(saved))
    expect(readPriceSettings((key) => values.get(key))).toEqual(expected)
  })
})

describe('daily price response validation', () => {
  it('restores daily decimal rates from a valid historical response', async () => {
    await withTestSetup(async () => {
      const date = new Date('2024-01-02T00:00:00Z')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ prices: [{ time: date.getTime() / 1000, USD: 42000.25 }], extra: true })),
      )
      const result = await new DailyRatesService({ logger, mempoolApiUrl: 'https://example.invalid' }).getDailyRates(
        date,
        date,
      )
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
      const result = await new DailyRatesService({ logger, mempoolApiUrl: 'https://example.invalid' }).getDailyRates(
        date,
        date,
      )
      expect(result.expectErr('invalid response').message).toContain('No price data returned')
    })
  })
})
