import { Box, Button, Flex, Text, usePrefersReducedMotion } from '@chakra-ui/react'
import { Liveline } from 'liveline'
import { trpc } from '../../trpc'
import { DashboardAmount, DashboardCardTitle } from './dashboard-typography'

const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const timeLabel = (time: number): string =>
  new Date(time * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

export function BitcoinPriceChart(): JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  const query = trpc.portalProve.retrieveBitcoinPriceHistory.useQuery(undefined, {
    staleTime: 300_000,
    refetchInterval: 300_000,
    retry: false,
  })
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
                {change.toFixed(2)}% · 7d
              </Text>
            )}
          </Flex>
        </Box>
        <Text textStyle="text/xs" color="neutral.600" bg="neutral.100" px={3} py={1} borderRadius="control">
          Last 7 days
        </Text>
      </Flex>
      <Box
        h={{ base: '210px', md: '240px' }}
        mt={4}
        role="img"
        aria-label={
          latest && first
            ? `Bitcoin market price over seven days, from ${usd(first.value)} to ${usd(latest.value)}.`
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
          window={7 * 86400}
          pulse={false}
          momentum={false}
          fill={false}
          badge={false}
          scrub={!reducedMotion}
          formatValue={usd}
          formatTime={timeLabel}
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
      >
        <Text textStyle="text/xs" color="neutral.600">
          {latest
            ? `Daily prices from CoinGecko · Updated ${timeLabel(latest.time)}`
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
