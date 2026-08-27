import { Box, Button, Flex, Grid, Heading, Stack, Text, useBreakpointValue } from '@chakra-ui/react'
import { Panel, Spinner } from '@hoseki/packages/ui/design-system'
import Decimal from 'decimal.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AccountsSidebar } from '../../components/dashboard-charts/accounts-sidebar'
import { AccumulationChart } from '../../components/dashboard-charts/accumulation-chart'
import {
  getMonthKey,
  getMonthlyChanges,
  toSatoshisString,
  withCurrentBalancePoint,
} from '../../components/dashboard-charts/balance-history'
import { MonthlyNetChangeChart } from '../../components/dashboard-charts/monthly-net-change-chart'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { trpc } from '../../trpc'
import { getBrowserTimezone } from '../../utils/timezone'

type TimeRange = '7d' | '30d' | '90d' | '1y' | 'all'

const PERIOD_LABELS: Record<TimeRange, string> = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  '1y': '1y',
  all: 'all time',
}

function formatBtc(satoshis: string | Decimal | unknown): string {
  try {
    const sats = typeof satoshis === 'string' || satoshis instanceof Decimal ? satoshis : toSatoshisString(satoshis)
    const btc = new Decimal(sats).div(100_000_000)
    const formatted = btc.toFixed(8)
    return formatted === '' || formatted === 'NaN' ? '0.00000000' : formatted
  } catch {
    return '0.00000000'
  }
}

