import { pino } from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PriceService } from './service'

afterEach(() => vi.unstubAllGlobals())

describe('Bitcoin price history', () => {
  it('validates, orders, converts milliseconds and caches market data', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: [
          [2000, 102],
          [1000, 100],
        ],
      }),
    })
    vi.stubGlobal('fetch', fetch)
    const service = new PriceService({ logger: pino({ level: 'silent' }) })
    expect((await service.getBitcoinPriceHistory()).unwrap()).toEqual([
      { time: 1, value: 100 },
      { time: 2, value: 102 },
    ])
    await service.getBitcoinPriceHistory()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toContain('days=7')
    expect(fetch.mock.calls[0]?.[0]).not.toContain('interval=')
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('requests and caches each range separately', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        prices: [
          [1000, 100],
          [2000, 102],
        ],
      }),
    })
    vi.stubGlobal('fetch', fetch)
    const service = new PriceService({ logger: pino({ level: 'silent' }) })
    for (const days of [1, 7, 30, 180, 365] as const) {
      await service.getBitcoinPriceHistory(days)
      expect(fetch.mock.lastCall?.[0]).toContain(`days=${days}`)
      await service.getBitcoinPriceHistory(days)
    }
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it.each([
    { prices: [] },
    {
      prices: [
        [1000, -1],
        [2000, 100],
      ],
    },
    { prices: 'invalid' },
  ])('rejects malformed data without caching it', async (body) => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
    vi.stubGlobal('fetch', fetch)
    const service = new PriceService({ logger: pino({ level: 'silent' }) })
    expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
    await service.getBitcoinPriceHistory()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns a result on network timeouts so local balances can still load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    const service = new PriceService({ logger: pino({ level: 'silent' }) })
    expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
    expect((await service.getCurrentBtcPrice()).isErr()).toBe(true)
  })

  it('returns an expected failure when the provider is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const service = new PriceService({ logger: pino({ level: 'silent' }) })
    expect((await service.getBitcoinPriceHistory()).isErr()).toBe(true)
  })
})
