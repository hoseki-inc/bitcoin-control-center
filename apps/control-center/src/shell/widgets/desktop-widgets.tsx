import { Box, Flex, HStack, Text, useToken } from '@chakra-ui/react'
import { formatUsd } from '@hoseki/packages/ui/utils'
import { useId } from 'react'
import { SensitiveValue } from '../../components/sensitive-value'
import type { useAccounts } from '../../hooks/use-accounts'
import { useBitcoinDisplay } from '../../hooks/use-bitcoin-display'
import { formatBitcoin } from '../../lib/bitcoin-display'
import { trpc } from '../../trpc'
import { getBrowserTimezone } from '../../utils/timezone'
import { Widget, WidgetDetail, WidgetTrack, WidgetValue } from './widget'

const DASH = '—'

function wholeUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** What do I hold? */
export function HoldingsWidget({ accounts }: { accounts: ReturnType<typeof useAccounts> }): JSX.Element {
  const { unit } = useBitcoinDisplay()
  const { totals, isLoading, isError } = accounts
  // "₿ 0" would claim an empty wallet; when no balance is known yet, say so instead.
  const anyBalanceKnown = accounts.accounts.some((account) => account.sats !== null)
  const known = !isLoading && !isError && totals.accountCount > 0 && anyBalanceKnown
  return (
    <Widget title="Holdings" label="Portfolio" to="/portfolio">
      <WidgetValue>
        {known ? <SensitiveValue>{formatBitcoin(totals.totalSats / 100_000_000, unit)}</SensitiveValue> : DASH}
      </WidgetValue>
      <WidgetDetail>
        {known ? (
          <>
            <SensitiveValue>{formatUsd(totals.totalUsd.toFixed(2))}</SensitiveValue> · {totals.accountCount}{' '}
            {totals.accountCount === 1 ? 'account' : 'accounts'}
          </>
        ) : isError ? (
          'Holdings unavailable'
        ) : isLoading ? (
          'Loading holdings…'
        ) : totals.accountCount > 0 ? (
          'Balances unavailable right now'
        ) : (
          'No accounts yet'
        )}
      </WidgetDetail>
      {known && totals.hasUnknownBalance && (
        <Box mt="auto">
          <WidgetDetail color="text.tertiary">Some balances not yet available</WidgetDetail>
        </Box>
      )}
    </Widget>
  )
}

function Sparkline({ values, rising }: { values: number[]; rising: boolean }): JSX.Element | null {
  const gradientId = useId()
  const [up, down] = useToken('colors', ['chart.positive', 'chart.negative'])
  if (values.length < 2) {
    return null
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 100
  const height = 32
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / span) * (height - 4) - 2
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const color = rising ? up : down
  return (
    <Box
      as="svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      w="100%"
      h={{ base: '18px', sm: '32px' }}
      mt="auto"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points.join(' ')} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </Box>
  )
}

/** What is Bitcoin worth right now, and which way is it moving? */
export function PriceWidget(): JSX.Element {
  const history = trpc.portalProve.retrieveBitcoinPriceHistory.useQuery(
    { days: 7 },
    { staleTime: 300_000, refetchInterval: 300_000, retry: false },
  )
  const points = history.data ?? []
  const first = points[0]
  const latest = points[points.length - 1]
  const change = first && latest ? ((latest.value - first.value) / first.value) * 100 : null
  return (
    <Widget title="Bitcoin" label="Market" to="/portfolio">
      <WidgetValue>{latest ? wholeUsd(latest.value) : DASH}</WidgetValue>
      <WidgetDetail color={change === null ? 'text.secondary' : change >= 0 ? 'status.success.fg' : 'status.error.fg'}>
        {change === null
          ? history.isError
            ? 'Price unavailable'
            : 'Loading price…'
          : `${change >= 0 ? '+' : ''}${change.toFixed(2)}% · 7 days`}
      </WidgetDetail>
      <Sparkline values={points.map((point) => point.value)} rising={(change ?? 0) >= 0} />
    </Widget>
  )
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'good' | 'warn' | 'bad' | 'idle'
}): JSX.Element {
  const dot =
    tone === 'good'
      ? 'status.success.solid'
      : tone === 'warn'
        ? 'status.warning.solid'
        : tone === 'bad'
          ? 'status.error.solid'
          : 'text.disabled'
  return (
    <Flex justify="space-between" align="center" gap={2}>
      <HStack spacing={2} minW={0}>
        <Box boxSize="6px" borderRadius="full" bg={dot} flexShrink={0} />
        <Text textStyle={{ base: 'text/xs', sm: 'text/sm' }} color="text.secondary" noOfLines={1}>
          {label}
        </Text>
      </HStack>
      <Text
        textStyle={{ base: 'text/xs', sm: 'text/sm' }}
        fontWeight="medium"
        noOfLines={1}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Text>
    </Flex>
  )
}

