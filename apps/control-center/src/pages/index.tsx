import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { BalanceSkeleton, FiatValue, HoldingsRecovery, HoldingsStatus } from '../components/balance-status'
import { BitcoinAmount } from '../components/bitcoin-amount'
import { AccumulationChart as DefaultAccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { withCurrentBalancePoint } from '../components/dashboard-charts/balance-history'
import { BitcoinPriceChart as DefaultBitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { DashboardAmount } from '../components/dashboard/dashboard-typography'
import { RecentStatements } from '../components/dashboard/recent-statements'
import { StatMini } from '../components/dashboard/stat-mini'
import { StatementsEmptyState } from '../components/statements/statements-empty-state'
import { type HoldingsData, useHoldings } from '../hooks/use-holdings'
import { refetchWhileGenerating } from '../lib/statement-polling'
import { type RouterOutput, trpc } from '../trpc'
import type { StatementDto } from '../trpc/server-types'
import { getBrowserTimezone } from '../utils/timezone'

type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']

export function HomePage({
  dataSource = homeDataSource,
  views = homeViews,
}: {
  dataSource?: HomeDataSource
  views?: HomeViews
}): JSX.Element {
  const {
    statements,
    portfolio,
    hasAccounts,
    accountCount,
    isLoading,
    hasError,
    historyError,
    retry,
    statementsLoading,
    statementsError,
    holdings,
  } = useHomeData(dataSource)
  const hasHistory = (portfolio?.historicalData.length ?? 0) > 0

  return (
    <Stack py={8} gap={8}>
      <HoldingsRecovery holdings={holdings} retry={holdings.retry} />
      {historyError && (
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
              Balance history unavailable
            </Text>
            <Text textStyle="text/sm" color="neutral.600" mt={1}>
              {hasHistory
                ? 'Showing previously loaded history. Try again to refresh it.'
                : 'Try again to load your balance history.'}
            </Text>
          </Box>
          <Button variant="outline" onClick={retry}>
            Try Again
          </Button>
        </Flex>
      )}
      {hasHistory || hasAccounts ? (
        <PortfolioSummary data={portfolio} holdings={holdings} accountCount={accountCount} views={views} />
      ) : isLoading ? (
        <DashboardPreview loading />
      ) : hasError ? (
        <DashboardPreview unavailable />
      ) : (
        <DashboardPreview />
      )}
      <views.BitcoinPriceChart />
      {statementsError ? (
        <Flex justify="space-between" gap={4} align="center" flexWrap="wrap">
          <Text as="output" textStyle="text/sm" color="neutral.600">
            Recent statements could not be loaded.
          </Text>
          <Button as={Link} to="/statements" variant="ghost">
            View Statements
          </Button>
        </Flex>
      ) : statementsLoading ? (
        <Text as="output" textStyle="text/sm" color="neutral.600">
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

function PortfolioSummary({
  data,
  accountCount,
  holdings,
  views: { AccumulationChart },
}: {
  data: PortfolioData | undefined
  holdings: HoldingsData
  accountCount: number | null
  views: HomeViews
}): JSX.Element {
  const userTimezone = getBrowserTimezone()

  const { summary, price } = holdings
  const currentSats = summary.knownCount > 0 || summary.complete ? summary.knownTotalSats : null
  const totalBtc = currentSats === null ? null : new Decimal(currentSats).div(100_000_000)
  const availableHistory = data?.historicalData ?? []
  const historyIncomplete = !summary.complete || data?.balanceStatus.complete === false
  const historicalData =
    availableHistory.length > 0 && !historyIncomplete && !summary.stale && !summary.updating && currentSats !== null
      ? withCurrentBalancePoint(
          availableHistory,
          currentSats,
          new Date(summary.oldestBalanceAt ?? Date.now()),
          userTimezone,
        )
      : availableHistory
  const startSats = historicalData[0]?.totalBalance
  const change30dBtc =
    !historyIncomplete && currentSats !== null && startSats !== undefined
      ? new Decimal(currentSats).minus(startSats).div(100_000_000)
      : null
  const isUp = change30dBtc === null || change30dBtc.gte(0)
  const hasBalance = totalBtc === null || totalBtc.gt(0)

  return (
    <Box bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 5, md: 6 }}>
      {/* Top row: balance + portfolio link */}
      <Flex align="flex-start" justify="space-between" mb={6} gap={4} flexWrap="wrap">
        <Box>
          <Box aria-label="Current Bitcoin balance">
            {!summary.complete && summary.knownCount > 0 && (
              <Text textStyle="text/sm" color="neutral.500">
                Known balance
              </Text>
            )}
            <DashboardAmount>
              {summary.loading ? <BalanceSkeleton /> : totalBtc === null ? '— BTC' : <BitcoinAmount btc={totalBtc} />}
            </DashboardAmount>
          </Box>
          <FiatValue
            sats={currentSats}
            price={price}
            mt={1}
            textStyle={{ base: 'text/xl', md: 'text/2xl' }}
            color="neutral.600"
          />
          <Box mt={2}>
            <HoldingsStatus summary={summary} />
          </Box>
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
        {historyIncomplete && (
          <Text textStyle="text/sm" color="neutral.600" mb={2}>
            Showing available history; some account balances are unknown.
          </Text>
        )}
        <Box as="figure" aria-label="Bitcoin balance, last 30 days">
          <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
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
        <StatMini label="30d Change" value={change30dBtc} btcPrice={price.value} />
        <StatMini label="Accounts" count={accountCount} />
      </Grid>
    </Box>
  )
}

interface HomeQuery<T> {
  data?: T
  isLoading: boolean
  isError: boolean
  refetch: () => Promise<{ isError: boolean }>
}

type AccountList = readonly unknown[]

/** The queries behind the home overview, independent of their transport. */
export interface HomeDataSource {
  useHoldings: () => HoldingsData
  useStatements: () => HomeQuery<StatementDto[]>
  usePortfolio: (input: { timeRange: '30d'; timezone: string }) => HomeQuery<PortfolioData>
  useClaims: () => HomeQuery<AccountList>
  useExchanges: () => HomeQuery<AccountList>
  useManual: () => HomeQuery<AccountList>
  useEtfs: () => HomeQuery<AccountList>
}

const homeDataSource: HomeDataSource = {
  useHoldings,
  useStatements: () => trpc.portalProve.statement.list.useQuery(undefined, { refetchInterval: refetchWhileGenerating }),
  usePortfolio: (input) => trpc.portalProve.controlCenter.getData.useQuery(input),
  useClaims: () => trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
  useExchanges: () => trpc.portalProve.exchange.list.useQuery(),
  useManual: () => trpc.portalProve.manual.list.useQuery(),
  useEtfs: () => trpc.portalProve.etf.list.useQuery(),
}

export interface HomeViews {
  AccumulationChart: typeof DefaultAccumulationChart
  BitcoinPriceChart: typeof DefaultBitcoinPriceChart
}

const homeViews: HomeViews = {
  AccumulationChart: DefaultAccumulationChart,
  BitcoinPriceChart: DefaultBitcoinPriceChart,
}

interface HomeData {
  holdings: HoldingsData
  statements: StatementDto[]
  portfolio: PortfolioData | undefined
  hasAccounts: boolean
  /** Null until every account list has loaded without an error. */
  accountCount: number | null
  statementsLoading: boolean
  statementsError: boolean
  isLoading: boolean
  hasError: boolean
  historyError: boolean
  retry: () => void
}

function useHomeData(dataSource: HomeDataSource): HomeData {
  const holdings = dataSource.useHoldings()
  const statements = dataSource.useStatements()
  const portfolio = dataSource.usePortfolio({
    timeRange: '30d',
    timezone: getBrowserTimezone(),
  })
  const claims = dataSource.useClaims()
  const exchanges = dataSource.useExchanges()
  const manual = dataSource.useManual()
  const etfs = dataSource.useEtfs()
  const accountLists = [claims, exchanges, manual, etfs]
  const queries = [portfolio, ...accountLists]
  const totalAccounts = accountLists.reduce((count, list) => count + (list.data?.length ?? 0), 0)
  const listsReady = accountLists.every((list) => list.data !== undefined && !list.isError)

  return {
    holdings,
    statements: statements.data ?? [],
    statementsLoading: statements.isLoading,
    // A failed refresh keeps the statements already loaded; this is only for having none to show.
    statementsError: statements.isError && statements.data === undefined,
    accountCount: listsReady ? totalAccounts : null,
    portfolio: portfolio.data,
    hasAccounts: totalAccounts > 0,
    isLoading: queries.some((query) => query.isLoading) || holdings.summary.loading || holdings.listsLoading,
    historyError: portfolio.isError,
    hasError: queries.some((query) => query.isError) || holdings.listsFailed || holdings.wallets.balancesFailed,
    retry: () => {
      holdings.retry()
      for (const query of queries) {
        void query.refetch()
      }
      if (statements.isError) {
        void statements.refetch()
      }
    },
  }
}
