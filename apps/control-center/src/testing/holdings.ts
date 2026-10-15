import Decimal from 'decimal.js'
import type { HoldingsData } from '../hooks/use-holdings'
import { type HoldingsAccounts, buildHoldings } from '../lib/holdings'

interface HoldingsFixtureOptions {
  sats?: string
  price?: string
  loading?: boolean
  unavailable?: boolean
}

/** A confirmed manual holding for overview layout tests; transport cases use the real hooks. */
export function holdingsFixture({
  sats = '0',
  price = '50000',
  loading = false,
  unavailable = false,
}: HoldingsFixtureOptions = {}): HoldingsData {
  const accounts: HoldingsAccounts = {
    claimsQuery: { data: [], isLoading: false },
    exchangeAccountsQuery: { data: [], isLoading: false },
    manualAccountsQuery: {
      data:
        unavailable || loading
          ? undefined
          : [
              {
                id: 'overview',
                displayName: 'Savings',
                balance: sats,
                balanceAsOf: '2026-09-01T00:00:00Z',
                createdAt: '2026-09-01T00:00:00Z',
                currency: 'BTC',
              },
            ],
      isLoading: loading,
      isError: unavailable,
    },
    etfAccountsQuery: { data: [], isLoading: false },
    btcPriceQuery: {
      data: { value: new Decimal(price), asOf: new Date('2026-09-01T00:00:00Z'), source: 'block', lastKnown: false },
      isLoading: false,
    },
  }
  const wallets = { data: new Map(), balancesFailed: false, balancesFetching: false, updatedAt: 0 }
  return {
    ...buildHoldings({
      accounts,
      wallets,
      stored: [],
      exchanges: { isRefreshing: false, previousBalanceTimes: new Map(), hasSettled: false, failed: false },
    }),
    accounts,
    wallets,
    retry: () => undefined,
  }
}
