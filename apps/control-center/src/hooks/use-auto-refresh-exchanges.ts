import { useEffect, useRef } from 'react'
import { trpc } from '../trpc'

const DEBOUNCE_MS = 60_000 // Don't refresh more than once per minute

/**
 * Automatically refreshes all exchange balances when a page mounts.
 * Debounced globally so rapid navigation doesn't hammer the API.
 */
let lastRefreshAt = 0

export function useAutoRefreshExchanges(): void {
  const utils = trpc.useUtils()
  const refreshMutation = trpc.portalProve.exchange.refreshAllBalances.useMutation({
    onSuccess: () => {
      void utils.portalProve.exchange.list.invalidate()
      void utils.portalProve.controlCenter.getData.invalidate()
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
}
