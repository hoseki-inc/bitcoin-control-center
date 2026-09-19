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
    historyRefreshingAccountIds: [] as string[],
    historyFailedAccountIds: [] as string[],
  }
  return {
    base,
    rangeData: { ...base, historicalData: [] as Array<{ timestamp: string; totalBalance: string }> },
    previous: false,
    fetching: false,
    error: null as Error | null,
    refetch: vi.fn(),
    useQuery: vi.fn(),
    sidebar: vi.fn(),
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
  const { createElement: createMockElement } = await import('react')
  const { format } = await import('date-fns')
  return {
    Spinner: () => createMockElement('span', { 'data-spinner': true }),
    Panel: ({ children }: { children: React.ReactNode }) => createMockElement('div', null, children),
    DateInput: ({ id, value, onChange }: { id: string; value: Date | null; onChange: (value: Date) => void }) =>
      createMockElement('input', {
        id,
        type: 'date',
        value: value ? format(value, 'yyyy-MM-dd') : '',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          onChange(new Date(`${event.target.value}T00:00:00`))
        },
      }),
  }
})
vi.mock('../../components/dashboard-charts/accounts-sidebar', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    AccountsSidebar: (props: { onToggle: (id: string) => void; onClearAll: () => void }) => {
      mocks.sidebar(props)
      return createMockElement(
        'div',
        null,
        createMockElement(
          'button',
          {
            onClick: () => {
              props.onToggle('holding')
            },
          },
          'Select holding',
        ),
        createMockElement(
          'button',
          {
            onClick: () => {
              props.onToggle('wallet')
            },
          },
          'Select wallet',
        ),
        createMockElement('button', { onClick: props.onClearAll }, 'Clear selection'),
      )
    },
  }
})
vi.mock('../../components/dashboard-charts/accumulation-chart', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    AccumulationChart: ({ data }: { data: unknown }) =>
      createMockElement('div', { 'data-chart': 'accumulation' }, JSON.stringify(data)),
  }
})
vi.mock('../../components/dashboard-charts/monthly-net-change-chart', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    MonthlyNetChangeChart: ({ data }: { data: unknown }) =>
      createMockElement('div', { 'data-chart': 'monthly' }, JSON.stringify(data)),
  }
})

let root: Root
let container: HTMLDivElement

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(ChakraProvider, null, createElement(DashboardPage)))
  })
}

