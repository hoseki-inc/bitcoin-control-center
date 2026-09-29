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
  it('reads and caches the current price from the configured mempool instance', async () => {
    await withTestSetup(async () => {
      const fetch = vi.fn(async (_url: string) => Response.json({ time: 1790700907, USD: 12345.67, EUR: 11000 }))
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger, mempoolApiUrl: 'http://mempool.local/' })
      expect((await service.getCurrentBtcPrice()).expect('valid price').value.toString()).toBe('12345.67')
      expect((await service.getCurrentBtcPrice()).expect('valid price').value.toString()).toBe('12345.67')
      expect(fetch.mock.calls).toEqual([['http://mempool.local/api/v1/prices']])
    })
  })

  it.each([null, {}, { USD: null }, { USD: '12345' }, { USD: 0 }])(
    'returns an error for an invalid current price: %j',
    async (body) => {
      await withTestSetup(async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json(body)),
        )
        const result = await new PriceService({ logger, mempoolApiUrl: 'https://example.invalid' }).getCurrentBtcPrice()
        expect(result.expectErr('invalid response').message).toBe('BTC price not found in mempool.space response')
      })
    },
  )

  it('returns an error when the price request cannot be made', async () => {
    await withTestSetup(async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed')
        }),
      )
      const result = await new PriceService({ logger, mempoolApiUrl: 'https://example.invalid' }).getCurrentBtcPrice()
      expect(result.expectErr('network failure').message).toBe('mempool.space price request failed: fetch failed')
    })
  })

  it('waits before retrying a refused price request', async () => {
    await withTestSetup(async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      onTestFinished(() => {
        vi.useRealTimers()
      })
      const fetch = vi
        .fn(async () => Response.json({ USD: 12345 }))
        .mockResolvedValueOnce(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
      vi.stubGlobal('fetch', fetch)
      const service = new PriceService({ logger, mempoolApiUrl: 'https://example.invalid' })

      const refused = 'mempool.space price error: 429 Too Many Requests'
      expect((await service.getCurrentBtcPrice()).expectErr('refused').message).toBe(refused)
      expect((await service.getCurrentBtcPrice()).expectErr('still waiting').message).toBe(refused)
      expect(fetch).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(30_000)
      expect((await service.getCurrentBtcPrice()).expect('recovered').value.toString()).toBe('12345')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  })

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
