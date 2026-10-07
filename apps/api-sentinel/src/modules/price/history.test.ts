import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { DailyRatesService } from './daily_rates'
import { PriceHistoryService, priceHistoryDates } from './history'
import { PriceService } from './service'

const logger = pino({ level: 'silent' })
const now = new Date('2026-09-08T12:00:00Z')
const nowSeconds = now.getTime() / 1000
const mempoolUrl = 'https://mempool.test'
const quotes = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }

let directory: string
let database: SentinelDb
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

async function setup({ fallbacks = false }: { fallbacks?: boolean } = {}): Promise<PriceHistoryService> {
  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  directory = mkdtempSync(join(tmpdir(), 'sentinel-price-history-'))
  database = await openDrizzleDatabase(directory, logger)
  fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockImplementation(mempool)
  vi.stubGlobal('fetch', fetcher)
  const settings = () => ({ source: 'mempool' as const, fallbacks })
  return new PriceHistoryService({
    dailyRatesService: new DailyRatesService({
      db: database,
      logger,
      mempoolApiUrl: mempoolUrl,
      allowPublicFallback: () => fallbacks,
    }),
    priceService: new PriceService({ logger, mempoolApiUrl: mempoolUrl, settings }),
  })
}

/** A long Retry-After skips the retry back-off and puts the source in cooldown at once. */
function unavailable(): Response {
  return new Response(null, { status: 503, headers: { 'retry-after': '3600' } })
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
  ] as const)('samples the %i-day range as %i UTC days on fixed %i-day steps, ending today', (days, count, step) => {
    const dates = priceHistoryDates(days, now)
    expect(dates).toHaveLength(count)
    expect(dates.at(-1)).toEqual(new Date('2026-09-08T00:00:00Z'))
    const dayNumbers = dates.map((date) => date.getTime() / 86_400_000)
    expect(dayNumbers.slice(0, -1).every((day) => day % step === 0)).toBe(true)
    expect(dayNumbers.every((day, i) => i === 0 || day - (dayNumbers[i - 1] ?? 0) <= step)).toBe(true)
  })

  it.each([7, 30, 180, 365] as const)('adds one new day to the %i-day range each day', (days) => {
    const sampled = new Set(priceHistoryDates(days, now).map((date) => date.getTime()))
    for (let next = 1; next <= 7; next++) {
      const dates = priceHistoryDates(days, new Date(now.getTime() + next * 86_400_000))
      expect(dates.filter((date) => !sampled.has(date.getTime()))).toHaveLength(1)
      for (const date of dates) {
        sampled.add(date.getTime())
      }
    }
  })

  it('does not reach before the earliest supported price date', () => {
    expect(priceHistoryDates(365, new Date('2023-06-01T00:00:00Z'))[0]).toEqual(new Date('2023-04-06T00:00:00Z'))
  })
})

describe('Bitcoin price history', () => {
  it('uses the configured mempool for daily quotes and the chosen source for the latest price', async () => {
    const service = await setup()
    const history = (await service.getHistory(7)).expect('history')
    expect(history.quoteCurrency).toBe('USD')
    expect(history.points).toHaveLength(8)
    expect(history.points[0]).toEqual({
      time: nowSeconds - 43_200 - 7 * 86_400,
      value: 50000 + (nowSeconds - 43_200) / 86_400 - 7,
    })
    expect(history.historySources).toEqual(['Your mempool server'])
    expect(history.latest?.value).toBe(61000)
    expect(history.latest?.time).toBeGreaterThanOrEqual(nowSeconds - 61)
    expect(requestedHosts()).toEqual(['mempool.test'])
  })

  it('plots a nearby quote used for a missing day once, at the time it was observed', async () => {
    const service = await setup()
    const observed = nowSeconds - 43_200 - 3 * 86_400
    fetcher.mockImplementation(async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/v1/prices') {
        return Response.json({ USD: 61000, time: nowSeconds - 60 })
      }
      const timestamp = Number(parsed.searchParams.get('timestamp'))
      // The server has no prices after the observation, so later days fall back to it.
      const time = Math.min(timestamp, observed)
      return Response.json({ prices: [{ time, ...quotes, USD: 50000 + time / 86_400 }] })
    })
    const history = (await service.getHistory(7)).expect('history')
    // Seven days ago through the observation, and nothing after it.
    expect(history.points.map(({ time }) => time)).toEqual([4, 3, 2, 1, 0].map((day) => observed - day * 86_400))
    expect(history.latest?.value).toBe(61000)
  })

  it('keeps a last known current price when the price source stops answering', async () => {
    const service = await setup()
    await service.getHistory(7)
    vi.setSystemTime(now.getTime() + 2 * 60_000)
    fetcher.mockImplementation(async (url) =>
      url.endsWith('/api/v1/prices') ? new Response(null, { status: 503 }) : mempool(url),
    )
    expect((await service.getHistory(7)).expect('history').latest?.value).toBe(61000)
  })

  it('reuses locally cached quotes on the next load', async () => {
    const service = await setup()
    await service.getHistory(30)
    const historical = fetcher.mock.calls.filter(([url]) => url.includes('historical-price')).length
    await service.getHistory(30)
    // Only today's quote, which may still change, is checked again.
    expect(fetcher.mock.calls.filter(([url]) => url.includes('historical-price')).length - historical).toBeLessThan(2)
  })

  it('quotes other currencies from the daily rates without the USD-only current price', async () => {
    const service = await setup()
    const history = (await service.getHistory(7, 'EUR')).expect('history')
    expect(history.quoteCurrency).toBe('EUR')
    expect(history.points.every((point) => point.value === quotes.EUR)).toBe(true)
    expect(history.latest).toBeUndefined()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/v1/prices'))).toBe(false)
  })

  it('reports an unavailable range rather than contacting another provider when fallbacks are off', async () => {
    const service = await setup()
    fetcher.mockImplementation(async () => unavailable())
    expect((await service.getHistory(7)).isErr()).toBe(true)
    expect(requestedHosts()).toEqual(['mempool.test'])
  })

  it('falls back only to public mempool.space when fallbacks are allowed', async () => {
    const service = await setup({ fallbacks: true })
    fetcher.mockImplementation(async (url) =>
      new URL(url).host === 'mempool.space' && url.includes('historical-price') ? mempool(url) : unavailable(),
    )
    const history = (await service.getHistory(7)).expect('history')
    expect(history.historySources).toEqual(['mempool.space'])
    const historyHosts = fetcher.mock.calls.flatMap(([url]) =>
      url.includes('historical-price') ? [new URL(url).host] : [],
    )
    expect([...new Set(historyHosts)].sort()).toEqual(['mempool.space', 'mempool.test'])
  })
})
