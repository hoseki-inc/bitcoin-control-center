import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { trpc } from '../../trpc'
import { HistoryLineChart } from '../dashboard-charts/history-line-chart'
import { DashboardAmount, DashboardCardTitle } from './dashboard-typography'

const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const timeLabel = (time: number): string =>
  new Date(time * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

const PRICE_RANGES = [
  { label: '24H', days: 1, description: 'Last 24 hours' },
  { label: '7D', days: 7, description: 'Last 7 days' },
  { label: '30D', days: 30, description: 'Last 30 days' },
  { label: '6M', days: 180, description: 'Last 6 months' },
  { label: '1Y', days: 365, description: 'Last year' },
] as const

type PriceRange = (typeof PRICE_RANGES)[number]

export function BitcoinPriceChart(): JSX.Element {
  const [range, setRange] = useState<PriceRange>(PRICE_RANGES[1])
  const query = trpc.portalProve.retrieveBitcoinPriceHistory.useQuery(
    { days: range.days },
    {
      staleTime: 300_000,
      refetchInterval: 300_000,
      retry: false,
    },
  )
  const points = query.data ?? []
  const latest = points[points.length - 1]
  const first = points[0]
  const change = latest && first ? ((latest.value - first.value) / first.value) * 100 : null

  return (
    <Box layerStyle="edge" borderRadius="panel" pt={{ base: 5, md: 6 }} overflow="hidden">
      <Flex px={{ base: 5, md: 6 }} justify="space-between" align="start" gap={4} flexWrap="wrap">
        <Box>
          <DashboardCardTitle>Bitcoin Price</DashboardCardTitle>
          <Flex align="baseline" gap={3} mt={1} flexWrap="wrap">
            <DashboardAmount>{latest ? usd(latest.value) : '—'}</DashboardAmount>
            {change !== null && (
              <Text textStyle="text/sm" color={change >= 0 ? 'status.success.fg' : 'status.error.fg'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}% · {range.label.toLowerCase()}
              </Text>
            )}
          </Flex>
        </Box>
        <Flex
          as="fieldset"
          border="none"
          m={0}
          minW={0}
          aria-label="Bitcoin price time range"
          gap={1}
          flexWrap="wrap"
          bg="surface.subtle"
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
              aria-label={option.description}
              aria-pressed={range.days === option.days}
              bg={range.days === option.days ? 'surface.emphasis' : 'transparent'}
              color={range.days === option.days ? 'text.primary' : 'text.secondary'}
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
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A drawn chart has no native element; role=img carries its summary.
        role="img"
        aria-label={
          latest && first
            ? `Bitcoin market price, ${range.description.toLowerCase()}, from ${usd(first.value)} to ${usd(latest.value)}.`
            : query.isLoading
              ? 'Loading Bitcoin price history'
              : 'Bitcoin price history unavailable'
        }
      >
        <HistoryLineChart
          data={points}
          loading={query.isLoading}
          formatValue={usd}
          formatTime={(time) =>
            range.days === 1
              ? new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : timeLabel(time)
          }
        />
      </Box>
      <Flex
        borderTop="1px solid"
        borderColor="border.subtle"
        px={{ base: 5, md: 6 }}
        py={3}
        justify="space-between"
        align="center"
        gap={3}
        flexWrap="wrap"
      >
        <Text as="output" display="block" textStyle="text/xs" color="text.secondary">
          {latest
            ? `${range.days === 1 ? 'Intraday' : range.days <= 30 ? 'Hourly' : 'Daily'} prices from CoinGecko · Updated ${new Date(latest.time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
            : query.isLoading
              ? 'Loading Bitcoin prices…'
              : 'Could not load market data.'}
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