async function click(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidateButton) => candidateButton.textContent === label,
  )
  expect(button, `Missing button: ${label}`).toBeDefined()
  await act(async () => {
    button!.click()
  })
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
  mocks.sidebar.mockClear()
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
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('custom portfolio range UI', () => {
  it('defaults to 90 days and still allows every other preset', async () => {
    expect(mocks.useQuery.mock.calls.at(-2)![0].timeRange).toBe('90d')
    for (const [label, timeRange] of [
      ['7D', '7d'],
      ['30D', '30d'],
      ['1Y', '1y'],
      ['All', 'all'],
      ['90D', '90d'],
    ] as const) {
      await click(label)
      const [input, options] = mocks.useQuery.mock.calls.at(-2)!
      expect(input.timeRange).toBe(timeRange)
      expect(input.customDateRange).toBeUndefined()
      expect(options.enabled).toBe(true)
    }
    await click('Select holding')
    const [input, options] = mocks.useQuery.mock.calls.at(-1)!
    expect(input.timeRange).toBe('90d')
    expect(input.manualAccountIds).toEqual(['holding'])
    expect(options.enabled).toBe(true)
  })

  it.each(['Select holding', 'Clear selection'])('keeps the dashboard visible while %s loads', async (action) => {
    if (action === 'Clear selection') {
      await click('Select holding')
    }
    const loadedChart = chartData()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })
    let complete!: (value: typeof mocks.base) => void
    const pending = new Promise<typeof mocks.base>((resolve) => {
      complete = resolve
    })
    const options = { queryKey: ['portfolio', '90d', action], queryFn: () => pending, keepPreviousData: true }
    const observer = new QueryObserver(client, { ...options, enabled: false })
    const unsubscribe = observer.subscribe(() => undefined)
    try {
      observer.setOptions({ ...options, enabled: true })
      expect(observer.getCurrentResult()).toMatchObject({ data: undefined, isLoading: true, isFetching: true })
      const defaultQuery = mocks.useQuery.getMockImplementation()!
      mocks.useQuery.mockImplementation((input, queryOptions) =>
        (input.claimIds !== undefined) === (action === 'Select holding')
          ? observer.getCurrentResult()
          : defaultQuery(input, queryOptions),
      )
      await click(action)
      expect(container.textContent).toContain('Portfolio')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
      expect(chartData()).toEqual(loadedChart)
      const completedData = {
        ...mocks.base,
        historicalData: [
          { timestamp: '2026-08-05T00:00:00.000Z', totalBalance: '50' },
          { timestamp: '2026-09-05T12:00:00.000Z', totalBalance: '100' },
        ],
      }
      complete(completedData)
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data).toEqual(completedData)
      })
      await render()
      expect(chartData()).toEqual(completedData.historicalData)
    } finally {
      unsubscribe()
      client.clear()
    }
  })

  it('still shows the first-load spinner when neither query has data', async () => {
    const defaultQuery = mocks.useQuery.getMockImplementation()!
    mocks.useQuery.mockImplementation((input) => ({ ...defaultQuery(input), data: undefined, isLoading: true }))
    await render()
    expect(container.textContent).not.toContain('Portfolio')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    expect(container.querySelector('[data-spinner]')).not.toBeNull()
  })

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

  it.each(['Custom', 'All'])(
    'does not manufacture a current-balance point or change pill for empty %s history',
    async (range) => {
      await click(range)
      if (range === 'Custom') {
        await click('Apply')
      }
      expect(chartData()).toEqual([])
      expect(container.textContent).not.toContain('BTC (+0.0%)')
    },
  )

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
    const [allInput, allOptions] = mocks.useQuery.mock.calls.at(-2)!
    const [selectedInput, options] = mocks.useQuery.mock.calls.at(-1)!
    expect(allInput.customDateRange).toEqual(selectedInput.customDateRange)
    expect(allOptions.enabled).toBe(false)
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
      if (hasPreviousData) {
        client.setQueryData(['portfolio', '90d'], mocks.base)
      }
      onlineManager.setOnline(false)
      const options = { staleTime: 300_000, keepPreviousData: true }
      const observer = new QueryObserver(client, {
        ...options,
        queryKey: ['portfolio', '90d'],
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
        if (selection === 'filtered') {
          await click('Select holding')
        }
        await click('Custom')
        await changeDate('portfolio-range-start', '2020-01-01')
        await changeDate('portfolio-range-end', '2020-01-03')
        await click('Apply')
        expect(fetchRange).not.toHaveBeenCalled()
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
        expect(container.textContent?.match(/Preparing history for this date range/g)).toHaveLength(2)
        expect(container.textContent).not.toContain('BTC (+0.0%)')

        onlineManager.setOnline(true)
        await vi.waitFor(() => {
          expect(observer.getCurrentResult().data).toEqual(completedData)
        })
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

  it.each(['All', 'Custom'])('keeps an already certified %s chart visible during tail updates', async (range) => {
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await click(range)
    if (range === 'Custom') {
      await click('Apply')
    }
    const loadedChart = chartData()
    mocks.rangeData = {
      ...mocks.rangeData,
      // A partial refresh must not replace the certified chart with new values.
      historicalData: [{ timestamp: '2026-09-05T12:00:00.000Z', totalBalance: '999' }],
      historySyncedAccountIds: [],
      historySyncingAccountIds: ['wallet'],
      historyRefreshingAccountIds: ['wallet'],
    }
    await render()
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
    expect(chartData()).toEqual(loadedChart)
    expect(container.textContent).toContain('Updating history')
    expect(container.textContent).not.toContain('Preparing history for this date range')
  })

  it('keeps loading if any selected wallet still needs its initial history', async () => {
    mocks.rangeData = {
      ...mocks.base,
      historySyncingAccountIds: ['wallet', 'new-wallet'],
      historyRefreshingAccountIds: ['wallet'],
    }
    await click('All')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    expect(container.textContent).toContain('Preparing history for this date range')
  })

  it('does not reuse an All chart or a partial prefix for a newly requested custom range', async () => {
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await click('All')
    mocks.rangeData = {
      ...mocks.base,
      historySyncingAccountIds: ['wallet'],
      historyRefreshingAccountIds: ['wallet'],
    }
    await click('Custom')
    await changeDate('portfolio-range-start', '2020-01-01')
    await click('Apply')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
    expect(container.textContent).toContain('Preparing history for this date range')
  })

  it.each([false, true])('explains failed history and continues polling (refresh: %s)', async (refresh) => {
    const interval = vi.spyOn(window, 'setInterval')
    if (refresh) {
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
      await click('All')
    }
    mocks.rangeData = {
      ...mocks.base,
      historySyncingAccountIds: ['wallet'],
      historyFailedAccountIds: ['wallet'],
      historyRefreshingAccountIds: refresh ? ['wallet'] : [],
    }
    if (refresh) {
      await render()
    } else {
      await click('All')
    }
    expect(container.textContent).toContain("Wallet history couldn't be loaded. Retrying automatically.")
    expect(container.textContent).not.toContain('Preparing history for this date range')
    expect(container.textContent).not.toContain('All synced')
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(refresh ? 2 : 0)
    const poll = interval.mock.calls.find(([, delay]) => delay === 10_000)![0] as () => void
    await act(async () => {
      poll()
    })
    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await render()
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
    expect(container.textContent).not.toContain('Retrying automatically')
  })

  it.each(['90D', '1Y', 'All', 'Custom'])(
    'warns about failed background refreshes without hiding a loaded %s chart',
    async (range) => {
      const client = new QueryClient({
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        defaultOptions: { queries: { retry: false, cacheTime: 0 } },
      })
      client.setQueryData(['portfolio', range], mocks.base)
      const observer = new QueryObserver(client, {
        queryKey: ['portfolio', range],
        queryFn: async () => {
          throw new Error('Connection lost')
        },
        staleTime: 300_000,
        keepPreviousData: true,
      })
      const unsubscribe = observer.subscribe(() => undefined)
      try {
        const failed = await observer.refetch()
        expect(failed).toMatchObject({ status: 'error', data: mocks.base, isPreviousData: false })
        mocks.useQuery.mockImplementation(() => failed)
        if (range === '90D') {
          await render()
        } else {
          await click(range)
          if (range === 'Custom') {
            await click('Apply')
          }
        }
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
        expect(container.textContent).toContain("Couldn't refresh this date range. Showing previously loaded data.")
        expect(container.textContent).not.toContain('All synced')
        expect(container.textContent).not.toContain('No verified claims yet')
      } finally {
        unsubscribe()
        client.clear()
      }
    },
  )

  it.each(['failed', 'disabled/loading'])(
    'does not let a %s all-account query hide selected wallet data',
    async (state) => {
      mocks.holdings = []
      mocks.claims = [{ id: 'wallet', displayName: 'Test wallet' }]
      await render()
      await click('Select wallet')
      const defaultQuery = mocks.useQuery.getMockImplementation()!
      mocks.useQuery.mockImplementation((input) => ({
        ...defaultQuery(input),
        data: input.claimIds ? { ...mocks.base, verifiedClaimsCount: 1, manualAccountCount: 0 } : undefined,
        isLoading: !input.claimIds && state === 'disabled/loading',
        error: !input.claimIds && state === 'failed' ? new Error('All-account request failed') : null,
      }))
      await render()
      await click('Custom')
      await click('Apply')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
      expect(container.textContent).not.toContain('No verified claims yet')
      const [allInput, allOptions] = mocks.useQuery.mock.calls.at(-2)!
      const [filteredInput, filteredOptions] = mocks.useQuery.mock.calls.at(-1)!
      expect(allOptions.enabled).toBe(false)
      expect(filteredOptions.enabled).toBe(true)
      expect(allInput.customDateRange).toEqual(filteredInput.customDateRange)
    },
  )

  it('uses selected-range sync status in the sidebar and ignores completion from a previous view', async () => {
    mocks.claims = [{ id: 'wallet', displayName: 'Test wallet' }]
    await render()
    await click('Select wallet')
    mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['wallet'] }
    const defaultQuery = mocks.useQuery.getMockImplementation()!
    mocks.useQuery.mockImplementation((input, options) =>
      input.claimIds === undefined && options.enabled === false
        ? { ...defaultQuery(input), data: { ...mocks.base, historySyncedAccountIds: ['wallet'] } }
        : defaultQuery(input),
    )
    await click('Custom')
    await click('Apply')
    expect(mocks.sidebar.mock.lastCall![0].historySyncingAccountIds).toEqual(['wallet'])
    expect(mocks.sidebar.mock.lastCall![0].recentlySyncedAccountIds).toEqual([])

    // Clearing the selection briefly exposes cached data from another query.
    mocks.previous = true
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await click('Clear selection')
    expect(mocks.sidebar.mock.lastCall![0].recentlySyncedAccountIds).toEqual([])
    expect(container.textContent).not.toContain('All synced')

    mocks.previous = false
    mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['wallet'] }
    await render()
    mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['wallet'] }
    await render()
    expect(mocks.sidebar.mock.lastCall![0].recentlySyncedAccountIds).toEqual(['wallet'])
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
      client.setQueryData(['portfolio', '90d'], portfolioData)
      const options = { staleTime: 300_000, keepPreviousData: true }
      const observer = new QueryObserver(client, { ...options, queryKey: ['portfolio', '90d'] })
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
        if (range === 'Custom') {
          await click('Apply')
        }

        expect(container.textContent).toContain("Couldn't load this date range: Connection lost")
        expect(container.textContent).not.toContain('No verified claims yet')
        expect(container.textContent).not.toContain('Add Your First Claim')
        expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
        await click('Try again')
        await vi.waitFor(() => {
          expect(observer.getCurrentResult().status).toBe('success')
        })
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
    await act(async () => {
      ;(poll as () => void)()
    })
    expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
  })
})
