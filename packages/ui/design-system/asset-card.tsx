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
        position="relative"
        textAlign="center"
        borderWidth="1px"
        borderRadius="md"
        borderColor="neutral.200"
        p={4}
        bg="white"
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
        ref={ref}
        {...props}
      >
        {onClick && (
          <Box
            as="button"
            type="button"
            aria-label={`Select ${currency}`}
            position="absolute"
            inset={0}
            zIndex={1}
            borderRadius="inherit"
            _focusVisible={{ boxShadow: 'outline' }}
            onClick={onClick}
          />
        )}
        <Image src={HOSEKI_ASSETS_CDN_URLS.COIN_LOGOS[currency]} alt={currency} boxSize="32px" mx="auto" />

        <Text mt={2} textStyle="label/md" fontWeight="medium" color="neutral.600">
          {currency}
        </Text>
        <Text mt={1} textStyle="label/md" fontWeight="medium" color="neutral.900">
          {new Intl.NumberFormat('en-US').format(balance.toNumber())}
        </Text>
        <Text textStyle="label/md" fontWeight="medium" color="success.600">
          {formatUsd(usdBalance)}
        </Text>
      </Box>
    )
  },
)

AssetCard.displayName = 'AssetCard'