function formatUsd(btcAmount: number, btcPrice: number): string {
  return (btcAmount * btcPrice).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function DashboardPage(): JSX.Element {
  useAutoRefreshExchanges()
  const [timeRange, setTimeRange] = useState<TimeRange>('1y')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [recentlySyncedAccountIds, setRecentlySyncedAccountIds] = useState<Set<string>>(new Set())
  const hasRecordedSnapshot = useRef(false)
  const previousHistorySyncingAccountIds = useRef<Set<string>>(new Set())
  const recentlySyncedTimeouts = useRef<Map<string, number>>(new Map())
  const shownRecentlySyncedAccountIds = useRef<Set<string>>(new Set())

  const navigate = useNavigate()
  const userTimezone = useMemo(() => getBrowserTimezone(), [])
  const isShowingAll = selected.size === 0
  const isSmallScreen = useBreakpointValue({ base: true, xl: false }) ?? true
  const [userCompact, setUserCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hoseki:sidebar-compact') === 'true'
    } catch {
      return false
    }
  })
  const compactSidebar = isSmallScreen || userCompact
  const toggleCompact = useCallback(() => {
    setUserCompact((prev) => {
      const next = !prev
      try {
        localStorage.setItem('hoseki:sidebar-compact', String(next))
      } catch {}
      return next
    })
  }, [])

  const recordSnapshot = trpc.portalProve.controlCenter.recordSnapshot.useMutation()
  const claimsQuery = trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
  const exchangeAccountsQuery = trpc.portalProve.exchange.list.useQuery()
  const manualAccountsQuery = trpc.portalProve.manual.list.useQuery()
  const etfAccountsQuery = trpc.portalProve.etf.list.useQuery()
  const btcPriceQuery = trpc.portalProve.retrieveBitcoinPrice.useQuery()

  const claims = useMemo(() => claimsQuery.data ?? [], [claimsQuery.data])
  const exchangeAccounts = useMemo(() => exchangeAccountsQuery.data ?? [], [exchangeAccountsQuery.data])
  const manualAccounts = useMemo(() => manualAccountsQuery.data ?? [], [manualAccountsQuery.data])
  const etfAccounts = useMemo(() => etfAccountsQuery.data ?? [], [etfAccountsQuery.data])
  const claimIds = useMemo(() => claims.map((claim) => claim.id), [claims])

  // Separate selected IDs into claim IDs and exchange account IDs.
  // Filter from typed source arrays so the return types are preserved correctly.
  const selectedClaimIds = useMemo(() => claimIds.filter((id) => selected.has(id)), [claimIds, selected])
  const selectedExchangeIds = useMemo(
    () => exchangeAccounts.map((a) => a.id).filter((id) => selected.has(id)),
    [exchangeAccounts, selected],
  )
  const selectedManualIds = useMemo(
    () => manualAccounts.map((a) => a.id).filter((id) => selected.has(id)),
    [manualAccounts, selected],
  )
  const selectedEtfIds = useMemo(
    () => etfAccounts.map((a) => a.id).filter((id) => selected.has(id)),
    [etfAccounts, selected],
  )

  const {
    data: allData,
    isLoading: allLoading,
    error: allError,
    refetch: refetchAllData,
  } = trpc.portalProve.controlCenter.getData.useQuery(
    { timeRange, timezone: userTimezone },
    { staleTime: 5 * 60 * 1000 },
  )
  const {
    data: filteredData,
    isFetching: filteredFetching,
    refetch: refetchFilteredData,
  } = trpc.portalProve.controlCenter.getData.useQuery(
    {
      timeRange,
      timezone: userTimezone,
      claimIds: selectedClaimIds,
      exchangeAccountIds: selectedExchangeIds,
      manualAccountIds: selectedManualIds,
      etfAccountIds: selectedEtfIds,
    },
    { enabled: !isShowingAll, staleTime: 5 * 60 * 1000, keepPreviousData: true },
  )

  // Keep showing previous data while filtered query loads to avoid chart flash
  const data = isShowingAll ? allData : filteredData ?? allData
  const isChartFetching = !isShowingAll && filteredFetching
  const historySyncingAccountIds = allData?.historySyncingAccountIds ?? filteredData?.historySyncingAccountIds ?? []
  const historySyncedAccountIds = allData?.historySyncedAccountIds ?? filteredData?.historySyncedAccountIds ?? []
  const historySyncingAccountIdsKey = historySyncingAccountIds.join('|')
  const historySyncedAccountIdsKey = historySyncedAccountIds.join('|')
  const recentlySyncedAccountIdList = useMemo(() => Array.from(recentlySyncedAccountIds), [recentlySyncedAccountIds])
  const balancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })

  useEffect(() => {
    if (historySyncingAccountIds.length === 0) return

    const intervalId = window.setInterval(() => {
      void refetchAllData()
      if (!isShowingAll) void refetchFilteredData()
    }, 10_000)

    return () => window.clearInterval(intervalId)
  }, [historySyncingAccountIds.length, isShowingAll, refetchAllData, refetchFilteredData])

  useEffect(() => {
    const currentSyncingIds = new Set(historySyncingAccountIdsKey === '' ? [] : historySyncingAccountIdsKey.split('|'))
    const currentSyncedIds = new Set(historySyncedAccountIdsKey === '' ? [] : historySyncedAccountIdsKey.split('|'))
    const completedIds = Array.from(previousHistorySyncingAccountIds.current).filter(
      (id) => !currentSyncingIds.has(id) && currentSyncedIds.has(id),
    )
    previousHistorySyncingAccountIds.current = currentSyncingIds

    for (const id of currentSyncingIds) {
      const visibleTimeout = recentlySyncedTimeouts.current.get(id)
      if (visibleTimeout !== undefined) {
        window.clearTimeout(visibleTimeout)
        recentlySyncedTimeouts.current.delete(id)
      }

      setRecentlySyncedAccountIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }

    for (const id of completedIds) {
      if (shownRecentlySyncedAccountIds.current.has(id)) continue

      shownRecentlySyncedAccountIds.current.add(id)
      setRecentlySyncedAccountIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })

      const existingTimeout = recentlySyncedTimeouts.current.get(id)
      if (existingTimeout !== undefined) window.clearTimeout(existingTimeout)

      const timeoutId = window.setTimeout(() => {
        recentlySyncedTimeouts.current.delete(id)
        setRecentlySyncedAccountIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 5_000)

      recentlySyncedTimeouts.current.set(id, timeoutId)
    }
  }, [historySyncingAccountIdsKey, historySyncedAccountIdsKey])

  useEffect(() => {
    shownRecentlySyncedAccountIds.current.clear()
  }, [timeRange])

  useEffect(() => {
    const timeouts = recentlySyncedTimeouts.current
    return () => {
      for (const timeoutId of timeouts.values()) {
        window.clearTimeout(timeoutId)
      }
      timeouts.clear()
    }
  }, [])

  useEffect(() => {
    if (allData?.verifiedClaimsCount && allData.verifiedClaimsCount > 0 && !hasRecordedSnapshot.current) {
      hasRecordedSnapshot.current = true
      recordSnapshot.mutate(undefined)
    }
  }, [allData?.verifiedClaimsCount, recordSnapshot])

  const toggleAccount = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearAll = useCallback(() => setSelected(new Set()), [])

  const claimTotalBtcSats = balancesQuery.data
    ? Array.from(balancesQuery.data.values()).reduce((sum, b) => {
        if (!b) return sum
        return sum + Number(b.current)
      }, 0)
    : 0

  const exchangeTotalBtcSats = exchangeAccounts.reduce((sum, a) => {
    if (!a.balance) return sum
    return sum + Number(a.balance)
  }, 0)

  const manualTotalBtcSats = manualAccounts.reduce((sum, a) => {
    if (!a.balance) return sum
    return sum + Number(a.balance)
  }, 0)

  const etfTotalBtcSats = etfAccounts.reduce((sum, a) => {
    if (!a.balance) return sum
    return sum + Number(a.balance)
  }, 0)

  const totalBtcSats = claimTotalBtcSats + exchangeTotalBtcSats + manualTotalBtcSats + etfTotalBtcSats

  const btcUsdPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null

  const claimsTotalUsd = balancesQuery.data
    ? Array.from(balancesQuery.data.values()).reduce((sum, b) => {
        if (!b?.usd) return sum
        return sum + Number(b.usd)
      }, 0)
    : 0

  const exchangeTotalUsd =
    btcUsdPrice !== null
      ? exchangeAccounts.reduce((sum, a) => {
          if (!a.balance) return sum
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const manualTotalUsd =
    btcUsdPrice !== null
      ? manualAccounts.reduce((sum, a) => {
          if (!a.balance) return sum
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const etfTotalUsd =
    btcUsdPrice !== null
      ? etfAccounts.reduce((sum, a) => {
          if (!a.balance) return sum
          return sum + (Number(a.balance) / 100_000_000) * btcUsdPrice
        }, 0)
      : 0

  const totalUsd = claimsTotalUsd + exchangeTotalUsd + manualTotalUsd + etfTotalUsd

  // Compute display balance from individual sources (claims + exchange) so the
  // hero number is always consistent with the sidebar total.
  const displayBalanceSats = isShowingAll
    ? totalBtcSats
    : selectedClaimIds.reduce((sum, id) => {
        const b = balancesQuery.data?.get(id)
        return sum + (b ? Number(b.current) : 0)
      }, 0) +
      selectedExchangeIds.reduce((sum, id) => {
        const acc = exchangeAccounts.find((a) => a.id === id)
        return sum + (acc?.balance ? Number(acc.balance) : 0)
      }, 0) +
      selectedManualIds.reduce((sum, id) => {
        const acc = manualAccounts.find((a) => a.id === id)
        return sum + (acc?.balance ? Number(acc.balance) : 0)
      }, 0) +
      selectedEtfIds.reduce((sum, id) => {
        const acc = etfAccounts.find((a) => a.id === id)
        return sum + (acc?.balance ? Number(acc.balance) : 0)
      }, 0)

  const historicalData = useMemo(
    () => withCurrentBalancePoint(data?.historicalData ?? [], displayBalanceSats, new Date(), userTimezone),
    [data?.historicalData, displayBalanceSats, userTimezone],
  )

  const periodChange = useMemo(() => {
    if (!historicalData.length) return null
    const currentSats = new Decimal(toSatoshisString(historicalData[historicalData.length - 1]?.totalBalance))
    const startSats = new Decimal(toSatoshisString(historicalData[0]?.totalBalance))
    return currentSats.minus(startSats)
  }, [historicalData])

  const handleGenerateStatement = useCallback((): void => {
    const preSelectedIds = isShowingAll ? claimIds : selectedClaimIds
    navigate('/statements/create', { state: { preSelectedClaimIds: preSelectedIds, returnTo: '/portfolio' } })
  }, [isShowingAll, claimIds, selectedClaimIds, navigate])

  const isInitialLoading =
    allLoading ||
    claimsQuery.isLoading ||
    exchangeAccountsQuery.isLoading ||
    manualAccountsQuery.isLoading ||
    etfAccountsQuery.isLoading ||
    btcPriceQuery.isLoading
  if (isInitialLoading) {
    return <Spinner fullPage size="xl" />
  }

  if (allError) {
    return (
      <Stack py={8} gap={8}>
        <Panel title="Error" p={6}>
          <Text color="error.400">Failed to load dashboard data: {allError.message}</Text>
        </Panel>
      </Stack>
    )
  }

  const hasVerifiedClaims =
    (allData?.verifiedClaimsCount ?? 0) > 0 ||
    exchangeAccounts.length > 0 ||
    manualAccounts.length > 0 ||
    etfAccounts.length > 0
  const hasHistoricalData = (allData?.historicalData?.length ?? 0) > 0
  const totalBtcDisplay = formatBtc(displayBalanceSats.toString())
  const btcPrice = data?.currentBtcPrice
    ? Number(data.currentBtcPrice)
    : allData?.currentBtcPrice
      ? Number(allData.currentBtcPrice)
      : 0
  const currentBtcFloat = displayBalanceSats / 100_000_000
  const hasBalance = displayBalanceSats > 0

  const isUp = periodChange === null || periodChange.gte(0)
  const changeColor = periodChange === null || periodChange.eq(0) ? 'neutral.400' : isUp ? 'success.600' : 'error.500'

  if (!hasVerifiedClaims && !hasHistoricalData) {
    return <EmptyState />
  }

  const activeLabel = isShowingAll
    ? 'Total Stack'
    : selected.size === 1
      ? claims.find((c) => selected.has(c.id))?.displayName ??
        exchangeAccounts.find((a) => selected.has(a.id))?.displayName ??
        manualAccounts.find((a) => selected.has(a.id))?.displayName ??
        etfAccounts.find((a) => selected.has(a.id))?.displayName ??
        'Account'
      : `${selected.size} accounts`

  const hasSidebar =
    claims.length > 0 || exchangeAccounts.length > 0 || manualAccounts.length > 0 || etfAccounts.length > 0

  return (
    <Flex minH="calc(100vh - 64px)">
      {/* Sidebar -- always visible when accounts exist */}
      {hasSidebar && (
        <Box alignSelf="flex-start" position="sticky" top={0} h="calc(100vh - 57px)" flexShrink={0}>
          <AccountsSidebar
            claims={claims}
            exchangeAccounts={exchangeAccounts}
            manualAccounts={manualAccounts}
            etfAccounts={etfAccounts}
            balances={balancesQuery.data}
            selected={selected}
            onToggle={toggleAccount}
            onClearAll={clearAll}
            totalBtcSats={totalBtcSats}
            totalUsd={totalUsd}
            compact={compactSidebar}
            onToggleCompact={isSmallScreen ? undefined : toggleCompact}
            historySyncingAccountIds={historySyncingAccountIds}
            recentlySyncedAccountIds={recentlySyncedAccountIdList}
          />
        </Box>
      )}

      {/* Main content */}
      <Box flex={1} minW={0} display="flex" justifyContent="center">
        <Box w="100%" maxW="863px" py={8} px={[4, 4, 6, 0]}>
          {/* Header row */}
          <Flex align="flex-start" justify="space-between" mb={8} gap={4} flexWrap="wrap">
            <Box>
              <Heading textStyle="text/3xl" fontWeight="bold" color="neutral.900">
                Portfolio
              </Heading>
              <Flex align="center" gap={2} mt={1.5}>
                <Text textStyle="text/sm" color="neutral.400">
                  {activeLabel}
                </Text>
                {!isShowingAll && (
                  <Text
                    textStyle="label/xs"
                    color="neutral.300"
                    cursor="pointer"
                    onClick={clearAll}
                    _hover={{ color: 'neutral.500' }}
                  >
                    ✕
                  </Text>
                )}
                <SyncIndicator historySyncingCount={historySyncingAccountIds.length} />
              </Flex>
            </Box>
            <Button size="md" px={6} py={3} borderRadius="8px" onClick={handleGenerateStatement}>
              Generate Statement
            </Button>
          </Flex>

          {/* Balance hero */}
          <Box mb={2} opacity={isChartFetching ? 0.35 : 1} transition="opacity 0.2s ease">
            <Text
              fontFamily="mono"
              textStyle={{ base: 'text/3xl', md: 'text/5xl' }}
              fontWeight="bold"
              color="neutral.900"
              letterSpacing="-0.04em"
            >
              {totalBtcDisplay}
            </Text>
            <Text textStyle="text/sm" color="neutral.400" fontWeight="medium" mt={1}>
              <Text as="span" color="neutral.300">
                BTC
              </Text>
              {'  ·  '}${formatUsd(currentBtcFloat, btcPrice)}
            </Text>
          </Box>

          {/* Change pill */}
          {periodChange !== null && (
            <Box
              display="inline-flex"
              alignItems="center"
              gap={1}
              mt={2}
              mb={8}
              px={2.5}
              py={1}
              borderRadius="lg"
              bg={isUp ? 'success.50' : 'error.50'}
              w="fit-content"
              opacity={isChartFetching ? 0.35 : 1}
              transition="opacity 0.2s ease"
            >
              <Text textStyle="text/sm" fontWeight="semibold" color={changeColor} fontFamily="mono">
                {isUp ? '↑' : '↓'} {formatBtc(periodChange.abs().toString())} BTC ({isUp ? '+' : ''}
                {periodChange.eq(0)
                  ? '0.0'
                  : periodChange
                      .div(new Decimal(toSatoshisString(historicalData[0]?.totalBalance)).abs().plus(1))
                      .mul(100)
                      .toFixed(1)}
                %)
              </Text>
              <Text textStyle="text/sm" fontWeight="medium" color={changeColor} opacity={0.6} ml={0.5}>
                {PERIOD_LABELS[timeRange]}
              </Text>
            </Box>
          )}

          {/* Accumulation chart */}
          <Box mb={8}>
            <Flex align="center" justify="space-between" mb={4}>
              <Flex align="center" gap={2}>
                <Text textStyle="overline/sm" fontWeight="bold" color="neutral.400">
                  Accumulation
                </Text>
                {isChartFetching && <Spinner size="xs" color="neutral.300" />}
              </Flex>
              <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
            </Flex>

            <Box
              bg="shades.0"
              border="1px solid"
              borderColor="neutral.200"
              borderRadius="12px"
              p={5}
              pr={2}
              position="relative"
              overflow="hidden"
            >
              <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
              {isChartFetching && (
                <Box
                  position="absolute"
                  inset={0}
                  borderRadius="12px"
                  pointerEvents="none"
                  sx={{
                    background:
                      'linear-gradient(90deg, rgba(240,242,245,0) 0%, rgba(240,242,245,0.85) 50%, rgba(240,242,245,0) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.4s ease-in-out infinite',
                    '@keyframes shimmer': {
                      '0%': { backgroundPosition: '-200% 0' },
                      '100%': { backgroundPosition: '200% 0' },
                    },
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Monthly net change */}
          <Box mb={8}>
            <Flex align="center" gap={2} mb={3}>
              <Text textStyle="overline/sm" fontWeight="bold" color="neutral.400">
                Monthly Net Change
              </Text>
              {isChartFetching && <Spinner size="xs" color="neutral.300" />}
            </Flex>
            <Box
              bg="shades.0"
              border="1px solid"
              borderColor="neutral.200"
              borderRadius="12px"
              px={3}
              pt={4}
              pb={2}
              position="relative"
              overflow="hidden"
            >
              <MonthlyNetChangeChart data={historicalData} timezone={userTimezone} />
              {isChartFetching && (
                <Box
                  position="absolute"
                  inset={0}
                  borderRadius="12px"
                  pointerEvents="none"
                  sx={{
                    background:
                      'linear-gradient(90deg, rgba(240,242,245,0) 0%, rgba(240,242,245,0.85) 50%, rgba(240,242,245,0) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.4s ease-in-out infinite',
                  }}
                />
              )}
            </Box>
          </Box>

          {/* Stats row */}
          <Grid templateColumns={{ base: '1fr', sm: '1fr 1fr' }} gap={3} mb={8}>
            <StatCard label="This Month" data={historicalData} mode="current" timezone={userTimezone} />
            <StatCard label="Monthly Avg (6mo)" data={historicalData} mode="average" timezone={userTimezone} />
          </Grid>
        </Box>
      </Box>
    </Flex>
  )
}

function SyncIndicator({ historySyncingCount }: { historySyncingCount: number }): JSX.Element {
  if (historySyncingCount > 0) {
    return (
      <Flex align="center" gap={1.5}>
        <Spinner size="xs" color="neutral.400" />
        <Text textStyle="label/xs" fontWeight="semibold" color="neutral.500">
          Updating history
        </Text>
      </Flex>
    )
  }

  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg="success.500" sx={{ animation: 'pulse 2s ease infinite' }} />
      <Text textStyle="label/xs" fontWeight="semibold" color="success.600">
        All synced
      </Text>
    </Flex>
  )
}

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (value: TimeRange) => void
}

function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps): JSX.Element {
  const options: { value: TimeRange; label: string }[] = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
  ]

  return (
    <Flex bg="neutral.50" borderRadius="8px" p="3px" gap="2px">
      {options.map((option) => (
        <Button
          key={option.value}
          onClick={() => onChange(option.value)}
          size="xs"
          px={3}
          py={1}
          borderRadius="6px"
          border="none"
          bg={value === option.value ? 'neutral.900' : 'transparent'}
          color={value === option.value ? 'shades.0' : 'neutral.400'}
          textStyle="label/xs"
          fontWeight="semibold"
          _hover={{
            bg: value === option.value ? 'neutral.900' : 'neutral.100',
          }}
        >
          {option.label}
        </Button>
      ))}
    </Flex>
  )
}

interface StatCardProps {
  label: string
  data: Array<{ timestamp: string; totalBalance: string }>
  mode: 'current' | 'average'
  timezone: string
}

function StatCard({ label, data, mode, timezone }: StatCardProps): JSX.Element {
  const value = useMemo(() => {
    const monthlyChanges = getMonthlyChanges(data, 6, timezone)
    if (monthlyChanges.length === 0) return new Decimal(0)

    if (mode === 'current') {
      const currentMonthKey = getMonthKey(new Date(), timezone)
      const currentMonth = monthlyChanges.find((change) => change.key === currentMonthKey)
      return new Decimal(currentMonth?.change ?? 0)
    }

    const total = monthlyChanges.reduce((sum, change) => sum.plus(change.change), new Decimal(0))
    return total.div(monthlyChanges.length)
  }, [data, mode, timezone])

  const isPositive = value.gte(0)

  return (
    <Box bg="shades.0" border="1px solid" borderColor="neutral.200" borderRadius="12px" px={4} py={4}>
      <Text textStyle="label/xs" color="neutral.400" fontWeight="semibold" mb={2}>
        {label}
      </Text>
      <Text
        fontFamily="mono"
        textStyle="text/lg"
        fontWeight="bold"
        color={isPositive ? 'success.600' : 'error.500'}
        letterSpacing="-0.02em"
      >
        {isPositive ? '+' : ''}
        {value.toFixed(8)}
      </Text>
      <Text textStyle="label/xs" color="neutral.300" mt={0.5}>
        BTC
      </Text>
    </Box>
  )
}

function EmptyState(): JSX.Element {
  return (
    <Stack py={8} gap={8}>
      <Flex align="center" justify="space-between">
        <Heading textStyle="text/xl" fontWeight="bold" color="neutral.900">
          Portfolio
        </Heading>
      </Flex>
      <Panel title="No verified claims" p={8}>
        <Stack align="center" textAlign="center" gap={4}>
          <Box w={16} h={16} borderRadius="full" bg="dataVizPrimary.100" />
          <Heading size="md" color="neutral.900">
            No verified claims yet
          </Heading>
          <Text color="neutral.400" maxW="md">
            To see your total Bitcoin and accumulation over time, verify at least one Bitcoin claim first.
          </Text>
          <Button as={Link} to="/accounts" colorScheme="primary" mt={2}>
            Add Your First Claim
          </Button>
        </Stack>
      </Panel>
    </Stack>
  )
}
