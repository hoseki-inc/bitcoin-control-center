import { Box, Flex, Text, usePrefersReducedMotion, useToken } from '@chakra-ui/react'
import { TZDate } from '@date-fns/tz'
import { parseUnknown } from '@hoseki/packages/result'
import { format } from 'date-fns'
import Decimal from 'decimal.js'
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  type XAxisTickContentProps,
  YAxis,
} from 'recharts'
import { z } from 'zod'
import { getBrowserTimezone } from '../../utils/timezone'
import { BitcoinAmount } from '../bitcoin-amount'
import {
  type BalanceDataPoint,
  formatAxisBtc,
  formatAxisDate,
  getAxisDecimals,
  getBalanceAxis,
} from './balance-history'

interface AccumulationChartProps {
  data: BalanceDataPoint[]
  hasActivity?: boolean
  isUp?: boolean
  timezone?: string
  /** "month" shows the first date as a month and year, as for all-time history. */
  startLabel?: 'day' | 'month'
}

function ChartTooltip({
  active,
  payload,
  timezone = getBrowserTimezone(),
}: TooltipContentProps & { timezone?: string }): JSX.Element | null {
  if (!active || payload.length === 0) {
    return null
  }

  const parsed = parseUnknown(
    z.object({
      timestamp: z.string(),
      totalBalance: z.string(),
    }),
    payload[0]?.payload,
  )
  if (parsed.isErr()) {
    return null
  }
  const data = parsed.unwrap()

  return (
    <Box bg="neutral.900" borderRadius="10px" px={3.5} py={2.5} shadow="lg">
      <Text textStyle="text/xs" color="neutral.300" mb={1}>
        {format(new TZDate(new Date(data.timestamp), timezone), 'MMMM d, yyyy')}
      </Text>
      <Text
        textStyle="text/sm"
        fontWeight="medium"
        color="shades.0"
        fontFamily="body"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <>
          <BitcoinAmount btc={new Decimal(data.totalBalance).div(100_000_000)} />
        </>
      </Text>
    </Box>
  )
}

export function AccumulationChart({
  data,
  hasActivity = true,
  isUp = true,
  timezone = getBrowserTimezone(),
  startLabel = 'day',
}: AccumulationChartProps): JSX.Element {
  // Ease into new values when the range or selection changes.
  const animate = !usePrefersReducedMotion({ ssr: false })
  const [axisColor] = useToken('colors', ['neutral.600'])
  const [success500, error500, neutral400] = useToken('colors', ['success.500', 'error.500', 'neutral.400'])

  const chartData = useMemo(
    () =>
      data
        .map((point) => {
          const timestampMs = new Date(point.timestamp).getTime()

          return {
            ...point,
            timestampMs,
            btcBalance: new Decimal(point.totalBalance).div(100_000_000).toNumber(),
          }
        })
        .filter((point) => Number.isFinite(point.timestampMs)),
    [data],
  )

  if (chartData.length === 0) {
    return (
      <Flex h="220px" align="center" justify="center" direction="column" gap={2} px={6} textAlign="center">
        <Text textStyle="text/md" fontWeight="medium" color="neutral.900">
          No history for this range
        </Text>
        <Text textStyle="text/sm" color="neutral.600">
          Try a different date range or allow your accounts to finish syncing.
        </Text>
      </Flex>
    )
  }

  const { ticks, domain } = getBalanceAxis(chartData.map((d) => d.btcBalance))
  const axisDecimals = getAxisDecimals(ticks)

  const firstMs = chartData[0]?.timestampMs ?? 0
  const lastMs = chartData[chartData.length - 1]?.timestampMs ?? firstMs
  const edgeTicks = firstMs === lastMs ? [firstMs] : [firstMs, lastMs]

  const strokeColor = !hasActivity ? neutral400 : isUp ? success500 : error500
  const gradientId = isUp ? 'accGradientUp' : 'accGradientDown'

  return (
    <Box h="220px" w="100%">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          aria-label="Bitcoin balance history"
          data={chartData}
          margin={{ top: 16, right: 12, left: 12, bottom: 4 }}
        >
          <defs>
            <linearGradient id="accGradientUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={success500} stopOpacity={0.15} />
              <stop offset="95%" stopColor={success500} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="accGradientDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={error500} stopOpacity={0.15} />
              <stop offset="95%" stopColor={error500} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestampMs"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            axisLine={false}
            tickLine={false}
            // Only the first and last dates, anchored inside the chart edges.
            ticks={edgeTicks}
            interval={0}
            tick={({ x, y, payload }: XAxisTickContentProps) => (
              <text
                x={x}
                y={y}
                dy={16}
                fontSize={12}
                fontWeight={500}
                fill={axisColor}
                textAnchor={
                  edgeTicks.length === 1 ? 'middle' : Number(payload.value) === edgeTicks[0] ? 'start' : 'end'
                }
              >
                {formatAxisDate(
                  Number(payload.value),
                  timezone,
                  Number(payload.value) === edgeTicks[0] ? startLabel : 'day',
                )}
              </text>
            )}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: axisColor, fontWeight: 500 }}
            tickFormatter={(btc: number) => formatAxisBtc(btc, axisDecimals)}
            width="auto"
          />
          <Tooltip
            isAnimationActive={animate}
            content={(tooltipProps) => <ChartTooltip {...tooltipProps} timezone={timezone} />}
            cursor={{ stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          <Area
            isAnimationActive={animate}
            type="monotone"
            dataKey="btcBalance"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={chartData.length === 1 ? { r: 3, fill: strokeColor } : false}
            activeDot={{ r: 4, stroke: strokeColor, strokeWidth: 2, fill: '#fff' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  )
}
