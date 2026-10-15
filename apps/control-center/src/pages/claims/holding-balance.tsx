import { Box, Flex, Stack, Text, keyframes } from '@chakra-ui/react'

export interface HoldingBalance {
  sats: number | null
  updatedAt: number | null
  state: 'current' | 'loading' | 'updating' | 'stale' | 'waiting' | 'unavailable'
  context?: string
}

export interface HoldingPrice {
  value: number | null
  lastKnown: boolean
  asOf: Date | null
}

interface HoldingBalanceProps {
  balance: HoldingBalance
  price: HoldingPrice
  totalSats: number | null
}

const shimmer = keyframes`
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
`

/** A short, quiet shimmer; a slow or failed connection never animates indefinitely. */
export function BalanceSkeleton(): JSX.Element {
  return (
    <Box
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

export function balanceAsOf(timestamp: number | null): string {
  return timestamp === null
    ? 'Update time unavailable'
    : `As of ${new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

interface FiatValueProps {
  sats: number
  price: HoldingPrice
}

export function FiatValue({ sats, price }: FiatValueProps): JSX.Element {
  return (
    <Text
      textStyle="text/sm"
      fontWeight="medium"
      color={price.value === null || price.lastKnown ? 'neutral.500' : 'success.600'}
      title={
        price.lastKnown && price.asOf !== null ? `Price ${balanceAsOf(price.asOf.getTime()).toLowerCase()}` : undefined
      }
    >
      {price.value === null
        ? 'USD price unavailable'
        : `$${((sats / 100_000_000) * price.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${price.lastKnown ? ' · Last known price' : ''}`}
    </Text>
  )
}

export function AccountBalance({ balance, price, totalSats }: HoldingBalanceProps): JSX.Element {
  const { sats, state } = balance
  const percentage = sats !== null && totalSats !== null ? (totalSats > 0 ? (sats / totalSats) * 100 : 0) : null
  const status =
    state === 'updating'
      ? 'Updating…'
      : state === 'stale'
        ? 'Last known balance'
        : state === 'loading'
          ? 'Fetching balance…'
          : state === 'waiting'
            ? 'Waiting for balance'
            : state === 'unavailable'
              ? 'Balance unavailable'
              : null

  return (
    <>
      <Stack gap={0} mx={4} mt={1} minH="104px" align="center" justify="flex-start" aria-live="polite">
        {sats !== null ? (
          <>
            <Text fontFamily="mono" textStyle="text/lg" fontWeight="bold" color="neutral.900" letterSpacing="-0.02em">
              {(sats / 100_000_000).toFixed(8)} BTC
            </Text>
            <FiatValue sats={sats} price={price} />
          </>
        ) : state === 'loading' ? (
          <Stack align="center" gap={1} h="48px" justify="center">
            <BalanceSkeleton />
            <Box h="12px" w="72px" bg="neutral.50" borderRadius="3px" aria-hidden="true" />
          </Stack>
        ) : (
          <Text
            fontFamily="mono"
            textStyle="text/lg"
            fontWeight="bold"
            color="neutral.400"
            aria-label="BTC balance unknown"
          >
            — BTC
          </Text>
        )}
        <Text
          textStyle="label/xs"
          color={state === 'stale' || state === 'unavailable' ? 'warning.700' : 'neutral.500'}
          mt={1}
        >
          {status ??
            (balance.updatedAt === null && balance.context !== undefined
              ? balance.context
              : balanceAsOf(balance.updatedAt))}
        </Text>
        {status !== null && sats !== null && (
          <Text textStyle="label/xs" color="neutral.500">
            {balanceAsOf(balance.updatedAt)}
          </Text>
        )}
        {sats === null && balance.context !== undefined && (
          <Text textStyle="label/xs" color="neutral.500">
            {balance.context}
          </Text>
        )}
      </Stack>
      <Flex
        align="center"
        gap={2.5}
        mx={4}
        mt={1}
        title={percentage === null ? 'Allocation needs all account balances' : undefined}
      >
        <Box flex={1} h="3px" bg="neutral.50" borderRadius="2px" overflow="hidden" aria-hidden="true">
          {percentage !== null && (
            <Box h="100%" w={`${percentage}%`} bg="neutral.900" borderRadius="2px" opacity={0.2} />
          )}
        </Box>
        <Text
          textStyle="label/xs"
          color="neutral.500"
          fontFamily="mono"
          whiteSpace="nowrap"
          aria-label={percentage === null ? 'Allocation unavailable' : undefined}
        >
          {percentage === null ? '—' : `${percentage.toFixed(1)}%`}
        </Text>
      </Flex>
    </>
  )
}
