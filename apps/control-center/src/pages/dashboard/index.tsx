import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Stack,
  Text,
  useBreakpointValue,
  useDisclosure,
} from '@chakra-ui/react'
import { DateInput, Panel, Spinner } from '@hoseki/packages/ui/design-system'
import { format, isAfter, isBefore, startOfDay, subDays } from 'date-fns'
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

type PresetTimeRange = '7d' | '30d' | '90d' | '1y' | 'all'
type TimeRange = PresetTimeRange | 'custom'

interface CustomDateRangeDraft {
  startDate: Date | null
  endDate: Date | null
}

interface CustomDateRangeInput {
  startDate: string
  endDate: string
}

const BITCOIN_GENESIS_DATE = new Date(2009, 0, 3)

function createDefaultCustomDateRange(now: Date): CustomDateRangeDraft {
  const today = startOfDay(now)
  return { startDate: subDays(today, 30), endDate: today }
}

function validateCustomDateRange(range: CustomDateRangeDraft, now: Date): string | null {
  if (range.startDate === null || range.endDate === null) return 'Choose both a start date and an end date.'

  if (isBefore(range.startDate, BITCOIN_GENESIS_DATE)) return 'Start date cannot be before Bitcoin genesis.'
  if (isAfter(range.startDate, range.endDate)) return 'Start date must be on or before end date.'
  if (isAfter(range.endDate, startOfDay(now))) return 'End date cannot be in the future.'
  return null
}

function toCustomDateRangeInput(range: CustomDateRangeDraft): CustomDateRangeInput | null {
  if (range.startDate === null || range.endDate === null) return null
  return { startDate: format(range.startDate, 'yyyy-MM-dd'), endDate: format(range.endDate, 'yyyy-MM-dd') }
}

