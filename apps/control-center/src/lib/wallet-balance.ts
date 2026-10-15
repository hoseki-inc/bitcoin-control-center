import type { BalanceValue } from '@hoseki/packages/lib/balance'
import Decimal from 'decimal.js'

interface StoredBalance {
  balanceSats: string
  timestamp: string
}

interface WalletBalanceInput {
  live: BalanceValue | null
  updatedAt: number
  balancesFailed: boolean
  stored?: StoredBalance
}

interface WalletBalance {
  balance: BalanceValue | null
  updatedAt: number | null
  fromStorage: boolean
}

/** Use Sentinel's snapshot while loading, or the newer known balance after a failed refresh. */
export function resolveWalletBalance({ live, updatedAt, balancesFailed, stored }: WalletBalanceInput): WalletBalance {
  const storedAt = stored === undefined ? Number.NaN : Date.parse(stored.timestamp)
  if (live !== null && (!balancesFailed || !(storedAt > updatedAt))) {
    return { balance: live, updatedAt: updatedAt > 0 ? updatedAt : null, fromStorage: false }
  }
  if (stored !== undefined) {
    return {
      balance: { current: new Decimal(stored.balanceSats), usd: null },
      updatedAt: Number.isFinite(storedAt) ? storedAt : null,
      fromStorage: true,
    }
  }
  return { balance: null, updatedAt: null, fromStorage: false }
}
