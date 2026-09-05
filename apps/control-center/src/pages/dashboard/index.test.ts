// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './index'

const mocks = vi.hoisted(() => {
  const base = {
    currentTotalBalance: '100',
    currentBtcPrice: '50000',
    verifiedClaimsCount: 0,
    exchangeAccountCount: 0,
    manualAccountCount: 1,
    etfAccountCount: 0,
    historicalData: [{ timestamp: '2026-08-05T00:00:00.000Z', totalBalance: '100' }],
    historySyncingAccountIds: [] as string[],
    historySyncedAccountIds: [] as string[],
  }
  return {
    base,
    rangeData: { ...base, historicalData: [] as Array<{ timestamp: string; totalBalance: string }> },
    previous: false,
    fetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
    useQuery: vi.fn(),
    recordSnapshot: { mutate: vi.fn() },
    claims: [] as Array<{ id: string; displayName: string }>,
    holdings: [{ id: 'holding', displayName: 'Test holding', balance: '100' }],
  }
})

vi.mock('../../trpc', () => {
  const emptyList = { data: [], isLoading: false }
  return {
    trpc: {
      portalProve: {
        controlCenter: {
          getData: { useQuery: mocks.useQuery },
          recordSnapshot: { useMutation: () => mocks.recordSnapshot },
        },
        registry: { claims: { list: { useQuery: () => ({ data: mocks.claims, isLoading: false }) } } },
        exchange: { list: { useQuery: () => emptyList } },
        etf: { list: { useQuery: () => emptyList } },
        manual: { list: { useQuery: () => ({ data: mocks.holdings, isLoading: false }) } },
        retrieveBitcoinPrice: { useQuery: () => ({ data: { value: 50_000 }, isLoading: false }) },
      },
    },
  }
})
vi.mock('../../hooks/use-auto-refresh-exchanges', () => ({ useAutoRefreshExchanges: () => undefined }))
vi.mock('../../lib/balances', () => ({ useGetBalancesPerClaimIds: () => ({ data: new Map() }) }))
vi.mock('../../utils/timezone', () => ({ getBrowserTimezone: () => 'UTC' }))
vi.mock('react-router', () => ({ useNavigate: () => vi.fn(), Link: 'a' }))
vi.mock('@hoseki/packages/ui/design-system', async () => {
  const { createElement } = await import('react')
  const { format } = await import('date-fns')
  return {
    Spinner: () => createElement('span', { 'data-spinner': true }),
    Panel: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
    DateInput: ({ id, value, onChange }: { id: string; value: Date | null; onChange: (value: Date) => void }) =>
      createElement('input', {
        id,
        type: 'date',
        value: value ? format(value, 'yyyy-MM-dd') : '',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(new Date(`${event.target.value}T00:00:00`)),
      }),
  }
})
vi.mock('../../components/dashboard-charts/accounts-sidebar', async () => {
  const { createElement } = await import('react')
  return {
    AccountsSidebar: ({ onToggle }: { onToggle: (id: string) => void }) =>
      createElement('button', { onClick: () => onToggle('holding') }, 'Select holding'),
  }
})
vi.mock('../../components/dashboard-charts/accumulation-chart', async () => {
  const { createElement } = await import('react')
  return {
    AccumulationChart: ({ data }: { data: unknown }) =>
      createElement('div', { 'data-chart': 'accumulation' }, JSON.stringify(data)),
  }
})
vi.mock('../../components/dashboard-charts/monthly-net-change-chart', async () => {
  const { createElement } = await import('react')
  return {
    MonthlyNetChangeChart: ({ data }: { data: unknown }) =>
      createElement('div', { 'data-chart': 'monthly' }, JSON.stringify(data)),
  }
})

let root: Root
let container: HTMLDivElement

async function render(): Promise<void> {
  await act(async () => root.render(createElement(ChakraProvider, null, createElement(DashboardPage))))
}

async function click(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === label)
  expect(button, `Missing button: ${label}`).toBeDefined()
  await act(async () => button!.click())
}

