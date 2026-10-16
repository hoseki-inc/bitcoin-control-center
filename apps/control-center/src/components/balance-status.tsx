import { Box, Button, Flex, Text, type TextProps, VisuallyHidden, keyframes } from '@chakra-ui/react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { HoldingBalance, HoldingPrice, Holdings, HoldingsSummary } from '../lib/holdings'

const shimmer = keyframes`
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
`

/** A short shimmer; a slow connection never animates indefinitely. */
export function BalanceSkeleton(): JSX.Element {
  return (
    <Box
      as="span"
      display="inline-block"
      aria-hidden="true"
      h="24px"
      w="160px"
      maxW="100%"
      borderRadius="4px"
      bg="neutral.50"
      bgImage="linear-gradient(90deg, transparent 25%, rgba(0, 0, 0, 0.035) 50%, transparent 75%)"
      backgroundSize="200% 100%"
      animation={`${shimmer} 2s ease-in-out 3`}
      sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
    />
  )
}

interface BalanceSyncProps {
  balance: HoldingBalance
  textStyle?: TextProps['textStyle']
}

/** Portfolio's relative last-sync treatment, shared by every current balance. */
export function BalanceSync({ balance, textStyle = 'text/sm' }: BalanceSyncProps): JSX.Element {
  const [, setClock] = useState(0)
  useEffect(() => {
    if (balance.updatedAt === null) {
      return
    }
    const interval = window.setInterval(() => {
      setClock((tick) => tick + 1)
    }, 30_000)
    return () => {
      window.clearInterval(interval)
    }
  }, [balance.updatedAt])
  const hasAmount = balance.sats !== null
  const stale = balance.state === 'stale'
  const updating = balance.state === 'updating'
  const timestamp = balance.updatedAt
  const relativeTime = useMemo(() => (timestamp === null ? null : Math.min(timestamp, Date.now())), [timestamp])
  const status =
    balance.state === 'loading'
      ? 'Fetching balance…'
      : balance.state === 'waiting'
        ? 'Waiting for balance'
        : !hasAmount
          ? 'Balance unavailable'
          : updating
            ? 'Updating…'
            : stale
              ? 'Last known balance'
              : 'Synced'
  if (balance.manual === true && hasAmount) {
    return (
      <Text
        textStyle={textStyle}
        color="neutral.500"
        data-balance-state={balance.state}
        title={timestamp === null ? undefined : format(timestamp, 'PPp')}
      >
        {stale ? 'Saved balance · ' : ''}
        {timestamp === null ? 'Manually tracked' : `As of ${format(timestamp, 'PPp')}`}
      </Text>
    )
  }
  return (
    <Flex
      align="center"
      justify="inherit"
      gap={1.5}
      color={stale || (!hasAmount && balance.state === 'unavailable') ? 'warning.700' : 'neutral.500'}
      data-balance-state={balance.state}
      title={timestamp === null ? undefined : format(timestamp, 'PPp')}
    >
      {hasAmount && (
        <Box
          boxSize="6px"
          flexShrink={0}
          borderRadius="full"
          bg={stale ? 'warning.400' : updating ? 'neutral.400' : 'success.500'}
          aria-hidden="true"
        />
      )}
      <Text textStyle={textStyle}>
        {hasAmount && timestamp !== null ? (
          <>
            {updating ? 'Updating… · ' : ''}Last synced{' '}
            <span aria-hidden="true">{formatDistanceToNowStrict(relativeTime ?? timestamp, { addSuffix: true })}</span>
            <VisuallyHidden>{format(timestamp, 'PPp')}</VisuallyHidden>
          </>
        ) : (
          status
        )}
      </Text>
    </Flex>
  )
}

interface HoldingsStatusProps {
  summary: HoldingsSummary
  textStyle?: TextProps['textStyle']
}

export function HoldingsStatus({ summary, textStyle = 'text/sm' }: HoldingsStatusProps): JSX.Element {
  return (
    <Box as="output" aria-live="polite" display="block">
      {!summary.complete && (
        <Text textStyle={textStyle} color="neutral.500">
          {summary.listsLoaded
            ? `${summary.knownCount} of ${summary.accountCount} balances available`
            : `${summary.knownCount} known balance${summary.knownCount === 1 ? '' : 's'} · Account list incomplete`}{' '}
          · Allocation unavailable
        </Text>
      )}
      {(summary.complete ||
        summary.knownCount === 0 ||
        summary.oldestBalanceAt !== null ||
        summary.stale ||
        summary.updating) && (
        <BalanceSync
          textStyle={textStyle}
          balance={{
            sats: summary.knownCount > 0 || summary.complete ? summary.knownTotalSats : null,
            updatedAt: summary.oldestBalanceAt,
            state: summary.loading
              ? 'loading'
              : summary.knownCount === 0 && !summary.complete
                ? summary.waiting && !summary.unavailable
                  ? 'waiting'
                  : 'unavailable'
                : summary.updating
                  ? 'updating'
                  : summary.stale
                    ? 'stale'
                    : 'current',
          }}
        />
      )}
    </Box>
  )
}

interface FiatValueProps extends TextProps {
  sats: number | null
  price: HoldingPrice
}

export function FiatValue({ sats, price, ...props }: FiatValueProps): JSX.Element {
  return (
    <Text
      textStyle="text/sm"
      fontWeight="medium"
      color={price.value === null || price.lastKnown ? 'neutral.500' : 'success.600'}
      title={price.lastKnown && price.asOf !== null ? `Price as of ${format(price.asOf, 'PPp')}` : undefined}
      {...props}
    >
      {price.value === null
        ? 'USD price unavailable'
        : sats === null
          ? '—'
          : `$${((sats / 100_000_000) * price.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${price.lastKnown ? ' · Last known price' : ''}`}
    </Text>
  )
}

interface HoldingsRecoveryProps {
  holdings: Holdings
  retry: () => void
}

export function HoldingsRecovery({ holdings, retry }: HoldingsRecoveryProps): JSX.Element | null {
  const message = holdings.listsFailed
    ? 'Some accounts could not be refreshed. Showing available balances.'
    : holdings.walletsFailed
      ? 'Wallet balances could not be updated. Check your Electrum connection in Settings.'
      : holdings.exchangeIssue
        ? 'Some exchange balances could not be updated. Open the account to check its connection.'
        : null
  if (message === null) {
    return null
  }
  return (
    <Flex role="alert" align="center" gap={3} flexWrap="wrap">
      <Text textStyle="text/sm" color="neutral.600">
        {message}
      </Text>
      {holdings.listsFailed || holdings.walletsFailed ? (
        <Button size="sm" variant="outline" onClick={retry}>
          Retry balances
        </Button>
      ) : (
        <Button as={Link} to="/accounts" size="sm" variant="outline">
          View accounts
        </Button>
      )}
    </Flex>
  )
}
