import { Box, Image, type StackProps, Text, forwardRef } from '@chakra-ui/react'
import type Decimal from 'decimal.js'
import { HOSEKI_ASSETS_CDN_URLS } from '../../constants'
import { formatUsd } from '../utils'

export type Currency = 'USDC' | 'USDT' | 'ETH' | 'BTC'

export type AssetCardProps = {
  currency: Currency
  balance: Decimal
  usdBalance: Decimal
  onClick?: () => void
} & StackProps

export const AssetCard = forwardRef<AssetCardProps, 'div'>(
  ({ currency, balance, usdBalance, onClick, ...props }, ref) => {
    return (
      <Box
        textAlign="center"
        borderWidth="1px"
        borderRadius="md"
        borderColor="border.subtle"
        p={4}
        bg="surface.raised"
        transition="all 0.2s"
        cursor={onClick ? 'pointer' : undefined}
        _hover={
          onClick
            ? {
                borderColor: 'primary.600',
                bg: 'primary.50',
              }
            : undefined
        }
        onClick={onClick}
        ref={ref}
        {...props}
      >
        <Image src={HOSEKI_ASSETS_CDN_URLS.COIN_LOGOS[currency]} alt={currency} boxSize="32px" mx="auto" />

        <Text mt={2} textStyle="label/md" fontWeight="medium" color="text.secondary">
          {currency}
        </Text>
        <Text mt={1} textStyle="label/md" fontWeight="medium" color="text.primary">
          {new Intl.NumberFormat('en-US').format(balance.toNumber())}
        </Text>
        <Text textStyle="label/md" fontWeight="medium" color="status.success.fg">
          {formatUsd(usdBalance)}
        </Text>
      </Box>
    )
  },
)
