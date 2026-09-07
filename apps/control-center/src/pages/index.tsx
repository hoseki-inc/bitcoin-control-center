import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { EmptyView } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { BitcoinAmount } from '../components/bitcoin-amount'
import { AccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { Banner } from '../components/dashboard/banner'
import { BitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { DashboardAmount, DashboardCardTitle } from '../components/dashboard/dashboard-typography'
import { RecentStatements } from '../components/dashboard/recent-statements'
import { useQueryErrorToast } from '../hooks/use-query-error-toast'
import { useUiSettings } from '../hooks/use-ui-settings'
import { type RouterOutput, trpc } from '../trpc'
import type { StatementDto } from '../trpc/server-types'
import { queryErrorMessage } from '../utils/query-error-message'
import { getBrowserTimezone } from '../utils/timezone'

type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']

export function HomePage(): JSX.Element {
  const { statements, portfolio, hasAccounts, isLoading, hasError, errorMessage, retry } = useDashboardData()
  const { isStatementsMadeEasyDismissed, updateUiSettings } = useUiSettings()
  useQueryErrorToast(hasError ? errorMessage : null, retry)
  const hasHistory = (portfolio?.historicalData.length ?? 0) > 0

  return (
    <Stack py={8} gap={6}>
      <Flex justify="space-between" align="start" gap={4} flexWrap="wrap">
        <PageHeading title="Home" description="Your Bitcoin holdings and recent statements at a glance." />
        {hasError && (
          <Button variant="outline" onClick={retry}>
            Try Again
          </Button>
        )}
      </Flex>
      {isLoading ? (
        <DashboardPreview loading />
      ) : hasError ? (
        <DashboardPreview unavailable />
      ) : (
        <>
          {!hasAccounts && !hasHistory ? (
            <DashboardPreview />
          ) : !hasHistory ? (
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
          ) : portfolio ? (
            <PortfolioSummary data={portfolio} />
          ) : null}
          {hasAccounts && <BitcoinPriceChart />}
          {hasHistory && !isStatementsMadeEasyDismissed && (
            <Banner
              mode={statements.length > 0 ? 'compact' : 'large-with-cta'}
              onDismissClick={() => updateUiSettings({ isStatementsMadeEasyDismissed: true })}
            />
          )}
          <RecentStatements statements={statements} />
        </>
      )}
    </Stack>
  )
}

function PortfolioSummary({ data }: { data: PortfolioData }): JSX.Element {
  const userTimezone = getBrowserTimezone()

  const currentSats = data.currentTotalBalance?.toString() ?? '0'
  const btcPrice = data.currentBtcPrice ? Number(data.currentBtcPrice) : 0
  const totalBtc = new Decimal(currentSats).div(100_000_000)
  const totalUsd = totalBtc.toNumber() * btcPrice

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
            <DashboardAmount>
              <BitcoinAmount btc={totalBtc} />
            </DashboardAmount>
          </Box>
          <Text textStyle="text/sm" color="neutral.500" mt={0.5}>
            ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
        </Box>
        <Button
          as={Link}
          to="/statements/create"
          state={{ returnTo: '/home' }}
          size="md"
          px={6}
          py={3}
          borderRadius="control"
        >
          Generate Statement
        </Button>
      </Flex>

      {/* Chart */}
      <Box mb={3}>
        <Text textStyle="label/xs" fontWeight="semibold" color="neutral.500" mb={2}>
          Last 30 Days
        </Text>
        <Box position="relative" overflow="hidden">
          <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
        </Box>
      </Box>

      {/* Stats */}
      <Grid templateColumns={{ base: '1fr', sm: '1fr 1fr' }} gap={3} mt={4}>
        <StatMini label="30d Change" value={change30dBtc} btcPrice={btcPrice} />
        <StatMini label="Accounts" count={(data.verifiedClaimsCount ?? 0) + (data.exchangeAccountCount ?? 0)} />
      </Grid>
    </Box>
  )
}

function StatMini({
  label,
  value,
  btcPrice,
  count,
}: {
  label: string
  value?: Decimal
  btcPrice?: number
  count?: number
}): JSX.Element {
  const isPositive = value ? value.gte(0) : true
  const usdValue = value && btcPrice ? value.toNumber() * btcPrice : null

  return (
    <Box bg="neutral.50" borderRadius="control" px={4} py={3}>
      <Text textStyle="label/xs" color="neutral.500" fontWeight="semibold" mb={1}>
        {label}
      </Text>
      {value !== undefined ? (
        <Flex align="baseline" gap={2} flexWrap="wrap">
          <Text
            fontFamily="mono"
            textStyle="text/sm"
            fontWeight="semibold"
            color={isPositive ? 'success.600' : 'error.500'}
          >
            {isPositive ? '+' : ''}
            <BitcoinAmount btc={value.toFixed(8)} />
          </Text>
          {usdValue !== null && (
            <Text textStyle="text/xs" color="neutral.500">
              {usdValue >= 0 ? '+' : '−'}$
              {Math.abs(usdValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          )}
        </Flex>
      ) : (
        <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900">
          {count} verified
        </Text>
      )}
    </Box>
  )
}

function useDashboardData(): {
  statements: StatementDto[]
  portfolio: PortfolioData | undefined
  hasAccounts: boolean
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
  const queries = [statements, portfolio, claims, exchanges, manual, etfs]

  return {
    statements: statements.data ?? [],
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
