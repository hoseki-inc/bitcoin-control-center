import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { type DailyRatesService, MIN_MEMPOOL_PRICE_DATE } from './daily_rates'
import { type PriceService, type PriceSourceName, isPublicMempool } from './service'

export type BitcoinPriceHistoryDays = 7 | 30 | 180 | 365

export interface BitcoinPricePoint {
  /** Unix seconds. */
  time: number
  value: number
}

export interface BitcoinPriceHistory {
  quoteCurrency: StatementQuoteCurrency
  /** Daily quotes from the statement price source, oldest first. */
  points: BitcoinPricePoint[]
  /** Names of the sources that supplied the daily quotes: the public host, or "Your mempool server". */
  historySources: string[]
  /** The current price from the source chosen in Settings, when it is in this currency and available. */
  latest?: BitcoinPricePoint & { source: PriceSourceName; sourceLabel: string }
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

/** The UTC days to quote for a range, ending today. */
export function priceHistoryDates(days: BitcoinPriceHistoryDays, now: Date): Date[] {
  const today = Math.floor(now.getTime() / (DAY_SECONDS * 1000)) * DAY_SECONDS
  const earliest = Math.ceil(MIN_MEMPOOL_PRICE_DATE.getTime() / 1000)
  const step = stepDays(days)
  const dates: Date[] = []
  for (let offset = 0; offset <= days; offset += step) {
    const day = today - offset * DAY_SECONDS
    if (day < earliest) {
      break
    }
    dates.push(new Date(day * 1000))
  }
  return dates.reverse()
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
        this.dailyRatesService.getDailyRates(opening, closing, quoteCurrency, dates),
        quoteCurrency === 'USD' ? this.priceService.getCurrentBtcPrice() : undefined,
      ])
      if (rates.isErr()) {
        return Err(rates.unwrapErr())
      }
      const { rates: daily, providerUrls } = rates.unwrap()
      const points = dates.flatMap((date) => {
        const rate = daily[date.toISOString().slice(0, 10)]
        return rate ? [{ time: date.getTime() / 1000, value: rate.close.toNumber() }] : []
      })
      const history: BitcoinPriceHistory = {
        quoteCurrency,
        points,
        historySources: [...new Set((providerUrls ?? []).map((url) => historySourceName(new URL(url))))],
      }
      if (current?.isOk() === true) {
        const price = current.unwrap()
        const latestDay = points.at(-1)?.time ?? 0
        if (!price.lastKnown && price.asOf.getTime() / 1000 > latestDay) {
          const source = this.priceService.options().sources.find(({ name }) => name === price.source)
          history.latest = {
            time: Math.floor(price.asOf.getTime() / 1000),
            value: price.value.toNumber(),
            source: price.source,
            sourceLabel: source?.label ?? price.source,
          }
        }
      }
      return Ok(history)
    },
  )
}
