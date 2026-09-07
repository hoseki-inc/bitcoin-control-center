import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { EmptyView } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { BitcoinAmount } from '../components/bitcoin-amount'
import { AccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { BitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { DashboardAmount, DashboardCardTitle } from '../components/dashboard/dashboard-typography'
import { RecentStatements } from '../components/dashboard/recent-statements'
import { SensitiveValue } from '../components/sensitive-value'
import { StatementsEmptyState } from '../components/statements/statements-empty-state'
import { useQueryErrorToast } from '../hooks/use-query-error-toast'
import { type RouterOutput, trpc } from '../trpc'
import type { StatementDto } from '../trpc/server-types'
import { queryErrorMessage } from '../utils/query-error-message'
import { getBrowserTimezone } from '../utils/timezone'

type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']

export function HomePage(): JSX.Element {
  const {
    statements,
    portfolio,
    hasAccounts,
    accountCount,
    isLoading,
    hasError,
    errorMessage,
    retry,
    statementsLoading,
    statementsError,
  } = useDashboardData()
  useQueryErrorToast(hasError ? errorMessage : null, retry)
  const hasHistory = (portfolio?.historicalData.length ?? 0) > 0

  return (
    <Stack py={{ base: 6, md: 8 }} gap={8}>
      <PageHeading title="Home" description="Your holdings at a glance." />
      {hasError && (
        <Flex
          role="alert"
          align="start"
          justify="space-between"
          gap={4}
          p={4}
          bg="neutral.50"
          borderRadius="control"
          flexWrap="wrap"
        >
          <Box flex="1" minW="200px">
            <Text textStyle="text/sm" fontWeight="medium">
              Some holdings data is unavailable
            </Text>
            <Text textStyle="text/sm" color="neutral.600" mt={1}>
              {hasHistory
                ? 'Showing the last available overview. Refresh to check for updates.'
                : 'Your balances could not be confirmed. Try again to load your holdings.'}
            </Text>
          </Box>
          <Button variant="outline" onClick={retry}>
            Try Again
          </Button>
        </Flex>
      )}
      {hasHistory && portfolio ? (
        <PortfolioSummary data={portfolio} accountCount={hasError ? null : accountCount} />
      ) : isLoading ? (
        <DashboardPreview loading />
      ) : hasError ? (
        <DashboardPreview unavailable />
      ) : !hasAccounts ? (
        <DashboardPreview />
      ) : (
        <EmptyView
          border="1px solid"
          borderColor="neutral.200"
          borderRadius="panel"
          title="Your history will appear here"
          description="View your accounts to check their connection and verification status."
          action={
            <Button as={Link} to="/accounts">
              View Accounts
            </Button>
          }
        />
      )}
      <BitcoinPriceChart />
      {statementsError ? (
        <Flex role="status" justify="space-between" gap={4} align="center" flexWrap="wrap">
          <Text textStyle="text/sm" color="neutral.600">
            Recent statements could not be loaded.
          </Text>
          <Button as={Link} to="/statements" variant="ghost">
            View Statements
          </Button>
        </Flex>
      ) : statementsLoading ? (
        <Text role="status" textStyle="text/sm" color="neutral.600">
          Loading recent statements…
        </Text>
      ) : statements.length > 0 ? (
        <RecentStatements statements={statements} />
      ) : (
        <StatementsEmptyState />
      )}
    </Stack>
  )
}

function PortfolioSummary({ data, accountCount }: { data: PortfolioData; accountCount: number | null }): JSX.Element {
  const userTimezone = getBrowserTimezone()

  const currentSats = data.currentTotalBalance?.toString() ?? '0'
  const btcPrice = data.currentBtcPrice && Number(data.currentBtcPrice) > 0 ? Number(data.currentBtcPrice) : null
  const totalBtc = new Decimal(currentSats).div(100_000_000)
  const totalUsd = btcPrice === null ? null : totalBtc.toNumber() * btcPrice

  const historicalData = data.historicalData ?? []
  const startSats = historicalData.length > 0 ? historicalData[0]?.totalBalance ?? '0' : '0'
  const change30d = new Decimal(currentSats).minus(new Decimal(startSats))
  const change30dBtc = change30d.div(100_000_000)
  const isUp = change30d.gte(0)
  const hasBalance = totalBtc.gt(0)

  return (
    <Box bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 4, md: 6 }}>
      {/* Top row: balance + generate button */}
      <Flex align="flex-start" justify="space-between" mb={6} gap={4} flexWrap="wrap">
        <Box>
          <DashboardCardTitle>Total Bitcoin</DashboardCardTitle>
          <Box mt={1}>
            <DashboardAmount primary>
              <SensitiveValue>
                <BitcoinAmount btc={totalBtc} />
              </SensitiveValue>
            </DashboardAmount>
          </Box>
          <Text textStyle="text/sm" color="neutral.600" mt={1}>
            <SensitiveValue>
              {totalUsd === null
                ? 'USD value unavailable'
                : totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
            </SensitiveValue>
          </Text>
        </Box>
        <Button as={Link} to="/portfolio" variant="outline" size="md" px={6} py={3} borderRadius="control">
          View Portfolio
        </Button>
      </Flex>

      {/* Chart */}
      <Box mb={3}>
        <Text textStyle="text/sm" fontWeight="medium" color="neutral.600" mb={2}>
          Last 30 Days
        </Text>
        <Box position="relative" overflow="hidden">
          <SensitiveValue>
            <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
          </SensitiveValue>
        </Box>
      </Box>

      {/* Stats */}
      <Grid
        templateColumns={{ base: '1fr', sm: '1fr 1fr' }}
        gap={6}
        mt={6}
        pt={5}
        borderTop="1px solid"
        borderColor="neutral.200"
      >
        <StatMini label="30d Change" value={change30dBtc} btcPrice={btcPrice} />
        <StatMini label="Accounts" count={accountCount} />
      </Grid>
    </Box>
  )
}

const statValueProps = {
  fontFamily: 'body',
  textStyle: 'text/xl',
  fontWeight: 'normal',
  sx: { fontVariantNumeric: 'tabular-nums' },
} as const

function StatMini({
  label,
  value,
  btcPrice,
  count,
}: {
  label: string
  value?: Decimal
  btcPrice?: number | null
  count?: number | null
}): JSX.Element {
  const isPositive = value ? value.gte(0) : true
  const usdValue = value && btcPrice ? value.toNumber() * btcPrice : null

  return (
    <Box minW={0}>
      <Text textStyle="text/md" color="neutral.900" fontWeight="medium" mb={2}>
        {label}
      </Text>
      {value !== undefined ? (
        <Flex align="baseline" gap={2} flexWrap="wrap">
          <Text {...statValueProps} color={value.isZero() ? 'neutral.900' : isPositive ? 'success.700' : 'error.700'}>
            <SensitiveValue>
              {isPositive ? '+' : ''}
              <BitcoinAmount btc={value.toFixed(8)} />
            </SensitiveValue>
          </Text>
          {usdValue !== null && (
            <Text {...statValueProps} color="neutral.600">
              <SensitiveValue>
                {usdValue >= 0 ? '+' : '−'}$
                {Math.abs(usdValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </SensitiveValue>
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

function useDashboardData(): {
  statements: StatementDto[]
  portfolio: PortfolioData | undefined
  hasAccounts: boolean
  accountCount: number
  statementsLoading: boolean
  statementsError: boolean
  isLoading: boolean
  hasError: boolean
  errorMessage: string
  retry: () => void
} {
  const statements = trpc.portalProve.statement.list.useQuery()
  const portfolio = trpc.portalProve.controlCenter.getData.useQuery({
    timeRange: '30d',
    timezone: getBrowserTimezone(),
  })
  const claims = trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
  const exchanges = trpc.portalProve.exchange.list.useQuery()
  const manual = trpc.portalProve.manual.list.useQuery()
  const etfs = trpc.portalProve.etf.list.useQuery()
  const queries = [portfolio, claims, exchanges, manual, etfs]

  return {
    statements: statements.data ?? [],
    statementsLoading: statements.isLoading,
    statementsError: statements.isError,
    accountCount: [claims.data, exchanges.data, manual.data, etfs.data].reduce(
      (count, accounts) => count + (accounts?.length ?? 0),
      0,
    ),
    portfolio: portfolio.data,
    hasAccounts: [claims.data, exchanges.data, manual.data, etfs.data].some((accounts) => (accounts?.length ?? 0) > 0),
    isLoading: queries.some((query) => query.isLoading),
    hasError: queries.some((query) => query.isError),
    errorMessage: queryErrorMessage(
      queries.find((query) => query.isError)?.error,
      "Your overview couldn't be loaded. Try again to see your holdings and statements.",
    ),
    retry: () => {
      for (const query of queries) void query.refetch()
    },
  }
}
