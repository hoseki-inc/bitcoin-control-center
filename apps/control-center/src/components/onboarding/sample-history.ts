import type { BalanceDataPoint } from '../dashboard-charts/balance-history'

/** A made-up Bitcoin price for the introduction's USD amounts. */
export const SAMPLE_BTC_PRICE = 82_500

const SATS_PER_BTC = 100_000_000
const DAY_MS = 86_400_000
const MONTHS = 12
const STARTING_BTC = 0.5
const WEEKLY_BTC = [0.0045, 0.006, 0.005, 0.0055, 0.0065] as const
/** Larger buys and withdrawals, by month index from the first month shown. */
const LUMP_SUMS_BTC = new Map([
  [2, 0.05],
  [4, -0.05],
  [6, 0.03],
  [8, -0.035],
  [9, 0.06],
])

/**
 * A year of made-up daily balances ending today: steady weekly buys, a few larger ones and two
 * withdrawals, so most months add to the stack and two take from it. Never the user's data.
 */
export function sampleBalanceHistory(now: Date): BalanceDataPoint[] {
  // Noon UTC falls on the same calendar day in every timezone the charts group months in.
  const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1, 12)
  const last = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12)
  const start = new Date(first)
  const points: BalanceDataPoint[] = []
  let btc = STARTING_BTC
  for (let time = first, day = 0; time <= last; time += DAY_MS, day++) {
    const date = new Date(time)
    if (day > 0 && day % 7 === 0) {
      btc += WEEKLY_BTC[(day / 7) % WEEKLY_BTC.length] ?? 0
    }
    if (date.getUTCDate() === 15) {
      const month = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth()
      btc += LUMP_SUMS_BTC.get(month) ?? 0
    }
    points.push({ timestamp: date.toISOString(), totalBalance: Math.round(btc * SATS_PER_BTC).toString() })
  }
  return points
}
