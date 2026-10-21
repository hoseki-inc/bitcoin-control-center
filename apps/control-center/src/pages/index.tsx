import { Box, Button, Flex, Grid, Skeleton, Stack, Text } from '@chakra-ui/react'
import { EmptyView, SkeletonRegion, TextSkeleton, useRevealAfterLoading } from '@hoseki/packages/ui/design-system'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { BitcoinAmount } from '../components/bitcoin-amount'
import { AccumulationChart as DefaultAccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { BitcoinPriceChart as DefaultBitcoinPriceChart } from '../components/dashboard/bitcoin-price-chart'
import { DashboardPreview } from '../components/dashboard/dashboard-preview'
import { DashboardAmount } from '../components/dashboard/dashboard-typography'
import { RecentStatements, RecentStatementsSkeleton } from '../components/dashboard/recent-statements'
import { StatMini } from '../components/dashboard/stat-mini'
import { FiatAmountText } from '../components/fiat-amount-text'
import { StatementsEmptyState } from '../components/statements/statements-empty-state'
import { UnavailableAlert } from '../components/unavailable-alert'
import { SyncIndicator } from '../components/wallet-balances/sync-indicator'
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
          <PortfolioSummary data={portfolio} accountCount={accountCount} wallets={wallets} views={views} />
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
    </Stack>
  )
}

function PortfolioSummary({
  data,
  accountCount,
  wallets,
  views: { AccumulationChart },
}: {
  data: PortfolioData
  accountCount: number | null
  /** Whether the wallet balances behind the total are current, and how old they are if not. */
  wallets: WalletBalanceSummary
  views: HomeViews
}): JSX.Element {
  const userTimezone = getBrowserTimezone()

  const currentSats = data.currentTotalBalance
  const price = Number(data.currentBtcPrice)
  const btcPrice = price > 0 ? price : null
  const totalBtc = new Decimal(currentSats).div(100_000_000)
  const totalUsd = btcPrice === null ? null : totalBtc.toNumber() * btcPrice

  const historicalData = data.historicalData
  const startSats = historicalData[0]?.totalBalance ?? '0'
  const change30d = new Decimal(currentSats).minus(new Decimal(startSats))
  const change30dBtc = change30d.div(100_000_000)
  const isUp = change30d.gte(0)
  const hasBalance = totalBtc.gt(0)

  return (
    <Box bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 5, md: 6 }}>
      {/* Top row: balance + portfolio link */}
      <Flex align="flex-start" justify="space-between" mb={6} gap={4} flexWrap="wrap">
        <Box>
          <DashboardAmount>
            <BitcoinAmount btc={totalBtc} />
          </DashboardAmount>
          <FiatAmountText mt={1}>
            {totalUsd === null
              ? 'USD value unavailable'
              : totalUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </FiatAmountText>
        </Box>
        <Button as={Link} to="/portfolio" variant="outline" size="md" px={6} py={3} borderRadius="control">
          View Portfolio
        </Button>
      </Flex>

      {/* Chart */}
      <Box mb={3}>
        <Flex align="center" justify="space-between" gap={3} mb={2} flexWrap="wrap">
          <Text textStyle="text/sm" fontWeight="medium" color="neutral.600">
            Last 30 Days
          </Text>
          {/* Only while balances are updating or out of date; a quiet refresh needs no word. */}
          {wallets.state === 'loading' || wallets.state === 'stale' ? (
            // Announces when wallet balances start or stop updating.
            <Box as="output">
              <SyncIndicator walletBalanceState={wallets.state} walletBalancesAsOf={wallets.asOf} />
            </Box>
          ) : null}
        </Flex>
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
        <StatMini label="30d Change" value={change30dBtc} btcPrice={btcPrice} />
        <StatMini label="Accounts" count={accountCount} />
      </Grid>
    </Box>
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
}

const homeViews: HomeViews = {
  AccumulationChart: DefaultAccumulationChart,
  BitcoinPriceChart: DefaultBitcoinPriceChart,
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
