import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { btcQuoteCache } from '../../db/schema'
import { DailyRatesService } from './daily_rates'
import { QuoteCache } from './quote_cache'

const logger = pino({ level: 'silent' })
/** A statement's download retries on the real schedule, only quicker. */
const SHORT_RETRIES = [1, 1, 1, 1]
const LOCAL = 'https://local-mempool.test'
const PUBLIC = 'https://mempool.space'
const DAY = 86_400
const day = new Date('2026-08-01T00:00:00Z')
const target = day.getTime() / 1000
const end = new Date('2026-08-31T00:00:00Z')
const quotes = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }
const chartOptions = { staleWhileRefreshing: true, requiredDaysOnly: true }
/** The node has no prices for August 8–24, so August 16 is more than four days from any. */
const gap = (time: number): boolean => time >= target + 7 * DAY && time <= target + 23 * DAY
/** Waits pass at once, moving the clock on as if they'd been waited out. */
const advanceClock = async (ms: number): Promise<void> => {
  vi.setSystemTime(Date.now() + ms)
}
let directory: string
let database: SentinelDb
/** Every request; each is a full-history download. */
let fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>

/** A full history with a price each midnight from ten days before August 1 until now, except where `skip` says. */
function history(
  values: Partial<Record<StatementQuoteCurrency, number | string | null>> = quotes,
  skip?: (time: number) => boolean,
): Response {
  const prices = []
  for (let time = target - 10 * DAY; time * 1000 <= Date.now(); time += DAY) {
    if (skip?.(time) !== true) {
      prices.push({ time, ...values })
    }
  }
  return Response.json({ prices })
}

/** A configured source without the public fallback. */
const service = (url = 'https://mempool.test', deps = {}): DailyRatesService =>
  new DailyRatesService({
    downloadRetryDelaysMs: SHORT_RETRIES,
    db: database,
    logger,
    mempoolApiUrl: url,
    allowPublicFallback: () => false,
    ...deps,
  })

/** A node with public mempool.space as its fallback. */
const withFallback = (deps = {}): DailyRatesService =>
  new DailyRatesService({ downloadRetryDelaysMs: SHORT_RETRIES, db: database, logger, mempoolApiUrl: LOCAL, ...deps })

const origins = (): string[] => fetcher.mock.calls.map(([input]) => new URL(input).origin)

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
  fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => history())
  vi.stubGlobal('fetch', fetcher)
}

