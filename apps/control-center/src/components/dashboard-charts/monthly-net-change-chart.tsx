import { Box, Flex, Text, useToken } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { type BalanceDataPoint, type MonthlyChange, getMonthlyChanges } from './balance-history'

interface MonthlyNetChangeChartProps {
  data: BalanceDataPoint[]
  timezone?: string
  formatAmount?: (value: number) => string
}

function BarTooltip({
  active,
  payload,
  formatAmount,
}: {
  active?: boolean
  formatAmount?: (value: number) => string
  payload?: Array<{ payload: MonthlyChange }>
}): JSX.Element | null {
  if (active !== true || !payload?.[0]) {
    return null
  }
  const { change } = payload[0].payload
  const isPositive = change >= 0

  return (
    <Box bg="neutral.900" borderRadius="8px" px={3} py={2} shadow="lg">
      <Text textStyle="text/sm" fontWeight="bold" fontFamily="mono" color={isPositive ? 'success.400' : 'error.400'}>
        {formatAmount ? (
          formatAmount(change)
        ) : (
          <>
            {isPositive ? '+' : ''}
            {change.toFixed(8)} BTC
          </>
        )}
      </Text>
    </Box>
  )
}

export function MonthlyNetChangeChart({ data, timezone, formatAmount }: MonthlyNetChangeChartProps): JSX.Element {
  const [success500, error500] = useToken('colors', ['success.500', 'error.500'])

  const monthlyChanges = useMemo(() => getMonthlyChanges(data, 6, timezone), [data, timezone])

  if (monthlyChanges.length === 0) {
    return (
      <Flex h="120px" align="center" justify="center">
        <Text color="neutral.400" textStyle="text/sm">
          Not enough data yet
        </Text>
      </Flex>
    )
  }

  return (
    <Box h="120px" w="100%">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={monthlyChanges} margin={{ top: 0, right: 4, left: 4, bottom: 0 }}>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#aaa', fontWeight: 500 }}
            dy={4}
          />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip content={<BarTooltip formatAmount={formatAmount} />} cursor={false} />
          <Bar dataKey="absChange" radius={[4, 4, 0, 0]} maxBarSize={36}>
            {monthlyChanges.map((entry) => (
              <Cell
                key={entry.key}
                fill={entry.change >= 0 ? `${success500}26` : `${error500}1F`}
                stroke={entry.change >= 0 ? `${success500}66` : `${error500}59`}
                strokeWidth={1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}
