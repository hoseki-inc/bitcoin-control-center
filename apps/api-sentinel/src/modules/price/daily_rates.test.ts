import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDatabase, initDatabase } from '../../db'
import { DailyRatesService } from './daily_rates'

const logger = pino({ level: 'silent' })
const day = new Date('2026-08-01T00:00:00Z')
const target = day.getTime() / 1000
const quotes = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }
const body = (
  time = target,
  values: Partial<Record<StatementQuoteCurrency, number | string | null>> = quotes,
): Response => Response.json({ prices: [{ time, ...values }] })
let directory: string
let database: SentinelDatabase
let fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>
const service = (url = 'https://mempool.test'): DailyRatesService =>
  new DailyRatesService({ db: database.db, logger, mempoolApiUrl: url, allowPublicFallback: () => false })

function setup(): void {
  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
  directory = mkdtempSync(join(tmpdir(), 'sentinel-quotes-'))
  database = initDatabase(directory, logger)
  fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => body())
  vi.stubGlobal('fetch', fetcher)
}

describe('historical statement quotes', () => {
  it.each<StatementQuoteCurrency>(['USD', 'CAD', 'GBP', 'EUR'])(
    'selects historical %s, without using latest FX rates',
    async (currency) => {
      setup()
      fetcher.mockResolvedValueOnce(
        Response.json({ prices: [{ time: target, ...quotes }], exchangeRates: { USDCAD: 999 } }),
      )
      const result = (await service().getDailyRates(day, day, currency)).unwrap()
      expect(result.quoteCurrency).toBe(currency)
      expect(result.rates['2026-08-01']?.close.toString()).toBe(String(quotes[currency]))
      expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
    },
  )

  it('fetches only required days and reuses persisted currencies across provider changes with original sources', async () => {
    setup()
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    const end = new Date('2026-08-31T00:00:00Z')
    const required = [day, end, day]
    expect((await service().getDailyRates(day, end, 'USD', required)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    database.close()
    database = initDatabase(directory, logger)
    fetcher.mockClear()
    fetcher.mockRejectedValue(new Error('offline'))
    const result = (await service('http://local-mempool.test').getDailyRates(day, end, 'CAD', required)).unwrap()
    for (const date of ['2026-08-01', '2026-08-31']) {
      expect(result.rates[date]?.close.toString()).toBe(String(quotes.CAD))
      expect(result.rates[date]?.providerUrl).toBe('https://mempool.test')
    }
    expect(fetcher).not.toHaveBeenCalled()
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM btc_quote_cache').get()).toEqual({ count: 8 })
  })

  it('de-duplicates simultaneous currency lookups', async () => {
    setup()
    const rates = service()
    const results = await Promise.all(
      StatementQuoteCurrencySchema.options.map(async (currency) => rates.getDailyRates(day, day, currency)),
    )
    expect(results.every((result) => result.isOk())).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([-4, 4])(
    'accepts a quote exactly %s days from the valuation without rewriting its timestamp',
    async (offset) => {
      setup()
      const observation = target + offset * 86400
      fetcher.mockImplementation(async (input) => {
        const lookup = Number(new URL(input).searchParams.get('timestamp'))
        return lookup >= observation ? body(observation) : Response.json({ prices: [] })
      })
      const result = (await service().getDailyRates(day, day, 'EUR')).unwrap()
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe(observation * 1000)
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9)
    },
  )

  it('finds nearby CAD when missing on the valuation date, keeping exact-date EUR valid', async () => {
    setup()
    fetcher.mockImplementation(async (input) => {
      const timestamp = Number(new URL(input).searchParams.get('timestamp'))
      return body(timestamp, { ...quotes, CAD: timestamp === target ? -1 : quotes.CAD })
    })
    const rates = service()
    const cad = (await rates.getDailyRates(day, day, 'CAD')).unwrap()
    expect(cad.rates['2026-08-01']?.timestamp.getTime()).toBe(day.getTime() - 86400000)
    expect((await rates.getDailyRates(day, day, 'EUR')).unwrap().rates['2026-08-01']?.timestamp).toEqual(day)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9)
  })

  it.each([0, -1, null, '60000'])('rejects invalid selected-currency quote %s', async (price) => {
    setup()
    fetcher.mockImplementation(async () => body(target - 4 * 86400, { ...quotes, USD: price }))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it('rejects observations after the lookup timestamp and malformed responses', async () => {
    setup()
    fetcher.mockResolvedValueOnce(body(target + 1))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
    fetcher.mockResolvedValueOnce(Response.json({ prices: 'invalid' }))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it.each([
    { before: -3, after: 1, selected: 1 },
    { before: -1, after: 3, selected: -1 },
    { before: -2, after: 2, selected: -2 },
  ])(
    'chooses the closest timestamp and prefers earlier on ties: $before / $after',
    async ({ before, after, selected }) => {
      setup()
      fetcher.mockImplementation(async (input) => {
        const lookup = Number(new URL(input).searchParams.get('timestamp'))
        const observations = [target - 5 * 86400, target + before * 86400, target + after * 86400]
        const timestamp = observations.filter((time) => time <= lookup).at(-1)
        expect(timestamp).toBeDefined()
        return body(timestamp)
      })
      const result = (await service().getDailyRates(day, day, 'CAD')).unwrap()
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe((target + selected * 86400) * 1000)
    },
  )

  it('does not let a cached older quote hide a closer later observation', async () => {
    setup()
    const earlier = new Date(day.getTime() - 3 * 86400000)
    fetcher.mockResolvedValueOnce(body(target - 3 * 86400))
    await service().getDailyRates(earlier, earlier, 'CAD')
    fetcher.mockImplementation(async (input) => {
      const lookup = Number(new URL(input).searchParams.get('timestamp'))
      return body(lookup >= target + 86400 ? target + 86400 : Math.min(lookup, target - 3 * 86400))
    })
    const result = (await service().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe(day.getTime() + 86400000)
  })

  it('rejects out-of-window fetched and cached observations with a bounded search', async () => {
    setup()
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    for (const offset of [-5, 5]) {
      const outside = new Date(day.getTime() + offset * 86400000)
      expect((await service().getDailyRates(outside, outside, 'CAD')).isOk()).toBe(true)
    }
    fetcher.mockClear()
    fetcher.mockResolvedValue(body(target - 5 * 86400))
    expect((await service().getDailyRates(day, day, 'CAD')).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalled()
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9)
  })

  it('caps recent searches at today instead of requesting dates that have not happened', async () => {
    setup()
    const recent = new Date('2026-09-07T00:00:00Z')
    const today = new Date('2026-09-08T00:00:00Z').getTime() / 1000
    fetcher.mockImplementation(async (input) => {
      const lookup = Number(new URL(input).searchParams.get('timestamp'))
      return body(lookup === today ? today : today - 6 * 86400)
    })
    const result = (await service().getDailyRates(recent, recent, 'CAD')).unwrap()
    expect(result.rates['2026-09-07']?.timestamp.getTime()).toBe(today * 1000)
    const lookups = fetcher.mock.calls.map(([input]) => Number(new URL(input).searchParams.get('timestamp')))
    expect(lookups.length).toBeLessThanOrEqual(7)
    // The latest lookup is the current hour, never a time that has not happened.
    expect(Math.max(...lookups)).toBe(today + 12 * 3600)
  })

  it('finds an observation recorded earlier today', async () => {
    setup()
    const recent = new Date('2026-09-06T00:00:00Z')
    const morning = new Date('2026-09-08T06:00:00Z').getTime() / 1000
    const observations = [target, morning]
    fetcher.mockImplementation(async (input) => {
      const lookup = Number(new URL(input).searchParams.get('timestamp'))
      return body(observations.filter((time) => time <= lookup).at(-1))
    })
    const result = (await service().getDailyRates(recent, recent)).unwrap()
    expect(result.rates['2026-09-06']?.timestamp.getTime()).toBe(morning * 1000)
  })

  it.each([true, false])(
    'uses a neighboring quote for a failed day whichever response arrives first (failure first: %s)',
    async (failureFirst) => {
      setup()
      fetcher.mockImplementation(async (input) => {
        const lookup = Number(new URL(input).searchParams.get('timestamp'))
        const failing = lookup === target
        if (failing !== failureFirst) {
          await new Promise((resolve) => {
            setTimeout(resolve, 20)
          })
        }
        return failing ? new Response('', { status: 429, headers: { 'retry-after': '120' } }) : body(lookup)
      })
      const end = new Date(day.getTime() + 3 * 86400000)
      const result = (await service().getDailyRates(day, end)).unwrap()
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe((target + 86400) * 1000)
      expect(Object.keys(result.rates)).toHaveLength(4)
    },
  )

  it('stops concurrent retries once the source asks for a long wait', async () => {
    setup()
    fetcher.mockImplementation(async (input) =>
      Number(new URL(input).searchParams.get('timestamp')) === target
        ? new Response('', { status: 429, headers: { 'retry-after': '120' } })
        : new Response('', { status: 429 }),
    )
    const end = new Date(day.getTime() + 3 * 86400000)
    expect((await service().getDailyRates(day, end)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('keeps the longest cooldown when concurrent requests fail', async () => {
    setup()
    const next = target + 86400
    fetcher.mockImplementation(async (input) => {
      const lookup = Number(new URL(input).searchParams.get('timestamp'))
      if (lookup === target) {
        return new Response('', { status: 429, headers: { 'retry-after': '120' } })
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      throw new Error('offline')
    })
    const rates = service()
    expect((await rates.getDailyRates(day, new Date(next * 1000))).isErr()).toBe(true)
    fetcher.mockClear()
    vi.setSystemTime(new Date('2026-09-08T12:00:31Z'))
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refreshes current-day lookups after one hour and reuses cached prices while offline', async () => {
    setup()
    const today = new Date('2026-09-08T00:00:00Z')
    const now = today.getTime() / 1000
    fetcher.mockResolvedValue(body(now))
    const rates = service()
    await rates.getDailyRates(today, today)
    await rates.getDailyRates(today, today)
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-08T14:00:00Z'))
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await rates.getDailyRates(today, today)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('honors a long Retry-After without repeated requests or waiting inside generation', async () => {
    setup()
    fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const rates = service()
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('backs off through a brief rate limit without failing a multi-day statement', async () => {
    setup()
    const limited = target + 10 * 86400
    let rejections = 2
    fetcher.mockImplementation(async (input) => {
      const lookup = Number(new URL(input).searchParams.get('timestamp'))
      if (lookup === limited && rejections > 0) {
        rejections--
        return new Response('', { status: 429 })
      }
      return body(lookup)
    })
    const end = new Date('2026-08-30T00:00:00Z')
    const result = (await service().getDailyRates(day, end)).unwrap()
    expect(Object.keys(result.rates)).toHaveLength(30)
    expect(result.rates['2026-08-11']?.timestamp.getTime()).toBe(limited * 1000)
  })

  it('looks again after an hour when history before the valuation date was missing', async () => {
    setup()
    fetcher.mockImplementation(async () => body(target - 10 * 86400))
    expect((await service().getDailyRates(day, day, 'CAD')).isErr()).toBe(true)
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    vi.setSystemTime(new Date('2026-09-08T13:01:00Z'))
    const result = (await service().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
  })
})

describe('local mempool with public fallback', () => {
  const local = 'https://local-mempool.test'
  const publicUrl = 'https://mempool.space'
  const localFirst = () => new DailyRatesService({ db: database.db, logger, mempoolApiUrl: local })
  it('uses a reasonable local quote without querying public', async () => {
    setup()
    fetcher.mockImplementation(async (input) => {
      expect(new URL(input).origin).toBe(local)
      return body(Math.min(Number(new URL(input).searchParams.get('timestamp')), target - 3 * 86400))
    })
    const result = (await localFirst().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9)
  })
  it('never asks public while fallbacks are turned off in Settings', async () => {
    setup()
    let fallbacks = false
    const rates = new DailyRatesService({
      db: database.db,
      logger,
      mempoolApiUrl: local,
      allowPublicFallback: () => fallbacks,
    })
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input),
        timestamp = Number(url.searchParams.get('timestamp'))
      return body(timestamp, url.origin === local ? { ...quotes, CAD: -1 } : quotes)
    })
    expect((await rates.getDailyRates(day, day, 'CAD')).isErr()).toBe(true)
    expect(fetcher.mock.calls.every(([input]) => new URL(input).origin === local)).toBe(true)
    fallbacks = true
    expect((await rates.getDailyRates(day, day, 'CAD')).unwrap().rates['2026-08-01']?.providerUrl).toBe(publicUrl)
  })
  it.each([true, false])(
    'chooses the same nearby quote whichever source answers first (local first: %s)',
    async (localAnswersFirst) => {
      setup()
      const july28 = target - 4 * 86400
      fetcher.mockImplementation(async (input) => {
        const url = new URL(input)
        if ((url.origin === local) !== localAnswersFirst) {
          await new Promise((resolve) => {
            setTimeout(resolve, 20)
          })
        }
        const lookup = Number(url.searchParams.get('timestamp'))
        if (url.origin !== local) {
          return body(lookup)
        }
        return lookup >= july28 ? body(july28) : Response.json({ prices: [] })
      })
      const end = new Date(day.getTime() + 3 * 86400000)
      const result = (await localFirst().getDailyRates(day, end)).unwrap()
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe((target + 86400) * 1000)
      expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
      expect(Object.keys(result.rates)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
    },
  )
  it('stops public requests as soon as fallbacks are turned off', async () => {
    setup()
    let fallbacks = true
    const rates = new DailyRatesService({
      db: database.db,
      logger,
      mempoolApiUrl: local,
      allowPublicFallback: () => fallbacks,
    })
    fetcher.mockImplementation(async (input) => {
      if (new URL(input).origin === local) {
        return Response.json({ prices: [] })
      }
      fallbacks = false
      return body(target - 10 * 86400)
    })
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher.mock.calls.filter(([input]) => new URL(input).origin === publicUrl)).toHaveLength(1)
  })
  it('asks public when the configured source has no prices, despite an older public quote in the cache', async () => {
    setup()
    const earlier = new Date(day.getTime() - 3 * 86400000)
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === local
        ? Response.json({ prices: [] })
        : body(Number(new URL(input).searchParams.get('timestamp'))),
    )
    await localFirst().getDailyRates(earlier, earlier)
    const result = (await localFirst().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
    expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
  })
  it('fills a missing local currency from public and reuses the public cache after reopening', async () => {
    setup()
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input),
        timestamp = Number(url.searchParams.get('timestamp'))
      return body(timestamp, url.origin === local ? { ...quotes, CAD: -1 } : quotes)
    })
    const result = (await localFirst().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
    expect(result.providerUrls).toEqual([publicUrl])
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(10)
    database.close()
    database = initDatabase(directory, logger)
    fetcher.mockClear()
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await localFirst().getDailyRates(day, day, 'CAD')).unwrap()).toEqual(result)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses public on a local outage and preserves its original timestamp', async () => {
    setup()
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === local
        ? new Response('', { status: 503, headers: { 'retry-after': '120' } })
        : body(Math.min(Number(new URL(input).searchParams.get('timestamp')), target - 3600)),
    )
    const result = (await localFirst().getDailyRates(day, day, 'EUR')).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
    expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe(day.getTime() - 3600000)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(10)
  })
  it('asks public before settling for a farther cached quote during a local outage', async () => {
    setup()
    const earlier = new Date(day.getTime() - 3 * 86400000)
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    await localFirst().getDailyRates(earlier, earlier)
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === local
        ? new Response('', { status: 503, headers: { 'retry-after': '120' } })
        : body(Number(new URL(input).searchParams.get('timestamp'))),
    )
    const result = (await localFirst().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
    expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
  })
  it('uses the closest cached quote when every source is unavailable', async () => {
    setup()
    const earlier = new Date(day.getTime() - 3 * 86400000)
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    await localFirst().getDailyRates(earlier, earlier)
    fetcher.mockRejectedValue(new Error('offline'))
    const result = (await localFirst().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(result.rates['2026-08-01']?.timestamp).toEqual(earlier)
  })
  it('records separate provenance for a statement using both instances', async () => {
    setup()
    const end = new Date('2026-08-20T00:00:00Z')
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input),
        timestamp = Number(url.searchParams.get('timestamp'))
      return body(timestamp, url.origin === local && timestamp > target ? { ...quotes, CAD: -1 } : quotes)
    })
    const result = (await localFirst().getDailyRates(day, end, 'CAD', [day, end])).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(result.rates['2026-08-20']?.providerUrl).toBe(publicUrl)
    expect(result.providerUrls).toEqual([local, publicUrl].sort())
    expect(result.providerUrl).toBeUndefined()
  })
  it('fails clearly when both sources lack usable history', async () => {
    setup()
    fetcher.mockImplementation(async () => body(target - 5 * 86400))
    const result = await localFirst().getDailyRates(day, day, 'CAD')
    expect(result.unwrapErr().message).toContain('either the configured mempool or public mempool.space')
    expect([...new Set(fetcher.mock.calls.map(([input]) => new URL(input).origin))]).toEqual([local, publicUrl])
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(18)
  })
  it('queries public directly without recursively retrying the same public provider', async () => {
    setup()
    const direct = new DailyRatesService({ db: database.db, logger, mempoolApiUrl: publicUrl })
    fetcher.mockResolvedValue(new Response('', { status: 404 }))
    expect((await direct.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
