import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { Liveline } from 'liveline'
import { useState } from 'react'
import { trpc } from '../../trpc'
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
    <Box border="1px solid" borderColor="neutral.200" borderRadius="panel" pt={{ base: 5, md: 6 }} overflow="hidden">
      <Flex px={{ base: 5, md: 6 }} justify="space-between" align="start" gap={4} flexWrap="wrap">
        <Box>
          <DashboardCardTitle>Bitcoin Price</DashboardCardTitle>
          <Flex align="baseline" gap={3} mt={1} flexWrap="wrap">
            <DashboardAmount>{latest ? usd(latest.value) : '—'}</DashboardAmount>
            {change !== null && (
              <Text textStyle="text/sm" color={change >= 0 ? 'success.700' : 'error.700'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}% · {range.label.toLowerCase()}
              </Text>
            )}
          </Flex>
        </Box>
        <Flex
          role="group"
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
              aria-label={option.description}
              aria-pressed={range.days === option.days}
              bg={range.days === option.days ? 'neutral.200' : 'transparent'}
              color={range.days === option.days ? 'neutral.900' : 'neutral.600'}
              onClick={() => setRange(option)}
            >
              {option.label}
            </Button>
          ))}
        </Flex>
      </Flex>
      <Box
        h={{ base: '210px', md: '240px' }}
        mt={4}
        role="img"
        aria-label={
          latest && first
            ? `Bitcoin market price, ${range.description.toLowerCase()}, from ${usd(first.value)} to ${usd(latest.value)}.`
            : query.isLoading
              ? 'Loading Bitcoin price history'
              : 'Bitcoin price history unavailable'
        }
      >
        <Liveline
          data={points}
          value={latest?.value ?? 0}
          loading={query.isLoading}
          emptyText="Price history is temporarily unavailable"
          theme="light"
          color="#D97706"
          window={range.days * 86400}
          pulse={false}
          momentum={false}
          fill={false}
          badge={false}
          scrub
          formatValue={usd}
          formatTime={(time) =>
            range.days === 1
              ? new Date(time * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : timeLabel(time)
          }
          padding={{ top: 12, right: 64, bottom: 32, left: 12 }}
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
        <Text textStyle="text/xs" color="neutral.600" role="status">
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