/** How current is it? Electrum, the chain tip, and history syncing. */
export function ConnectionsWidget({ accounts }: { accounts: ReturnType<typeof useAccounts> }): JSX.Element {
  const electrum = trpc.settings.electrumStatus.useQuery(undefined, { refetchInterval: 15_000 })
  const tip = trpc.blocks.tip.useQuery(undefined, { refetchInterval: 60_000, retry: false })
  const portfolio = trpc.portalProve.controlCenter.getData.useQuery({
    timeRange: '30d',
    timezone: getBrowserTimezone(),
  })
  const syncing = portfolio.data?.historySyncingAccountIds.length ?? 0
  const failed = portfolio.data?.historyFailedAccountIds.length ?? 0
  const reconnect = accounts.totals.reconnectCount

  return (
    <Widget title="Connections" label="Settings" to="/settings">
      <Flex direction="column" gap={{ base: 1, sm: 2 }} mt={{ base: 1, sm: 3 }}>
        <StatusRow
          label="Electrum"
          value={electrum.data === undefined ? DASH : electrum.data.connected ? 'Connected' : 'Offline'}
          tone={electrum.data === undefined ? 'idle' : electrum.data.connected ? 'good' : 'bad'}
        />
        <StatusRow
          label="Latest block"
          value={tip.data ? tip.data.height.toLocaleString('en-US') : DASH}
          tone={tip.data ? 'good' : tip.isError ? 'bad' : 'idle'}
        />
        <StatusRow
          label={reconnect > 0 ? 'Exchanges' : 'History'}
          value={
            reconnect > 0
              ? `${reconnect} to reconnect`
              : failed > 0
                ? `${failed} failed`
                : syncing > 0
                  ? `Syncing ${syncing}`
                  : portfolio.data
                    ? 'Up to date'
                    : DASH
          }
          tone={reconnect > 0 || failed > 0 ? 'bad' : syncing > 0 ? 'warn' : portfolio.data ? 'good' : 'idle'}
        />
      </Flex>
    </Widget>
  )
}

/** What has been proven? Self-custody accounts with a signed ownership message. */
export function VerificationWidget({ accounts }: { accounts: ReturnType<typeof useAccounts> }): JSX.Element {
  const { totals, isLoading } = accounts
  const total = totals.selfCustodyCount
  return (
    <Widget title="Verified" label="Accounts" to="/accounts">
      <WidgetValue>{isLoading || total === 0 ? DASH : `${totals.verifiedCount} of ${total}`}</WidgetValue>
      <WidgetDetail>
        {isLoading
          ? 'Loading accounts…'
          : total === 0
            ? 'No self-custody accounts'
            : totals.pendingCount > 0
              ? `${totals.pendingCount} awaiting a signature`
              : 'Every wallet verified'}
      </WidgetDetail>
      {!isLoading && total > 0 && <WidgetTrack value={totals.verifiedCount / total} />}
    </Widget>
  )
}
