import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { count } from 'drizzle-orm'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { btcQuoteCache } from '../../db/schema'
import { DailyRatesService } from './daily_rates'
import { QuoteCache } from './quote_cache'

const logger = pino({ level: 'silent' })
/** A statement's download retries on the real schedule, only quicker. */
const SHORT_RETRIES = [1, 1, 1, 1]
/** Waits pass at once, moving the clock on as if they'd been waited out. */
const advanceClock = async (ms: number): Promise<void> => {
  vi.setSystemTime(Date.now() + ms)
}
const day = new Date('2026-08-01T00:00:00Z')
const target = day.getTime() / 1000
const quotes = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }
const body = (
  time = target,
  values: Partial<Record<StatementQuoteCurrency, number | string | null>> = quotes,
): Response => Response.json({ prices: [{ time, ...values }] })
let directory: string
let database: SentinelDb
/** Day-by-day lookups (`?timestamp=`). */
let fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>
/** Full-history downloads (`?currency=`). They fail unless a test says otherwise, so the day-by-day tests cover the fallback. */
let historyFetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>
const service = (url = 'https://mempool.test'): DailyRatesService =>
  new DailyRatesService({
    downloadRetryDelaysMs: SHORT_RETRIES,
    db: database,
    logger,
    mempoolApiUrl: url,
    allowPublicFallback: () => false,
  })

/** A full history of daily prices from ten days before `day` up to now. */
const recentHistory = (): Response => {
  const prices = []
  for (let time = target - 10 * 86400; time * 1000 <= Date.now(); time += 86400) {
    prices.push({ time, ...quotes })
  }
  return Response.json({ prices })
}

async function setup(): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
  directory = mkdtempSync(join(tmpdir(), 'sentinel-quotes-'))
  database = await openDrizzleDatabase(directory, logger)
  // Each setup cleans up its own database, so a test can set up more than once.
  const opened = { database, directory }
  onTestFinished(() => {
    opened.database.$client.close()
    rmSync(opened.directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => body())
  historyFetcher = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockImplementation(async () => new Response('Not found', { status: 404 }))
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    new URL(input).searchParams.has('timestamp') ? fetcher(input, init) : historyFetcher(input, init),
  )
}

