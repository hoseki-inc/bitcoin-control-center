import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react'
import { EmptyView } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'
import { AccumulationChart as DefaultAccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { BitcoinPriceChart as DefaultBitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { PortfolioSummary } from '../components/dashboard/portfolio-summary'
import { RecentStatements } from '../components/dashboard/recent-statements'
import { FirstRunOnboarding } from '../components/onboarding/first-run-onboarding'
import { StatementsEmptyState } from '../components/statements/statements-empty-state'
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
    retry,
    statementsLoading,
    statementsError,
  } = useHomeData(dataSource)
  const hasHistory = (portfolio?.historicalData.length ?? 0) > 0

  return (
    <Stack py={8} gap={8}>
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
        <PortfolioSummary data={portfolio} accountCount={accountCount} AccumulationChart={views.AccumulationChart} />
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
      <views.Onboarding accountCount={accountCount} />
    </Stack>
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
  useStatements: () => HomeQuery<StatementDto[]>
  usePortfolio: (input: { timeRange: '30d'; timezone: string }) => HomeQuery<PortfolioData>
  useClaims: () => HomeQuery<AccountList>
  useExchanges: () => HomeQuery<AccountList>
  useManual: () => HomeQuery<AccountList>
  useEtfs: () => HomeQuery<AccountList>
}

const homeDataSource: HomeDataSource = {
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
  Onboarding: typeof FirstRunOnboarding
}

const homeViews: HomeViews = {
  AccumulationChart: DefaultAccumulationChart,
  BitcoinPriceChart: DefaultBitcoinPriceChart,
  Onboarding: FirstRunOnboarding,
}

interface HomeData {
  statements: StatementDto[]
  portfolio: PortfolioData | undefined
  hasAccounts: boolean
  /** Null until every account list has loaded without an error. */
  accountCount: number | null
  statementsLoading: boolean
  statementsError: boolean
  isLoading: boolean
  hasError: boolean
  retry: () => void
}

function useHomeData(dataSource: HomeDataSource): HomeData {
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
    statements: statements.data ?? [],
    statementsLoading: statements.isLoading,
    // A failed refresh keeps the statements already loaded; this is only for having none to show.
    statementsError: statements.isError && statements.data === undefined,
    accountCount: listsReady ? totalAccounts : null,
    portfolio: portfolio.data,
    hasAccounts: totalAccounts > 0,
    isLoading: queries.some((query) => query.isLoading),
    hasError: queries.some((query) => query.isError),
    retry: () => {
      for (const query of queries) {
        void query.refetch()
      }
      if (statements.isError) {
        void statements.refetch()
      }
    },
  }
}
