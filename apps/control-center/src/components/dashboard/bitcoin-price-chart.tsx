import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { trpc } from '../../trpc'
import { HistoryLineChart as DefaultHistoryLineChart } from '../dashboard-charts/history-line-chart'

// Home values balances in USD, so the chart matches the current price shown there.
const QUOTE_CURRENCY = 'USD'

const formatPrice = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: QUOTE_CURRENCY, maximumFractionDigits: 0 })
// Every point, including the latest, is labeled with the viewer's own date, so dates never run backward.
const dayLabel = (time: number): string =>
  new Date(time * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

// Daily quotes come from the mempool historical price API used by statements.
const PRICE_RANGES = [
  { label: '7D', days: 7, description: 'Last 7 days' },
  { label: '30D', days: 30, description: 'Last 30 days' },
  { label: '6M', days: 180, description: 'Last 6 months' },
  { label: '1Y', days: 365, description: 'Last year' },
] as const

type PriceRange = (typeof PRICE_RANGES)[number]

export interface BitcoinPriceChartViews {
  HistoryLineChart: typeof DefaultHistoryLineChart
}

const bitcoinPriceChartViews: BitcoinPriceChartViews = {
  HistoryLineChart: DefaultHistoryLineChart,
}

export function BitcoinPriceChart({ views = bitcoinPriceChartViews }: { views?: BitcoinPriceChartViews }): JSX.Element {
  const { HistoryLineChart } = views
  const [range, setRange] = useState<PriceRange>(PRICE_RANGES[0])
  const query = trpc.portalProve.retrieveBitcoinPriceHistory.useQuery(
    { days: range.days, quoteCurrency: QUOTE_CURRENCY },
    {
      staleTime: 300_000,
      refetchInterval: 300_000,
      retry: false,
    },
  )
  const history = query.data
  const daily = history?.points ?? []
  const latest = history?.latest
  const points = latest ? [...daily, { time: latest.time, value: latest.value }] : daily
  const last = points[points.length - 1]
  const first = points[0]
  const change = last && first ? ((last.value - first.value) / first.value) * 100 : null
  const unavailable = query.isError ? query.error.message : 'Price history is temporarily unavailable'

  return (
    <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" pt={{ base: 5, md: 6 }} overflow="hidden">
      <Flex px={{ base: 5, md: 6 }} justify="space-between" align="start" gap={4} flexWrap="wrap">
        <Box>
          <Text as="h2" textStyle="text/md" fontWeight="medium" color="neutral.900">
            Bitcoin Price
          </Text>
          <Flex align="baseline" gap={3} mt={1} flexWrap="wrap">
            <Text
              textStyle="text/2xl"
              overflowWrap="anywhere"
              minW={0}
              fontWeight="medium"
              color="neutral.900"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {last ? formatPrice(last.value) : '—'}
            </Text>
            {change !== null && (
              <Text textStyle="text/sm" color={change >= 0 ? 'success.700' : 'error.700'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}% · {range.label.toLowerCase()}
              </Text>
            )}
          </Flex>
        </Box>
        <Flex
          as="fieldset"
          aria-label="Bitcoin price time range"
          gap={1}
          flexWrap="wrap"
          bg="neutral.50"
          p={1}
          borderRadius="control"
        >
          {PRICE_RANGES.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant="ghost"
              minH="44px"
              px={3}
              aria-pressed={range.days === option.days}
              bg={range.days === option.days ? 'neutral.200' : 'transparent'}
              color={range.days === option.days ? 'neutral.900' : 'neutral.600'}
              onClick={() => {
                setRange(option)
              }}
            >
              {option.label}
            </Button>
          ))}
        </Flex>
      </Flex>
      <Box
        h={{ base: '210px', md: '240px' }}
        mt={4}
        as="figure"
        aria-label={
          last && first
            ? `Bitcoin market price, ${range.description.toLowerCase()}, from ${formatPrice(first.value)} to ${formatPrice(last.value)}.`
            : query.isLoading
              ? 'Loading Bitcoin price history'
              : unavailable
        }
      >
        <HistoryLineChart
          data={points}
          loading={query.isLoading}
          emptyMessage={unavailable}
          formatValue={formatPrice}
          formatTime={dayLabel}
        />
      </Box>
      <Flex
        borderTop="1px solid"
        borderColor="neutral.200"
        px={{ base: 5, md: 6 }}
        py={3}
        justify="space-between"
        align="center"
        gap={3}
        flexWrap="wrap"
      >
        <Text as="output" textStyle="text/xs" color="neutral.600">
          {history && last
            ? `Source: ${history.historySources.join(', ')}`
            : query.isLoading
              ? 'Loading Bitcoin prices…'
              : 'Price sources and fallbacks are set in Settings.'}
        </Text>
        {query.isError && (
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()} isLoading={query.isFetching}>
            Retry
          </Button>
        )}
      </Flex>
    </Box>
  )
}