describe('historical statement quotes', () => {
  it.each<StatementQuoteCurrency>(['USD', 'CAD', 'GBP', 'EUR'])(
    'selects historical %s, without using latest FX rates',
    async (currency) => {
      await setup()
      fetcher.mockResolvedValueOnce(
        Response.json({ prices: [{ time: target, ...quotes }], exchangeRates: { USDCAD: 999 } }),
      )
      const result = (await service().getDailyRates(day, day, currency)).unwrap()
      expect(result.quoteCurrency).toBe(currency)
      expect(result.rates['2026-08-01']?.close.toString()).toBe(String(quotes[currency]))
      expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
    },
  )

  it('without a full history, looks up every day in the range, then reuses saved currencies across providers', async () => {
    await setup()
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    const end = new Date('2026-08-31T00:00:00Z')
    const required = [day, end, day]
    expect((await service().getDailyRates(day, end, 'USD', required)).isOk()).toBe(true)
    // Every day, not just the required ones, so the lookups don't show which days had activity.
    const looked = fetcher.mock.calls.map(([input]) => Number(new URL(input).searchParams.get('timestamp')))
    expect(looked.sort((a, b) => a - b)).toEqual(Array.from({ length: 31 }, (_, i) => target + i * 86400))
    database.$client.close()
    database = await openDrizzleDatabase(directory, logger)
    fetcher.mockClear()
    fetcher.mockRejectedValue(new Error('offline'))
    const result = (await service('http://local-mempool.test').getDailyRates(day, end, 'CAD', required)).unwrap()
    for (const date of ['2026-08-01', '2026-08-31']) {
      expect(result.rates[date]?.close.toString()).toBe(String(quotes.CAD))
      expect(result.rates[date]?.providerUrl).toBe('https://mempool.test')
    }
    expect(fetcher).not.toHaveBeenCalled()
    await expect(database.select({ count: count() }).from(btcQuoteCache)).resolves.toEqual([{ count: 31 * 4 }])
  })

  it('de-duplicates simultaneous currency lookups', async () => {
    await setup()
    const rates = service()
    const results = await Promise.all(
      StatementQuoteCurrencySchema.options.map(async (currency) => rates.getDailyRates(day, day, currency)),
    )
    expect(results.every((result) => result.isOk())).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates lookups while asynchronous request settings are loading', async () => {
    await setup()
    let release = (): void => {}
    const permission = new Promise<void>((resolve) => {
      release = resolve
    })
    const allowRequests = vi.fn(async () => {
      await permission
      return true
    })
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: 'https://mempool.test',
      allowRequests,
    })
    const results = Promise.all(
      StatementQuoteCurrencySchema.options.map(async (currency) => rates.getDailyRates(day, day, currency)),
    )
    await vi.waitFor(() => {
      expect(allowRequests).toHaveBeenCalledTimes(4)
    })
    release()
    expect((await results).every((result) => result.isOk())).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([-4, 4])(
    'accepts a quote exactly %s days from the valuation without rewriting its timestamp',
    async (offset) => {
      await setup()
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
    await setup()
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
    await setup()
    fetcher.mockImplementation(async () => body(target - 4 * 86400, { ...quotes, USD: price }))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it('rejects observations after the lookup timestamp and malformed responses', async () => {
    await setup()
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
      await setup()
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
    await setup()
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
    await setup()
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
    await setup()
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
    await setup()
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
    "fails a day its source couldn't confirm, even with a neighbour's quote, whichever arrives first (failure first: %s)",
    async (failureFirst) => {
      await setup()
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
      expect((await service().getDailyRates(day, end)).isErr()).toBe(true)
    },
  )

  it('stops concurrent retries once the source asks for a long wait', async () => {
    await setup()
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
    await setup()
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

  it("refreshes current-day lookups after one hour, and doesn't settle for saved prices while offline", async () => {
    await setup()
    const today = new Date('2026-09-08T00:00:00Z')
    const now = today.getTime() / 1000
    fetcher.mockResolvedValue(body(now))
    const rates = service()
    await rates.getDailyRates(today, today)
    await rates.getDailyRates(today, today)
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-08T14:00:00Z'))
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await rates.getDailyRates(today, today)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('honors a long Retry-After without repeated requests or waiting inside generation', async () => {
    await setup()
    fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const rates = service()
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('backs off through a brief rate limit without failing a multi-day statement', async () => {
    await setup()
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
    await setup()
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
  const localFirst = () =>
    new DailyRatesService({ downloadRetryDelaysMs: SHORT_RETRIES, db: database, logger, mempoolApiUrl: local })
  it('uses a reasonable local quote without querying public', async () => {
    await setup()
    fetcher.mockImplementation(async (input) => {
      expect(new URL(input).origin).toBe(local)
      return body(Math.min(Number(new URL(input).searchParams.get('timestamp')), target - 3 * 86400))
    })
    const result = (await localFirst().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(9)
  })
  it('never asks public while fallbacks are turned off in Settings', async () => {
    await setup()
    let fallbacks = false
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
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
      await setup()
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
      // The node can't confirm every day, so public's exact quote is used, whoever answered first.
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe(target * 1000)
      expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
      expect(Object.keys(result.rates)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
    },
  )
  it('stops public requests as soon as fallbacks are turned off', async () => {
    await setup()
    let fallbacks = true
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
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
    await setup()
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
    await setup()
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input),
        timestamp = Number(url.searchParams.get('timestamp'))
      return body(timestamp, url.origin === local ? { ...quotes, CAD: -1 } : quotes)
    })
    const result = (await localFirst().getDailyRates(day, day, 'CAD')).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(publicUrl)
    expect(result.providerUrls).toEqual([publicUrl])
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(10)
    database.$client.close()
    database = await openDrizzleDatabase(directory, logger)
    fetcher.mockClear()
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await localFirst().getDailyRates(day, day, 'CAD')).unwrap()).toEqual(result)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('uses public on a local outage and preserves its original timestamp', async () => {
    await setup()
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
    await setup()
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
  it('fails rather than use a saved quote when every source is unavailable', async () => {
    await setup()
    const earlier = new Date(day.getTime() - 3 * 86400000)
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    await localFirst().getDailyRates(earlier, earlier)
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await localFirst().getDailyRates(day, day)).isErr()).toBe(true)
  })
  it('records separate provenance for a statement using both instances', async () => {
    await setup()
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
    await setup()
    fetcher.mockImplementation(async () => body(target - 5 * 86400))
    const result = await localFirst().getDailyRates(day, day, 'CAD')
    expect(result.unwrapErr().message).toContain('No confirmed CAD price')
    expect([...new Set(fetcher.mock.calls.map(([input]) => new URL(input).origin))]).toEqual([local, publicUrl])
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(18)
  })
  it('queries public directly without recursively retrying the same public provider', async () => {
    await setup()
    const direct = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: publicUrl,
    })
    fetcher.mockResolvedValue(new Response('', { status: 404 }))
    expect((await direct.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('full price history downloads', () => {
  const end = new Date('2026-08-31T00:00:00Z')
  /** One price a day from `from` up to now, as mempool's full history returns them. */
  const history = (
    values: Partial<Record<StatementQuoteCurrency, number>> = quotes,
    from = target - 400 * 86400,
  ): Response => {
    const prices = []
    for (let time = from; time * 1000 <= Date.now(); time += 86400) {
      prices.push({ time, ...values })
    }
    return Response.json({ prices })
  }

  it('reads every day from one download, which names no dates', async () => {
    await setup()
    historyFetcher.mockImplementation(async () => history())
    const result = (await service().getDailyRates(day, end, 'CAD', [day, end])).unwrap()
    expect(result.rates['2026-08-31']?.close.toString()).toBe(String(quotes.CAD))
    expect(historyFetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://mempool.test/api/v1/historical-price?currency=CAD',
    ])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { scenario: 'from the download', gap: false, download: true },
    { scenario: 'when the download has a long gap', gap: true, download: true },
    { scenario: 'day by day', gap: false, download: false },
    { scenario: 'day by day, past days the source has no price for', gap: true, download: false },
  ])("makes the same requests whatever the statement's activity days, $scenario", async ({ gap, download }) => {
    // August 8–24 has no prices: more than four days from any price on the 16th.
    const missing = (time: number): boolean => gap && time >= target + 7 * 86400 && time <= target + 23 * 86400
    const requests = async (required: Date[]): Promise<string[]> => {
      await setup()
      historyFetcher.mockImplementation(async () => {
        if (!download) {
          return new Response('Not found', { status: 404 })
        }
        const prices = []
        for (let time = target - 400 * 86400; time * 1000 <= Date.now(); time += 86400) {
          if (!missing(time)) {
            prices.push({ time, ...quotes })
          }
        }
        return Response.json({ prices })
      })
      fetcher.mockImplementation(async (input) => {
        const time = Number(new URL(input).searchParams.get('timestamp'))
        return missing(time) ? Response.json({ prices: [] }) : body(time)
      })
      await service().getDailyRates(day, end, 'USD', required)
      return [...historyFetcher.mock.calls, ...fetcher.mock.calls].map(([input]) => input)
    }
    const quiet = await requests([day, end])
    const busy = await requests([day, new Date('2026-08-16T00:00:00Z'), end])
    expect(busy).toEqual(quiet)
  })

  it('downloads again after a day, and after an hour for days still settling', async () => {
    await setup()
    historyFetcher.mockImplementation(async () => history())
    const rates = service()
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T11:00:00Z'))
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-09T12:00:01Z'))
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(2)
    // Yesterday's price is still settling, so an hour is enough to ask again.
    const yesterday = new Date('2026-09-08T00:00:00Z')
    vi.setSystemTime(new Date('2026-09-09T13:00:02Z'))
    expect((await rates.getDailyRates(yesterday, yesterday)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(3)
  })

  it('serves saved prices at once and refreshes them in the background when asked to', async () => {
    await setup()
    historyFetcher.mockImplementation(async () => history())
    const rates = service()
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    let release = (): void => {}
    historyFetcher.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return history({ ...quotes, USD: 61000 })
    })
    const stale = (await rates.getDailyRates(day, end, 'USD', [day], { staleWhileRefreshing: true })).unwrap()
    expect(stale.rates['2026-08-01']?.close.toString()).toBe('60000')
    await vi.waitFor(() => {
      expect(historyFetcher).toHaveBeenCalledTimes(2)
    })
    release()
    await vi.waitFor(async () => {
      const fresh = (await rates.getDailyRates(day, end, 'USD', [day])).unwrap()
      expect(fresh.rates['2026-08-01']?.close.toString()).toBe('61000')
    })
    expect(historyFetcher).toHaveBeenCalledTimes(2)
  })

  it("downloads public mempool.space's history when the node's has none, unless Settings turns that off", async () => {
    await setup()
    historyFetcher.mockImplementation(async (input) =>
      input.startsWith('https://mempool.space') ? history() : Response.json({ prices: [] }),
    )
    let allowed = false
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: 'https://local-mempool.test',
      allowPublicFallback: () => allowed,
    })
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(historyFetcher.mock.calls.map(([input]) => new URL(input).origin)).toEqual(['https://local-mempool.test'])
    // Without prices in its history, the node won't have them day by day either.
    expect(fetcher).not.toHaveBeenCalled()
    allowed = true
    historyFetcher.mockClear()
    const result = (await rates.getDailyRates(day, day)).unwrap()
    expect(result.providerUrl).toBe('https://mempool.space')
    expect(historyFetcher.mock.calls.map(([input]) => new URL(input).origin)).toEqual([
      'https://local-mempool.test',
      'https://mempool.space',
    ])
  })
})

describe('statements need confirmed prices', () => {
  it('fails while offline even with fresh-looking saved prices from an earlier download', async () => {
    await setup()
    const prices = []
    for (let time = target - 400 * 86400; time * 1000 <= Date.now(); time += 86400) {
      prices.push({ time, ...quotes })
    }
    historyFetcher.mockImplementation(async () => Response.json({ prices }))
    const rates = service()
    expect((await rates.getDailyRates(day, day)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    historyFetcher.mockRejectedValue(new Error('offline'))
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    // The Home chart can still show them while it tries to refresh.
    expect((await rates.getDailyRates(day, day, 'USD', [day], { staleWhileRefreshing: true })).isOk()).toBe(true)
  })
})

describe("a statement's download retries", () => {
  it('keeps trying through rate limits, server errors and dropped connections', async () => {
    await setup()
    historyFetcher
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async () => recentHistory())
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(5)
  })

  it('waits out a source that asks for a short wait instead of giving up', async () => {
    await setup()
    historyFetcher
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockImplementation(async () => recentHistory())
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(2)
  })

  it("gives up after its last attempt, and doesn't then ask an unreachable source day by day", async () => {
    await setup()
    historyFetcher.mockRejectedValue(new Error('offline'))
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(5)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("keeps its patience after joining the chart's quick download", async () => {
    await setup()
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: 'https://mempool.test',
      allowPublicFallback: () => false,
      sleep: advanceClock,
    })
    const recent = new Date('2026-09-05T00:00:00Z')
    // Saved prices from yesterday's download, so the chart shows them and refreshes in the background.
    historyFetcher.mockImplementation(async () => recentHistory())
    expect((await rates.getDailyRates(recent, recent)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T13:00:00Z'))
    let fail = (): void => {}
    historyFetcher.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        fail = resolve
      })
      // A wait the chart won't take, but a statement will.
      return new Response('', { status: 503, headers: { 'retry-after': '30' } })
    })
    const chart = await rates.getDailyRates(recent, recent, 'USD', [recent], {
      staleWhileRefreshing: true,
      requestRequiredDays: true,
    })
    expect(chart.isOk()).toBe(true)
    await vi.waitFor(() => {
      expect(historyFetcher).toHaveBeenCalledTimes(2)
    })
    const checks = vi.spyOn(QuoteCache.prototype, 'downloadedAt')
    const statement = rates.getDailyRates(recent, recent)
    // The statement joins the chart's download instead of starting its own.
    await vi.waitFor(() => {
      expect(checks.mock.settledResults).toHaveLength(1)
    })
    expect(historyFetcher).toHaveBeenCalledTimes(2)
    // That fails, so the statement waits out the cooldown and tries again itself.
    fail()
    expect((await statement).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(3)
  })
})

describe('time limits', () => {
  const local = 'https://local-mempool.test'
  const chartOptions = { staleWhileRefreshing: true, requestRequiredDays: true }

  it('stops within its time budget, giving each attempt the time left, and public mempool.space one try', async () => {
    await setup()
    const start = Date.now()
    const rates = new DailyRatesService({ db: database, logger, mempoolApiUrl: local, sleep: advanceClock })
    const timeouts = vi.spyOn(AbortSignal, 'timeout')
    // Each attempt takes ten seconds to fail.
    historyFetcher.mockImplementation(async () => {
      await advanceClock(10_000)
      return new Response('', { status: 503 })
    })
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    // The node's attempts start at 0, 12, 27 and 47 seconds. The next would start at 77.
    expect(historyFetcher.mock.calls.map(([input]) => new URL(input).origin)).toEqual([
      local,
      local,
      local,
      local,
      'https://mempool.space',
    ])
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([60_000, 48_000, 33_000, 13_000, 10_000])
    expect(Date.now() - start).toBe(67_000)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("gives up on the chart's first load at the time limit, without trying again at once", async () => {
    await setup()
    const rates = new DailyRatesService({
      db: database,
      logger,
      mempoolApiUrl: 'https://mempool.test',
      allowPublicFallback: () => false,
      sleep: advanceClock,
    })
    historyFetcher.mockImplementation(async () => {
      await advanceClock(60_000)
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isErr()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stops looking up days once the time is up', async () => {
    await setup()
    const deadline = Date.now() + 60_000
    const started: number[] = []
    // The source has nothing near the day, and takes ten seconds to say so each time.
    fetcher.mockImplementation(async () => {
      started.push(Date.now())
      await advanceClock(10_000)
      return Response.json({ prices: [] })
    })
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
    expect(started).toHaveLength(6)
    expect(started.every((time) => time < deadline)).toBe(true)
  })

  it('stops waiting for a download it joined at its own time limit', async () => {
    await setup()
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      priceBudgetMs: 50,
      db: database,
      logger,
      mempoolApiUrl: 'https://mempool.test',
      allowPublicFallback: () => false,
    })
    const recent = new Date('2026-09-05T00:00:00Z')
    historyFetcher.mockImplementation(async () => recentHistory())
    expect((await rates.getDailyRates(recent, recent)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T13:00:00Z'))
    let finish = (): void => {}
    historyFetcher.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return recentHistory()
    })
    expect((await rates.getDailyRates(recent, recent, 'USD', [recent], chartOptions)).isOk()).toBe(true)
    await vi.waitFor(() => {
      expect(historyFetcher).toHaveBeenCalledTimes(2)
    })
    // The statement waits for the chart's download, which outlasts the statement's time limit.
    expect((await rates.getDailyRates(recent, recent)).isErr()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(2)
    finish()
    await vi.waitFor(async () => {
      expect((await rates.getDailyRates(recent, recent)).isOk()).toBe(true)
    })
  })
})

describe('confirming prices', () => {
  const local = 'https://local-mempool.test'
  const daily = (from: number, values: Partial<Record<StatementQuoteCurrency, number>> = quotes): Response => {
    const prices = []
    for (let time = from; time * 1000 <= Date.now(); time += 86400) {
      prices.push({ time, ...values })
    }
    return Response.json({ prices })
  }
  const chartOptions = { staleWhileRefreshing: true, requestRequiredDays: true }

  it('asks a node day by day before going to public mempool.space', async () => {
    await setup()
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: local,
    })
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    const result = (await rates.getDailyRates(day, new Date('2026-08-05T00:00:00Z'))).unwrap()
    expect(result.providerUrls).toEqual([local])
    const origins = [...historyFetcher.mock.calls, ...fetcher.mock.calls].map(([input]) => new URL(input).origin)
    expect(new Set(origins)).toEqual(new Set([local]))
  })

  it("doesn't use a saved price that no source has confirmed recently", async () => {
    await setup()
    // Two days ago, public mempool.space supplied a price for August 1.
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    historyFetcher.mockImplementation(async () => daily(target - 10 * 86400))
    expect((await service('https://mempool.space').getDailyRates(day, day)).isOk()).toBe(true)
    // Now the node's history has nothing near it, and public has a corrected price.
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    historyFetcher.mockImplementation(async (input) =>
      new URL(input).origin === local
        ? daily(target + 30 * 86400)
        : daily(target - 10 * 86400, { ...quotes, USD: 61000 }),
    )
    fetcher.mockImplementation(async () => Response.json({ prices: [] }))
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: local,
    })
    const result = (await rates.getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.close.toString()).toBe('61000')
  })

  it("checks the chart's saved prices daily, even though they include today", async () => {
    await setup()
    const today = new Date('2026-09-08T00:00:00Z')
    historyFetcher.mockImplementation(async () => daily(target))
    const rates = service()
    expect((await rates.getDailyRates(day, today, 'USD', [day, today], chartOptions)).isOk()).toBe(true)
    expect(historyFetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-08T18:00:00Z'))
    expect((await rates.getDailyRates(day, today, 'USD', [day, today], chartOptions)).isOk()).toBe(true)
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(historyFetcher).toHaveBeenCalledTimes(1)
  })

  it("refreshes the chart day by day when the source can't send its full history", async () => {
    await setup()
    const rates = service()
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    fetcher.mockClear()
    fetcher.mockImplementation(async (input) =>
      body(Number(new URL(input).searchParams.get('timestamp')), { ...quotes, USD: 70000 }),
    )
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isOk()).toBe(true)
    await vi.waitFor(async () => {
      const refreshed = (await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).unwrap()
      expect(refreshed.rates['2026-08-01']?.close.toString()).toBe('70000')
    })
  })

  it("fills only the gaps in a node's history from public mempool.space, without asking the node day by day", async () => {
    await setup()
    // The node has no prices for August 8–24. Public has them all, at a slightly different price.
    const gap = (time: number): boolean => time >= target + 7 * 86400 && time <= target + 23 * 86400
    historyFetcher.mockImplementation(async (input) => {
      const node = new URL(input).origin === local
      const prices = []
      for (let time = target - 10 * 86400; time * 1000 <= Date.now(); time += 86400) {
        if (!node || !gap(time)) {
          prices.push({ time, ...quotes, USD: node ? 60000 : 61000 })
        }
      }
      return Response.json({ prices })
    })
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: local,
    })
    const end = new Date('2026-08-31T00:00:00Z')
    const result = (await rates.getDailyRates(day, end, 'USD', [day, new Date('2026-08-16T00:00:00Z'), end])).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(result.rates['2026-08-01']?.close.toString()).toBe('60000')
    expect(result.rates['2026-08-16']?.providerUrl).toBe('https://mempool.space')
    expect(result.rates['2026-08-31']?.close.toString()).toBe('60000')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('combines the days a node confirms with those public mempool.space confirms', async () => {
    await setup()
    // Prices an hour before midnight, so no day has an exact match. The node has them up to
    // August 15, and public from August 16.
    const nodeUntil = target + 15 * 86400 - 3600
    const publicFrom = target + 16 * 86400 - 3600
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input)
      const time = Math.floor((Number(url.searchParams.get('timestamp')) + 3600) / 86400) * 86400 - 3600
      if (url.origin === local) {
        return body(Math.min(time, nodeUntil))
      }
      return time >= publicFrom ? body(time) : Response.json({ prices: [] })
    })
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: local,
    })
    const end = new Date('2026-08-31T00:00:00Z')
    const result = (await rates.getDailyRates(day, end, 'USD', [day, end])).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe(local)
    expect(result.rates['2026-08-31']?.providerUrl).toBe('https://mempool.space')
  })

  it('searches nearby when the source no longer has a day it confirmed before', async () => {
    await setup()
    // Two days ago, the source had a price for August 1.
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    // Now it has none in USD that day, only the days around it.
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    fetcher.mockImplementation(async (input) => {
      const time = Number(new URL(input).searchParams.get('timestamp'))
      return body(time, time === target ? { ...quotes, USD: -1 } : quotes)
    })
    const result = (await service().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.timestamp).toEqual(new Date('2026-07-31T00:00:00Z'))
  })

  it("asks public mempool.space for a day the node confirmed before but can't any more", async () => {
    await setup()
    const rates = (): DailyRatesService =>
      new DailyRatesService({ downloadRetryDelaysMs: SHORT_RETRIES, db: database, logger, mempoolApiUrl: local })
    // Two days ago, the node had a price for August 1.
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
    fetcher.mockImplementation(async (input) => body(Number(new URL(input).searchParams.get('timestamp'))))
    expect((await rates().getDailyRates(day, day)).isOk()).toBe(true)
    // Now it has no USD prices at all.
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    fetcher.mockImplementation(async (input) => {
      const url = new URL(input)
      return body(Number(url.searchParams.get('timestamp')), url.origin === local ? { ...quotes, USD: -1 } : quotes)
    })
    const result = (await rates().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.providerUrl).toBe('https://mempool.space')
  })

  it('stops a public download when fallbacks are turned off while it waits', async () => {
    await setup()
    let fallbacks = true
    const waits: number[] = []
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: local,
      allowPublicFallback: () => fallbacks,
      sleep: async (ms) => {
        waits.push(ms)
        fallbacks = false
      },
    })
    // The node has no prices, and public asks for a wait the chart won't take.
    fetcher.mockImplementation(async () => Response.json({ prices: [] }))
    historyFetcher.mockImplementation(async (input) =>
      new URL(input).origin === local
        ? new Response('Not found', { status: 404 })
        : new Response('', { status: 503, headers: { 'retry-after': '30' } }),
    )
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isErr()).toBe(true)
    // A statement waits out public's cooldown, and fallbacks are turned off meanwhile.
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(waits).toEqual([30_000])
    expect(historyFetcher.mock.calls.filter(([input]) => new URL(input).origin !== local)).toHaveLength(1)
  })

  it('saves downloaded prices as numbers and text', async () => {
    await setup()
    historyFetcher.mockImplementation(async () => daily(target))
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    const [row] = await database.select().from(btcQuoteCache).limit(1)
    expect(row?.timestamp).toBeTypeOf('number')
    expect(row?.price).toBeTypeOf('string')
    expect(row?.refreshedAt).toBe(Date.now())
  })
})
