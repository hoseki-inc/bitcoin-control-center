import { useEffect, useRef } from 'react'
import { trpc } from '../trpc'

const DEBOUNCE_MS = 60_000 // Don't refresh more than once per minute

/**
 * Automatically refreshes all exchange balances when a page mounts.
 * Debounced globally so rapid navigation doesn't hammer the API.
 */
let lastRefreshAt = 0

interface ExchangeRefresh {
  isRefreshing: boolean
  previousBalanceTimes: ReadonlyMap<string, string | null>
  hasSettled: boolean
  failed: boolean
}

export function useAutoRefreshExchanges(): ExchangeRefresh {
  const utils = trpc.useUtils()
  const refreshMutation = trpc.portalProve.exchange.refreshAllBalances.useMutation({
    onMutate: async () => {
      const accounts = utils.portalProve.exchange.list.getData() ?? (await utils.portalProve.exchange.list.fetch())
      return { previousBalanceTimes: new Map(accounts.map((account) => [account.id, account.balanceAsOf])) }
    },
    onSettled: async () => {
      await Promise.all([
        utils.portalProve.exchange.list.invalidate(),
        utils.portalProve.controlCenter.getData.invalidate(),
      ])
    },
  })
  const hasTriggered = useRef(false)

  useEffect(() => {
    if (hasTriggered.current) {
      return
    }
    const now = Date.now()
    if (now - lastRefreshAt < DEBOUNCE_MS) {
      return
    }

    hasTriggered.current = true
    lastRefreshAt = now
    refreshMutation.mutate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isRefreshing: refreshMutation.isLoading,
    previousBalanceTimes: refreshMutation.context?.previousBalanceTimes ?? new Map(),
    hasSettled: refreshMutation.isSuccess || refreshMutation.isError,
    failed: refreshMutation.isError,
  }
}
