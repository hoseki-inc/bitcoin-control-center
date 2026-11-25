import { useEffect, useRef } from 'react'
import { trpc } from '../trpc'

const DEBOUNCE_MS = 60_000 // Don't refresh more than once per minute

export interface ExchangeRefreshSnapshotAccount {
  id: string
  balance: string | null
  connectionStatus: string
}

/**
 * Returns true if any exchange account was added, removed, changed balance, or changed
 * connectionStatus between `before` and `after` (ignoring array order and `balanceAsOf`).
 */
export function exchangeListChanged(
  before: readonly ExchangeRefreshSnapshotAccount[],
  after: readonly ExchangeRefreshSnapshotAccount[],
): boolean {
  if (before.length !== after.length) {
    return true
  }
  const beforeById = new Map(
    before.map((account) => [account.id, { balance: account.balance, connectionStatus: account.connectionStatus }]),
  )
  if (beforeById.size !== after.length) {
    return true
  }
  for (const account of after) {
    const previous = beforeById.get(account.id)
    if (previous === undefined) {
      return true
    }
    if (previous.balance !== account.balance || previous.connectionStatus !== account.connectionStatus) {
      return true
    }
  }
  return false
}

/**
 * Automatically refreshes all exchange balances when a page mounts with at least one connected
 * exchange account. Debounced globally so rapid navigation doesn't hammer the API, and invalidates
 * portfolio queries only when a balance or connection status actually changed.
 */
let lastRefreshAt = 0

export function useAutoRefreshExchanges(accounts: readonly ExchangeRefreshSnapshotAccount[] | undefined): void {
  const utils = trpc.useUtils()
  const beforeSnapshotRef = useRef<ExchangeRefreshSnapshotAccount[] | null>(null)
  const refreshMutation = trpc.portalProve.exchanges.refreshAllBalances.useMutation({
    meta: { invalidatesQueries: false },
    onSettled: () => {
      const before = beforeSnapshotRef.current
      beforeSnapshotRef.current = null
      void (async (): Promise<void> => {
        let shouldInvalidatePortfolio = true
        try {
          const after = await utils.portalProve.exchanges.list.fetch(undefined, { staleTime: 0 })
          shouldInvalidatePortfolio = before === null || exchangeListChanged(before, after)
        } catch {
          // Conservative fallback if the updated exchange list cannot be fetched.
          await utils.portalProve.exchanges.list.invalidate(undefined, { refetchType: 'none' })
          shouldInvalidatePortfolio = true
        }

        await Promise.all([
          utils.portalProve.exchanges.coinbase.list.invalidate(),
          utils.portalProve.exchanges.kraken.list.invalidate(),
          utils.portalProve.exchanges.robinhood.list.invalidate(),
          utils.portalProve.exchanges.strike.list.invalidate(),
        ])

        if (shouldInvalidatePortfolio) {
          await utils.portalProve.portfolio.invalidate()
        }
      })()
    },
  })
  const mutateRefresh = refreshMutation.mutate
  const hasTriggered = useRef(false)

  useEffect(() => {
    if (hasTriggered.current) {
      return
    }
    if (accounts === undefined || !accounts.some((account) => account.connectionStatus === 'connected')) {
      return
    }
    const now = Date.now()
    if (now - lastRefreshAt < DEBOUNCE_MS) {
      return
    }

    hasTriggered.current = true
    lastRefreshAt = now
    beforeSnapshotRef.current = accounts.map(({ id, balance, connectionStatus }) => ({
      id,
      balance,
      connectionStatus,
    }))
    mutateRefresh()
  }, [accounts, mutateRefresh])
}
