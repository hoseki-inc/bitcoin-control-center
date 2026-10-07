import { Box, Flex, Text, useToken } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Line, LineChart, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from 'recharts'
import { z } from 'zod'

const HistoryPointSchema = z.object({ time: z.number(), value: z.number() })

interface HistoryLineChartProps {
  data: Array<{ time: number; value: number }>
  formatValue: (value: number) => string
  formatTime: (time: number) => string
  loading?: boolean
  /** Shown when there is no data to draw. */
  emptyMessage?: string
  /** Fixed chart size; omit to fill the parent through Recharts' ResponsiveContainer. */
  size?: { width: number; height: number }
}

/** Static history with pointer and keyboard inspection. */
export function HistoryLineChart({
  data,
  formatValue,
  formatTime,
  loading = false,
  emptyMessage = 'Price history is temporarily unavailable',
  size,
}: HistoryLineChartProps): JSX.Element {
  const [axisColor, lineColor] = useToken('colors', ['neutral.600', 'warning.600'])
  if (loading || data.length === 0) {
    return (
      <Flex h="full" align="center" justify="center" px={5}>
        <Text as="output" textStyle="text/sm" color="neutral.600">
          {loading ? 'Loading history…' : emptyMessage}
        </Text>
      </Flex>
    )
  }
  const chart = (
    <LineChart
      data={data}
      width={size?.width}
      height={size?.height}
      margin={{ top: 12, right: 16, bottom: 8, left: 8 }}
      accessibilityLayer
    >
      <XAxis
        dataKey="time"
        type="number"
        domain={['dataMin', 'dataMax']}
        tickFormatter={formatTime}
        axisLine={false}
        tickLine={false}
        minTickGap={48}
        // Keep the last date label clear of the price labels on the right.
        padding={{ right: 28 }}
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
          const point = parseUnknown(HistoryPointSchema, props.payload[0]?.payload).unwrapOr(null)
          if (!props.active || point === null) {
            return null
          }
          return (
            <Box bg="neutral.900" color="white" borderRadius="control" px={3} py={2}>
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
  )
  if (size) {
    return chart
  }
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      {chart}
    </ResponsiveContainer>
  )
}
