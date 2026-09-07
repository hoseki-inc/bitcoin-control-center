import { Box, Flex, Text, useToken } from '@chakra-ui/react'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import Decimal from 'decimal.js'
import { useMemo } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, type TooltipContentProps, XAxis, YAxis } from 'recharts'
import { getBrowserTimezone } from '../../utils/timezone'

interface BalanceDataPoint {
  timestamp: string
  totalBalance: string
  btcPrice?: string
}

interface AccumulationChartProps {
  data: BalanceDataPoint[]
  hasActivity?: boolean
  isUp?: boolean
  timezone?: string
}

function formatBtcBalance(satoshis: string | Decimal): string {
  return new Decimal(satoshis).div(100_000_000).toFixed(8)
}

function formatShortBtc(satoshis: string | Decimal): string {
  const btc = new Decimal(satoshis).div(100_000_000)
  return btc.gte(1) ? btc.toFixed(2) : btc.toFixed(4)
}

function formatUsd(btcAmount: number, btcPrice: number): string {
  return (btcAmount * btcPrice).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function ChartTooltip({
  active,
  payload,
  timezone = getBrowserTimezone(),
}: TooltipContentProps & { timezone?: string }): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0]?.payload as (BalanceDataPoint & { btcBalance: number }) | undefined
  if (!data) return null

  const btcPrice = data.btcPrice ? Number(data.btcPrice) : 0

  return (
    <Box bg="neutral.900" borderRadius="10px" px={3.5} py={2.5} shadow="lg">
      <Text textStyle="label/xs" color="neutral.500" mb={1}>
        {format(new TZDate(new Date(data.timestamp), timezone), 'MMMM d, yyyy')}
      </Text>
      <Text textStyle="text/sm" fontWeight="bold" color="shades.0" fontFamily="mono">
        {formatBtcBalance(data.totalBalance)} BTC
      </Text>
      {btcPrice > 0 && (
        <Text textStyle="label/xs" color="neutral.500" mt={0.5} fontFamily="mono">
          ${formatUsd(data.btcBalance, btcPrice)}
        </Text>
      )}
    </Box>
  )
}

export function AccumulationChart({
  data,
  hasActivity = true,
  isUp = true,
  timezone = getBrowserTimezone(),
}: AccumulationChartProps): JSX.Element {
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

  const values = chartData.map((d) => d.btcBalance)
  const yMin = Math.min(...values)
  const yMax = Math.max(...values)
  const yPad = (yMax - yMin) * 0.15

  const strokeColor = !hasActivity ? neutral400 : isUp ? success500 : error500
  const gradientId = isUp ? 'accGradientUp' : 'accGradientDown'

  return (
    <Box h="220px" w="100%">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
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
            tick={{ fontSize: 10, fill: '#bbb', fontWeight: 500 }}
            tickFormatter={(value: number) => format(new TZDate(new Date(value), timezone), 'MMM d')}
            minTickGap={42}
            dy={8}
          />
          <YAxis
            domain={[yMin - yPad, yMax + yPad]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: '#ccc', fontWeight: 500 }}
            tickFormatter={(v: number) => formatShortBtc(new Decimal(v).mul(100_000_000).toString())}
            width={52}
          />
          <Tooltip
            content={(tooltipProps) => <ChartTooltip {...tooltipProps} timezone={timezone} />}
            cursor={{ stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          <Area
            type="monotone"
            dataKey="btcBalance"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, stroke: strokeColor, strokeWidth: 2, fill: '#fff' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  )
}
