import { Box, Button, Flex, Text } from '@chakra-ui/react'
import { trpc } from '../../trpc'
import { HistoryLineChart } from '../dashboard-charts/history-line-chart'
import { formatValuationDate } from './value'

/** Only reported investment values are charted; gaps retain each account's last known valuation. */
export function InvestmentHistoryChart(): JSX.Element {
  const query = trpc.portalProve.investments.history.useQuery()
  if (query.isError) {
    return (
      <Flex h="full" align="center" justify="center" direction="column" gap={2}>
        <Text textStyle="text/sm" color="neutral.600">
          Investment history is unavailable.
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void query.refetch()
          }}
        >
          Try Again
        </Button>
      </Flex>
    )
  }
  const points = (query.data ?? []).map((point) => ({
    time: new Date(`${point.valuedAt}T12:00:00Z`).getTime(),
    value: Number(point.valueCents) / 100,
  }))
  return (
    <Box as="figure" aria-label="Reported investment value history in USD" m={0} minW={0}>
      <Text as="figcaption" textStyle="text/xs" color="neutral.500" mb={2}>
        Reported value history · USD
      </Text>
      <Box h="140px">
        <HistoryLineChart
          data={points}
          loading={query.isLoading}
          ticks={points.map((point) => point.time)}
          showPoints
          startAtZero
          lineType="stepAfter"
          lineColor="success.500"
          formatValue={(value) =>
            value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
          }
          formatTime={(time) => formatValuationDate(new Date(time).toISOString().slice(0, 10))}
          emptyMessage="Add a valuation to see your investment history."
        />
      </Box>
    </Box>
  )
}
