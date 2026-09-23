import { Box, Flex, Text, useToken } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BitcoinAmount } from '../bitcoin-amount'
import { SensitiveValue } from '../sensitive-value'
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
  if (!active || !payload?.[0]) return null
  const { change, label } = payload[0].payload
  const isPositive = change >= 0

  return (
    <Box bg="surface.inverse" borderRadius="8px" px={3} py={2} shadow="lg">
      <Text textStyle="text/xs" color="text.disabled" mb={1}>
        {label}
      </Text>
      <Text
        textStyle="text/sm"
        fontWeight="medium"
        fontFamily="body"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
        color={change === 0 ? 'text.inverse' : isPositive ? 'status.success.fg' : 'status.error.fg'}
      >
        {formatAmount ? (
          formatAmount(change)
        ) : (
          <SensitiveValue>
            {change > 0 ? '+' : ''}
            <BitcoinAmount btc={change.toFixed(8)} />
          </SensitiveValue>
        )}
      </Text>
    </Box>
  )
}

export function MonthlyNetChangeChart({ data, timezone, formatAmount }: MonthlyNetChangeChartProps): JSX.Element {
  const [success500, error500, axisColor, baselineColor] = useToken('colors', [
    'chart.positive',
    'chart.negative',
    'chart.axis',
    'chart.grid',
  ])

  const monthlyChanges = useMemo(() => getMonthlyChanges(data, 6, timezone), [data, timezone])

  if (monthlyChanges.length === 0) {
    return (
      <Flex h="120px" align="center" justify="center">
        <Text color="text.secondary" textStyle="text/sm">
          Not enough data yet
        </Text>
      </Flex>
    )
  }

  return (
    <Box w="100%">
      {monthlyChanges.every((month) => month.change === 0) && (
        <Text textStyle="text/sm" color="text.secondary" mb={3}>
          No net change in this date range.
        </Text>
      )}
      <Box h="120px">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthlyChanges} margin={{ top: 0, right: 4, left: 4, bottom: 0 }}>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
              dy={4}
            />
            <YAxis
              hide
              domain={[(minimum: number) => Math.min(0, minimum), (maximum: number) => Math.max(0, maximum)]}
            />
            <ReferenceLine y={0} stroke={baselineColor} />
            <Tooltip content={<BarTooltip formatAmount={formatAmount} />} cursor={false} />
            <Bar isAnimationActive={false} dataKey="change" radius={[4, 4, 0, 0]} maxBarSize={36}>
              {monthlyChanges.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={entry.change >= 0 ? success500 : error500}
                  stroke={entry.change >= 0 ? success500 : error500}
                  strokeOpacity={entry.change >= 0 ? 0.4 : 0.35}
                  strokeWidth={1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  )
}
