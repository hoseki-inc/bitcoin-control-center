import { Box, Flex, Text } from '@chakra-ui/react'
import type { Decimal } from 'decimal.js'
import { BitcoinAmount } from '../bitcoin-amount'

const statValueProps = {
  fontFamily: 'body',
  textStyle: 'text/xl',
  fontWeight: 'normal',
  sx: { fontVariantNumeric: 'tabular-nums' },
} as const

/** One stat under the Home balance: a change in Bitcoin (and dollars) or an account count; null shows "—". */
export function StatMini({
  label,
  value,
  btcPrice,
  count,
}: {
  label: string
  value?: Decimal | null
  btcPrice?: number | null
  count?: number | null
}): JSX.Element {
  const usdValue = value && btcPrice != null ? value.toNumber() * btcPrice : null
  // A change too small to show in cents has no sign.
  const usdCents = usdValue === null ? 0 : Math.round(usdValue * 100)

  return (
    <Box minW={0}>
      <Text textStyle="text/md" color="neutral.900" fontWeight="medium" mb={2}>
        {label}
      </Text>
      {value === null ? (
        <Text {...statValueProps} color="neutral.900">
          —
        </Text>
      ) : value !== undefined ? (
        <Flex align="baseline" gap={2} flexWrap="wrap">
          <Text {...statValueProps} color={value.isZero() ? 'neutral.900' : value.gt(0) ? 'success.700' : 'error.700'}>
            {value.gte(0) ? '+' : '−'}
            <BitcoinAmount btc={value.abs()} />
          </Text>
          {usdValue !== null && (
            <Text {...statValueProps} color="neutral.600">
              {usdCents > 0 ? '+' : usdCents < 0 ? '−' : ''}$
              {(Math.abs(usdCents) / 100).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          )}
        </Flex>
      ) : (
        <Text {...statValueProps} color="neutral.900">
          {count === null ? '—' : count}{' '}
          <Text as="span" textStyle="text/sm" color="neutral.600">
            tracked
          </Text>
        </Text>
      )}
    </Box>
  )
}
