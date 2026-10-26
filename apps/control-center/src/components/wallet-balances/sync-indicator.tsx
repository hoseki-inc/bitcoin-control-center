import { Box, Flex, Text, VisuallyHidden } from '@chakra-ui/react'
import { useDelayedFlag } from '@hoseki/packages/ui/design-system/loading/use-delayed-flag'
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WalletBalanceStatus } from '../../lib/wallet-balances'

type SyncLabel =
  | { kind: 'lastSynced'; at: Date }
  | { kind: 'unreachable' | 'historyUnavailable' | 'updatingBalances' | 'updatingHistory' | 'synced' }

/**
 * What the indicator says. A wallet that can't be reached comes first, as it qualifies the balance
 * itself; balances that are unknown (`wallets` null) are never "Synced".
 */
function syncLabel(
  wallets: WalletBalanceStatus | null,
  history: { syncing: boolean; unavailable: boolean },
): SyncLabel | null {
  if (wallets?.kind === 'lastSynced' || wallets?.kind === 'unreachable') {
    return wallets
  }
  if (history.unavailable) {
    return { kind: 'historyUnavailable' }
  }
  if (wallets?.kind === 'updating') {
    return { kind: 'updatingBalances' }
  }
  if (history.syncing) {
    return { kind: 'updatingHistory' }
  }
  return wallets?.kind === 'current' ? { kind: 'synced' } : null
}

/**
 * How current the balances beside it are, announced as it changes. Portfolio also reports its
 * history through it.
 */
export function SyncIndicator({
  wallets,
  historySyncingCount = 0,
  isPending = false,
  hasError = false,
}: {
  /** Null while an account list is missing, so the balances can't be known. */
  wallets: WalletBalanceStatus | null
  historySyncingCount?: number
  /** The history for a newly chosen range is still loading. */
  isPending?: boolean
  /** The history couldn't be loaded. */
  hasError?: boolean
}): JSX.Element {
  // A range that loads quickly neither flashes nor announces "Updating history": "Synced", or no
  // status, stays until the load has taken a moment. Any other status gives way at once.
  const pendingDelayed = useDelayedFlag(isPending, 400)
  const wasSettled = useRef(!isPending)
  const label = syncLabel(wallets, {
    syncing: historySyncingCount > 0 || (isPending && (pendingDelayed || !wasSettled.current)),
    unavailable: hasError,
  })
  useEffect(() => {
    wasSettled.current = label === null || label.kind === 'synced'
  })

  return (
    // An alert covers a history error, so it isn't announced twice.
    <Box as="output" aria-live={label?.kind === 'historyUnavailable' ? 'off' : undefined}>
      {label?.kind === 'lastSynced' ? (
        <LastSynced at={label.at} />
      ) : label?.kind === 'unreachable' ? (
        <Status dot="warning.400" color="warning.700" text="Can't reach Electrum" />
      ) : label?.kind === 'historyUnavailable' ? (
        <Text textStyle="text/sm" color="error.700">
          History unavailable
        </Text>
      ) : label?.kind === 'updatingBalances' || label?.kind === 'updatingHistory' ? (
        <Flex align="center" gap={1.5}>
          <Spinner label="" size="xs" color="neutral.400" />
          <Text textStyle="text/sm" color="neutral.500">
            {label.kind === 'updatingBalances' ? 'Updating balances' : 'Updating history'}
          </Text>
        </Flex>
      ) : label?.kind === 'synced' ? (
        <Status dot="success.500" color="neutral.500" text="Synced" />
      ) : null}
    </Box>
  )
}

function Status({ dot, color, text }: { dot: string; color: string; text: string }): JSX.Element {
  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg={dot} aria-hidden="true" />
      <Text textStyle="text/sm" color={color}>
        {text}
      </Text>
    </Flex>
  )
}

function LastSynced({ at }: { at: Date }): JSX.Element {
  const [, setClockTick] = useState(0)
  const atMs = at.getTime()
  // A clock behind the server's must not read as a sync in the future. Fixed once per sync time,
  // so the time read to screen readers doesn't change.
  const shownMs = useMemo(() => Math.min(atMs, Date.now()), [atMs])
  useEffect(() => {
    // Keep "X ago" current between data updates.
    const intervalId = window.setInterval(() => {
      setClockTick((tick) => tick + 1)
    }, 30_000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [])
  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg="warning.400" aria-hidden="true" />
      <Text textStyle="text/sm" color="warning.700">
        Last synced {/* The relative time keeps changing; a fixed time is read instead, so it isn't re-announced. */}
        <span aria-hidden="true">{formatDistanceToNowStrict(shownMs, { addSuffix: true })}</span>
        <VisuallyHidden>{format(shownMs, 'PPp')}</VisuallyHidden>
      </Text>
    </Flex>
  )
}
