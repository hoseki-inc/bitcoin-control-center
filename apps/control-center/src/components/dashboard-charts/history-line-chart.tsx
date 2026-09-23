import { Box, Flex, Text, useToken } from '@chakra-ui/react'
import { Line, LineChart, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from 'recharts'

interface HistoryLineChartProps {
  data: Array<{ time: number; value: number }>
  formatValue: (value: number) => string
  formatTime: (time: number) => string
  loading?: boolean
}

/** Static history with pointer and keyboard inspection, shared by price history and the sample portfolio. */
export function HistoryLineChart({
  data,
  formatValue,
  formatTime,
  loading = false,
}: HistoryLineChartProps): JSX.Element {
  const [axisColor, lineColor] = useToken('colors', ['chart.axis', 'chart.price'])
  if (loading || data.length === 0) {
    return (
      <Flex h="full" align="center" justify="center" px={5}>
        <Text textStyle="text/sm" color="text.secondary" role="status">
          {loading ? 'Loading history…' : 'Price history is temporarily unavailable'}
        </Text>
      </Flex>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }} accessibilityLayer>
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={formatTime}
          axisLine={false}
          tickLine={false}
          minTickGap={48}
          tick={{ fill: axisColor }}
        />
        <YAxis
          orientation="right"
          domain={['auto', 'auto']}
          tickFormatter={formatValue}
          width={96}
          axisLine={false}
          tickLine={false}
          tick={{ fill: axisColor }}
        />
        <Tooltip
          isAnimationActive={false}
          content={(props: TooltipContentProps) => {
            const point = props.payload?.[0]?.payload as { time: number; value: number } | undefined
            if (!props.active || !point) return null
            return (
              <Box bg="surface.inverse" color="text.inverse" borderRadius="control" px={3} py={2}>
                <Text textStyle="text/xs">{formatTime(point.time)}</Text>
                <Text textStyle="text/sm" fontWeight="medium">
                  {formatValue(point.value)}
                </Text>
              </Box>
            )
          }}
        />
        <Line
          dataKey="value"
          type="linear"
          stroke={lineColor}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
