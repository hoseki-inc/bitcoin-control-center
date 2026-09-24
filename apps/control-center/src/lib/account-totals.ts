import type { RouterOutput } from '../trpc'
import type { ClaimDto } from '../trpc/server-types'
import { ensureClaimStatusNotExpired } from '../utils/claim-utils'
import { isExchangeConnected, needsExchangeReconnect } from '../utils/exchange-connection-status'

export type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]
export type ManualAccountDto = RouterOutput['portalProve']['manual']['list'][number]
export type EtfAccountDto = RouterOutput['portalProve']['etf']['list'][number]

interface ClaimBalance {
  current: unknown
  usd: unknown
}

export interface AccountTotalsInput {
  claims: readonly ClaimDto[]
  /** On-chain balances by claim id; missing or null means not yet known. */
  claimBalances: ReadonlyMap<string, ClaimBalance | null> | undefined
  exchangeAccounts: readonly ExchangeAccountDto[]
  manualAccounts: readonly ManualAccountDto[]
  etfAccounts: readonly EtfAccountDto[]
  btcUsdPrice: number | null
}

export interface AccountTotals {
  totalSats: number
  totalUsd: number
  /** Some balance is unknown (loading, unavailable, or an exchange needs reconnecting). */
  hasUnknownBalance: boolean
  accountCount: number
  selfCustodyCount: number
  verifiedCount: number
  pendingCount: number
  reconnectCount: number
}

const SATS_PER_BTC = 100_000_000

function sats(balance: string | number | bigint | null | undefined): number {
  return balance === null || balance === undefined ? 0 : Number(balance)
}

/** The totals shown on the Accounts page and the desktop, computed one way for both. */
export function computeAccountTotals({
  claims,
  claimBalances,
  exchangeAccounts,
  manualAccounts,
  etfAccounts,
  btcUsdPrice,
}: AccountTotalsInput): AccountTotals {
  const connectedExchanges = exchangeAccounts.filter(isExchangeConnected)
  const claimValues = claimBalances ? [...claimBalances.values()] : []
  const claimSats = claimValues.reduce((sum, balance) => sum + (balance ? Number(balance.current) : 0), 0)
  const claimUsd = claimValues.reduce((sum, balance) => sum + (balance?.usd == null ? 0 : Number(balance.usd)), 0)

  const priced = [...connectedExchanges, ...manualAccounts, ...etfAccounts]
  const pricedSats = priced.reduce((sum, account) => sum + sats(account.balance), 0)
  const pricedUsd = btcUsdPrice === null ? 0 : (pricedSats / SATS_PER_BTC) * btcUsdPrice

  const verifiedCount = claims.filter((claim) => ensureClaimStatusNotExpired(claim) === 'verified').length

  return {
    totalSats: claimSats + pricedSats,
    totalUsd: claimUsd + pricedUsd,
    hasUnknownBalance:
      claims.some((claim) => !claimBalances?.get(claim.id)) ||
      exchangeAccounts.some(needsExchangeReconnect) ||
      [...exchangeAccounts, ...manualAccounts, ...etfAccounts].some((account) => account.balance === null),
    accountCount: claims.length + exchangeAccounts.length + manualAccounts.length + etfAccounts.length,
    selfCustodyCount: claims.length,
    verifiedCount,
    pendingCount: claims.length - verifiedCount,
    reconnectCount: exchangeAccounts.filter(needsExchangeReconnect).length,
  }
}