describe('prices from a full history', () => {
  it.each<StatementQuoteCurrency>(['USD', 'CAD', 'GBP', 'EUR'])(
    'reads %s from one download, which names no dates',
    async (currency) => {
      await setup()
      // Older mempools send every currency, and exchange rates, which aren't used.
      fetcher.mockImplementation(async () =>
        Response.json({ prices: [{ time: target, ...quotes, CHF: 52000 }], exchangeRates: { USDCAD: 999 } }),
      )
      const result = (await service().getDailyRates(day, day, currency)).unwrap()
      expect(result.quoteCurrency).toBe(currency)
      expect(result.rates['2026-08-01']?.close.toString()).toBe(String(quotes[currency]))
      expect(result.rates['2026-08-01']?.timestamp).toEqual(day)
      expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
        `https://mempool.test/api/v1/historical-price?currency=${currency}`,
      ])
    },
  )

  it.each([-4, 4])('uses a price %s days away, at the time it was observed', async (offset) => {
    await setup()
    const observed = target + offset * DAY
    fetcher.mockImplementation(async () => history(quotes, (time) => time !== observed))
    const result = (await service().getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe(observed * 1000)
  })

  it('fails a day with no price within four days', async () => {
    await setup()
    fetcher.mockImplementation(async () => history(quotes, (time) => Math.abs(time - target) <= 4 * DAY))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it.each([
    { before: -3, after: 1, selected: 1 },
    { before: -1, after: 3, selected: -1 },
    { before: -2, after: 2, selected: -2 },
  ])(
    'chooses the closest price, and the earlier one on a tie: $before / $after',
    async ({ before, after, selected }) => {
      await setup()
      fetcher.mockImplementation(async () =>
        history(quotes, (time) => time !== target + before * DAY && time !== target + after * DAY),
      )
      const result = (await service().getDailyRates(day, day, 'CAD')).unwrap()
      expect(result.rates['2026-08-01']?.timestamp.getTime()).toBe((target + selected * DAY) * 1000)
    },
  )

  it.each([0, -1, null, '60000'])('ignores an invalid price, %s', async (price) => {
    await setup()
    fetcher.mockImplementation(async () => history({ ...quotes, USD: price }))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it("doesn't keep prices stamped in the future", async () => {
    await setup()
    const today = new Date('2026-09-08T00:00:00Z')
    fetcher.mockImplementation(async () => Response.json({ prices: [{ time: Date.now() / 1000 + 3600, ...quotes }] }))
    const rates = service()
    expect((await rates.getDailyRates(today, today, 'USD', [today], chartOptions)).isErr()).toBe(true)
    // Once that time has passed, the chart still has no price for today.
    vi.setSystemTime(new Date('2026-09-08T14:00:00Z'))
    expect((await rates.getDailyRates(today, today, 'USD', [today], chartOptions)).isErr()).toBe(true)
  })

  it.each([
    { name: 'no body', body: null },
    { name: 'prices that are not a list', body: { prices: 'invalid' } },
    { name: 'a time that is not a number', body: { prices: [{ time: 'yesterday', USD: 1 }] } },
    { name: 'more than 200,000 prices', body: { prices: Array.from({ length: 200_001 }, () => ({ time: target })) } },
  ])('rejects a history with $name', async ({ body }) => {
    await setup()
    fetcher.mockImplementation(async () => Response.json(body))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
  })

  it("replaces a source's saved history with each download, saving prices as numbers and text", async () => {
    await setup()
    const rates = service()
    expect((await rates.getDailyRates(day, day)).unwrap().rates['2026-08-01']?.timestamp).toEqual(day)
    const [row] = await database.select().from(btcQuoteCache).limit(1)
    expect(row?.timestamp).toBeTypeOf('number')
    expect(row?.price).toBeTypeOf('string')
    // A day later, the source no longer has August 1.
    vi.setSystemTime(new Date('2026-09-09T12:00:01Z'))
    fetcher.mockImplementation(async () => history(quotes, (time) => time === target))
    const result = (await rates.getDailyRates(day, day)).unwrap()
    expect(result.rates['2026-08-01']?.timestamp).toEqual(new Date('2026-07-31T00:00:00Z'))
  })
})

describe('privacy', () => {
  it.each([
    { scenario: 'when the node has every day', node: 'full' },
    { scenario: 'when public mempool.space fills a gap', node: 'gap' },
    { scenario: 'when the node is offline', node: 'offline' },
    { scenario: 'when the node refuses to send its history', node: 'refuses' },
  ] as const)('makes the same requests whatever the activity days, $scenario', async ({ node }) => {
    const run = async (required: Date[]): Promise<{ ok: boolean; requests: string[] }> => {
      await setup()
      fetcher.mockImplementation(async (input) => {
        if (new URL(input).origin !== LOCAL) {
          return history()
        }
        if (node === 'offline') {
          throw new Error('offline')
        }
        return node === 'refuses'
          ? new Response('Not found', { status: 404 })
          : history(quotes, node === 'gap' ? gap : undefined)
      })
      const result = await withFallback().getDailyRates(day, end, 'USD', required)
      return { ok: result.isOk(), requests: fetcher.mock.calls.map(([input]) => input) }
    }
    const quiet = await run([day, end])
    const busy = await run([day, new Date('2026-08-16T00:00:00Z'), end])
    expect(busy).toEqual(quiet)
    expect(quiet.ok).toBe(true)
    expect(quiet.requests.every((url) => url.endsWith('/api/v1/historical-price?currency=USD'))).toBe(true)
  })
})

describe('saved prices', () => {
  it('downloads again after a day, or after an hour for a statement with days still settling', async () => {
    await setup()
    const rates = service()
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T11:00:00Z'))
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-09T12:00:01Z'))
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    // A range reaching yesterday, whose price is still settling, is downloaded again after an hour.
    vi.setSystemTime(new Date('2026-09-09T13:00:02Z'))
    expect((await rates.getDailyRates(day, new Date('2026-09-08T00:00:00Z'))).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("checks the chart's history daily, even though its days include today", async () => {
    await setup()
    const today = new Date('2026-09-08T00:00:00Z')
    const rates = service()
    expect((await rates.getDailyRates(day, today, 'USD', [day, today], chartOptions)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-08T18:00:00Z'))
    expect((await rates.getDailyRates(day, today, 'USD', [day, today], chartOptions)).isOk()).toBe(true)
    // Any background refresh would have started by now.
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("serves the chart's saved prices at once and refreshes them in the background", async () => {
    await setup()
    const rates = service()
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
    let release = (): void => {}
    fetcher.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return history({ ...quotes, USD: 61000 })
    })
    const stale = (await rates.getDailyRates(day, end, 'USD', [day], chartOptions)).unwrap()
    expect(stale.rates['2026-08-01']?.close.toString()).toBe('60000')
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
    release()
    await vi.waitFor(async () => {
      const fresh = (await rates.getDailyRates(day, end, 'USD', [day])).unwrap()
      expect(fresh.rates['2026-08-01']?.close.toString()).toBe('61000')
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("waits for a chart whose days aren't all saved, rather than showing some of them", async () => {
    await setup()
    const rates = service()
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isOk()).toBe(true)
    // The history doesn't reach back to July 1.
    const july = new Date('2026-07-01T00:00:00Z')
    expect((await rates.getDailyRates(july, day, 'USD', [july, day], chartOptions)).isErr()).toBe(true)
  })

  it("uses a source's last download while it's offline, until that's a day old", async () => {
    await setup()
    const rates = withFallback()
    expect((await rates.getDailyRates(day, end)).isOk()).toBe(true)
    fetcher.mockRejectedValue(new Error('offline'))
    vi.setSystemTime(new Date('2026-09-09T11:00:00Z'))
    expect((await rates.getDailyRates(day, end)).unwrap().providerUrls).toEqual([LOCAL])
    expect(origins()).toEqual([LOCAL])
    vi.setSystemTime(new Date('2026-09-09T12:00:01Z'))
    expect((await rates.getDailyRates(day, end)).isErr()).toBe(true)
    // The chart can still show them while it tries to refresh.
    expect((await rates.getDailyRates(day, end, 'USD', [day, end], chartOptions)).isOk()).toBe(true)
  })
})

describe('sources', () => {
  it("fills only the node's gaps from public mempool.space, keeping the node's prices", async () => {
    await setup()
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === LOCAL ? history(quotes, gap) : history({ ...quotes, USD: 61000 }),
    )
    const dates = ['2026-08-01', '2026-08-10', '2026-08-16', '2026-08-31']
    const required = dates.map((date) => new Date(`${date}T00:00:00Z`))
    const result = (await withFallback().getDailyRates(day, end, 'USD', required)).unwrap()
    expect(dates.map((date) => [result.rates[date]?.providerUrl, result.rates[date]?.close.toString()])).toEqual([
      [LOCAL, '60000'],
      // The node's price three days earlier is used, though public has that day.
      [LOCAL, '60000'],
      [PUBLIC, '61000'],
      [LOCAL, '60000'],
    ])
    expect(result.rates['2026-08-10']?.timestamp).toEqual(new Date('2026-08-07T00:00:00Z'))
    expect(origins()).toEqual([LOCAL, PUBLIC])
  })

  it("uses public mempool.space for every day once the node's history is old and it's offline", async () => {
    await setup()
    const rates = withFallback()
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === LOCAL ? history(quotes, gap) : history({ ...quotes, USD: 61000 }),
    )
    // The node alone covers early August.
    expect((await rates.getDailyRates(day, new Date('2026-08-05T00:00:00Z'))).unwrap().providerUrls).toEqual([LOCAL])
    // 23 hours later, public fills the node's gap.
    vi.setSystemTime(new Date('2026-09-09T11:00:00Z'))
    expect((await rates.getDailyRates(day, end)).unwrap().providerUrls).toEqual([LOCAL, PUBLIC])
    // Two hours after that, the node's history is more than a day old, and the node is offline.
    vi.setSystemTime(new Date('2026-09-09T13:00:00Z'))
    fetcher.mockImplementation(async (input) => {
      if (new URL(input).origin === LOCAL) {
        throw new Error('offline')
      }
      return history({ ...quotes, USD: 61000 })
    })
    const result = (await rates.getDailyRates(day, end)).unwrap()
    expect(result.providerUrls).toEqual([PUBLIC])
    expect(result.rates['2026-08-01']?.close.toString()).toBe('61000')
  })

  it('never asks public mempool.space while fallbacks are off, nor uses what it saved', async () => {
    await setup()
    let fallbacks = false
    const rates = withFallback({ allowPublicFallback: () => fallbacks })
    fetcher.mockImplementation(async (input) => (new URL(input).origin === LOCAL ? history(quotes, gap) : history()))
    expect((await rates.getDailyRates(day, end)).isErr()).toBe(true)
    expect(origins()).toEqual([LOCAL])
    fallbacks = true
    expect((await rates.getDailyRates(day, end)).unwrap().providerUrls).toEqual([LOCAL, PUBLIC])
    fallbacks = false
    expect((await rates.getDailyRates(day, end)).isErr()).toBe(true)
    expect(origins()).toEqual([LOCAL, PUBLIC])
  })

  it.each([
    {
      wait: 'a cooldown the chart left',
      // A wait the chart won't take, but a statement will.
      response: (): Response => new Response('', { status: 503, headers: { 'retry-after': '30' } }),
      chartFirst: true,
      waits: [30_000],
    },
    { wait: 'a retry', response: (): Response => new Response('', { status: 503 }), chartFirst: false, waits: [1] },
  ])('stops a public download when fallbacks are turned off during $wait', async ({ response, chartFirst, waits }) => {
    await setup()
    let fallbacks = true
    const waited: number[] = []
    const rates = withFallback({
      allowPublicFallback: () => fallbacks,
      sleep: async (ms: number) => {
        waited.push(ms)
        fallbacks = false
      },
    })
    // The node refuses, so public is asked.
    fetcher.mockImplementation(async (input) =>
      new URL(input).origin === LOCAL ? new Response('Not found', { status: 404 }) : response(),
    )
    if (chartFirst) {
      expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isErr()).toBe(true)
    }
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(waited).toEqual(waits)
    expect(origins().filter((origin) => origin === PUBLIC)).toHaveLength(1)
  })

  it("doesn't use prices saved from another source", async () => {
    await setup()
    expect((await service('https://old-node.test').getDailyRates(day, end)).isOk()).toBe(true)
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await service('https://new-node.test').getDailyRates(day, end)).isErr()).toBe(true)
  })

  it('has no fallback when the configured source is public mempool.space', async () => {
    await setup()
    fetcher.mockResolvedValue(new Response('Not found', { status: 404 }))
    const rates = new DailyRatesService({
      downloadRetryDelaysMs: SHORT_RETRIES,
      db: database,
      logger,
      mempoolApiUrl: PUBLIC,
    })
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails clearly when the sources together lack a day', async () => {
    await setup()
    fetcher.mockImplementation(async () => history(quotes, gap))
    const result = await withFallback().getDailyRates(day, end, 'CAD')
    expect(result.unwrapErr().message).toBe('No recent CAD price for every day')
    expect(origins()).toEqual([LOCAL, PUBLIC])
  })
})

describe('retries and time limits', () => {
  it('keeps trying through rate limits, server errors and dropped connections', async () => {
    await setup()
    fetcher
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('waits out a source that asks for a short wait instead of giving up', async () => {
    await setup()
    fetcher.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
    expect((await service().getDailyRates(day, day)).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('gives up after its last attempt', async () => {
    await setup()
    fetcher.mockRejectedValue(new Error('offline'))
    expect((await service().getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('honours a long Retry-After without asking again', async () => {
    await setup()
    fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const rates = service()
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    { failure: 'server errors', fail: (): Response => new Response('', { status: 503 }) },
    {
      failure: 'timeouts',
      fail: (): Response => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      },
    },
  ])('stops within its time budget through $failure, giving each attempt the time left', async ({ fail }) => {
    await setup()
    const start = Date.now()
    const rates = new DailyRatesService({ db: database, logger, mempoolApiUrl: LOCAL, sleep: advanceClock })
    const timeouts = vi.spyOn(AbortSignal, 'timeout')
    // Each attempt takes ten seconds to fail.
    fetcher.mockImplementation(async () => {
      await advanceClock(10_000)
      return fail()
    })
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    // The node's attempts start at 0, 12, 27 and 47 seconds; the next would start at 77. Public still gets one.
    expect(origins()).toEqual([LOCAL, LOCAL, LOCAL, LOCAL, PUBLIC])
    expect(timeouts.mock.calls.map(([ms]) => ms)).toEqual([60_000, 48_000, 33_000, 13_000, 10_000])
    expect(Date.now() - start).toBe(67_000)
  })

  it("retries the chart's first load only briefly", async () => {
    await setup()
    fetcher.mockImplementation(async () => new Response('', { status: 503 }))
    expect(
      (
        await service('https://mempool.test', { sleep: advanceClock }).getDailyRates(
          day,
          day,
          'USD',
          [day],
          chartOptions,
        )
      ).isErr(),
    ).toBe(true)
    // Four attempts 0.5, 1 and 2 seconds apart, where a statement makes five over about a minute.
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it("gives up on the chart's first load at the time limit, without trying again at once", async () => {
    await setup()
    fetcher.mockImplementation(async () => {
      await advanceClock(60_000)
      throw new DOMException('The operation timed out.', 'TimeoutError')
    })
    expect((await service().getDailyRates(day, day, 'USD', [day], chartOptions)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('downloads once for simultaneous requests in a currency', async () => {
    await setup()
    const rates = service()
    const usd = await Promise.all([1, 2, 3].map(async () => rates.getDailyRates(day, end)))
    expect(usd.every((result) => result.isOk())).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const all = await Promise.all(
      StatementQuoteCurrencySchema.options.map(async (currency) => rates.getDailyRates(day, end, currency)),
    )
    expect(all.every((result) => result.isOk())).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it("keeps a statement's patience after it joins the chart's quick download", async () => {
    await setup()
    const rates = service('https://mempool.test', { sleep: advanceClock })
    // Saved prices from yesterday's download, so the chart shows them and refreshes in the background.
    expect((await rates.getDailyRates(day, day)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T13:00:00Z'))
    let fail = (): void => {}
    fetcher.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        fail = resolve
      })
      // A wait the chart won't take, but a statement will.
      return new Response('', { status: 503, headers: { 'retry-after': '30' } })
    })
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isOk()).toBe(true)
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
    const checks = vi.spyOn(QuoteCache.prototype, 'downloadedAt')
    const statement = rates.getDailyRates(day, day)
    // Once its saved history has been checked, the statement is waiting for the chart's download.
    await vi.waitFor(() => {
      expect(checks.mock.settledResults[0]?.type).toBe('fulfilled')
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    // That fails, so the statement waits out the cooldown and tries again itself.
    fail()
    expect((await statement).isOk()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('stops waiting for a download it joined at its own time limit', async () => {
    await setup()
    const rates = service('https://mempool.test', { priceBudgetMs: 50 })
    expect((await rates.getDailyRates(day, day)).isOk()).toBe(true)
    vi.setSystemTime(new Date('2026-09-09T13:00:00Z'))
    let finish = (): void => {}
    fetcher.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return history()
    })
    expect((await rates.getDailyRates(day, day, 'USD', [day], chartOptions)).isOk()).toBe(true)
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
    // The statement waits for the chart's download, which outlasts the statement's time limit.
    expect((await rates.getDailyRates(day, day)).isErr()).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
    finish()
    await vi.waitFor(async () => {
      expect((await rates.getDailyRates(day, day)).isOk()).toBe(true)
    })
  })
})