function formatCustomDateRangeLabel(range: CustomDateRangeDraft): string {
  if (range.startDate === null || range.endDate === null) return 'custom'
  if (format(range.startDate, 'yyyy') === format(range.endDate, 'yyyy')) {
    return `${format(range.startDate, 'MMM d')} – ${format(range.endDate, 'MMM d, yyyy')}`
  }
  return `${format(range.startDate, 'PP')} – ${format(range.endDate, 'PP')}`
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
  const [customDateRange, setCustomDateRange] = useState<CustomDateRangeDraft>({
    startDate: null,
    endDate: null,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [recentlySyncedAccountIds, setRecentlySyncedAccountIds] = useState<Set<string>>(new Set())
  const hasRecordedSnapshot = useRef(false)
  const previousHistorySyncingAccountIds = useRef<Set<string>>(new Set())
  const recentlySyncedTimeouts = useRef<Map<string, number>>(new Map())
  const shownRecentlySyncedAccountIds = useRef<Set<string>>(new Set())

  const navigate = useNavigate()
  const userTimezone = useMemo(() => getBrowserTimezone(), [])
  const today = new Date()
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

  const customDateRangeInput = toCustomDateRangeInput(customDateRange)
  const rangeQueryInput =
    timeRange === 'custom'
      ? { timeRange: '1y' as const, customDateRange: customDateRangeInput ?? undefined }
      : { timeRange }
  const allRangeQueryInput = timeRange === 'custom' && !isShowingAll ? { timeRange: '1y' as const } : rangeQueryInput

  const {
    data: allData,
    isLoading: allLoading,
    isFetching: allFetching,
    isPreviousData: allIsPreviousData,
    error: allError,
    refetch: refetchAllData,
  } = trpc.portalProve.controlCenter.getData.useQuery(
    { ...allRangeQueryInput, timezone: userTimezone },
    { staleTime: 5 * 60 * 1000, keepPreviousData: true },
  )
  const {
    data: filteredData,
    isFetching: filteredFetching,
    isPreviousData: filteredIsPreviousData,
    error: filteredError,
    refetch: refetchFilteredData,
  } = trpc.portalProve.controlCenter.getData.useQuery(
    {
      ...rangeQueryInput,
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
  const activeData = isShowingAll ? allData : filteredData
  const activeFetching = isShowingAll ? allFetching : filteredFetching
  const activeIsPreviousData = isShowingAll ? allIsPreviousData : filteredIsPreviousData
  const activeError = isShowingAll ? allError : filteredError
  const isChartFetching = activeFetching && (activeIsPreviousData || activeData === undefined)
  const allHistorySyncingAccountIds = allData?.historySyncingAccountIds ?? []
  const filteredHistorySyncingAccountIds = filteredData?.historySyncingAccountIds ?? []
  const historySyncingAccountIds = isShowingAll ? allHistorySyncingAccountIds : filteredHistorySyncingAccountIds
  const historySyncedAccountIds = isShowingAll
    ? allData?.historySyncedAccountIds ?? []
    : filteredData?.historySyncedAccountIds ?? []
  const historySyncingAccountIdsKey = historySyncingAccountIds.join('|')
  const historySyncedAccountIdsKey = historySyncedAccountIds.join('|')
  const recentlySyncedAccountIdList = useMemo(() => Array.from(recentlySyncedAccountIds), [recentlySyncedAccountIds])
  const balancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })

  useEffect(() => {
    if (allHistorySyncingAccountIds.length === 0 && filteredHistorySyncingAccountIds.length === 0) return

    const intervalId = window.setInterval(() => {
      // Slow Electrum/exchange requests may outlast the polling interval.
      // Reuse an in-flight request rather than repeatedly cancelling it.
      if (allHistorySyncingAccountIds.length > 0) void refetchAllData({ cancelRefetch: false })
      if (!isShowingAll && filteredHistorySyncingAccountIds.length > 0) {
        void refetchFilteredData({ cancelRefetch: false })
      }
    }, 10_000)

    return () => window.clearInterval(intervalId)
  }, [
    allHistorySyncingAccountIds.length,
    filteredHistorySyncingAccountIds.length,
    isShowingAll,
    refetchAllData,
    refetchFilteredData,
  ])

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
  }, [customDateRangeInput?.endDate, customDateRangeInput?.startDate, timeRange])

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

  const isFullHistoryRange = timeRange === 'custom' || timeRange === 'all'
  const historyRangeError =
    isFullHistoryRange && activeError !== null && (activeData === undefined || activeIsPreviousData)
      ? activeError
      : null
  // Offline queries can be paused rather than fetching. Wait for this range's
  // own data instead of exposing previous-range or all-account fallback data.
  const isFullHistoryPending =
    isFullHistoryRange &&
    historyRangeError === null &&
    (activeIsPreviousData || activeData === undefined || historySyncingAccountIds.length > 0)
  const customEndsToday = timeRange === 'custom' && customDateRangeInput?.endDate === format(new Date(), 'yyyy-MM-dd')
  const historicalData = useMemo(() => {
    const history = data?.historicalData ?? []
    if (historyRangeError !== null || isFullHistoryPending) return []
    if (timeRange === 'custom') {
      if (history.length === 0) return []
      return customEndsToday ? withCurrentBalancePoint(history, displayBalanceSats, new Date(), userTimezone) : history
    }
    return withCurrentBalancePoint(history, displayBalanceSats, new Date(), userTimezone)
  }, [
    customEndsToday,
    data?.historicalData,
    displayBalanceSats,
    historyRangeError,
    isFullHistoryPending,
    timeRange,
    userTimezone,
  ])

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

  if (allError && allData === undefined && isShowingAll && !isFullHistoryRange) {
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
  // A failed range request cannot establish that the portfolio is empty.
  if (!hasVerifiedClaims && !hasHistoricalData && historyRangeError === null) {
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
            historySyncingAccountIds={allHistorySyncingAccountIds}
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
            </Box>
          )}

          {/* Accumulation chart */}
          <Box mb={8}>
            <Flex align="center" justify="space-between" mb={4} gap={3} flexWrap="wrap">
              <Flex align="center" gap={2}>
                <Text textStyle="overline/sm" fontWeight="bold" color="neutral.400">
                  Accumulation
                </Text>
                {activeFetching && <Spinner size="xs" color="neutral.300" />}
              </Flex>
              <TimeRangeSelector
                value={timeRange}
                customDateRange={customDateRange}
                today={today}
                onPresetChange={setTimeRange}
                onCustomApply={(range) => {
                  setCustomDateRange(range)
                  setTimeRange('custom')
                }}
              />
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
              {historyRangeError !== null ? (
                <HistoryRangeError
                  height="220px"
                  message={historyRangeError.message}
                  onRetry={() => void (isShowingAll ? refetchAllData() : refetchFilteredData())}
                />
              ) : isFullHistoryPending ? (
                <HistoryRangeLoading height="220px" />
              ) : (
                <AccumulationChart data={historicalData} hasActivity={hasBalance} isUp={isUp} timezone={userTimezone} />
              )}
              {isChartFetching && !isFullHistoryPending && (
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
              {activeFetching && <Spinner size="xs" color="neutral.300" />}
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
              {historyRangeError !== null ? (
                <HistoryRangeError
                  height="120px"
                  message={historyRangeError.message}
                  onRetry={() => void (isShowingAll ? refetchAllData() : refetchFilteredData())}
                />
              ) : isFullHistoryPending ? (
                <HistoryRangeLoading height="120px" />
              ) : (
                <MonthlyNetChangeChart data={historicalData} timezone={userTimezone} />
              )}
              {isChartFetching && !isFullHistoryPending && (
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

function HistoryRangeLoading({ height }: { height: string }): JSX.Element {
  return (
    <Flex h={height} align="center" justify="center" direction="column" gap={2}>
      <Spinner size="sm" color="neutral.400" />
      <Text textStyle="text/sm" color="neutral.500">
        Preparing history for this date range
      </Text>
    </Flex>
  )
}

function HistoryRangeError({
  height,
  message,
  onRetry,
}: {
  height: string
  message: string
  onRetry: () => void
}): JSX.Element {
  return (
    <Flex h={height} align="center" justify="center" direction="column" gap={3} px={4} textAlign="center">
      <Text textStyle="text/sm" color="error.500">
        Couldn&apos;t load this date range: {message}
      </Text>
      <Text textStyle="label/xs" color="neutral.500">
        Try again, or choose another range.
      </Text>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
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
  customDateRange: CustomDateRangeDraft
  today: Date
  onPresetChange: (value: PresetTimeRange) => void
  onCustomApply: (range: CustomDateRangeDraft) => void
}

function TimeRangeSelector({
  value,
  customDateRange,
  today,
  onPresetChange,
  onCustomApply,
}: TimeRangeSelectorProps): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [draft, setDraft] = useState<CustomDateRangeDraft>(customDateRange)
  const draftError = validateCustomDateRange(draft, today)
  const options: { value: PresetTimeRange; label: string }[] = [
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '90d', label: '90D' },
    { value: '1y', label: '1Y' },
    { value: 'all', label: 'All' },
  ]

  const handleCustomClick = (): void => {
    const hasAppliedRange = customDateRange.startDate !== null && customDateRange.endDate !== null
    setDraft(hasAppliedRange ? customDateRange : createDefaultCustomDateRange(new Date()))
  }

  const handleApply = (): void => {
    if (draftError !== null) return
    onCustomApply(draft)
    onClose()
  }

  return (
    <Stack align="flex-end" gap={1}>
      <Flex bg="neutral.50" borderRadius="8px" p="3px" gap="2px" flexWrap="wrap">
        {options.map((option) => (
          <Button
            key={option.value}
            onClick={() => {
              onClose()
              onPresetChange(option.value)
            }}
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

        <Popover isOpen={isOpen} onOpen={onOpen} onClose={onClose} placement="bottom-end" isLazy>
          <PopoverTrigger>
            <Button
              onClick={handleCustomClick}
              size="xs"
              px={3}
              py={1}
              borderRadius="6px"
              border="none"
              bg={value === 'custom' ? 'neutral.900' : 'transparent'}
              color={value === 'custom' ? 'shades.0' : 'neutral.400'}
              textStyle="label/xs"
              fontWeight="semibold"
              _hover={{ bg: value === 'custom' ? 'neutral.900' : 'neutral.100' }}
            >
              Custom
            </Button>
          </PopoverTrigger>
          <Portal>
            <PopoverContent
              w="min(360px, calc(100vw - 32px))"
              bg="shades.0"
              borderColor="neutral.200"
              borderRadius="12px"
              boxShadow="xl"
            >
              <PopoverArrow bg="shades.0" />
              <PopoverBody p={4}>
                <Stack gap={4}>
                  <Text textStyle="text/sm" fontWeight="semibold" color="neutral.900">
                    Choose a date range
                  </Text>
                  <Stack direction={{ base: 'column', sm: 'row' }} gap={3}>
                    <FormControl isInvalid={draftError !== null}>
                      <FormLabel htmlFor="portfolio-range-start" textStyle="label/xs" color="neutral.600" mb={1.5}>
                        Start date
                      </FormLabel>
                      <DateInput
                        id="portfolio-range-start"
                        value={draft.startDate}
                        min={BITCOIN_GENESIS_DATE}
                        max={today}
                        onChange={(startDate) => setDraft((current) => ({ ...current, startDate }))}
                        size="sm"
                      />
                    </FormControl>
                    <FormControl isInvalid={draftError !== null}>
                      <FormLabel htmlFor="portfolio-range-end" textStyle="label/xs" color="neutral.600" mb={1.5}>
                        End date
                      </FormLabel>
                      <DateInput
                        id="portfolio-range-end"
                        value={draft.endDate}
                        min={draft.startDate ?? BITCOIN_GENESIS_DATE}
                        max={today}
                        onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
                        size="sm"
                      />
                    </FormControl>
                  </Stack>
                  <Text textStyle="label/xs" color={draftError === null ? 'neutral.500' : 'error.500'}>
                    {draftError ?? 'Older self-custody history may take longer to prepare.'}
                  </Text>
                  <Flex justify="flex-end" gap={2}>
                    <Button size="sm" variant="ghost" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleApply} isDisabled={draftError !== null}>
                      Apply
                    </Button>
                  </Flex>
                </Stack>
              </PopoverBody>
            </PopoverContent>
          </Portal>
        </Popover>
      </Flex>
      {value === 'custom' && customDateRange.startDate !== null && customDateRange.endDate !== null && (
        <Text textStyle="label/xs" color="neutral.400" pr={1}>
          {formatCustomDateRangeLabel(customDateRange)}
        </Text>
      )}
    </Stack>
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
