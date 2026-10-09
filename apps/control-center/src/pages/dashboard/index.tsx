import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Stack,
  Text,
  VisuallyHidden,
  useBreakpointValue,
  useDisclosure,
} from '@chakra-ui/react'
import { TZDate } from '@date-fns/tz'
import { DateInput as DefaultDateInput, EmptyView, Spinner } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { VIEWPORT_BELOW_HEADER, Wrapper } from '@hoseki/packages/ui/prove-verify-ui/layout'
import { format, formatDistanceToNowStrict, isAfter, isBefore, startOfDay, subDays } from 'date-fns'
import Decimal from 'decimal.js'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AccountFilter as DefaultAccountFilter } from '../../components/dashboard-charts/account-filter'
import { AccumulationChart as DefaultAccumulationChart } from '../../components/dashboard-charts/accumulation-chart'
import {
  getFlowTotals,
  getMonthlyChanges,
  toSatoshisString,
  withCurrentBalancePoint,
} from '../../components/dashboard-charts/balance-history'
import { chartColors } from '../../components/dashboard-charts/chart-colors'
import { HistoryChartFrame, HistoryRangeLoading } from '../../components/dashboard-charts/history-chart-frame'
import { MonthlyNetChangeChart as DefaultMonthlyNetChangeChart } from '../../components/dashboard-charts/monthly-net-change-chart'
import { FiatAmountText } from '../../components/fiat-amount-text'
import {
  formatBitcoinNumber,
  formatSignedBitcoinNumber,
  formatSignedUsd,
  isUsableBtcPrice,
} from '../../lib/bitcoin-display'
import { isExchangeConnected } from '../../utils/exchange-connection-status'
import { type DashboardDataSource, dashboardDataSource } from './dashboard-data'

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

/** Matches `formatPeriodDates`, so the caption keeps its form once the range's figures load. */
function formatCustomDateRangeLabel(range: CustomDateRangeDraft): string {
  if (range.startDate === null || range.endDate === null) {
    return 'custom'
  }
  return `${format(range.startDate, 'MMM d, yyyy')} – ${format(range.endDate, 'MMM d, yyyy')}`
}

/** The first and last dates the chart actually shows, such as "Oct 1, 2025 – Sep 30, 2026". */
function formatPeriodDates(points: { timestamp: string }[], timezone: string): string | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) {
    return null
  }
  const toDate = (timestamp: string): string => format(new TZDate(new Date(timestamp), timezone), 'MMM d, yyyy')
  return `${toDate(first.timestamp)} – ${toDate(last.timestamp)}`
}

/** A smaller, lighter "BTC" after a large amount, scaled to it. */
function BtcUnit(): JSX.Element {
  return (
    <Text as="span" ml="0.3em" fontSize="0.6em" fontWeight="medium" color="neutral.500" letterSpacing="0">
      BTC
    </Text>
  )
}