async function changeDate(id: string, value: string): Promise<void> {
  const input = document.getElementById(id) as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function chartData(): unknown {
  return JSON.parse(container.querySelector('[data-chart="accumulation"]')!.textContent!)
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'))
  mocks.previous = false
  mocks.fetching = false
  mocks.error = null
  mocks.claims = []
  mocks.holdings = [{ id: 'holding', displayName: 'Test holding', balance: '100' }]
  mocks.rangeData = { ...mocks.base, historicalData: [], historySyncingAccountIds: [] }
  mocks.refetch.mockReset()
  mocks.useQuery
    .mockReset()
    .mockImplementation((input: { customDateRange?: unknown; claimIds?: unknown; timeRange: string }) => {
      const fullRange = input.customDateRange !== undefined || input.timeRange === 'all'
      return {
        data: fullRange ? mocks.rangeData : mocks.base,
        isLoading: false,
        isFetching: fullRange && mocks.fetching,
        isPreviousData: fullRange && mocks.previous,
        error: fullRange ? mocks.error : null,
        refetch: mocks.refetch,
      }
    })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('custom portfolio range UI', () => {
  it('only applies the draft dates on Apply, not while opening or editing the selector', async () => {
    await click('Custom')
    await changeDate('portfolio-range-start', '2020-01-01')
    await changeDate('portfolio-range-end', '2020-01-03')
    expect(mocks.useQuery.mock.calls.some(([input]) => input.customDateRange)).toBe(false)
    await click('Apply')
    expect(
      mocks.useQuery.mock.calls.some(
        ([input]) =>
          input.customDateRange?.startDate === '2020-01-01' && input.customDateRange?.endDate === '2020-01-03',
      ),
    ).toBe(true)
  })

  it('does not manufacture a current-balance point or change pill for empty custom history ending today', async () => {
    await click('Custom')
    await click('Apply')
    expect(chartData()).toEqual([])
    expect(container.textContent).not.toContain('BTC (+0.0%)')
  })

  it('does not append today to a historical range', async () => {
    mocks.rangeData.historicalData = [
      { timestamp: '2020-01-01T00:00:00.000Z', totalBalance: '50' },
      { timestamp: '2020-01-03T23:59:59.999Z', totalBalance: '75' },
    ]
    await click('Custom')
    await changeDate('portfolio-range-start', '2020-01-01')
    await changeDate('portfolio-range-end', '2020-01-03')
    await click('Apply')
    expect(chartData()).toEqual(mocks.rangeData.historicalData)
  })

  it('keeps cancelled drafts out of the query and prevents inverted dates', async () => {
    await click('Custom')
    await changeDate('portfolio-range-start', '2020-01-03')
    await changeDate('portfolio-range-end', '2020-01-01')
    const apply = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Apply')!
    expect(apply.disabled).toBe(true)
    await click('Cancel')
    expect(mocks.useQuery.mock.calls.some(([input]) => input.customDateRange)).toBe(false)
  })

  it('loads the selected accounts without waiting for an all-account custom request', async () => {
    await click('Select holding')
    await click('Custom')
    await click('Apply')
    const [allInput] = mocks.useQuery.mock.calls.at(-2)!
    const [selectedInput, options] = mocks.useQuery.mock.calls.at(-1)!
    expect(allInput.customDateRange).toBeUndefined()
    expect(selectedInput.manualAccountIds).toEqual(['holding'])
    expect(selectedInput.customDateRange).toBeDefined()
    expect(options.enabled).toBe(true)
  })

  it('shows loading in both charts instead of previous-range values', async () => {
    mocks.rangeData = { ...mocks.base }
    mocks.previous = true
    mocks.fetching = true
    await click('Custom')
    await click('Apply')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    expect(container.textContent?.match(/Preparing history for this date range/g)).toHaveLength(2)
  })

  it.each([
    { selection: 'all', hasPreviousData: true },
    { selection: 'filtered', hasPreviousData: true },
    { selection: 'filtered', hasPreviousData: false },
  ])(
    'waits for an offline $selection range (previous data: $hasPreviousData)',
    async ({ selection, hasPreviousData }) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })
      client.mount()
      if (hasPreviousData) client.setQueryData(['portfolio', '1y'], mocks.base)
      onlineManager.setOnline(false)
      const options = { staleTime: 300_000, keepPreviousData: true }
      const observer = new QueryObserver(client, {
        ...options,
        queryKey: ['portfolio', '1y'],
        queryFn: async () => mocks.base,
      })
      const unsubscribe = observer.subscribe(() => undefined)
      const completedData = {
        ...mocks.base,
        historicalData: [
          { timestamp: '2020-01-01T00:00:00.000Z', totalBalance: '50' },
          { timestamp: '2020-01-03T23:59:59.999Z', totalBalance: '75' },
        ],
      }
      const fetchRange = vi.fn(async () => completedData)

      try {
        observer.setOptions({ ...options, queryKey: ['portfolio', 'custom'], queryFn: fetchRange })
        expect(observer.getCurrentResult()).toMatchObject({
          isPaused: true,
          isFetching: false,
          isPreviousData: hasPreviousData,
          error: null,
        })
        const defaultQuery = mocks.useQuery.getMockImplementation()!
        mocks.useQuery.mockImplementation((input) =>
          input.customDateRange ? observer.getCurrentResult() : defaultQuery(input),
        )
        if (selection === 'filtered') await click('Select holding')
        await click('Custom')
        await changeDate('portfolio-range-start', '2020-01-01')
        await changeDate('portfolio-range-end', '2020-01-03')
        await click('Apply')
        expect(fetchRange).not.toHaveBeenCalled()
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
        expect(container.textContent?.match(/Preparing history for this date range/g)).toHaveLength(2)
        expect(container.textContent).not.toContain('BTC (+0.0%)')

        onlineManager.setOnline(true)
        await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(completedData))
        await render()
        expect(fetchRange).toHaveBeenCalledTimes(1)
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
        expect(chartData()).toEqual(completedData.historicalData)
      } finally {
        unsubscribe()
        client.unmount()
        client.clear()
        onlineManager.setOnline(true)
      }
    },
  )

  it('keeps loading during full-history backfill and shows both charts on completion', async () => {
    mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['wallet'] }
    await click('All')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await render()
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
  })

  it('shows a recoverable error instead of stale history when the selected range fails', async () => {
    mocks.rangeData = { ...mocks.base }
    mocks.previous = true
    mocks.error = new Error('Request failed')
    await click('Custom')
    await click('Apply')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    expect(container.textContent).toContain("Couldn't load this date range: Request failed")
    await click('Try again')
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { range: 'Custom', archivedOnly: false },
    { range: 'All', archivedOnly: false },
    { range: 'All', archivedOnly: true },
  ])(
    'keeps a failed $range request recoverable without other holdings (archived only: $archivedOnly)',
    async ({ range, archivedOnly }) => {
      mocks.holdings = []
      mocks.claims = archivedOnly ? [] : [{ id: 'wallet', displayName: 'Test wallet' }]
      const portfolioData = { ...mocks.base, verifiedClaimsCount: archivedOnly ? 0 : 1, manualAccountCount: 0 }
      const client = new QueryClient({
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        defaultOptions: { queries: { retry: false, cacheTime: 0 } },
      })
      client.setQueryData(['portfolio', '1y'], portfolioData)
      const options = { staleTime: 300_000, keepPreviousData: true }
      const observer = new QueryObserver(client, { ...options, queryKey: ['portfolio', '1y'] })
      const unsubscribe = observer.subscribe(() => undefined)
      const fetchRange = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(portfolioData)

      try {
        observer.setOptions({ ...options, queryKey: ['portfolio', range], queryFn: fetchRange })
        const failedResult = await observer.refetch({ cancelRefetch: false })
        // Unlike a failed background refresh, a failed new range drops previous data.
        expect(failedResult).toMatchObject({ status: 'error', data: undefined, isPreviousData: false })
        const defaultQuery = mocks.useQuery.getMockImplementation()!
        mocks.useQuery.mockImplementation((input) =>
          input.customDateRange || input.timeRange === 'all'
            ? observer.getCurrentResult()
            : { ...defaultQuery(input), data: portfolioData },
        )
        await render()
        await click(range)
        if (range === 'Custom') await click('Apply')

        expect(container.textContent).toContain("Couldn't load this date range: Connection lost")
        expect(container.textContent).not.toContain('No verified claims yet')
        expect(container.textContent).not.toContain('Add Your First Claim')
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
        await click('Try again')
        await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
        await render()
        expect(fetchRange).toHaveBeenCalledTimes(2)
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
        expect(container.textContent).not.toContain("Couldn't load this date range")
      } finally {
        unsubscribe()
        client.clear()
      }
    },
  )

  it('still shows the empty state after successfully loading a genuinely empty portfolio', async () => {
    mocks.holdings = []
    const defaultQuery = mocks.useQuery.getMockImplementation()!
    mocks.useQuery.mockImplementation((input) => ({
      ...defaultQuery(input),
      data: { ...mocks.base, currentTotalBalance: '0', manualAccountCount: 0, historicalData: [] },
    }))
    await render()
    expect(container.textContent).toContain('No verified claims yet')
    expect(container.textContent).not.toContain("Couldn't load this date range")
  })

  it('does not let polling cancel a slow request that is still running', async () => {
    const interval = vi.spyOn(window, 'setInterval')
    mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['wallet'] }
    await click('All')
    const poll = interval.mock.calls.find(([, delay]) => delay === 10_000)?.[0]
    expect(typeof poll).toBe('function')
    await act(async () => (poll as () => void)())
    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
  })
})
