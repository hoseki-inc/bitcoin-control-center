import { Box, Flex, Text, VisuallyHidden } from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WalletBalanceState } from '../../lib/wallet-balances'

/**
 * How current the balances above it are: "Synced", "Updating balances", or "Last synced 5 minutes
 * ago" while a wallet can't be reached. Portfolio also reports its history through it.
 */
export function SyncIndicator({
  walletBalanceState,
  walletBalancesAsOf,
  historySyncingCount = 0,
  isPending = false,
  hasError = false,
}: {
  walletBalanceState: WalletBalanceState
  /** While Electrum is unreachable, when the oldest wallet balance shown was current. */
  walletBalancesAsOf: Date | null
  historySyncingCount?: number
  /** The history for a newly chosen range is still loading. */
  isPending?: boolean
  /** The history couldn't be loaded. */
  hasError?: boolean
}): JSX.Element | null {
  const [, setClockTick] = useState(0)
  // A range that loads quickly neither flashes nor announces "Updating history": "Synced",
  // or no status, stays until the load has taken a moment. Any other status gives way at once.
  const [showsPending, setShowsPending] = useState(isPending)
  const wasSettled = useRef(!isPending)
  useEffect(() => {
    if (!isPending) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setShowsPending(true)
    }, 400)
    return () => {
      window.clearTimeout(timeoutId)
      setShowsPending(false)
    }
  }, [isPending])
  const asOfMs = walletBalancesAsOf?.getTime() ?? null
  // A clock behind the server's must not read as a sync in the future. Fixed once per
  // sync time, so the time read to screen readers doesn't change.
  const shownAsOfMs = useMemo(() => (asOfMs === null ? null : Math.min(asOfMs, Date.now())), [asOfMs])
  useEffect(() => {
    if (asOfMs === null) {
      return
    }
    // Keep "X ago" current between data updates.
    const intervalId = window.setInterval(() => {
      setClockTick((tick) => tick + 1)
    }, 30_000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [asOfMs])

  const isUpdating =
    walletBalanceState === 'loading' || historySyncingCount > 0 || (isPending && (showsPending || !wasSettled.current))
  const isSettled = shownAsOfMs === null && !hasError && !isUpdating
  useEffect(() => {
    wasSettled.current = isSettled
  })

  // First, as it qualifies the balance itself; an alert covers any history error.
  if (shownAsOfMs !== null) {
    return (
      <Flex align="center" gap={1.5}>
        <Box w="6px" h="6px" borderRadius="full" bg="warning.400" aria-hidden="true" />
        <Text textStyle="text/sm" color="warning.700">
          Last synced {/* The relative time keeps changing; a fixed time is read instead, so it isn't re-announced. */}
          <span aria-hidden="true">{formatDistanceToNowStrict(shownAsOfMs, { addSuffix: true })}</span>
          <VisuallyHidden>{format(shownAsOfMs, 'PPp')}</VisuallyHidden>
        </Text>
      </Flex>
    )
  }
  if (hasError) {
    return (
      <Text textStyle="text/sm" color="error.700">
        History unavailable
      </Text>
    )
  }
  if (isUpdating) {
    return (
      <Flex align="center" gap={1.5}>
        <Spinner label="" size="xs" color="neutral.400" />
        <Text textStyle="text/sm" color="neutral.500">
          {walletBalanceState === 'loading' ? 'Updating balances' : 'Updating history'}
        </Text>
      </Flex>
    )
  }
  // Balances that are unknown or can't be fetched are never "Synced", even with no time to show.
  if (walletBalanceState !== 'current') {
    return null
  }

  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg="success.500" aria-hidden="true" />
      <Text textStyle="text/sm" color="neutral.500">
        Synced
      </Text>
    </Flex>
  )
}
