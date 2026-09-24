import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Grid,
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
import { DateInput, EmptyView, Spinner } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { Wrapper } from '@hoseki/packages/ui/prove-verify-ui/layout'
import { format, isAfter, isBefore, startOfDay, subDays } from 'date-fns'
import Decimal from 'decimal.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { AccountFilter } from '../../components/dashboard-charts/account-filter'
import { AccumulationChart } from '../../components/dashboard-charts/accumulation-chart'
import {
  getMonthKey,
  getMonthlyChanges,
  toSatoshisString,
  withCurrentBalancePoint,
} from '../../components/dashboard-charts/balance-history'
import { HistoryChartFrame, HistoryRangeLoading } from '../../components/dashboard-charts/history-chart-frame'
import { MonthlyNetChangeChart } from '../../components/dashboard-charts/monthly-net-change-chart'
import { BitcoinPriceChart } from '../../components/dashboard/bitcoin-price-chart'
import { DashboardCardTitle } from '../../components/dashboard/dashboard-typography'
import { FiatAmountText } from '../../components/fiat-amount-text'
import { SensitiveValue } from '../../components/sensitive-value'
import { UsdEquivalent } from '../../components/usd-equivalent'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { trpc } from '../../trpc'
import { isExchangeConnected } from '../../utils/exchange-connection-status'
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
  if (range.startDate === null || range.endDate === null) {
    return 'Choose both a start date and an end date.'
  }

  if (isBefore(range.startDate, BITCOIN_GENESIS_DATE)) {
    return 'Start date cannot be before Bitcoin genesis.'
  }
  if (isAfter(range.startDate, range.endDate)) {
    return 'Start date must be on or before end date.'
  }
  if (isAfter(range.endDate, startOfDay(now))) {
    return 'End date cannot be in the future.'
  }
  return null
}

function toCustomDateRangeInput(range: CustomDateRangeDraft): CustomDateRangeInput | null {
  if (range.startDate === null || range.endDate === null) {
    return null
  }
  return { startDate: format(range.startDate, 'yyyy-MM-dd'), endDate: format(range.endDate, 'yyyy-MM-dd') }
}

function formatCustomDateRangeLabel(range: CustomDateRangeDraft): string {
  if (range.startDate === null || range.endDate === null) {
    return 'custom'
  }
  if (format(range.startDate, 'yyyy') === format(range.endDate, 'yyyy')) {
    return `${format(range.startDate, 'MMM d')} – ${format(range.endDate, 'MMM d, yyyy')}`
  }
  return `${format(range.startDate, 'PP')} – ${format(range.endDate, 'PP')}`
}

