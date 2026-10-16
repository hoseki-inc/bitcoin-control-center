import { useEffect, useRef, useSyncExternalStore } from 'react'
import { trpc } from '../trpc'

const DEBOUNCE_MS = 60_000
let lastRefreshAt = 0

export interface ExchangeRefresh {
  isRefreshing: boolean
  previousBalanceTimes: ReadonlyMap<string, string | null>
  hasSettled: boolean
  failed: boolean
}

// Keep a refresh's status across page navigation, including a debounced mount.
let refreshState: ExchangeRefresh = {
  isRefreshing: false,
  previousBalanceTimes: new Map(),
  hasSettled: false,
  failed: false,
}
const listeners = new Set<() => void>()
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function publish(state: ExchangeRefresh): void {
  refreshState = state
  for (const listener of listeners) {
    listener()
  }
}
function getRefreshState(): ExchangeRefresh {
  return refreshState
}

/** Refresh on mount, debounced across pages, with the same status on each page. */
export function useAutoRefreshExchanges(): ExchangeRefresh {
  const state = useSyncExternalStore(subscribe, getRefreshState, getRefreshState)
  const utils = trpc.useUtils()
  const refreshMutation = trpc.portalProve.exchange.refreshAllBalances.useMutation({
    onMutate: async () => {
      publish({ isRefreshing: true, previousBalanceTimes: new Map(), hasSettled: false, failed: false })
      const accounts = utils.portalProve.exchange.list.getData() ?? (await utils.portalProve.exchange.list.fetch())
      const previousBalanceTimes = new Map(accounts.map((account) => [account.id, account.balanceAsOf]))
      publish({ isRefreshing: true, previousBalanceTimes, hasSettled: false, failed: false })
      return { previousBalanceTimes }
    },
    onSettled: async (_data, error, _variables, context) => {
      await Promise.all([
        utils.portalProve.exchange.list.invalidate(),
        utils.portalProve.controlCenter.getData.invalidate(),
      ])
      publish({
        isRefreshing: false,
        previousBalanceTimes: context?.previousBalanceTimes ?? new Map(),
        hasSettled: true,
        failed: error !== null,
      })
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
  return state
}
