import type { SupportedHardwareWallet } from '@hoseki/packages/wallet/hardware-wallet'
import { type AccountTotals, computeAccountTotals } from '../lib/account-totals'
import { useGetBalancesPerClaimIds } from '../lib/balances'
import { trpc } from '../trpc'
import { ensureClaimStatusNotExpired } from '../utils/claim-utils'
import { needsExchangeReconnect } from '../utils/exchange-connection-status'
import { getThreshold } from '../utils/multisig-utils'
import { useAutoRefreshExchanges } from './use-auto-refresh-exchanges'

export type AccountKind = 'wallet' | 'multisig' | 'exchange' | 'manual' | 'etf'
export type AccountState = 'verified' | 'pending' | 'connected' | 'reconnect' | 'manual'

/** One account in the shape the desktop needs, whatever its source. */
export interface AccountSummary {
  id: string
  kind: AccountKind
  name: string
  /** Detail route; it opens in a sheet. */
  to: string
  /** Balance in sats, or null while unknown. */
  sats: number | null
  state: AccountState
  wallet: SupportedHardwareWallet | null
  exchange: string | null
  /** For multisig, e.g. "2 of 3". */
  quorum: string | null
}

const EXCHANGE_ROUTES = new Set(['coinbase', 'kraken', 'robinhood', 'strike'])

function quorumFor(claim: {
  account: Parameters<typeof getThreshold>[0]
  keystores: readonly unknown[]
}): string | null {
  try {
    return `${getThreshold(claim.account)} of ${claim.keystores.length}`
  } catch {
    return null
  }
}

/** Every account in the order the Accounts page lists them, with shared totals. */
export function useAccounts(): {
  accounts: AccountSummary[]
  totals: AccountTotals
  btcUsdPrice: number | null
  /** The account lists are loading. On-chain balances load separately; see `totals.hasUnknownBalance`. */
  isLoading: boolean
  isError: boolean
  retry: () => void
} {
  useAutoRefreshExchanges()
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
  const exchangeQuery = trpc.portalProve.exchange.list.useQuery()
  const manualQuery = trpc.portalProve.manual.list.useQuery()
  const etfQuery = trpc.portalProve.etf.list.useQuery()
  const priceQuery = trpc.portalProve.retrieveBitcoinPrice.useQuery()

  const claims = claimsQuery.data ?? []
  const exchangeAccounts = exchangeQuery.data ?? []
  const manualAccounts = manualQuery.data ?? []
  const etfAccounts = etfQuery.data ?? []
  const claimIds = claims.map((claim) => claim.id)
  const balances = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })
  const btcUsdPrice = priceQuery.data?.value ? Number(priceQuery.data.value) : null

  const accounts: AccountSummary[] = [
    ...claims.map((claim): AccountSummary => {
      const multisig = claim.keystores.length > 1
      const balance = balances.data.get(claim.id)
      return {
        id: claim.id,
        kind: multisig ? 'multisig' : 'wallet',
        name: claim.displayName ?? claim.officialName ?? 'Wallet',
        to: multisig && claim.status === 'pending' ? `/multisig/${claim.id}` : `/accounts/${claim.id}`,
        sats: balance ? Number(balance.current) : null,
        state: ensureClaimStatusNotExpired(claim) === 'verified' ? 'verified' : 'pending',
        wallet: claim.keystores[0]?.wallet ?? null,
        exchange: null,
        quorum: multisig ? quorumFor(claim) : null,
      }
    }),
    ...exchangeAccounts.map((account): AccountSummary => ({
      id: account.id,
      kind: 'exchange',
      name: account.displayName,
      to: `/accounts/${EXCHANGE_ROUTES.has(account.exchange) ? account.exchange : 'coinbase'}/${account.id}`,
      sats: needsExchangeReconnect(account) || account.balance === null ? null : Number(account.balance),
      state: needsExchangeReconnect(account) ? 'reconnect' : 'connected',
      wallet: null,
      exchange: account.exchange,
      quorum: null,
    })),
    ...manualAccounts.map((account): AccountSummary => ({
      id: account.id,
      kind: 'manual',
      name: account.displayName,
      to: `/accounts/manual/${account.id}`,
      sats: account.balance === null ? null : Number(account.balance),
      state: 'manual',
      wallet: null,
      exchange: null,
      quorum: null,
    })),
    ...etfAccounts.map((account): AccountSummary => ({
      id: account.id,
      kind: 'etf',
      name: account.displayName,
      to: `/accounts/etf/${account.id}`,
      sats: account.balance === null ? null : Number(account.balance),
      state: 'manual',
      wallet: null,
      exchange: null,
      quorum: null,
    })),
  ]

  const queries = [claimsQuery, exchangeQuery, manualQuery, etfQuery]
  return {
    accounts,
    totals: computeAccountTotals({
      claims,
      claimBalances: balances.data,
      exchangeAccounts,
      manualAccounts,
      etfAccounts,
      btcUsdPrice,
    }),
    btcUsdPrice,
    // Balances depend on Electrum and can take a while; never hold the account list back for them.
    isLoading: queries.some((query) => query.isLoading),
    isError: queries.some((query) => query.isError),
    retry: () => {
      for (const query of queries) void query.refetch()
    },
  }
}
