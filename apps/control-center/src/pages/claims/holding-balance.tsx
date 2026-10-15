import { Box, Flex, Stack, Text } from '@chakra-ui/react'
import { BalanceSkeleton, BalanceSync, FiatValue } from '../../components/balance-status'
import type { HoldingBalance, HoldingPrice } from '../../lib/holdings'

interface HoldingBalanceProps {
  balance: HoldingBalance
  price: HoldingPrice
  totalSats: number | null
}

export function AccountBalance({ balance, price, totalSats }: HoldingBalanceProps): JSX.Element {
  const { sats, state } = balance
  const percentage = sats !== null && totalSats !== null ? (totalSats > 0 ? (sats / totalSats) * 100 : 0) : null

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
        <Box mt={1}>
          <BalanceSync balance={balance} textStyle="label/xs" />
        </Box>
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
