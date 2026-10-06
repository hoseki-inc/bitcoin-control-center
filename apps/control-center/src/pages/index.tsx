import { Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { BitcoinAmount } from '../components/bitcoin-amount'
import { AccumulationChart } from '../components/dashboard-charts/accumulation-chart'
import { Banner } from '../components/dashboard/banner'
import { RecentStatements } from '../components/dashboard/recent-statements'
import { SensitiveValue } from '../components/sensitive-value'
import { useUiSettings } from '../hooks/use-ui-settings'
import { trpc } from '../trpc'
import type { StatementDto } from '../trpc/server-types'
import { getBrowserTimezone } from '../utils/timezone'

type DashboardData = {
  statements: StatementDto[]
  isLoading: boolean
}

export function HomePage(): JSX.Element {
  const { statements, isLoading } = useDashboardData()
  const { isStatementsMadeEasyDismissed, updateUiSettings } = useUiSettings()

  return (
    <Stack py={8} gap={8}>
      {isLoading ? (
        <Spinner fullPage size="xl" />
      ) : (
        <>
          <PortfolioSummary />
          {!isStatementsMadeEasyDismissed && (
            <Banner
              mode={statements.length > 0 ? 'compact' : 'large-with-cta'}
              onDismissClick={() => {
                updateUiSettings({ isStatementsMadeEasyDismissed: true })
              }}
            />
          )}
          <RecentStatements statements={statements} />
        </>
      )}
    </Stack>
  )
}

function PortfolioSummary(): JSX.Element | null {
  const userTimezone = getBrowserTimezone()
  const { data, isLoading, isFetching } = trpc.portalProve.controlCenter.getData.useQuery({
    timeRange: '30d',
    timezone: userTimezone,
  })

  if (isLoading || !data) {
    return null
  }

  const isChartFetching = isFetching && !isLoading

  const currentSats = data.currentTotalBalance
  const btcPrice = data.currentBtcPrice ? Number(data.currentBtcPrice) : 0
  const totalBtc = new Decimal(currentSats).div(100_000_000)
  const totalUsd = totalBtc.toNumber() * btcPrice

  const historicalData = data.historicalData
  const startSats = historicalData.length > 0 ? (historicalData[0]?.totalBalance ?? '0') : '0'
  const change30d = new Decimal(currentSats).minus(new Decimal(startSats))
  const change30dBtc = change30d.div(100_000_000)
  const isUp = change30d.gte(0)
  const hasBalance = totalBtc.gt(0)

  return (
    <Box bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="12px" p={5}>
      {/* Top row: balance + generate button */}
      <Flex align="flex-start" justify="space-between" mb={4}>
        <Box>
          <Text fontFamily="mono" textStyle="text/3xl" fontWeight="bold" color="neutral.900" letterSpacing="-0.03em">
            <BitcoinAmount btc={totalBtc} />
          </Text>
          <Text textStyle="text/sm" color="neutral.400" mt={0.5}>
            <SensitiveValue>
              ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </SensitiveValue>
          </Text>
        </Box>
        <Button
          as={Link}
          to="/statements/create"
          state={{ returnTo: '/home' }}
          size="md"
          px={6}
          py={3}
          borderRadius="8px"
        >
          Generate Statement
        </Button>
      </Flex>

      {/* Chart */}
      <Box mb={3}>
        <Text textStyle="label/xs" fontWeight="semibold" color="neutral.400" mb={2}>
          Last 30 Days
        </Text>
        <Box position="relative" overflow="hidden">
          <SensitiveValue>
            <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
          </SensitiveValue>
          {isChartFetching && (
            <Box
              position="absolute"
              inset={0}
              pointerEvents="none"
              sx={{
                background:
                  'linear-gradient(90deg, rgba(240,242,245,0) 0%, rgba(240,242,245,0.85) 50%, rgba(240,242,245,0) 100%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.4s ease-in-out infinite',
                '@keyframes shimmer': {
                  '0%': { backgroundPosition: '-200% 0' },
                  '100%': { backgroundPosition: '200% 0' },
                },
              }}
            />
          )}
        </Box>
      </Box>

      {/* Stats */}
      <Grid templateColumns="1fr 1fr" gap={3} mt={4}>
        <StatMini label="30d Change" value={change30dBtc} btcPrice={btcPrice} />
        <StatMini label="Accounts" count={data.verifiedClaimsCount + data.exchangeAccountCount} />
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
  const usdValue =
    value && btcPrice !== undefined && btcPrice !== 0 && !Number.isNaN(btcPrice) ? value.toNumber() * btcPrice : null

  return (
    <Box bg="neutral.50" borderRadius="8px" px={3.5} py={3}>
      <Text textStyle="label/xs" color="neutral.400" fontWeight="semibold" mb={1}>
        {label}
      </Text>
      {value !== undefined ? (
        <Flex align="baseline" gap={2}>
          <Text
            fontFamily="mono"
            textStyle="text/sm"
            fontWeight="bold"
            color={isPositive ? 'success.600' : 'error.500'}
          >
            <SensitiveValue>
              {isPositive ? '+' : ''}
              <BitcoinAmount btc={value} />
            </SensitiveValue>
          </Text>
          {usdValue !== null && (
            <Text textStyle="text/xs" color="neutral.400">
              <SensitiveValue>
                {usdValue >= 0 ? '+' : '−'}$
                {Math.abs(usdValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </SensitiveValue>
            </Text>
          )}
        </Flex>
      ) : (
        <Text textStyle="text/sm" fontWeight="bold" color="neutral.900">
          {count} verified
        </Text>
      )}
    </Box>
  )
}

function useDashboardData(): DashboardData {
  const { data: statements, isLoading: isLoadingStatements } = trpc.portalProve.statement.list.useQuery()
  const { isLoading: isLoadingControlCenter } = trpc.portalProve.controlCenter.getData.useQuery({
    timeRange: '30d',
    timezone: getBrowserTimezone(),
  })

  return {
    statements: statements ?? [],
    isLoading: isLoadingStatements || isLoadingControlCenter,
  }
}
