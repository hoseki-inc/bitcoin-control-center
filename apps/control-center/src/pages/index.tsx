import { Box, Button, Flex, Grid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { EmptyView, SkeletonRegion, TextSkeleton, useRevealAfterLoading } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'
import { AccumulationChart as DefaultAccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { BitcoinPriceChart as DefaultBitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { DashboardAmount } from '../components/dashboard/dashboard-typography'
import { PortfolioSummary } from '../components/dashboard/portfolio-summary'
import { RecentStatements, RecentStatementsSkeleton } from '../components/dashboard/recent-statements'
import { FiatAmountText } from '../components/fiat-amount-text'
import { FirstRunOnboarding } from '../components/onboarding/first-run-onboarding'
import { StatementsEmptyState } from '../components/statements/statements-empty-state'
import { UnavailableAlert } from '../components/unavailable-alert'
import { refetchWhileGenerating } from '../lib/statement-polling'
import {
  type WalletBalanceSummary,
  type WalletBalancesQuery,
  summarizeWalletBalances,
  useWalletBalances,
} from '../lib/wallet-balances'
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
    wallets,
    isLoading,
    hasError,
    retry,
    statementsLoading,
    statementsError,
  } = useHomeData(dataSource)
  const hasHistory = (portfolio?.historicalData.length ?? 0) > 0
  const overviewReveal = useRevealAfterLoading(isLoading)
  const statementsReveal = useRevealAfterLoading(statementsLoading)

  return (
    <Stack py={8} gap={8}>
      {hasError && (
        <UnavailableAlert
          title="Some holdings data is unavailable"
          description={
            hasHistory
              ? 'Showing the last available overview. Refresh to check for updates.'
              : 'Your balances could not be confirmed. Try again to load your holdings.'
          }
          onRetry={retry}
        />
      )}
      {hasHistory && portfolio ? (
        <Box sx={overviewReveal}>
          <PortfolioSummary
            data={portfolio}
            accountCount={accountCount}
            walletStatus={wallets.status}
            AccumulationChart={views.AccumulationChart}
          />
        </Box>
      ) : isLoading ? (
        // Shaped like the overview most people see, so it loads in place.
        <PortfolioSummarySkeleton />
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
        <RecentStatementsSkeleton />
      ) : statements.length > 0 ? (
        <Box sx={statementsReveal}>
          <RecentStatements statements={statements} />
        </Box>
      ) : (
        <StatementsEmptyState />
      )}
      <views.Onboarding accountCount={accountCount} />
    </Stack>
  )
}

/** The overview's outline while it loads: the balance, the 30-day chart and both stats. */
function PortfolioSummarySkeleton(): JSX.Element {
  return (
    <SkeletonRegion
      label="Loading your holdings…"
      bg="shades.0"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="panel"
      p={{ base: 5, md: 6 }}
    >
      <Flex align="flex-start" justify="space-between" mb={6} gap={4} flexWrap="wrap">
        <Box>
          <DashboardAmount>
            <TextSkeleton width="9ch" />
          </DashboardAmount>
          <FiatAmountText mt={1}>
            <TextSkeleton width="7ch" />
          </FiatAmountText>
        </Box>
        <Skeleton h="40px" w="148px" />
      </Flex>
      <Box mb={3}>
        <Text textStyle="text/sm" fontWeight="medium" color="neutral.600" mb={2}>
          Last 30 Days
        </Text>
        {/* A large area pulses in lighter tones, so it doesn't outweigh the figures around it. */}
        <Skeleton h="220px" startColor="neutral.50" endColor="neutral.100" />
      </Box>
      <Grid
        templateColumns={{ base: '1fr', sm: '1fr 1fr' }}
        gap={6}
        mt={6}
        pt={5}
        borderTop="1px solid"
        borderColor="neutral.200"
      >
        {['30d Change', 'Accounts'].map((label) => (
          <Box key={label}>
            <Text textStyle="text/md" color="neutral.900" fontWeight="medium" mb={2}>
              {label}
            </Text>
            <Text textStyle="text/xl">
              <TextSkeleton width="12ch" />
            </Text>
          </Box>
        ))}
      </Grid>
    </SkeletonRegion>
  )
}

interface HomeQuery<T> {
  data?: T
  isLoading: boolean
  isError: boolean
  refetch: () => Promise<{ isError: boolean }>
}

type AccountList = readonly { id: string }[]

/** The queries behind the home overview, independent of their transport. */
export interface HomeDataSource {
  useStatements: () => HomeQuery<StatementDto[]>
  usePortfolio: (input: { timeRange: '30d'; timezone: string }) => HomeQuery<PortfolioData>
  useClaims: () => HomeQuery<AccountList>
  useExchanges: () => HomeQuery<AccountList>
  useManual: () => HomeQuery<AccountList>
  useEtfs: () => HomeQuery<AccountList>
  useWalletBalances: (claimIds: string[], options: { enabled: boolean }) => WalletBalancesQuery
}

const homeDataSource: HomeDataSource = {
  useStatements: () => trpc.portalProve.statement.list.useQuery(undefined, { refetchInterval: refetchWhileGenerating }),
  usePortfolio: (input) => trpc.portalProve.controlCenter.getData.useQuery(input),
  useClaims: () => trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
  useExchanges: () => trpc.portalProve.exchange.list.useQuery(),
  useManual: () => trpc.portalProve.manual.list.useQuery(),
  useEtfs: () => trpc.portalProve.etf.list.useQuery(),
  useWalletBalances,
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
  wallets: WalletBalanceSummary
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
  const claimIds = (claims.data ?? []).map(({ id }) => id)
  const walletBalances = dataSource.useWalletBalances(claimIds, { enabled: claimIds.length > 0 })

  return {
    statements: statements.data ?? [],
    statementsLoading: statements.isLoading,
    // A failed refresh keeps the statements already loaded; this is only for having none to show.
    statementsError: statements.isError && statements.data === undefined,
    accountCount: listsReady ? totalAccounts : null,
    wallets: summarizeWalletBalances(claimIds, walletBalances.rows),
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
