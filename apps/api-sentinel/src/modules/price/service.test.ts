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
