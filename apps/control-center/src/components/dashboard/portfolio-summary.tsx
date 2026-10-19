import { Box, Button, Flex, Grid, Text } from '@chakra-ui/react'
import Decimal from 'decimal.js'
import { Link } from 'react-router'
import { getBrowserTimezone } from '../../utils/timezone'
import { BitcoinAmount } from '../bitcoin-amount'
import { AccumulationChart as DefaultAccumulationChart } from '../dashboard-charts/accumulation-chart'
import type { BalanceDataPoint } from '../dashboard-charts/balance-history'
import { FiatAmountText } from '../fiat-amount-text'
import { DashboardAmount } from './dashboard-typography'
import { StatMini } from './stat-mini'

export interface PortfolioSummaryData {
  /** Satoshis. */
  currentTotalBalance: string
  currentBtcPrice: string
  historicalData: BalanceDataPoint[]
}

/** Home's overview: the total, its last 30 days and the account count. */
export function PortfolioSummary({
  data,
  accountCount,
  AccumulationChart = DefaultAccumulationChart,
}: {
  data: PortfolioSummaryData
  accountCount: number | null
  AccumulationChart?: typeof DefaultAccumulationChart
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
        <Text textStyle="text/sm" fontWeight="medium" color="neutral.600" mb={2}>
          Last 30 Days
        </Text>
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
