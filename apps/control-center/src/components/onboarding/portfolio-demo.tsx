import { Box, Button, Flex, Grid, Text } from '@chakra-ui/react'
import { useMemo, useState } from 'react'
import { getMonthlyChanges } from '../dashboard-charts/balance-history'
import { HistoryLineChart } from '../dashboard-charts/history-line-chart'
import { MonthlyNetChangeChart } from '../dashboard-charts/monthly-net-change-chart'
import { FiatAmountText } from '../fiat-amount-text'

const DAY = 86400
const SAMPLE_PRICE = 80000
const ranges = [30, 90, 365] as const
const btc = (value: number): string => `${value.toFixed(4)} BTC`
const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dateLabel = (time: number): string =>
  new Date(time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Fictional holdings, generated from deposits and withdrawals rather than market-price movements. */
export function PortfolioDemo(): JSX.Element {
  const [days, setDays] = useState<(typeof ranges)[number]>(90)
  const [end] = useState(() => Math.floor(Date.now() / 1000))
  const fullHistory = useMemo(
    () =>
      Array.from({ length: 366 }, (_, day) => {
        const balance =
          120_000_000 +
          Math.floor(day / 30) * 5_000_000 +
          Math.floor(day / 7) * 1_000_000 -
          Math.floor(day / 90) * 20_000_000
        return {
          time: end - (365 - day) * DAY,
          value: balance / 100_000_000,
        }
      }),
    [end],
  )
  const history = fullHistory.slice(-(days + 1))
  const first = history[0]?.value ?? 0
  const total = history[history.length - 1]?.value ?? 0
  const change = total - first
  const deposits = history.reduce(
    (sum, point, index) => sum + Math.max(0, point.value - (history[index - 1]?.value ?? point.value)),
    0,
  )
  const withdrawals = history.reduce(
    (sum, point, index) => sum + Math.max(0, (history[index - 1]?.value ?? point.value) - point.value),
    0,
  )

  const balanceHistory = history.map((point) => ({
    timestamp: new Date(point.time * 1000).toISOString(),
    totalBalance: String(Math.round(point.value * 100_000_000)),
  }))
  const monthlySummary = getMonthlyChanges(balanceHistory)
    .map((month) => `${month.label}: ${month.change >= 0 ? '+' : ''}${btc(month.change)}`)
    .join('; ')

  return (
    <Box as="section" aria-label="Interactive sample portfolio" minW={0}>
      <Flex
        justify="space-between"
        align="center"
        gap={3}
        flexWrap="wrap"
        pb={5}
        borderBottom="1px solid"
        borderColor="neutral.200"
      >
        <Text textStyle="text/sm" color="neutral.600">
          Sample portfolio
        </Text>
      </Flex>
      <Flex justify="space-between" align="end" gap={5} flexWrap="wrap" pt={6}>
        <Box>
          <Text textStyle="text/sm" color="neutral.600">
            Bitcoin balance
          </Text>
          <Text
            textStyle={{ base: 'amount/compact', sm: 'amount/primary' }}
            fontWeight="medium"
            mt={1}
            aria-live="polite"
            aria-atomic="true"
          >
            {btc(total)}
          </Text>
          <FiatAmountText primary mt={1}>
            {usd(total * SAMPLE_PRICE)} USD
          </FiatAmountText>
        </Box>
        <Flex role="group" aria-label="Sample history date range" gap={1}>
          {ranges.map((range) => (
            <Button
              key={range}
              size="sm"
              variant="ghost"
              minH="44px"
              aria-pressed={range === days}
              bg={range === days ? 'neutral.100' : 'transparent'}
              onClick={() => setDays(range)}
            >
              {range === 365 ? '1Y' : `${range}D`}
            </Button>
          ))}
        </Flex>
      </Flex>
      <Text textStyle="text/sm" color={change >= 0 ? 'success.700' : 'error.700'} mt={3}>
        {change >= 0 ? '+' : ''}
        {btc(change)} ({change >= 0 ? '+' : ''}
        {first ? ((change / first) * 100).toFixed(1) : '0.0'}%)
        <Text as="span" color="neutral.600">
          {' '}
          · past {days === 365 ? 'year' : `${days} days`}
        </Text>
      </Text>
      <Box
        h={{ base: '240px', md: '300px' }}
        mt={4}
        role="img"
        aria-label={`Sample balance history, from ${btc(first)} to ${btc(total)} over ${days} days`}
      >
        <HistoryLineChart data={history} formatValue={btc} formatTime={dateLabel} />
      </Box>
      <Box as="section" aria-label={`Sample monthly net change. ${monthlySummary}`} mt={6} mb={6}>
        <Text as="h2" textStyle="text/md" fontWeight="medium">
          Monthly Net Change
        </Text>
        <Text textStyle="text/sm" color="neutral.600" mt={1} mb={5}>
          Green is an increase. Red is a decrease.
        </Text>
        <MonthlyNetChangeChart data={balanceHistory} formatAmount={btc} />
      </Box>
      <Grid
        templateColumns={{ base: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }}
        gap={{ base: 4, sm: 6 }}
        py={5}
        borderTop="1px solid"
        borderBottom="1px solid"
        borderColor="neutral.200"
      >
        {[
          ['Starting balance', btc(first)],
          ['Added', `+${btc(deposits)}`],
          ['Removed', `−${btc(withdrawals)}`],
        ].map(([label, value]) => (
          <Flex key={label} direction={{ base: 'row', sm: 'column' }} justify="space-between" gap={1} minW={0}>
            <Text textStyle="text/sm" color="neutral.600">
              {label}
            </Text>
            <Text textStyle="text/md" fontWeight="medium" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </Text>
          </Flex>
        ))}
      </Grid>
      <Text textStyle="text/xs" color="neutral.600" mt={3}>
        Illustrative balances. USD values use a sample price of $80,000 per BTC.
      </Text>
    </Box>
  )
}