/** "+12.3%", or "+<0.1%" for a change too small to show at one decimal. */
function formatPercentChange(change: Decimal, start: Decimal): string {
  const percent = change.abs().div(start).mul(100)
  const shown = percent.lt(0.05)
    ? '<0.1'
    : percent.toNumber().toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${change.lt(0) ? '\u2212' : '+'}${shown}%`
}

function formatUsd(btcAmount: number, btcPrice: number): string {
  return (btcAmount * btcPrice).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export interface DashboardViews {
  AccountFilter: typeof DefaultAccountFilter
  AccumulationChart: typeof DefaultAccumulationChart
  MonthlyNetChangeChart: typeof DefaultMonthlyNetChangeChart
  DateInput: typeof DefaultDateInput
}

const dashboardViews: DashboardViews = {
  AccountFilter: DefaultAccountFilter,
  AccumulationChart: DefaultAccumulationChart,
  MonthlyNetChangeChart: DefaultMonthlyNetChangeChart,
  DateInput: DefaultDateInput,
}

export function DashboardPage({
  dataSource = dashboardDataSource,
  views = dashboardViews,
}: {
  dataSource?: DashboardDataSource
  views?: DashboardViews
}): JSX.Element {
  const { AccountFilter, AccumulationChart, MonthlyNetChangeChart, DateInput } = views
  dataSource.useAutoRefresh()
  // Read the width on the first render so cached data never flashes the phone layout.
  const hasDesktopSidebar = useBreakpointValue({ base: false, lg: true }, { ssr: false }) ?? false
  const [timeRange, setTimeRange] = useState<TimeRange>('90d')
  const [customDateRange, setCustomDateRange] = useState<CustomDateRangeDraft>({
    startDate: null,
    endDate: null,
  })
  const [selection, setSelected] = useState<Set<string>>(new Set())
  const [recentlySyncedAccountIds, setRecentlySyncedAccountIds] = useState<Set<string>>(new Set())
  const displayedHistory = useRef<ReturnType<typeof withCurrentBalancePoint> | null>(null)
  const hasRecordedSnapshot = useRef(false)
  const previousHistorySync = useRef({ viewKey: '', syncingIds: new Set<string>() })
  const completedHistory = useRef<{ viewKey: string; points: ReturnType<typeof withCurrentBalancePoint> } | null>(null)
  const recentlySyncedTimeouts = useRef<Map<string, number>>(new Map())
  const shownRecentlySyncedAccountIds = useRef<Set<string>>(new Set())
  const knownServerBalances = useRef<Map<string, number>>(new Map())
  const activeLabelRef = useRef<HTMLParagraphElement>(null)

  const navigate = useNavigate()
  const userTimezone = useMemo(() => dataSource.getTimezone(), [dataSource])
  const today = new Date()
  const { recordSnapshot, claimsQuery, exchangeAccountsQuery, manualAccountsQuery, etfAccountsQuery, btcPriceQuery } =
    dataSource.useAccounts()

  const claims = useMemo(() => claimsQuery.data ?? [], [claimsQuery.data])
  const exchangeAccounts = useMemo(() => exchangeAccountsQuery.data ?? [], [exchangeAccountsQuery.data])
  const manualAccounts = useMemo(() => manualAccountsQuery.data ?? [], [manualAccountsQuery.data])
  const etfAccounts = useMemo(() => etfAccountsQuery.data ?? [], [etfAccountsQuery.data])
  const claimIds = useMemo(() => claims.map((claim) => claim.id), [claims])
  // Drop selected accounts that were removed or now need reconnecting; with none left, show all.
  const selected = useMemo(() => {
    const selectable = new Set<string>([
      ...claimIds,
      ...exchangeAccounts.filter(isExchangeConnected).map((account) => account.id),
      ...manualAccounts.map((account) => account.id),
      ...etfAccounts.map((account) => account.id),
    ])
    const valid = new Set([...selection].filter((id) => selectable.has(id)))
    return valid.size === selection.size ? selection : valid
  }, [selection, claimIds, exchangeAccounts, manualAccounts, etfAccounts])
  const isShowingAll = selected.size === 0

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
  const selectionKey = [...selected].sort().join('|')
  const historyViewKey = JSON.stringify([timeRange, customDateRangeInput, [...selected].sort()])

  const {
    data: allData,
    isLoading: allLoading,
    isFetching: allFetching,
    isPreviousData: allIsPreviousData,
    error: allError,
    refetch: refetchAllData,
  } = dataSource.useHistory(
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
  } = dataSource.useHistory(
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
  const balancesQuery = dataSource.useBalances({ claimIds, enabled: claimIds.length > 0 })

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
      }, 3_000)

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

  const quotedBtcPrice = btcPriceQuery.data?.value ? Number(btcPriceQuery.data.value) : null
  const btcPrice = isUsableBtcPrice(quotedBtcPrice) ? quotedBtcPrice : null

  // Keep the current balance consistent with the accounts included in this view.
  const liveBalanceSats = isShowingAll
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
  // Wallet balances are missing while they load or when Electrum is unreachable.
  // Counting them as zero would show a false drop, so use the server's total,
  // which falls back to each wallet's last stored balance.
  // Balances kept from before a failed fetch are no longer live.
  const viewClaimIds = isShowingAll ? claimIds : selectedClaimIds
  const hasLiveClaimBalances =
    (viewClaimIds.length === 0 || !balancesQuery.balancesFailed) &&
    viewClaimIds.every((id) => (balancesQuery.data.get(id) ?? null) !== null)
  // The current total doesn't depend on the date range, so all accounts can keep
  // the previous range's total; another selection's total never applies.
  const serverData = activeData !== undefined && !activeIsPreviousData ? activeData : isShowingAll ? allData : undefined
  const currentServerBalanceSats = serverData === undefined ? null : Number(serverData.currentTotalBalance)
  // Null until the server reports a total for a selection without live balances.
  const displayBalanceSats = hasLiveClaimBalances
    ? liveBalanceSats
    : (currentServerBalanceSats ?? knownServerBalances.current.get(selectionKey) ?? null)
  // When the balance comes from stored wallet balances, the time they last synced.
  // A clock behind the server's must not read as a sync in the future.
  const storedBalancesAsOfMs = Date.parse(serverData?.walletBalancesAsOf ?? '')
  const walletBalancesAsOf =
    !hasLiveClaimBalances && Number.isFinite(storedBalancesAsOfMs)
      ? new Date(Math.min(storedBalancesAsOfMs, Date.now()))
      : null

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
    // Without live wallet balances, the server's latest point is the best current balance.
    if (!hasLiveClaimBalances) {
      return history
    }
    if (timeRange === 'custom') {
      return customEndsToday ? withCurrentBalancePoint(history, liveBalanceSats, new Date(), userTimezone) : history
    }
    return withCurrentBalancePoint(history, liveBalanceSats, new Date(), userTimezone)
  }, [
    customEndsToday,
    activeData?.historicalData,
    hasCurrentRangeData,
    hasLiveClaimBalances,
    liveBalanceSats,
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
    if (currentServerBalanceSats !== null) {
      knownServerBalances.current.set(selectionKey, currentServerBalanceSats)
    }
  }, [selectionKey, currentServerBalanceSats])

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
  const flowTotals = useMemo(() => getFlowTotals(historicalData), [historicalData])
  const monthsInRange = useMemo(
    () => getMonthlyChanges(historicalData, Number.POSITIVE_INFINITY, userTimezone).length,
    [historicalData, userTimezone],
  )
  // A range that starts at zero has no meaningful percentage change.
  const periodStartSats = new Decimal(toSatoshisString(historicalData[0]?.totalBalance))

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
  const periodLabel =
    timeRange === 'custom'
      ? formatCustomDateRangeLabel(customDateRange)
      : timeRange === 'all'
        ? 'All time'
        : { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '1y': 'Last year' }[timeRange]
  // An unknown balance keeps the chart's gain and loss colors.
  const hasBalance = displayBalanceSats === null || displayBalanceSats > 0

  // Presets read as a plain period; only a custom range spells out its dates.
  const rangeCaption =
    timeRange === 'custom' ? (formatPeriodDates(historicalData, userTimezone) ?? periodLabel) : periodLabel
  const retryHistory = (): void => {
    void (isShowingAll ? refetchAllData : refetchFilteredData)({ cancelRefetch: false })
  }
  const isUp = periodChange === null || periodChange.gte(0)
  const changeColor = isUp ? 'success.700' : 'error.700'
  // A failed range request cannot establish that the portfolio is empty.
  if (!hasVerifiedClaims && !hasHistoricalData && hasCurrentRangeData && !activeError && !historyBackfillFailed) {
    return <EmptyState />
  }

  const activeLabel = isShowingAll
    ? 'All accounts'
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
  const isViewRefreshing = hasCurrentRangeData && !activeError && !isFullHistoryPending && activeFetching

  return (
    <Flex minH={VIEWPORT_BELOW_HEADER} align="stretch">
      {hasDesktopSidebar && accountFilter}
      <Box flex="1" minW={0}>
        <Wrapper maxW="928px" w="full" py={{ base: 6, md: 8 }}>
          {!hasDesktopSidebar && <Box mb={6}>{accountFilter}</Box>}
          <Box minW={0}>
            <VisuallyHidden as="h1">Portfolio</VisuallyHidden>
            {/* Above the balance, as the figures below may be stale or incomplete. */}
            {hasCurrentRangeData && activeError && historyRangeError === null && (
              <Box role="alert" mb={4}>
                <Text textStyle="text/sm" color="error.500">
                  Couldn&apos;t refresh this date range. Showing previously loaded data.
                </Text>
                <Button mt={2} size="sm" variant="outline" onClick={retryHistory}>
                  Try again
                </Button>
              </Box>
            )}
            {historyBackfillFailed && !historyBackfillBlocked && !activeError && (
              <Box mb={4}>
                <HistoryBackfillError />
              </Box>
            )}
            {/* Portfolio balance and period context */}
            <Box mb={6} minW={0}>
              <Flex align="center" gap={2} minW={0} flexWrap="wrap">
                <Text
                  ref={activeLabelRef}
                  // Takes focus after the filter is cleared, as the clear button goes away.
                  tabIndex={-1}
                  textStyle="text/sm"
                  fontWeight="medium"
                  color="neutral.700"
                  overflowWrap="anywhere"
                >
                  {activeLabel}
                </Text>
                {!isShowingAll && (
                  <Box
                    as="button"
                    type="button"
                    aria-label="Clear account filter"
                    onClick={() => {
                      setSelected(new Set())
                      activeLabelRef.current?.focus()
                    }}
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    boxSize="18px"
                    ml={-1}
                    borderRadius="full"
                    color="neutral.500"
                    _hover={{ color: 'neutral.900', bg: 'neutral.100' }}
                    _focusVisible={{ outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '2px' }}
                  >
                    <X size={12} strokeWidth={2.25} />
                  </Box>
                )}
                <Box as="span" boxSize="3px" borderRadius="full" bg="neutral.300" aria-hidden="true" />
                {/* The one place sync and loading changes are announced. */}
                <Box as="output">
                  <SyncIndicator
                    walletBalancesAsOf={walletBalancesAsOf}
                    historySyncingCount={historySyncingAccountIds.length}
                    isPending={!hasCurrentRangeData}
                    hasError={!!activeError || historyBackfillFailed}
                  />
                </Box>
              </Flex>
              {/* The button centers on the balance line; on phones it wraps below. */}
              <Flex
                align="center"
                justify="space-between"
                columnGap={4}
                rowGap={{ base: 3, sm: 1 }}
                flexWrap="wrap"
                mt={1}
              >
                <Flex
                  align="baseline"
                  columnGap={3}
                  flexWrap="wrap"
                  minW={0}
                  opacity={isViewUpdating ? 0.35 : 1}
                  transition="opacity 0.2s ease"
                >
                  <Text
                    fontFamily="body"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                    textStyle={{ base: 'text/7xl', md: 'amount/hero' }}
                    letterSpacing="-0.03em"
                    fontWeight="semibold"
                    color="neutral.900"
                    overflowWrap="anywhere"
                  >
                    {displayBalanceSats === null
                      ? '\u2014'
                      : formatBitcoinNumber(new Decimal(displayBalanceSats).div(100_000_000))}
                  </Text>
                  <Text textStyle={{ base: 'text/xl', md: 'text/3xl' }} fontWeight="medium" color="neutral.500">
                    BTC
                  </Text>
                </Flex>
                <Button
                  size="md"
                  variant="outline"
                  flexShrink={0}
                  order={{ base: 1, sm: 0 }}
                  onClick={handleGenerateStatement}
                >
                  Generate Statement
                </Button>
                <Box
                  flexBasis="100%"
                  order={{ base: 0, sm: 1 }}
                  opacity={isViewUpdating ? 0.35 : 1}
                  transition="opacity 0.2s ease"
                >
                  <FiatAmountText textStyle={{ base: 'text/lg', md: 'text/xl' }} fontWeight="normal">
                    <>
                      {btcPrice === null
                        ? 'USD unavailable'
                        : displayBalanceSats === null
                          ? '\u2014'
                          : `$${formatUsd(displayBalanceSats / 100_000_000, btcPrice)}`}
                    </>
                  </FiatAmountText>
                </Box>
              </Flex>
            </Box>

            {/* Accumulation chart */}
            <Box mb={6} border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 4, md: 6 }}>
              <Flex align="flex-start" justify="space-between" mb={5} gap={3} flexWrap="wrap">
                <Box minW={0} minH="56px" opacity={isViewUpdating ? 0.35 : 1} transition="opacity 0.2s ease">
                  {periodChange !== null && hasCurrentRangeData && (
                    <>
                      <Flex align="center" gap={2.5} flexWrap="wrap">
                        <Text
                          textStyle={{ base: 'text/xl', md: 'text/3xl' }}
                          fontWeight="semibold"
                          color={changeColor}
                          sx={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {/* Zero reads as +0.00000000 BTC, matching Net accumulated below. */}
                          {formatSignedBitcoinNumber(periodChange.div(100_000_000))}
                          <BtcUnit />
                        </Text>
                        {!periodChange.eq(0) && periodStartSats.gt(0) && (
                          <Text
                            as="span"
                            px={2}
                            py={0.5}
                            borderRadius="full"
                            bg={isUp ? 'success.50' : 'error.50'}
                            color={changeColor}
                            textStyle="text/xs"
                            fontWeight="semibold"
                            sx={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {formatPercentChange(periodChange, periodStartSats)}
                          </Text>
                        )}
                        {activeFetching && <Spinner size="xs" color="neutral.300" />}
                      </Flex>
                      <Text textStyle="text/sm" color="neutral.500" mt={1}>
                        {rangeCaption}
                      </Text>
                    </>
                  )}
                  {/* Until a custom range has figures, still say which dates it covers. */}
                  {!(periodChange !== null && hasCurrentRangeData) && timeRange === 'custom' && (
                    <Text textStyle="text/sm" color="neutral.500">
                      {periodLabel}
                    </Text>
                  )}
                </Box>
                <TimeRangeSelector
                  DateInput={DateInput}
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

              <HistoryPanel
                height="220px"
                viewKey={historyViewKey}
                error={historyRangeError}
                isBackfillBlocked={historyBackfillBlocked}
                isPending={isFullHistoryPending}
                isUpdating={isViewUpdating}
                isRefreshing={isViewRefreshing}
                onRetry={retryHistory}
              >
                <AccumulationChart
                  data={historicalData}
                  hasActivity={hasBalance}
                  isUp={isUp}
                  timezone={userTimezone}
                  startLabel={timeRange === 'all' ? 'month' : 'day'}
                />
              </HistoryPanel>
            </Box>

            {/* Net accumulated over the selected range */}
            <Box mb={6} border="1px solid" borderColor="neutral.200" borderRadius="panel" p={{ base: 4, md: 6 }}>
              <NetAccumulatedSummary
                ready={periodChange !== null && hasCurrentRangeData}
                inBtc={flowTotals.inBtc}
                outBtc={flowTotals.outBtc}
                monthsInRange={monthsInRange}
                btcPrice={btcPrice}
                caption={rangeCaption}
                isUpdating={isViewUpdating}
                isFetching={activeFetching}
              />
              <HistoryPanel
                height="200px"
                viewKey={historyViewKey}
                error={historyRangeError}
                isBackfillBlocked={historyBackfillBlocked}
                isPending={isFullHistoryPending}
                isUpdating={isViewUpdating}
                isRefreshing={isViewRefreshing}
                onRetry={retryHistory}
              >
                <MonthlyNetChangeChart data={historicalData} timezone={userTimezone} btcPrice={btcPrice} />
              </HistoryPanel>
              <Box minH="16px" mt={4}>
                {periodChange !== null && btcPrice !== null && (
                  <Text textStyle="label/sm" color="neutral.500" textAlign="right">
                    USD at today&apos;s Bitcoin price
                  </Text>
                )}
              </Box>
            </Box>
          </Box>
        </Wrapper>
      </Box>
    </Flex>
  )
}

/** A chart, or the error or loading state that replaces it, in the shared frame. */
function HistoryPanel({
  height,
  viewKey,
  error,
  isBackfillBlocked,
  isPending,
  isUpdating,
  isRefreshing,
  onRetry,
  children,
}: {
  height: string
  viewKey: string
  error: Pick<Error, 'message'> | null
  isBackfillBlocked: boolean
  isPending: boolean
  isUpdating: boolean
  isRefreshing: boolean
  onRetry: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <HistoryChartFrame
      height={height}
      viewKey={viewKey}
      loading={isPending}
      updating={isUpdating}
      refreshing={isRefreshing}
    >
      {error !== null ? (
        <HistoryRangeError height={height} message={error.message} onRetry={onRetry} />
      ) : isBackfillBlocked ? (
        <Flex h={height} align="center" justify="center" px={4} textAlign="center">
          <HistoryBackfillError />
        </Flex>
      ) : isPending ? (
        <HistoryRangeLoading height={height} />
      ) : (
        children
      )}
    </HistoryChartFrame>
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
      <Text textStyle="text/xs" color="neutral.500">
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
    <Text role="alert" textStyle="text/sm" color="error.500">
      Wallet history couldn&apos;t be loaded. Retrying automatically. Check your Electrum connection if this continues.
    </Text>
  )
}

function SyncIndicator({
  walletBalancesAsOf,
  historySyncingCount,
  isPending,
  hasError,
}: {
  /** Set when the balance shown is the wallets' last stored one. */
  walletBalancesAsOf: Date | null
  historySyncingCount: number
  isPending: boolean
  hasError: boolean
}): JSX.Element {
  // First, as it qualifies the balance itself; an alert above covers any history error.
  if (walletBalancesAsOf !== null) {
    return (
      <Flex align="center" gap={1.5}>
        <Box w="6px" h="6px" borderRadius="full" bg="warning.400" aria-hidden="true" />
        <Text textStyle="text/sm" color="warning.700">
          Last synced{' '}
          {/* The relative time changes every minute; a fixed time is read instead, so it isn't re-announced. */}
          <span aria-hidden="true">{formatDistanceToNowStrict(walletBalancesAsOf, { addSuffix: true })}</span>
          <VisuallyHidden>{format(walletBalancesAsOf, 'PPp')}</VisuallyHidden>
        </Text>
      </Flex>
    )
  }
  if (hasError) {
    return (
      <Text textStyle="text/sm" color="error.500">
        History unavailable
      </Text>
    )
  }
  if (isPending || historySyncingCount > 0) {
    return (
      <Flex align="center" gap={1.5}>
        <Spinner label="" size="xs" color="neutral.400" />
        <Text textStyle="text/sm" color="neutral.500">
          Updating history
        </Text>
      </Flex>
    )
  }

  return (
    <Flex align="center" gap={1.5}>
      <Box w="6px" h="6px" borderRadius="full" bg="success.500" aria-hidden="true" />
      <Text textStyle="text/sm" color="neutral.500">
        Synced
      </Text>
    </Flex>
  )
}

/** Net, average and approximate in/out for the selected range. */
function NetAccumulatedSummary({
  ready,
  inBtc,
  outBtc,
  monthsInRange,
  btcPrice,
  caption,
  isUpdating,
  isFetching,
}: {
  ready: boolean
  inBtc: Decimal
  outBtc: Decimal
  monthsInRange: number
  btcPrice: number | null
  caption: string
  isUpdating: boolean
  isFetching: boolean
}): JSX.Element {
  const net = inBtc.minus(outBtc)
  // Over every month the range touches, matching the bars below.
  const average = net.div(Math.max(1, monthsInRange))
  const total = inBtc.plus(outBtc)
  const inShare = total.gt(0) ? inBtc.div(total).mul(100).toNumber() : 100
  return (
    <Box opacity={isUpdating ? 0.35 : 1} transition="opacity 0.2s ease" minH="72px" mb={6}>
      <Flex align="flex-start" justify="space-between" gap={4} flexWrap="wrap">
        <Box minW={0}>
          <Flex align="center" gap={2}>
            <Text as="h2" textStyle="overline/sm" fontWeight="semibold" color="neutral.500">
              Net accumulated
            </Text>
            {isFetching && <Spinner size="xs" color="neutral.300" />}
          </Flex>
          {ready && (
            <>
              <Flex align="baseline" columnGap={2.5} flexWrap="wrap" mt={1}>
                <Text
                  textStyle="amount/compact"
                  letterSpacing="-0.02em"
                  fontWeight="semibold"
                  color={net.lt(0) ? 'error.700' : 'success.700'}
                >
                  {formatSignedBitcoinNumber(net)}
                  <BtcUnit />
                </Text>
                <Text textStyle="text/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatSignedUsd(net, btcPrice)}
                </Text>
              </Flex>
              <Text textStyle="text/sm" color="neutral.500" mt={0.5}>
                {caption}
              </Text>
            </>
          )}
        </Box>
        {ready && (
          <Box textAlign="right">
            <Text textStyle="text/xs" color="neutral.500">
              Avg / month
            </Text>
            <Text
              textStyle="text/lg"
              fontWeight="semibold"
              color="neutral.900"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatSignedBitcoinNumber(average)}
            </Text>
            <Text textStyle="label/sm" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatSignedUsd(average, btcPrice)}
            </Text>
          </Box>
        )}
      </Flex>
      {ready && outBtc.gt(0) && (
        <Box mt={5}>
          <Flex h="6px" gap="2px" aria-hidden="true">
            <Box
              w={`${inShare}%`}
              bg={chartColors.gain}
              borderRadius="full"
              transition="width 0.4s ease"
              sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
            />
            <Box flex="1" bg={chartColors.loss} borderRadius="full" />
          </Flex>
          <Flex justify="space-between" mt={2} gap={4}>
            <Box>
              <Text
                textStyle="text/md"
                fontWeight="medium"
                color="success.700"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                +{formatBitcoinNumber(inBtc)} in
              </Text>
              <Text textStyle="label/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatSignedUsd(inBtc, btcPrice)}
              </Text>
            </Box>
            <Box textAlign="right">
              <Text
                textStyle="text/md"
                fontWeight="medium"
                color="error.700"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                −{formatBitcoinNumber(outBtc)} out
              </Text>
              <Text textStyle="label/xs" color="neutral.500" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatSignedUsd(outBtc.neg(), btcPrice)}
              </Text>
            </Box>
          </Flex>
        </Box>
      )}
    </Box>
  )
}

interface TimeRangeSelectorProps {
  value: TimeRange
  customDateRange: CustomDateRangeDraft
  today: Date
  onPresetChange: (value: PresetTimeRange) => void
  onCustomApply: (range: CustomDateRangeDraft) => void
  DateInput: typeof DefaultDateInput
}

function TimeRangeSelector({
  DateInput,
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
        aria-label="Portfolio time range"
        bg="neutral.100"
        borderRadius="control"
        p={1}
        gap={0.5}
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
            bg={value === option.value ? 'shades.0' : 'transparent'}
            boxShadow={value === option.value ? 'sm' : 'none'}
            color={value === option.value ? 'neutral.900' : 'neutral.600'}
            textStyle="text/xs"
            fontWeight="medium"
            _hover={{
              bg: value === option.value ? 'shades.0' : 'neutral.200',
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
              bg={value === 'custom' ? 'shades.0' : 'transparent'}
              boxShadow={value === 'custom' ? 'sm' : 'none'}
              color={value === 'custom' ? 'neutral.900' : 'neutral.600'}
              textStyle="text/xs"
              fontWeight="medium"
              _hover={{ bg: value === 'custom' ? 'shades.0' : 'neutral.200' }}
            >
              Custom
            </Button>
          </PopoverTrigger>
          <Portal>
            <PopoverContent
              w="min(360px, calc(100vw - 32px))"
              bg="shades.0"
              borderColor="neutral.200"
              borderRadius="panel"
              boxShadow="xl"
            >
              <PopoverArrow bg="shades.0" />
              <PopoverBody p={4}>
                <Stack gap={4}>
                  <Text textStyle="text/sm" fontWeight="medium" color="neutral.900">
                    Choose a date range
                  </Text>
                  <Stack direction={{ base: 'column', sm: 'row' }} gap={3}>
                    <FormControl isInvalid={draftError !== null}>
                      <FormLabel htmlFor="portfolio-range-start" textStyle="text/xs" color="neutral.600" mb={1.5}>
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
                      <FormLabel htmlFor="portfolio-range-end" textStyle="text/xs" color="neutral.600" mb={1.5}>
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
                  <Text textStyle="text/xs" color={draftError === null ? 'neutral.500' : 'error.500'}>
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
    </Stack>
  )
}

function EmptyState(): JSX.Element {
  return (
    <Wrapper maxW="928px" w="full" py={{ base: 6, md: 8 }}>
      <Stack gap={6}>
        <PageHeading
          title="Portfolio"
          description="Choose accounts and a date range to see changes in your holdings."
        />
        <EmptyView
          border="1px solid"
          borderColor="neutral.200"
          borderRadius="panel"
          bgGradient="linear(to-b, neutral.50, shades.0)"
          title="Watch your Bitcoin grow"
          description="Add your first account to see your total Bitcoin and track your holdings over time."
          action={
            <Button as={Link} to="/accounts/add">
              Add Your First Account
            </Button>
          }
        />
      </Stack>
    </Wrapper>
  )
}
