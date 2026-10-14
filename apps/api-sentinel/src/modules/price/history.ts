import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { type DailyRatesService, MIN_MEMPOOL_PRICE_DATE } from './daily_rates'
import { type PriceService, isPublicMempool } from './service'

export type BitcoinPriceHistoryDays = 7 | 30 | 180 | 365

export interface BitcoinPricePoint {
  /** Unix seconds. */
  time: number
  value: number
}

export interface BitcoinPriceHistory {
  quoteCurrency: StatementQuoteCurrency
  /** Daily quotes from the statement price source, at the time each was observed, oldest first. */
  points: BitcoinPricePoint[]
  /** Names of the sources that supplied the daily quotes: the public host, or "Your mempool server". */
  historySources: string[]
  /** The current price from the source chosen in Settings, when it is in this currency and available. */
  latest?: BitcoinPricePoint
}

const DAY_SECONDS = 86_400

// A self-hosted mempool is often reached at an internal address, such as StartOS's bridge IP, which
// means nothing to the person reading it; name it the way Settings does instead.
function historySourceName(url: URL): string {
  return isPublicMempool(url) ? url.host : 'Your mempool server'
}

/** Longer ranges sample fewer days, which bounds the requests a first load makes for uncached days. */
function stepDays(days: BitcoinPriceHistoryDays): number {
  if (days <= 30) {
    return 1
  }
  return days <= 180 ? 3 : 7
}

/**
 * The UTC days to quote for a range, ending today. Sampled days fall on fixed calendar steps, so
 * the next day reuses the cached days and adds one.
 */
export function priceHistoryDates(days: BitcoinPriceHistoryDays, now: Date): Date[] {
  const today = Math.floor(now.getTime() / (DAY_SECONDS * 1000))
  const first = Math.max(today - days, Math.ceil(MIN_MEMPOOL_PRICE_DATE.getTime() / (DAY_SECONDS * 1000)))
  const step = stepDays(days)
  const dates: Date[] = []
  for (let day = Math.ceil(first / step) * step; day < today; day += step) {
    dates.push(new Date(day * DAY_SECONDS * 1000))
  }
  dates.push(new Date(today * DAY_SECONDS * 1000))
  return dates
}

/**
 * Bitcoin price history for Home. Uses the same daily rates, local quote cache and fallback
 * setting as statements, plus the current price from the source chosen in Settings, so it
 * never contacts a provider the rest of the app would not.
 */
export class PriceHistoryService {
  private readonly dailyRatesService: DailyRatesService
  private readonly priceService: PriceService

  public constructor(deps: { dailyRatesService: DailyRatesService; priceService: PriceService }) {
    this.dailyRatesService = deps.dailyRatesService
    this.priceService = deps.priceService
  }

  public getHistory = asyncFn(
    async (
      days: BitcoinPriceHistoryDays,
      quoteCurrency: StatementQuoteCurrency = 'USD',
    ): Promise<Result<BitcoinPriceHistory, Error>> => {
      const now = new Date()
      const dates = priceHistoryDates(days, now)
      const [opening] = dates
      const closing = dates.at(-1)
      if (!opening || !closing || dates.length < 2) {
        return Err(new Error('Bitcoin price history is not available for this range'))
      }
      // The current price source quotes USD only, so other currencies end at today's daily quote.
      const [rates, current] = await Promise.all([
        // Shown at once from saved prices while they refresh; its evenly spaced days reveal nothing.
        this.dailyRatesService.getDailyRates(opening, closing, quoteCurrency, dates, {
          staleWhileRefreshing: true,
          requiredDaysOnly: true,
        }),
        quoteCurrency === 'USD' ? this.priceService.getCurrentBtcPrice() : undefined,
      ])
      if (rates.isErr()) {
        return Err(rates.unwrapErr())
      }
      const { rates: daily, providerUrls } = rates.unwrap()
      // A day without its own quote may use a nearby one; plot each quote once, when it was observed.
      const observed = new Map<number, number>()
      for (const rate of Object.values(daily)) {
        observed.set(rate.timestamp.getTime() / 1000, rate.close.toNumber())
      }
      const points = [...observed].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
      const history: BitcoinPriceHistory = {
        quoteCurrency,
        points,
        historySources: [...new Set((providerUrls ?? []).map((url) => historySourceName(new URL(url))))],
      }
      // A last known price counts too: it is at most about an hour old.
      if (current?.isOk() === true) {
        const price = current.unwrap()
        if (price.asOf.getTime() / 1000 > (points.at(-1)?.time ?? 0)) {
          history.latest = { time: Math.floor(price.asOf.getTime() / 1000), value: price.value.toNumber() }
        }
      }
      return Ok(history)
    },
  )
}
