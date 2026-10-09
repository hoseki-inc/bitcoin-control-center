import { Box, Flex, Text, usePrefersReducedMotion, useToken } from '@chakra-ui/react'
import { useMemo } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatSignedUsd } from '../../lib/bitcoin-display'
import { BitcoinAmount } from '../bitcoin-amount'
import { type BalanceDataPoint, type MonthlyChange, getMonthTickLabel, getMonthlyChanges } from './balance-history'
import { chartColors } from './chart-colors'

interface MonthlyNetChangeChartProps {
  data: BalanceDataPoint[]
  timezone?: string
  /** Today's price for the muted USD line in each month's tooltip. */
  btcPrice?: number | null
}

function BarTooltip({
  active,
  payload,
  btcPrice,
}: {
  active?: boolean
  payload?: Array<{ payload: MonthlyChange }>
  btcPrice: number | null
}): JSX.Element | null {
  if (active !== true || !payload?.[0]) {
    return null
  }
  const { change, labelWithYear } = payload[0].payload
  const isPositive = change >= 0
  const usd = formatSignedUsd(change.toFixed(8), btcPrice)

  return (
    <Box bg="neutral.900" borderRadius="8px" px={3} py={2} shadow="lg">
      <Text textStyle="text/xs" color="neutral.300" mb={1}>
        {labelWithYear}
      </Text>
      <Text
        textStyle="text/sm"
        fontWeight="medium"
        fontFamily="body"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
        color={change === 0 ? 'shades.0' : isPositive ? 'success.400' : 'error.400'}
      >
        {change > 0 ? '+' : change < 0 ? '\u2212' : ''}
        <BitcoinAmount btc={Math.abs(change).toFixed(8)} />
      </Text>
      {usd !== '' && (
        <Text textStyle="text/xs" color="neutral.400" mt={0.5} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {usd}
        </Text>
      )}
    </Box>
  )
}

const BAR_RADIUS = 3

/** A month label under its bar; every month reads the same. */
function MonthTick({
  x = 0,
  y = 0,
  payload,
  months,
  color,
}: {
  x?: number | string
  y?: number | string
  payload?: { value: string; index: number }
  months: MonthlyChange[]
  color: string
}): JSX.Element | null {
  const label = getMonthTickLabel(
    months,
    months.findIndex((month) => month.key === payload?.value),
  )
  if (label === null) {
    return null
  }
  return (
    <text x={Number(x)} y={Number(y)} dy={14} textAnchor="middle" fontSize={12} fontWeight={500} fill={color}>
      {label}
    </text>
  )
}

export function MonthlyNetChangeChart({ data, timezone, btcPrice = null }: MonthlyNetChangeChartProps): JSX.Element {
  // Ease into new values when the range or selection changes.
  const animate = !usePrefersReducedMotion({ ssr: false })
  const [axisColor, baselineColor] = useToken('colors', ['neutral.500', 'neutral.200'])

  // Every month in the selected range.
  const monthlyChanges = useMemo(() => getMonthlyChanges(data, Number.POSITIVE_INFINITY, timezone), [data, timezone])

  if (monthlyChanges.length === 0) {
    return (
      <Flex h="200px" align="center" justify="center">
        <Text color="neutral.600" textStyle="text/sm">
          Not enough data yet
        </Text>
      </Flex>
    )
  }

  const isDense = monthlyChanges.length > 12
  return (
    <Box w="100%">
      {monthlyChanges.every((month) => month.change === 0) && (
        <Text textStyle="text/sm" color="neutral.600" mb={3}>
          No net change in this date range.
        </Text>
      )}
      <Box h="200px">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            aria-label="Monthly net change"
            data={monthlyChanges}
            // Wider sides when dense, as a label can be wider than the bar under it.
            margin={{ top: 4, right: isDense ? 24 : 16, left: isDense ? 24 : 16, bottom: 0 }}
            // The gap applies on both sides: bars fill half a column up to a year, then about 62%.
            barCategoryGap={isDense ? '19%' : '25%'}
          >
            <XAxis
              dataKey="key"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={<MonthTick months={monthlyChanges} color={axisColor} />}
            />
            <YAxis
              hide
              domain={[(minimum: number) => Math.min(0, minimum), (maximum: number) => Math.max(0, maximum)]}
            />
            <ReferenceLine y={0} stroke={baselineColor} />
            <Tooltip isAnimationActive={animate} content={<BarTooltip btcPrice={btcPrice} />} cursor={false} />
            {/* Recharts mirrors the radius for losses, so each bar rounds its end away from zero. */}
            <Bar isAnimationActive={animate} dataKey="change" maxBarSize={44} radius={[BAR_RADIUS, BAR_RADIUS, 0, 0]}>
              {monthlyChanges.map((month) => (
                <Cell key={month.key} fill={month.change < 0 ? chartColors.loss : chartColors.gain} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  )
}
