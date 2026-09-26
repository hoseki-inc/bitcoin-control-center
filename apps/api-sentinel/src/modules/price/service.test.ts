import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { DailyRatesService } from './daily_rates'
import { PriceService } from './service'

const logger = pino({ level: 'silent' })
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.unstubAllGlobals()
  })

  await run()
}

describe('price response validation', () => {
  it('preserves decimal conversion and caching for a valid current price', async () => {
    await withTestSetup(async () => {
      const fetch = vi.fn(async () => Response.json({ bitcoin: { usd: 12345.67 }, extra: true }))
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger })
      expect((await service.getCurrentBtcPrice()).expect('valid price').value.toString()).toBe('12345.67')
      expect((await service.getCurrentBtcPrice()).expect('valid price').value.toString()).toBe('12345.67')
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  it.each([null, {}, { bitcoin: null }, { bitcoin: { usd: '12345' } }])(
    'returns an error for an invalid current price: %j',
    async (body) => {
      await withTestSetup(async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json(body)),
        )
        const result = await new PriceService({ logger }).getCurrentBtcPrice()
        expect(result.expectErr('invalid response').message).toBe('BTC price not found in CoinGecko response')
      })
    },
  )

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

describe('Bitcoin price history', () => {
  type MarketChartPrices = [number, number][] | string

  function marketChart(prices: MarketChartPrices): Response {
    return Response.json({ prices })
  }

  it('validates, orders, converts milliseconds and caches market data', async () => {
    await withTestSetup(async () => {
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
        marketChart([
          [2000, 102],
          [1000, 100],
        ]),
      )
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger })
      expect((await service.getBitcoinPriceHistory()).expect('valid history')).toEqual([
        { time: 1, value: 100 },
        { time: 2, value: 102 },
      ])
      await service.getBitcoinPriceHistory()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0]?.[0]).toContain('days=7')
      expect(fetch.mock.calls[0]?.[0]).not.toContain('interval=')
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    })
  })

  it('requests and caches each range separately', async () => {
    await withTestSetup(async () => {
      const fetch = vi.fn(async (_url: string) =>
        marketChart([
          [1000, 100],
          [2000, 102],
        ]),
      )
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger })
      for (const days of [1, 7, 30, 180, 365] as const) {
        await service.getBitcoinPriceHistory(days)
        expect(fetch.mock.lastCall?.[0]).toContain(`days=${days}`)
        await service.getBitcoinPriceHistory(days)
      }
      expect(fetch).toHaveBeenCalledTimes(5)
    })
  })

  it.each([
    [[]],
    [
      [
        [1000, -1],
        [2000, 100],
      ],
    ],
    ['invalid'],
  ])('rejects malformed data without caching it: %j', async (prices) => {
    await withTestSetup(async () => {
      const fetch = vi.fn(async () => marketChart(prices))
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger })
      expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
      await service.getBitcoinPriceHistory()
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('returns a result on network timeouts so local balances can still load', async () => {
    await withTestSetup(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('timeout'))),
      )
      const service = new PriceService({ logger })
      expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
      expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
    })
  })

  it('returns an expected failure when the provider is unavailable', async () => {
    await withTestSetup(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 503 })),
      )
      const service = new PriceService({ logger })
      expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
    })
  })
})
