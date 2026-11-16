import { Box, Flex, Grid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { SkeletonRegion } from '@hoseki/packages/ui/design-system'
import { StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import Decimal from 'decimal.js'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { RouterOutput } from '../../trpc'
import { InvestmentIcon } from '../claims/account-type-media'
import { DashboardAmount, DashboardCardTitle } from '../dashboard/dashboard-typography'
import { FiatAmountText } from '../fiat-amount-text'
import { UnavailableAlert } from '../unavailable-alert'
import { formatInvestmentValue, formatValuationDate } from './value'

export type InvestmentAccounts = RouterOutput['portalProve']['investments']['list']
export interface InvestmentListQuery {
  data?: InvestmentAccounts
  isLoading: boolean
  isError: boolean
  refetch: () => Promise<object>
}

/** USD values remain separate from every Bitcoin balance, chart and accumulation figure. */
export function InvestmentOverview({
  query,
  bitcoinUsd,
  showCombined = false,
  chart,
}: {
  query: InvestmentListQuery
  bitcoinUsd?: number | null
  showCombined?: boolean
  chart?: ReactNode
}): JSX.Element | null {
  if (query.isError) {
    return (
      <UnavailableAlert
        title="Investment values are unavailable"
        description="Your Bitcoin accounts are unaffected. Try again to load your manually recorded investments."
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  if (query.isLoading) {
    return (
      <SkeletonRegion
        label="Loading investment valuations"
        border="1px solid"
        borderColor="neutral.200"
        borderRadius="panel"
        p={{ base: 5, md: 6 }}
      >
        <Skeleton h="20px" w="200px" mb={4} />
        <Grid templateColumns={{ base: '1fr', md: '1fr 1.5fr' }} gap={6}>
          <Stack spacing={4}>
            <Skeleton h="48px" />
            <Skeleton h="48px" />
          </Stack>
          <Skeleton h="160px" />
        </Grid>
      </SkeletonRegion>
    )
  }
  if (query.data === undefined || query.data.length === 0) {
    return null
  }
  const totalCents = query.data.reduce((total, account) => total.plus(account.valueCents), new Decimal(0))
  const bitcoinValueKnown = bitcoinUsd != null && Number.isFinite(bitcoinUsd) && bitcoinUsd >= 0
  return (
    <Stack
      bg="shades.0"
      p={{ base: 5, md: 6 }}
      spacing={4}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
    >
      <DashboardCardTitle>Other Bitcoin Investments</DashboardCardTitle>
      <Grid
        templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1.5fr)' }}
        gap={{ base: 5, md: 8 }}
        alignItems="center"
      >
        <Stack spacing={4}>
          <Box minW={0}>
            <Text textStyle="text/sm" color="neutral.600" mb={1}>
              Investment Value
            </Text>
            <FiatAmountText>{formatInvestmentValue(totalCents.toFixed(0))}</FiatAmountText>
          </Box>
          {showCombined && (
            <Box minW={0}>
              <Text textStyle="text/sm" color="neutral.600" mb={1}>
                Combined Portfolio Value (USD)
              </Text>
              {bitcoinValueKnown ? (
                <DashboardAmount>
                  {formatInvestmentValue(totalCents.plus(new Decimal(bitcoinUsd).mul(100)).toFixed(0))}
                </DashboardAmount>
              ) : (
                <Text textStyle="text/sm" color="neutral.500">
                  Unavailable until Bitcoin holdings can be valued
                </Text>
              )}
            </Box>
          )}
        </Stack>
        {chart}
      </Grid>
    </Stack>
  )
}

export function InvestmentAccountCard({ account }: { account: InvestmentAccounts[number] }): JSX.Element {
  return (
    <Stack
      as={Link}
      to={`/accounts/investments/${account.id}`}
      p={2}
      pb={5}
      gap={1}
      textAlign="center"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="md"
      bg="shades.0"
      transition="all 0.2s ease"
      _hover={{ transform: 'translateY(-2px)', shadow: 'md' }}
      _focusVisible={{ boxShadow: 'outline' }}
    >
      <StatusBadge status="neutral" label="Manually updated" size="sm" ml="auto" />
      <Flex justify="center" align="center" h="30px" my={2}>
        <InvestmentIcon boxSize={7} />
      </Flex>
      <Text textStyle="label/md" fontWeight="medium" color="neutral.600" mx={4} isTruncated title={account.displayName}>
        {account.displayName}
      </Text>
      <Text
        textStyle="text/lg"
        fontWeight="semibold"
        color="neutral.900"
        mx={4}
        mt={1}
        overflowWrap="anywhere"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatInvestmentValue(account.valueCents)}
        <Text as="span" textStyle="text/sm" color="neutral.500" ml={1}>
          {' '}
          USD
        </Text>
      </Text>
      <Text textStyle="label/sm" color="neutral.500" mx={4}>
        As of {formatValuationDate(account.valuedAt)}
      </Text>
    </Stack>
  )
}
