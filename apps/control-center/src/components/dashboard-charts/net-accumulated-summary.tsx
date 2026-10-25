import { Box, Flex, Text } from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system/spinner'
import type Decimal from 'decimal.js'
import { formatBitcoinNumber, formatSignedBitcoinNumber, formatSignedUsd } from '../../lib/bitcoin-display'
import { chartColors } from './chart-colors'

/** A smaller, lighter "BTC" after a large amount, scaled to it. */
export function BtcUnit(): JSX.Element {
  return (
    <Text as="span" ml="0.3em" fontSize="0.6em" fontWeight="medium" color="neutral.500" letterSpacing="0">
      BTC
    </Text>
  )
}

/** Net, average and approximate in/out for the selected range. */
export function NetAccumulatedSummary({
  ready,
  inBtc,
  outBtc,
  monthsInRange,
  btcPrice,
  caption,
  isUpdating,
  isFetching,
}: {
  ready: boolean
  inBtc: Decimal
  outBtc: Decimal
  monthsInRange: number
  btcPrice: number | null
  caption: string
  isUpdating: boolean
  isFetching: boolean
}): JSX.Element {
  const net = inBtc.minus(outBtc)
  // Over every month the range touches, matching the bars below.
  const average = net.div(Math.max(1, monthsInRange))
  const total = inBtc.plus(outBtc)
  const inShare = total.gt(0) ? inBtc.div(total).mul(100).toNumber() : 100
  return (
    <Box opacity={isUpdating ? 0.35 : 1} transition="opacity 0.2s ease" minH="72px" mb={6}>
      <Flex align="flex-start" justify="space-between" gap={4} flexWrap="wrap">
        <Box minW={0}>
          <Flex align="center" gap={2}>
            <Text as="h2" textStyle="overline/sm" fontWeight="semibold" color="neutral.500">
              Net accumulated
            </Text>
            {isFetching && <Spinner size="xs" color="neutral.300" />}
          </Flex>
          {ready && (
            <>
              <Flex align="baseline" columnGap={2.5} flexWrap="wrap" mt={1}>
                <Text
                  textStyle="amount/compact"
                  letterSpacing="-0.02em"
                  fontWeight="semibold"
                  color={net.isZero() ? 'neutral.900' : net.lt(0) ? 'error.700' : 'success.700'}
                >
                  {formatSignedBitcoinNumber(net)}
                  <BtcUnit />
                </Text>
                <Text textStyle="text/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatSignedUsd(net, btcPrice)}
                </Text>
              </Flex>
              <Text textStyle="text/sm" color="neutral.500" mt={0.5}>
                {caption}
              </Text>
            </>
          )}
        </Box>
        {ready && (
          <Box textAlign="right">
            <Text textStyle="text/xs" color="neutral.500">
              Avg / month
            </Text>
            <Text
              textStyle="text/lg"
              fontWeight="semibold"
              color="neutral.900"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatSignedBitcoinNumber(average)}
            </Text>
            <Text textStyle="label/sm" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatSignedUsd(average, btcPrice)}
            </Text>
          </Box>
        )}
      </Flex>
      {ready && outBtc.gt(0) && (
        <Box mt={5}>
          <Flex h="6px" gap="2px" aria-hidden="true">
            <Box
              w={`${inShare}%`}
              bg={chartColors.gain}
              borderRadius="full"
              transition="width 0.4s ease"
              sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
            />
            <Box flex="1" bg={chartColors.loss} borderRadius="full" />
          </Flex>
          <Flex justify="space-between" mt={2} gap={4}>
            <Box>
              <Text
                textStyle="text/md"
                fontWeight="medium"
                color={inBtc.isZero() ? 'neutral.900' : 'success.700'}
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatSignedBitcoinNumber(inBtc)} in
              </Text>
              <Text textStyle="label/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatSignedUsd(inBtc, btcPrice)}
              </Text>
            </Box>
            <Box textAlign="right">
              <Text
                textStyle="text/md"
                fontWeight="medium"
                color="error.700"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                −{formatBitcoinNumber(outBtc)} out
              </Text>
              <Text textStyle="label/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatSignedUsd(outBtc.neg(), btcPrice)}
              </Text>
            </Box>
          </Flex>
        </Box>
      )}
    </Box>
  )
}
