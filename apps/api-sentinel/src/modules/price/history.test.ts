import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDatabase, initDatabase } from '../../db'
import { DailyRatesService } from './daily_rates'
import { PriceHistoryService, priceHistoryDates } from './history'
import { PriceService } from './service'

const logger = pino({ level: 'silent' })
const now = new Date('2026-09-08T12:00:00Z')
const nowSeconds = now.getTime() / 1000
const mempoolUrl = 'https://mempool.test'
const quotes = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }

let directory: string
let database: SentinelDatabase
let fetcher: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>

/** A mempool server that knows every hour, and quotes each day at a different USD price. */
async function mempool(url: string): Promise<Response> {
  const parsed = new URL(url)
  if (parsed.pathname === '/api/v1/prices') {
    return Response.json({ USD: 61000, time: nowSeconds - 60 })
  }
  const timestamp = Number(parsed.searchParams.get('timestamp'))
  return Response.json({ prices: [{ time: timestamp, ...quotes, USD: 50000 + timestamp / 86_400 }] })
}

function setup({ fallbacks = false }: { fallbacks?: boolean } = {}): PriceHistoryService {
  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  directory = mkdtempSync(join(tmpdir(), 'sentinel-price-history-'))
  database = initDatabase(directory, logger)
  fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(mempool)
  vi.stubGlobal('fetch', fetcher)
  const settings = () => ({ source: 'mempool' as const, fallbacks })
  return new PriceHistoryService({
    dailyRatesService: new DailyRatesService({
      db: database.db,
      logger,
      mempoolApiUrl: mempoolUrl,
      allowPublicFallback: () => fallbacks,
    }),
    priceService: new PriceService({ logger, mempoolApiUrl: mempoolUrl, settings }),
  })
}

function requestedHosts(): string[] {
  return [...new Set(fetcher.mock.calls.map(([url]) => new URL(url).host))]
}

describe('price history dates', () => {
  it.each([
    [7, 8, 1],
    [30, 31, 1],
    [180, 61, 3],
    [365, 53, 7],
  ] as const)('samples the %i-day range as %i UTC days, %i apart, ending today', (days, count, step) => {
    const dates = priceHistoryDates(days, now)
    expect(dates).toHaveLength(count)
    expect(dates.at(-1)).toEqual(new Date('2026-09-08T00:00:00Z'))
    expect(
      dates.every((date, i) => i === 0 || date.getTime() - (dates[i - 1]?.getTime() ?? 0) === step * 86_400_000),
    ).toBe(true)
  })

  it('does not reach before the earliest supported price date', () => {
    expect(priceHistoryDates(365, new Date('2023-06-01T00:00:00Z'))[0]).toEqual(new Date('2023-04-06T00:00:00Z'))
  })
})

describe('Bitcoin price history', () => {
  it('uses the configured mempool for daily quotes and the chosen source for the latest price', async () => {
    const service = setup()
    const history = (await service.getHistory(7)).expect('history')
    expect(history.quoteCurrency).toBe('USD')
    expect(history.points).toHaveLength(8)
    expect(history.points[0]).toEqual({
      time: nowSeconds - 43_200 - 7 * 86_400,
      value: 50000 + (nowSeconds - 43_200) / 86_400 - 7,
    })
    expect(history.historySources).toEqual(['Your mempool server'])
    expect(history.latest).toMatchObject({ value: 61000, source: 'mempool' })
    expect(history.latest?.time).toBeGreaterThanOrEqual(nowSeconds - 61)
    expect(requestedHosts()).toEqual(['mempool.test'])
  })

  it('reuses locally cached quotes on the next load', async () => {
    const service = setup()
    await service.getHistory(30)
    const historical = fetcher.mock.calls.filter(([url]) => url.includes('historical-price')).length
    await service.getHistory(30)
    // Only today's quote, which may still change, is checked again.
    expect(fetcher.mock.calls.filter(([url]) => url.includes('historical-price')).length - historical).toBeLessThan(2)
  })

  it('quotes other currencies from the daily rates without the USD-only current price', async () => {
    const service = setup()
    const history = (await service.getHistory(7, 'EUR')).expect('history')
    expect(history.quoteCurrency).toBe('EUR')
    expect(history.points.every((point) => point.value === quotes.EUR)).toBe(true)
    expect(history.latest).toBeUndefined()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/v1/prices'))).toBe(false)
  })

  it('reports an unavailable range rather than contacting another provider when fallbacks are off', async () => {
    const service = setup()
    fetcher.mockImplementation(async () => new Response(null, { status: 503 }))
    expect((await service.getHistory(7)).isErr()).toBe(true)
    expect(requestedHosts()).toEqual(['mempool.test'])
  })

  it('falls back only to public mempool.space when fallbacks are allowed', async () => {
    const service = setup({ fallbacks: true })
    fetcher.mockImplementation(async (url) =>
      new URL(url).host === 'mempool.space' && url.includes('historical-price')
        ? mempool(url)
        : new Response(null, { status: 503 }),
    )
    const history = (await service.getHistory(7)).expect('history')
    expect(history.historySources).toEqual(['mempool.space'])
    const historyHosts = fetcher.mock.calls.flatMap(([url]) =>
      url.includes('historical-price') ? [new URL(url).host] : [],
    )
    expect([...new Set(historyHosts)].sort()).toEqual(['mempool.space', 'mempool.test'])
  })
})
