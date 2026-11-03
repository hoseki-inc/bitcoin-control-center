import { Box, Button, Flex, Grid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { SkeletonRegion } from '@hoseki/packages/ui/design-system'
import { StatusBadge } from '@hoseki/packages/ui/prove-verify-ui'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import type { RouterOutput } from '../../trpc'
import { InvestmentIcon } from '../claims/account-type-media'
import { DashboardCardTitle } from '../dashboard/dashboard-typography'
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
  compact = false,
}: {
  query: InvestmentListQuery
  bitcoinUsd?: number | null
  showCombined?: boolean
  /** Keep the Bitcoin charts primary on Home and Portfolio; cards belong on Accounts. */
  compact?: boolean
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
        <Skeleton h="20px" w="200px" mb={3} />
        <Skeleton h="28px" w="150px" />
      </SkeletonRegion>
    )
  }
  if (query.data === undefined || query.data.length === 0) {
    return null
  }
  const totalCents = query.data.reduce((total, account) => total.plus(account.valueCents), new Decimal(0))
  const oldestDate = query.data.reduce(
    (oldest, account) => (account.valuedAt < oldest ? account.valuedAt : oldest),
    query.data[0]?.valuedAt ?? '',
  )
  const bitcoinValueKnown = bitcoinUsd != null && Number.isFinite(bitcoinUsd) && bitcoinUsd >= 0
  return (
    <Stack
      bg="shades.0"
      p={{ base: 5, md: 6 }}
      spacing={5}
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
    >
      <Flex align="flex-start" justify="space-between" gap={4} flexWrap="wrap">
        <Box minW={0}>
          <DashboardCardTitle>Other Bitcoin Investments</DashboardCardTitle>
          <Text textStyle="text/sm" color="neutral.600" mt={1}>
            Manually updated · {query.data.length} {query.data.length === 1 ? 'account' : 'accounts'}
          </Text>
        </Box>
        {compact && (
          <Button as={Link} to="/accounts" variant="outline" size="sm" flexShrink={0}>
            View Accounts
          </Button>
        )}
      </Flex>
      <Grid templateColumns={{ base: '1fr', sm: showCombined ? '1fr 1fr' : '1fr' }} gap={5}>
        <Box minW={0}>
          <Text textStyle="text/sm" color="neutral.600" mb={1}>
            Investment Value
          </Text>
          <Text
            textStyle="text/2xl"
            fontWeight="medium"
            color="neutral.900"
            overflowWrap="anywhere"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatInvestmentValue(totalCents.toFixed(0))}
            <Text as="span" textStyle="text/sm" color="neutral.500" ml={1}>
              {' '}
              USD
            </Text>
          </Text>
          <Text textStyle="text/xs" color="neutral.500" mt={1}>
            Oldest valuation: {formatValuationDate(oldestDate)}
          </Text>
        </Box>
        {showCombined && (
          <Box minW={0}>
            <Text textStyle="text/sm" color="neutral.600" mb={1}>
              Combined Portfolio Value (USD)
            </Text>
            {bitcoinValueKnown ? (
              <Text
                textStyle="text/2xl"
                fontWeight="medium"
                color="neutral.900"
                overflowWrap="anywhere"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatInvestmentValue(totalCents.plus(new Decimal(bitcoinUsd).mul(100)).toFixed(0))}
              </Text>
            ) : (
              <Text textStyle="text/sm" color="neutral.500">
                Unavailable until Bitcoin holdings can be valued
              </Text>
            )}
            <Text textStyle="text/xs" color="neutral.500" mt={1}>
              Bitcoin holdings + reported investments
            </Text>
          </Box>
        )}
      </Grid>
      {!compact && (
        <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }} gap={4}>
          {query.data.map((account) => (
            <Stack
              as={Link}
              to={`/accounts/investments/${account.id}`}
              key={account.id}
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
              <Text
                textStyle="label/md"
                fontWeight="medium"
                color="neutral.600"
                mx={4}
                isTruncated
                title={account.displayName}
              >
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
          ))}
        </Grid>
      )}
      <Text textStyle="text/xs" color="neutral.500">
        Latest reported investment values are excluded from BTC balances and accumulation.
      </Text>
    </Stack>
  )
}
