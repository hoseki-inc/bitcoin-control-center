/**
 * Pure ETF holdings calculation utilities.
 * No Prisma/DB imports — safe to use from any app (sentinel, armadillo, web).
 */

// ─── Ticker & Config ────────────────────────────────────────────────────────

export type EtfTicker = 'IBIT' | 'FBTC' | 'GBTC' | 'ARKB' | 'BITB' | 'HODL' | 'BTC' | 'MSBT'

export interface EtfConfig {
  ticker: EtfTicker
  name: string
  issuer: string
  /** BTC per share at the reference date */
  btcPerShare: number
  /** Date the btcPerShare was observed (ISO date string YYYY-MM-DD) */
  referenceDate: string
  /** Annual expense ratio as a decimal (e.g. 0.0025 = 0.25%) */
  expenseRatio: number
  /** If set, expense ratio is effectively 0% until this date (ISO YYYY-MM-DD) */
  expenseWaivedUntil?: string
}

export const ETF_CONFIGS: Record<EtfTicker, EtfConfig> = {
  IBIT: {
    ticker: 'IBIT',
    name: 'iShares Bitcoin Trust',
    issuer: 'BlackRock',
    btcPerShare: 0.00056697,
    referenceDate: '2026-03-05',
    expenseRatio: 0.0025,
  },
  FBTC: {
    ticker: 'FBTC',
    name: 'Fidelity Wise Origin Bitcoin Fund',
    issuer: 'Fidelity',
    btcPerShare: 0.00087103,
    referenceDate: '2026-03-06',
    expenseRatio: 0.0025,
  },
  GBTC: {
    ticker: 'GBTC',
    name: 'Grayscale Bitcoin Trust',
    issuer: 'Grayscale',
    btcPerShare: 0.0007793,
    referenceDate: '2026-03-06',
    expenseRatio: 0.015,
  },
  ARKB: {
    ticker: 'ARKB',
    name: 'ARK 21Shares Bitcoin ETF',
    issuer: '21Shares',
    btcPerShare: 0.000332,
    referenceDate: '2026-03-06',
    expenseRatio: 0.0021,
  },
  BITB: {
    ticker: 'BITB',
    name: 'Bitwise Bitcoin ETF',
    issuer: 'Bitwise',
    btcPerShare: 0.000543,
    referenceDate: '2026-03-06',
    expenseRatio: 0.002,
  },
  HODL: {
    ticker: 'HODL',
    name: 'VanEck Bitcoin Trust',
    issuer: 'VanEck',
    btcPerShare: 0.000283,
    referenceDate: '2026-03-05',
    expenseRatio: 0.002,
    expenseWaivedUntil: '2026-07-31',
  },
  BTC: {
    ticker: 'BTC',
    name: 'Grayscale Bitcoin Mini Trust',
    issuer: 'Grayscale',
    btcPerShare: 0.00044241,
    referenceDate: '2026-03-06',
    expenseRatio: 0.0015,
  },
  MSBT: {
    ticker: 'MSBT',
    name: 'Morgan Stanley Bitcoin Trust',
    issuer: 'Morgan Stanley',
    btcPerShare: 0.00028667,
    referenceDate: '2026-04-08',
    expenseRatio: 0.0014,
  },
}

export const ETF_TICKERS = Object.keys(ETF_CONFIGS) as EtfTicker[]

// ─── Calculations ───────────────────────────────────────────────────────────

/**
 * Compute the current BTC-per-share for an ETF, accounting for daily expense ratio decay.
 * Formula: knownRatio * (1 - effectiveExpenseRatio / 365) ^ daysElapsed
 */
export function computeBtcPerShare(config: EtfConfig, asOfDate: Date): number {
  const refDate = new Date(config.referenceDate + 'T12:00:00Z')
  const daysElapsed = Math.floor((asOfDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))

  if (daysElapsed <= 0) return config.btcPerShare

  const effectiveRate = getEffectiveExpenseRate(config, asOfDate)
  const dailyDecay = 1 - effectiveRate / 365
  return config.btcPerShare * Math.pow(dailyDecay, daysElapsed)
}

/**
 * Compute total BTC sats for a holding (shares * btcPerShare).
 */
export function computeHoldingBtcSats(config: EtfConfig, shares: number, asOfDate: Date): bigint {
  const btcPerShare = computeBtcPerShare(config, asOfDate)
  const btcAmount = shares * btcPerShare
  return BigInt(Math.round(btcAmount * 1e8))
}

/**
 * Get the effective annual expense rate, accounting for fee waivers.
 * HODL has a 0% effective rate until its waiver expiry.
 */
function getEffectiveExpenseRate(config: EtfConfig, asOfDate: Date): number {
  if (config.expenseWaivedUntil) {
    const waiverEnd = new Date(config.expenseWaivedUntil + 'T23:59:59Z')
    if (asOfDate <= waiverEnd) return 0
  }
  return config.expenseRatio
}