function formatUsd(btcAmount: number, btcPrice: number): string {
  return (btcAmount * btcPrice).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function DashboardPage(): JSX.Element {
  useAutoRefreshExchanges()
  const hasDesktopSidebar = useBreakpointValue({ base: false, lg: true }) ?? false
  const [timeRange, setTimeRange] = useState<TimeRange>('90d')
  const [customDateRange, setCustomDateRange] = useState<CustomDateRangeDraft>({
    startDate: null,
    endDate: null,
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [recentlySyncedAccountIds, setRecentlySyncedAccountIds] = useState<Set<string>>(new Set())
  const displayedHistory = useRef<ReturnType<typeof withCurrentBalancePoint> | null>(null)
  const hasRecordedSnapshot = useRef(false)
  const previousHistorySync = useRef({ viewKey: '', syncingIds: new Set<string>() })
  const completedHistory = useRef<{ viewKey: string; points: ReturnType<typeof withCurrentBalancePoint> } | null>(null)
  const recentlySyncedTimeouts = useRef<Map<string, number>>(new Map())
  const shownRecentlySyncedAccountIds = useRef<Set<string>>(new Set())

  const navigate = useNavigate()
  const userTimezone = useMemo(() => getBrowserTimezone(), [])
  const today = new Date()
  const isShowingAll = selected.size === 0
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
    () =>
      exchangeAccounts
        .filter(isExchangeConnected)
        .map((a) => a.id)
        .filter((id) => selected.has(id)),
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
  const historyViewKey = JSON.stringify([timeRange, customDateRangeInput, [...selected].sort()])

  const {
    data: allData,
    isLoading: allLoading,
    isFetching: allFetching,
    isPreviousData: allIsPreviousData,
    error: allError,
    refetch: refetchAllData,
  } = trpc.portalProve.controlCenter.getData.useQuery(
    { ...rangeQueryInput, timezone: userTimezone },
    { enabled: isShowingAll, staleTime: 5 * 60 * 1000, keepPreviousData: true },
  )
  const {
    data: filteredData,
    isLoading: filteredLoading,
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
  const data = isShowingAll ? (allData ?? filteredData) : (filteredData ?? allData)
  const activeData = isShowingAll ? allData : filteredData
  const activeLoading = isShowingAll ? allLoading : filteredLoading
  const activeFetching = isShowingAll ? allFetching : filteredFetching
  const activeIsPreviousData = isShowingAll ? allIsPreviousData : filteredIsPreviousData
  const activeError = isShowingAll ? allError : filteredError
  const hasCurrentRangeData = activeData !== undefined && !activeIsPreviousData
  const allHistorySyncingAccountIds = allData?.historySyncingAccountIds ?? []
  const filteredHistorySyncingAccountIds = filteredData?.historySyncingAccountIds ?? []
  const historySyncingAccountIds = isShowingAll ? allHistorySyncingAccountIds : filteredHistorySyncingAccountIds
  const historySyncedAccountIds = isShowingAll
    ? (allData?.historySyncedAccountIds ?? [])
    : (filteredData?.historySyncedAccountIds ?? [])
  const historySyncingAccountIdsKey = historySyncingAccountIds.join('|')
  const historySyncedAccountIdsKey = historySyncedAccountIds.join('|')
  const historyRefreshingAccountIds = activeData?.historyRefreshingAccountIds ?? []
  const historyFailedAccountIds = activeIsPreviousData ? [] : (activeData?.historyFailedAccountIds ?? [])
  const cachedHistory = completedHistory.current?.viewKey === historyViewKey ? completedHistory.current.points : null
  // Retain only a chart actually completed for this exact range and selection.
  // A cached prefix alone cannot establish a newly requested range's history.
  const isHistoryRefreshing =
    hasCurrentRangeData &&
    cachedHistory !== null &&
    historySyncingAccountIds.length > 0 &&
    historySyncingAccountIds.every((id) => historyRefreshingAccountIds.includes(id))
  const historyNeedsInitialLoad = historySyncingAccountIds.length > 0 && !isHistoryRefreshing
  const recentlySyncedAccountIdList = useMemo(() => Array.from(recentlySyncedAccountIds), [recentlySyncedAccountIds])
  const balancesQuery = useGetBalancesPerClaimIds({ claimIds, enabled: claimIds.length > 0 })

  useEffect(() => {
    if (historySyncingAccountIds.length === 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      // Slow Electrum/exchange requests may outlast the polling interval.
      // Reuse an in-flight request rather than repeatedly cancelling it.
      void (isShowingAll ? refetchAllData : refetchFilteredData)({ cancelRefetch: false })
    }, 10_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [historySyncingAccountIds.length, isShowingAll, refetchAllData, refetchFilteredData])

  useEffect(() => {
    if (previousHistorySync.current.viewKey !== historyViewKey) {
      previousHistorySync.current = { viewKey: historyViewKey, syncingIds: new Set() }
      shownRecentlySyncedAccountIds.current.clear()
      for (const timeout of recentlySyncedTimeouts.current.values()) {
        window.clearTimeout(timeout)
      }
      recentlySyncedTimeouts.current.clear()
      setRecentlySyncedAccountIds(new Set())
    }
    // Cached results for another range/selection cannot establish completion.
    if (activeIsPreviousData || activeError || activeData === undefined) {
      return
    }
    const currentSyncingIds = new Set(historySyncingAccountIdsKey === '' ? [] : historySyncingAccountIdsKey.split('|'))
    const currentSyncedIds = new Set(historySyncedAccountIdsKey === '' ? [] : historySyncedAccountIdsKey.split('|'))
    const completedIds = Array.from(previousHistorySync.current.syncingIds).filter(
      (id) => !currentSyncingIds.has(id) && currentSyncedIds.has(id),
    )
    previousHistorySync.current.syncingIds = currentSyncingIds

    for (const id of currentSyncingIds) {
      const visibleTimeout = recentlySyncedTimeouts.current.get(id)
      if (visibleTimeout !== undefined) {
        window.clearTimeout(visibleTimeout)
        recentlySyncedTimeouts.current.delete(id)
      }

      setRecentlySyncedAccountIds((prev) => {
        if (!prev.has(id)) {
          return prev
        }
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }

    for (const id of completedIds) {
      if (shownRecentlySyncedAccountIds.current.has(id)) {
        continue
      }

      shownRecentlySyncedAccountIds.current.add(id)
      setRecentlySyncedAccountIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })

      const existingTimeout = recentlySyncedTimeouts.current.get(id)
      if (existingTimeout !== undefined) {
        window.clearTimeout(existingTimeout)
      }

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
  }, [
    historySyncingAccountIdsKey,
    historySyncedAccountIdsKey,
    historyViewKey,
    activeIsPreviousData,
    activeError,
    activeData,
  ])

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
    if ((allData?.verifiedClaimsCount ?? 0) > 0 && !hasRecordedSnapshot.current) {
      hasRecordedSnapshot.current = true
      recordSnapshot.mutate(undefined)
    }
  }, [allData?.verifiedClaimsCount, recordSnapshot])

  const claimTotalBtcSats = Array.from(balancesQuery.data.values()).reduce((sum, b) => {
    if (!b) {
      return sum
    }
    return sum + Number(b.current)
  }, 0)

  const exchangeTotalBtcSats = exchangeAccounts.filter(isExchangeConnected).reduce((sum, a) => {
    if (a.balance == null || a.balance === '') {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const manualTotalBtcSats = manualAccounts.reduce((sum, a) => {
    if (!a.balance) {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const etfTotalBtcSats = etfAccounts.reduce((sum, a) => {
    if (!a.balance) {
      return sum
    }
    return sum + Number(a.balance)
  }, 0)

  const totalBtcSats = claimTotalBtcSats + exchangeTotalBtcSats + manualTotalBtcSats + etfTotalBtcSats

  const btcUsdPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null

  // Keep the current balance consistent with the accounts included in this view.
  const displayBalanceSats = isShowingAll
    ? totalBtcSats
    : selectedClaimIds.reduce((sum, id) => {
        const b = balancesQuery.data.get(id)
        return sum + (b ? Number(b.current) : 0)
      }, 0) +
      selectedExchangeIds.reduce((sum, id) => {
        const acc = exchangeAccounts.find((a) => a.id === id)
        return sum + (acc?.balance != null && acc.balance !== '' ? Number(acc.balance) : 0)
      }, 0) +
      selectedManualIds.reduce((sum, id) => {
        const acc = manualAccounts.find((a) => a.id === id)
        return sum + (acc?.balance != null && acc.balance !== '' ? Number(acc.balance) : 0)
      }, 0) +
      selectedEtfIds.reduce((sum, id) => {
        const acc = etfAccounts.find((a) => a.id === id)
        return sum + (acc?.balance != null && acc.balance !== '' ? Number(acc.balance) : 0)
      }, 0)

  const isFullHistoryRange = timeRange === 'custom' || timeRange === 'all'
  const historyRangeError =
    activeError && (!hasCurrentRangeData || (isFullHistoryRange && historyNeedsInitialLoad)) ? activeError : null
  const historyBackfillFailed = hasCurrentRangeData && historyFailedAccountIds.length > 0
  const historyBackfillBlocked = isFullHistoryRange && historyNeedsInitialLoad && historyBackfillFailed
  // Offline queries can be paused rather than fetching. Wait for this range's
  // own data instead of exposing previous-range or all-account fallback data.
  const isFullHistoryPending =
    isFullHistoryRange &&
    historyRangeError === null &&
    !historyBackfillBlocked &&
    (!hasCurrentRangeData || historyNeedsInitialLoad)
  const customEndsToday = timeRange === 'custom' && customDateRangeInput?.endDate === format(new Date(), 'yyyy-MM-dd')
  const historicalData = useMemo(() => {
    const history = activeData?.historicalData ?? []
    if (historyRangeError !== null || isFullHistoryPending || historyBackfillBlocked) {
      return []
    }
    // Keep the prior chart intact while another selection loads. Never mix its
    // history with the newly selected account balance.
    if (!hasCurrentRangeData) {
      return displayedHistory.current ?? []
    }
    if (isFullHistoryRange && isHistoryRefreshing) {
      return cachedHistory
    }
    if (isFullHistoryRange && history.length === 0) {
      return []
    }
    if (timeRange === 'custom') {
      return customEndsToday ? withCurrentBalancePoint(history, displayBalanceSats, new Date(), userTimezone) : history
    }
    return withCurrentBalancePoint(history, displayBalanceSats, new Date(), userTimezone)
  }, [
    customEndsToday,
    activeData?.historicalData,
    hasCurrentRangeData,
    displayBalanceSats,
    historyRangeError,
    isFullHistoryPending,
    historyBackfillBlocked,
    isFullHistoryRange,
    isHistoryRefreshing,
    cachedHistory,
    timeRange,
    userTimezone,
  ])

  useEffect(() => {
    if (isFullHistoryRange && hasCurrentRangeData && !activeError && historySyncingAccountIds.length === 0) {
      completedHistory.current = { viewKey: historyViewKey, points: historicalData }
    }
  }, [
    isFullHistoryRange,
    hasCurrentRangeData,
    activeError,
    historySyncingAccountIds.length,
    historyViewKey,
    historicalData,
  ])

  useEffect(() => {
    if (hasCurrentRangeData && !activeError && !isFullHistoryPending && !historyBackfillBlocked) {
      displayedHistory.current = historicalData
    }
  }, [hasCurrentRangeData, activeError, isFullHistoryPending, historyBackfillBlocked, historicalData])

  const periodChange = useMemo(() => {
    if (!historicalData.length) {
      return null
    }
    const currentSats = new Decimal(toSatoshisString(historicalData[historicalData.length - 1]?.totalBalance))
    const startSats = new Decimal(toSatoshisString(historicalData[0]?.totalBalance))
    return currentSats.minus(startSats)
  }, [historicalData])

  const handleGenerateStatement = useCallback((): void => {
    const preSelectedIds = isShowingAll ? claimIds : selectedClaimIds
    void navigate('/statements/create', { state: { preSelectedClaimIds: preSelectedIds, returnTo: '/portfolio' } })
  }, [isShowingAll, claimIds, selectedClaimIds, navigate])

  const isInitialLoading =
    (activeLoading && !isFullHistoryRange && allData === undefined && filteredData === undefined) ||
    claimsQuery.isLoading ||
    exchangeAccountsQuery.isLoading ||
    manualAccountsQuery.isLoading ||
    etfAccountsQuery.isLoading ||
    btcPriceQuery.isLoading
  if (isInitialLoading) {
    return <Spinner fullPage size="xl" />
  }

  const hasVerifiedClaims =
    (allData?.verifiedClaimsCount ?? 0) > 0 ||
    (activeData?.verifiedClaimsCount ?? 0) > 0 ||
    claims.length > 0 ||
    exchangeAccounts.length > 0 ||
    manualAccounts.length > 0 ||
    etfAccounts.length > 0
  const hasHistoricalData = (allData?.historicalData.length ?? 0) > 0 || (activeData?.historicalData.length ?? 0) > 0
  const historyBtcPrice = Number(data?.currentBtcPrice ?? allData?.currentBtcPrice ?? 0)
  const btcPrice = btcUsdPrice ?? (historyBtcPrice > 0 ? historyBtcPrice : null)
  const periodLabel =
    timeRange === 'custom'
      ? formatCustomDateRangeLabel(customDateRange)
      : timeRange === 'all'
        ? 'all time'
        : { '7d': 'past 7 days', '30d': 'past 30 days', '90d': 'past 90 days', '1y': 'past year' }[timeRange]
  const currentBtcFloat = displayBalanceSats / 100_000_000
  const hasBalance = displayBalanceSats > 0

  const isUp = periodChange === null || periodChange.gte(0)
  const changeColor =
    periodChange === null || periodChange.eq(0) ? 'text.secondary' : isUp ? 'status.success.fg' : 'status.error.fg'
  // A failed range request cannot establish that the portfolio is empty.
  if (!hasVerifiedClaims && !hasHistoricalData && hasCurrentRangeData && !activeError && !historyBackfillFailed) {
    return <EmptyState />
  }

  const activeLabel = isShowingAll
    ? 'Total balance'
    : selected.size === 1
      ? (claims.find((c) => selected.has(c.id))?.displayName ??
        exchangeAccounts.find((a) => selected.has(a.id))?.displayName ??
        manualAccounts.find((a) => selected.has(a.id))?.displayName ??
        etfAccounts.find((a) => selected.has(a.id))?.displayName ??
        'Account')
      : `${selected.size} accounts`

  const hasAccounts =
    claims.length > 0 || exchangeAccounts.length > 0 || manualAccounts.length > 0 || etfAccounts.length > 0

  const accountFilter = hasAccounts ? (
    <AccountFilter
      presentation={hasDesktopSidebar ? 'sidebar' : 'dropdown'}
      claims={claims}
      exchangeAccounts={exchangeAccounts}
      manualAccounts={manualAccounts}
      etfAccounts={etfAccounts}
      balances={balancesQuery.data}
      btcPrice={btcPrice}
      selected={selected}
      onSelectionChange={setSelected}
      historySyncingAccountIds={activeIsPreviousData ? [] : historySyncingAccountIds}
      recentlySyncedAccountIds={recentlySyncedAccountIdList}
    />
  ) : null
  const isViewUpdating = !hasCurrentRangeData && !activeError && !isFullHistoryPending
  const isViewRefreshing =
    hasCurrentRangeData &&
    !activeError &&
    !isFullHistoryPending &&
    (activeFetching || historySyncingAccountIds.length > 0)

  return (
    <Flex minH="var(--shell-viewport-height, calc(100dvh - 76px))" align="stretch">
      {hasDesktopSidebar && accountFilter}
      <Box flex="1" minW={0}>
        <Wrapper maxW="928px" w="full" py={{ base: 6, md: 8 }}>
          <Flex align="flex-start" justify="space-between" mb={6} gap={4} flexWrap="wrap">
            <PageHeading
              title="Portfolio"
              description="Choose accounts and a date range to see changes in your holdings."
            />
            <Button size="md" variant="outline" flexShrink={0} onClick={handleGenerateStatement}>
              Generate Statement
            </Button>
          </Flex>
          {!hasDesktopSidebar && <Box mb={6}>{accountFilter}</Box>}
          <Box minW={0}>
            {/* Portfolio balance and period context */}
            <Box mb={8} pt={2}>
              <Flex align="center" justify="space-between" gap={4} mb={2} flexWrap="wrap">
                <Flex align="center" gap={2} minW={0}>
                  <Text textStyle="text/sm" color="text.secondary" overflowWrap="anywhere">
                    {activeLabel}
                  </Text>
                </Flex>
                <SyncIndicator
                  historySyncingCount={historySyncingAccountIds.length}
                  isPending={!hasCurrentRangeData}
                  hasError={!!activeError || historyBackfillFailed}
                />
              </Flex>
              <Flex align="baseline" gap={{ base: 2, sm: 4 }} flexWrap="wrap">
                <Text
                  fontFamily="body"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                  textStyle={{ base: 'amount/compact', md: 'amount/primary' }}
                  fontWeight="medium"
                  color="text.primary"
                  overflowWrap="anywhere"
                >
                  <SensitiveValue>
                    <BitcoinAmount btc={new Decimal(displayBalanceSats).div(100_000_000)} />
                  </SensitiveValue>
                </Text>
                <FiatAmountText primary>
                  <SensitiveValue>
                    {btcPrice === null ? 'USD unavailable' : `$${formatUsd(currentBtcFloat, btcPrice)}`}
                  </SensitiveValue>
                </FiatAmountText>
              </Flex>
              <Box minH="24px" mt={2}>
                {periodChange !== null && hasCurrentRangeData && (
                  <Flex align="baseline" gap={1.5} flexWrap="wrap">
                    <Text textStyle="text/sm" color={changeColor} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <SensitiveValue>
                        {periodChange.eq(0) ? (
                          'No change'
                        ) : (
                          <>
                            {isUp ? '+' : '−'}
                            <BitcoinAmount btc={periodChange.abs().div(100_000_000)} /> ({isUp ? '+' : ''}
                            {periodChange
                              .div(new Decimal(toSatoshisString(historicalData[0]?.totalBalance)).abs().plus(1))
                              .mul(100)
                              .toFixed(1)}
                            %)
                          </>
                        )}
                      </SensitiveValue>
                    </Text>
                    <Text textStyle="text/sm" color="text.tertiary">
                      · {periodLabel}
                    </Text>
                  </Flex>
                )}
              </Box>
            </Box>

            {/* Accumulation chart */}
            <Box mb={6} layerStyle="edge" borderRadius="panel" p={{ base: 4, md: 6 }}>
              <Flex align="center" justify="space-between" mb={5} gap={3} flexWrap="wrap">
                <Flex align="center" gap={2}>
                  <DashboardCardTitle>Accumulation</DashboardCardTitle>
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

              <HistoryChartFrame
                height="220px"
                viewKey={historyViewKey}
                loading={isFullHistoryPending}
                updating={isViewUpdating}
                refreshing={isViewRefreshing}
              >
                {historyRangeError !== null ? (
                  <HistoryRangeError
                    height="220px"
                    message={historyRangeError.message}
                    onRetry={() => void (isShowingAll ? refetchAllData : refetchFilteredData)({ cancelRefetch: false })}
                  />
                ) : historyBackfillBlocked ? (
                  <Flex h="220px" align="center" justify="center" px={4} textAlign="center">
                    <HistoryBackfillError />
                  </Flex>
                ) : isFullHistoryPending ? (
                  <HistoryRangeLoading height="220px" />
                ) : (
                  <SensitiveValue>
                    <AccumulationChart
                      data={historicalData}
                      hasActivity={hasBalance}
                      isUp={isUp}
                      timezone={userTimezone}
                    />
                  </SensitiveValue>
                )}
              </HistoryChartFrame>
            </Box>

            {/* Monthly net change */}
            <Box mb={6} layerStyle="edge" borderRadius="panel" p={{ base: 4, md: 6 }}>
              <Flex align="center" gap={2} mb={5}>
                <DashboardCardTitle>Monthly Net Change</DashboardCardTitle>
              </Flex>
              <HistoryChartFrame
                height="120px"
                viewKey={historyViewKey}
                loading={isFullHistoryPending}
                updating={isViewUpdating}
                refreshing={isViewRefreshing}
              >
                {historyRangeError !== null ? (
                  <HistoryRangeError
                    height="120px"
                    message={historyRangeError.message}
                    onRetry={() => void (isShowingAll ? refetchAllData : refetchFilteredData)({ cancelRefetch: false })}
                  />
                ) : historyBackfillBlocked ? (
                  <Flex h="120px" align="center" justify="center" px={4} textAlign="center">
                    <HistoryBackfillError />
                  </Flex>
                ) : isFullHistoryPending ? (
                  <HistoryRangeLoading height="120px" />
                ) : (
                  <SensitiveValue>
                    <MonthlyNetChangeChart data={historicalData} timezone={userTimezone} />
                  </SensitiveValue>
                )}
              </HistoryChartFrame>
              {/* Stats row */}
              <Grid
                templateColumns={{ base: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, max-content))' }}
                columnGap={{ base: 6, sm: 12, md: 16 }}
                rowGap={6}
                mt={5}
                pt={5}
                borderTop="1px solid"
                borderColor="border.subtle"
              >
                <StatCard
                  label="This Month"
                  available={periodChange !== null && hasCurrentRangeData}
                  data={historicalData}
                  mode="current"
                  btcPrice={btcPrice}
                  timezone={userTimezone}
                />
                <StatCard
                  label="Monthly Avg (6mo)"
                  available={periodChange !== null && hasCurrentRangeData}
                  data={historicalData}
                  mode="average"
                  btcPrice={btcPrice}
                  timezone={userTimezone}
                />
              </Grid>
              <Box minH="20px" mt={4}>
                {periodChange !== null && btcPrice !== null && Number.isFinite(btcPrice) && btcPrice > 0 && (
                  <Text textStyle="text/xs" color="text.tertiary" textAlign="right">
                    USD equivalents use the current Bitcoin price.
                  </Text>
                )}
              </Box>
            </Box>
            {hasCurrentRangeData && activeError && historyRangeError === null && (
              <Box role="alert" mb={4}>
                <Text textStyle="text/sm" color="status.error.fg">
                  Couldn&apos;t refresh this date range. Showing previously loaded data.
                </Text>
                <Button
                  mt={2}
                  size="sm"
                  variant="outline"
                  onClick={() => void (isShowingAll ? refetchAllData : refetchFilteredData)({ cancelRefetch: false })}
                >
                  Try again
                </Button>
              </Box>
            )}
            {historyBackfillFailed && !historyBackfillBlocked && !activeError && (
              <Box mb={4}>
                <HistoryBackfillError />
              </Box>
            )}
          </Box>
          {/* Market price lives here now that Home is the desktop; it stays separate from holdings. */}
          <Box mt={8}>
            <BitcoinPriceChart />
          </Box>
        </Wrapper>
      </Box>
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
      <Text textStyle="text/sm" color="status.error.fg">
        Couldn&apos;t load this date range: {message}
      </Text>
      <Text textStyle="text/xs" color="text.tertiary">
        Try again, or choose another range.
      </Text>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </Flex>
  )
}

function HistoryBackfillError(): JSX.Element {
  return (
    <Text role="alert" textStyle="text/sm" color="status.error.fg">
      Wallet history couldn&apos;t be loaded. Retrying automatically. Check your Electrum connection if this continues.
    </Text>
  )
}

function SyncIndicator({
  historySyncingCount,
  isPending,
  hasError,
}: {
  historySyncingCount: number
  isPending: boolean
  hasError: boolean
}): JSX.Element {
  if (hasError) {
    return (
      <Text textStyle="text/xs" color="status.error.fg">
        History unavailable
      </Text>
    )
  }
  if (isPending || historySyncingCount > 0) {
    return (
      <Flex align="center" gap={1.5}>
        <Spinner size="xs" color="text.tertiary" />
        <Text textStyle="text/xs" fontWeight="medium" color="text.tertiary">
          Updating history
        </Text>
      </Flex>
    )
  }

  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg="status.success.solid" />
      <Text textStyle="text/xs" fontWeight="medium" color="text.tertiary">
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
    if (draftError !== null) {
      return
    }
    onCustomApply(draft)
    onClose()
  }

  return (
    <Stack align="flex-end" gap={1}>
      <Flex
        as="fieldset"
        border="none"
        m={0}
        minW={0}
        aria-label="Portfolio time range"
        bg="surface.subtle"
        borderRadius="control"
        p={1}
        gap={1}
        flexWrap="wrap"
      >
        {options.map((option) => (
          <Button
            key={option.value}
            aria-pressed={value === option.value}
            onClick={() => {
              onClose()
              onPresetChange(option.value)
            }}
            size="sm"
            px={3}
            minH="40px"
            variant="ghost"
            borderRadius="control"
            border="none"
            bg={value === option.value ? 'surface.emphasis' : 'transparent'}
            color={value === option.value ? 'text.primary' : 'text.secondary'}
            textStyle="text/xs"
            fontWeight="medium"
            _hover={{
              bg: value === option.value ? 'surface.emphasis' : 'surface.muted',
            }}
          >
            {option.label}
          </Button>
        ))}

        <Popover isOpen={isOpen} onOpen={onOpen} onClose={onClose} placement="bottom-end" isLazy>
          <PopoverTrigger>
            <Button
              onClick={handleCustomClick}
              size="sm"
              px={3}
              minH="40px"
              variant="ghost"
              aria-pressed={value === 'custom'}
              borderRadius="control"
              border="none"
              bg={value === 'custom' ? 'surface.emphasis' : 'transparent'}
              color={value === 'custom' ? 'text.primary' : 'text.secondary'}
              textStyle="text/xs"
              fontWeight="medium"
              _hover={{ bg: value === 'custom' ? 'surface.emphasis' : 'surface.muted' }}
            >
              Custom
            </Button>
          </PopoverTrigger>
          <Portal>
            <PopoverContent
              w="min(360px, calc(100vw - 32px))"
              bg="surface.raised"
              borderColor="border.subtle"
              borderRadius="panel"
              boxShadow="xl"
            >
              <PopoverArrow bg="surface.raised" />
              <PopoverBody p={4}>
                <Stack gap={4}>
                  <Text textStyle="text/sm" fontWeight="medium" color="text.primary">
                    Choose a date range
                  </Text>
                  <Stack direction={{ base: 'column', sm: 'row' }} gap={3}>
                    <FormControl isInvalid={draftError !== null}>
                      <FormLabel htmlFor="portfolio-range-start" textStyle="text/xs" color="text.secondary" mb={1.5}>
                        Start date
                      </FormLabel>
                      <DateInput
                        id="portfolio-range-start"
                        value={draft.startDate}
                        min={BITCOIN_GENESIS_DATE}
                        max={today}
                        onChange={(startDate) => {
                          setDraft((current) => ({ ...current, startDate }))
                        }}
                        size="sm"
                      />
                    </FormControl>
                    <FormControl isInvalid={draftError !== null}>
                      <FormLabel htmlFor="portfolio-range-end" textStyle="text/xs" color="text.secondary" mb={1.5}>
                        End date
                      </FormLabel>
                      <DateInput
                        id="portfolio-range-end"
                        value={draft.endDate}
                        min={draft.startDate ?? BITCOIN_GENESIS_DATE}
                        max={today}
                        onChange={(endDate) => {
                          setDraft((current) => ({ ...current, endDate }))
                        }}
                        size="sm"
                      />
                    </FormControl>
                  </Stack>
                  <Text textStyle="text/xs" color={draftError === null ? 'text.tertiary' : 'status.error.fg'}>
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
        <Text textStyle="text/xs" color="text.tertiary" pr={1}>
          {formatCustomDateRangeLabel(customDateRange)}
        </Text>
      )}
    </Stack>
  )
}

interface StatCardProps {
  btcPrice: number | null
  available: boolean
  label: string
  data: Array<{ timestamp: string; totalBalance: string }>
  mode: 'current' | 'average'
  timezone: string
}

function StatCard({ label, data, mode, timezone, available, btcPrice }: StatCardProps): JSX.Element {
  const value = useMemo(() => {
    const monthlyChanges = getMonthlyChanges(data, 6, timezone)
    if (monthlyChanges.length === 0) {
      return new Decimal(0)
    }

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
    <Box minW={0}>
      <Text textStyle="text/xs" color="text.tertiary" fontWeight="medium" mb={2}>
        {label}
      </Text>
      <Text
        fontFamily="body"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
        textStyle="text/lg"
        fontWeight="medium"
        color={value.eq(0) ? 'text.primary' : isPositive ? 'status.success.fg' : 'status.error.fg'}
        letterSpacing="-0.02em"
      >
        <SensitiveValue>
          {available ? (
            <>
              {value.gt(0) ? '+' : ''}
              <BitcoinAmount btc={value} />
            </>
          ) : (
            '—'
          )}
        </SensitiveValue>
      </Text>
      <Text textStyle="text/sm" color="text.secondary" mt={1} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <SensitiveValue>{available ? <UsdEquivalent btc={value} btcPrice={btcPrice} showSign /> : '—'}</SensitiveValue>
      </Text>
    </Box>
  )
}

function EmptyState(): JSX.Element {
  return (
    <Stack py={{ base: 6, md: 8 }} gap={6}>
      <PageHeading title="Portfolio" description="Choose accounts and a date range to see changes in your holdings." />
      <EmptyView
        layerStyle="edge"
        borderRadius="panel"
        bgGradient="linear(to-b, neutral.50, white)"
        title="Watch your Bitcoin grow"
        description="Add your first account to see your total Bitcoin and track your holdings over time."
        action={
          <Button as={Link} to="/accounts/add">
            Add Your First Account
          </Button>
        }
      />
    </Stack>
  )
}
