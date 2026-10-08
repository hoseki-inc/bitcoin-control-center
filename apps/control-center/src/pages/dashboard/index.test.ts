// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import { parseUnknown } from '@hoseki/packages/result'
import type { ClaimId } from '@hoseki/packages/schemas'
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query'
import { format } from 'date-fns'
import Decimal from 'decimal.js'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import type { AccountFilter } from '../../components/dashboard-charts/account-filter'
import { claimFixture } from '../../testing/claims'
import type { RouterInput } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import type { DashboardDataSource, PortfolioQuery } from './dashboard-data'
import { DashboardPage, type DashboardViews } from './index'

type SidebarProps = Parameters<typeof AccountFilter>[0]

const browser = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  let initialDom: ReturnType<typeof createBrowserDom> | undefined = createBrowserDom()
  installBrowserDom(initialDom)
  return {
    acquire: () => {
      const dom = initialDom ?? createBrowserDom()
      initialDom = undefined
      installBrowserDom(dom)
      return dom
    },
  }
})

const mocks = vi.hoisted(() => {
  let error: Error | null = null
  const claims: ClaimDto[] = []
  const base: NonNullable<PortfolioQuery['data']> = {
    currentTotalBalance: '100',
    currentBtcPrice: '50000',
    verifiedClaimsCount: 0,
    exchangeAccountCount: 0,
    manualAccountCount: 1,
    etfAccountCount: 0,
    historicalData: [{ timestamp: '2026-08-05T00:00:00.000Z', totalBalance: '100' }],
    historySyncingAccountIds: Array<string>(),
    historySyncedAccountIds: Array<string>(),
    historyRefreshingAccountIds: Array<string>(),
    historyFailedAccountIds: Array<string>(),
    walletBalancesAsOf: null,
  }
  return {
    base,
    rangeData: { ...base, historicalData: Array<{ timestamp: string; totalBalance: string }>() },
    previous: false,
    fetching: false,
    get error() {
      return error
    },
    set error(value: Error | null) {
      error = value
    },
    refetch: vi.fn(),
    useQuery:
      vi.fn<
        (
          input: Exclude<RouterInput['portalProve']['controlCenter']['getData'], void>,
          options?: { enabled: boolean },
        ) => PortfolioQuery
      >(),
    sidebar: vi.fn<(props: SidebarProps) => void>(),
    recordSnapshot: { mutate: vi.fn() },
    btcPrice: 50_000,
    balances: new Map<ClaimId, BalanceValue | null>(),
    balancesFailed: false,
    claims,
    holdings: [
      {
        id: 'holding',
        displayName: 'Test holding',
        balance: '100',
        currency: 'BTC' as const,
        balanceAsOf: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
  }
})

const dataSource: DashboardDataSource = {
  useAccounts: () => ({
    recordSnapshot: mocks.recordSnapshot,
    claimsQuery: { data: mocks.claims, isLoading: false },
    exchangeAccountsQuery: { data: [], isLoading: false },
    manualAccountsQuery: { data: mocks.holdings, isLoading: false },
    etfAccountsQuery: { data: [], isLoading: false },
    btcPriceQuery: {
      data: {
        value: new Decimal(mocks.btcPrice),
        asOf: new Date('2026-01-01T00:00:00Z'),
        source: 'block',
        lastKnown: false,
      },
      isLoading: false,
    },
  }),
  useHistory: (input, options) => mocks.useQuery(input, options),
  useBalances: () => ({ data: mocks.balances, balancesFailed: mocks.balancesFailed }),
  useAutoRefresh: () => undefined,
  getTimezone: () => 'UTC',
}
const views: DashboardViews = {
  DateInput: ({ id, value, onChange }) =>
    createElement('input', {
      id,
      type: 'date',
      value: value ? format(value, 'yyyy-MM-dd') : '',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(new Date(`${event.target.value}T00:00:00`))
      },
    }),
  AccountFilter: (props: SidebarProps) => {
    mocks.sidebar(props)
    return createElement(
      'div',
      null,
      createElement(
        'button',
        {
          onClick: () => {
            props.onSelectionChange(new Set(['holding']))
          },
        },
        'Select holding',
      ),
      createElement(
        'button',
        {
          onClick: () => {
            props.onSelectionChange(new Set(['re_clmx_wallet']))
          },
        },
        'Select wallet',
      ),
      createElement(
        'button',
        {
          onClick: () => {
            props.onSelectionChange(new Set())
          },
        },
        'Clear selection',
      ),
    )
  },

  AccumulationChart: ({ data }) => createElement('div', { 'data-chart': 'accumulation' }, JSON.stringify(data)),
  MonthlyNetChangeChart: ({ data }) => createElement('div', { 'data-chart': 'monthly' }, JSON.stringify(data)),
}

let root: Root
let container: HTMLDivElement

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(MemoryRouter, null, createElement(DashboardPage, { dataSource, views })),
      ),
    )
  })
}

async function click(label: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidateButton) => candidateButton.textContent === label,
  )
  assert.exists(button, `Missing button: ${label}`)
  await act(async () => {
    button.click()
  })
}

async function changeDate(id: string, value: string): Promise<void> {
  const input = document.getElementById(id)
  assert(input instanceof HTMLInputElement, 'Expected a date input')
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    assert(descriptor?.set !== undefined, 'Expected the input value setter')
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(JsonValueSchema), z.record(JsonValueSchema)]),
)

function chartData(): JsonValue {
  const content = container.querySelector('[data-chart="accumulation"]')?.textContent
  assert.exists(content, 'Expected accumulation chart data')
  // SAFETY: DOM text is JSON from the chart renderer; parseUnknown below verifies the full recursive JSON shape.
  return parseUnknown(JsonValueSchema, JSON.parse(content) as unknown).expect('Expected JSON chart data')
}

function getQueryCall(
  index: number,
): [Exclude<RouterInput['portalProve']['controlCenter']['getData'], void>, { enabled: boolean }] {
  const call = mocks.useQuery.mock.calls.at(index)
  assert.exists(call, `Missing query call at index ${index}`)
  assert.exists(call[1], 'Expected query options')
  return [call[0], call[1]]
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  const lifecycle = { finished: false }
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    lifecycle.finished = true

    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
    vi.useRealTimers()
  })
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
  mocks.btcPrice = 50_000
  mocks.balances = new Map()
  mocks.balancesFailed = false
  mocks.claims = []
  mocks.holdings = [
    {
      id: 'holding',
      displayName: 'Test holding',
      balance: '100',
      currency: 'BTC' as const,
      balanceAsOf: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ]
  mocks.rangeData = { ...mocks.base, historicalData: [], historySyncingAccountIds: [] }
  mocks.refetch.mockReset()
  mocks.sidebar.mockClear()
  mocks.useQuery.mockReset().mockImplementation((input) => {
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
  if (lifecycle.finished) {
    return
  }

  await run()
}

describe('custom portfolio range UI', () => {
  it('defaults to 90 days and still allows every other preset', async () => {
    await withTestSetup(async () => {
      expect(getQueryCall(-2)[0].timeRange).toBe('90d')
      for (const [label, timeRange] of [
        ['7D', '7d'],
        ['30D', '30d'],
        ['1Y', '1y'],
        ['All', 'all'],
        ['90D', '90d'],
      ] as const) {
        await click(label)
        const [input, options] = getQueryCall(-2)
        expect(input.timeRange).toBe(timeRange)
        expect(input.customDateRange).toBeUndefined()
        expect(options.enabled).toBe(true)
      }
      await click('Select holding')
      const [input, options] = getQueryCall(-1)
      expect(input.timeRange).toBe('90d')
      expect(input.manualAccountIds).toEqual(['holding'])
      expect(options.enabled).toBe(true)
    })
  })

  it.each(['Select holding', 'Clear selection'])('keeps the dashboard visible while %s loads', async (action) => {
    await withTestSetup(async () => {
      if (action === 'Clear selection') {
        await click('Select holding')
      }
      const loadedChart = chartData()
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })
      let complete!: (value: typeof mocks.base) => void
      const pending = new Promise<typeof mocks.base>((resolve) => {
        complete = resolve
      })
      const options = { queryKey: ['portfolio', '90d', action], queryFn: async () => pending, keepPreviousData: true }
      const observer = new QueryObserver<typeof mocks.base, Error>(client, { ...options, enabled: false })
      const unsubscribe = observer.subscribe(() => undefined)
      try {
        observer.setOptions({ ...options, enabled: true })
        expect(observer.getCurrentResult()).toMatchObject({ data: undefined, isLoading: true, isFetching: true })
        const defaultQuery = mocks.useQuery.getMockImplementation()
        assert.exists(defaultQuery, 'Expected the default query implementation')
        mocks.useQuery.mockImplementation((input, queryOptions) =>
          (input.claimIds !== undefined) === (action === 'Select holding')
            ? observer.getCurrentResult()
            : defaultQuery(input, queryOptions),
        )
        await click(action)
        expect(container.textContent).toContain('Generate Statement')
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
  })

  it('never appends a newly selected balance to the retained chart and ignores a late abandoned view', async () => {
    await withTestSetup(async () => {
      mocks.holdings = [
        {
          id: 'holding',
          displayName: 'Test holding',
          balance: '25',
          currency: 'BTC' as const,
          balanceAsOf: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'other',
          displayName: 'Other holding',
          balance: '75',
          currency: 'BTC' as const,
          balanceAsOf: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      await render()
      const loadedChart = chartData()
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      let abandonedData: typeof mocks.base | undefined
      mocks.useQuery.mockImplementation((input, options) => {
        if (input.claimIds === undefined) {
          return defaultQuery(input, options)
        }
        return {
          data: input.manualAccountIds?.includes('holding') === true ? abandonedData : undefined,
          isLoading: true,
          isFetching: true,
          isPreviousData: false,
          error: null,
          refetch: mocks.refetch,
        }
      })
      await click('Select holding')
      expect(chartData()).toEqual(loadedChart)
      expect(container.querySelectorAll('[inert]')).toHaveLength(2)
      expect(container.querySelector('output')?.textContent).toBe('Updating history')
      await click('Select wallet')
      abandonedData = {
        ...mocks.base,
        historicalData: [{ timestamp: '2026-08-05T00:00:00.000Z', totalBalance: '999' }],
      }
      await render()
      expect(chartData()).toEqual(loadedChart)
      expect(container.textContent).not.toContain('999')
      await click('Clear selection')
      expect(container.querySelectorAll('[inert]')).toHaveLength(0)
      expect(chartData()).toEqual(loadedChart)
    })
  })

  it('still shows the first-load spinner when neither query has data', async () => {
    await withTestSetup(async () => {
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      mocks.useQuery.mockImplementation((input) => ({ ...defaultQuery(input), data: undefined, isLoading: true }))
      await render()
      expect(container.textContent).not.toContain('Generate Statement')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
      expect(container.querySelector('.chakra-spinner')).not.toBeNull()
    })
  })

  it('only applies the draft dates on Apply, not while opening or editing the selector', async () => {
    await withTestSetup(async () => {
      await click('Custom')
      await changeDate('portfolio-range-start', '2020-01-01')
      await changeDate('portfolio-range-end', '2020-01-03')
      expect(mocks.useQuery.mock.calls.some(([input]) => input.customDateRange)).toBe(false)
      await click('Apply')
      expect(
        mocks.useQuery.mock.calls.some(
          ([input]) =>
            input.customDateRange?.startDate === '2020-01-01' && input.customDateRange.endDate === '2020-01-03',
        ),
      ).toBe(true)
    })
  })

  it.each(['Custom', 'All'])(
    'does not manufacture a current-balance point or change pill for empty %s history',
    async (range) => {
      await withTestSetup(async () => {
        await click(range)
        if (range === 'Custom') {
          await click('Apply')
        }
        expect(chartData()).toEqual([])
        expect(container.textContent).not.toContain('BTC (+0.0%)')
      })
    },
  )

  it('does not append today to a historical range', async () => {
    await withTestSetup(async () => {
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
  })

  it('keeps cancelled drafts out of the query and prevents inverted dates', async () => {
    await withTestSetup(async () => {
      await click('Custom')
      await changeDate('portfolio-range-start', '2020-01-03')
      await changeDate('portfolio-range-end', '2020-01-01')
      const apply = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Apply')
      assert.exists(apply, 'Missing Apply button')
      expect(apply.disabled).toBe(true)
      await click('Cancel')
      expect(mocks.useQuery.mock.calls.some(([input]) => input.customDateRange)).toBe(false)
    })
  })

  it('loads the selected accounts without waiting for an all-account custom request', async () => {
    await withTestSetup(async () => {
      await click('Select holding')
      await click('Custom')
      await click('Apply')
      const [allInput, allOptions] = getQueryCall(-2)
      const [selectedInput, options] = getQueryCall(-1)
      expect(allInput.customDateRange).toEqual(selectedInput.customDateRange)
      expect(allOptions.enabled).toBe(false)
      expect(selectedInput.manualAccountIds).toEqual(['holding'])
      expect(selectedInput.customDateRange).toBeDefined()
      expect(options.enabled).toBe(true)
    })
  })

  it('shows loading in both charts instead of previous-range values', async () => {
    await withTestSetup(async () => {
      mocks.rangeData = { ...mocks.base }
      mocks.previous = true
      mocks.fetching = true
      await click('Custom')
      await click('Apply')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
      expect(container.textContent.match(/Preparing history for this date range/g)).toHaveLength(2)
    })
  })

  it.each([
    { selection: 'all', hasPreviousData: true },
    { selection: 'filtered', hasPreviousData: true },
    { selection: 'filtered', hasPreviousData: false },
  ])(
    'waits for an offline $selection range (previous data: $hasPreviousData)',
    async ({ selection, hasPreviousData }) => {
      await withTestSetup(async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, cacheTime: 0 } } })
        client.mount()
        if (hasPreviousData) {
          client.setQueryData(['portfolio', '90d'], mocks.base)
        }
        onlineManager.setOnline(false)
        const options = { staleTime: 300_000, keepPreviousData: true }
        const observer = new QueryObserver<typeof mocks.base, Error>(client, {
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
          const defaultQuery = mocks.useQuery.getMockImplementation()
          assert.exists(defaultQuery, 'Expected the default query implementation')
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
          expect(container.textContent.match(/Preparing history for this date range/g)).toHaveLength(2)
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
      })
    },
  )

  it('keeps loading during full-history backfill and shows both charts on completion', async () => {
    await withTestSetup(async () => {
      mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['re_clmx_wallet'] }
      await click('All')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
      await render()
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
    })
  })

  it.each(['All', 'Custom'])('keeps an already certified %s chart visible during tail updates', async (range) => {
    await withTestSetup(async () => {
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
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
        historySyncingAccountIds: ['re_clmx_wallet'],
        historyRefreshingAccountIds: ['re_clmx_wallet'],
      }
      await render()
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
      expect(chartData()).toEqual(loadedChart)
      expect(container.textContent).toContain('Updating history')
      expect(container.textContent).not.toContain('Preparing history for this date range')
    })
  })

  it('keeps loading if any selected wallet still needs its initial history', async () => {
    await withTestSetup(async () => {
      mocks.rangeData = {
        ...mocks.base,
        historySyncingAccountIds: ['re_clmx_wallet', 'new-wallet'],
        historyRefreshingAccountIds: ['re_clmx_wallet'],
      }
      await click('All')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
      expect(container.textContent).toContain('Preparing history for this date range')
    })
  })

  it('does not reuse an All chart or a partial prefix for a newly requested custom range', async () => {
    await withTestSetup(async () => {
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
      await click('All')
      mocks.rangeData = {
        ...mocks.base,
        historySyncingAccountIds: ['re_clmx_wallet'],
        historyRefreshingAccountIds: ['re_clmx_wallet'],
      }
      await click('Custom')
      await changeDate('portfolio-range-start', '2020-01-01')
      await click('Apply')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(0)
      expect(container.textContent).toContain('Preparing history for this date range')
    })
  })

  it.each([false, true])('explains failed history and continues polling (refresh: %s)', async (refresh) => {
    await withTestSetup(async () => {
      const interval = vi.spyOn(window, 'setInterval')
      if (refresh) {
        mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
        await click('All')
      }
      mocks.rangeData = {
        ...mocks.base,
        historySyncingAccountIds: ['re_clmx_wallet'],
        historyFailedAccountIds: ['re_clmx_wallet'],
        historyRefreshingAccountIds: refresh ? ['re_clmx_wallet'] : [],
      }
      if (refresh) {
        await render()
      } else {
        await click('All')
      }
      expect(container.textContent).toContain("Wallet history couldn't be loaded. Retrying automatically.")
      expect(container.textContent).not.toContain('Preparing history for this date range')
      expect(container.textContent).not.toContain('Synced')
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(refresh ? 2 : 0)
      const poll = interval.mock.calls.find(([, delay]) => delay === 10_000)?.[0]
      assert.exists(poll, 'Expected the history polling callback')
      await act(async () => {
        poll()
      })
      expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
      await render()
      expect(container.querySelectorAll('[data-chart]')).toHaveLength(2)
      expect(container.textContent).not.toContain('Retrying automatically')
    })
  })

  it.each(['90D', '1Y', 'All', 'Custom'])(
    'warns about failed background refreshes without hiding a loaded %s chart',
    async (range) => {
      await withTestSetup(async () => {
        const client = new QueryClient({
          logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
          defaultOptions: { queries: { retry: false, cacheTime: 0 } },
        })
        client.setQueryData(['portfolio', range], mocks.base)
        const observer = new QueryObserver<typeof mocks.base, Error>(client, {
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
          expect(container.textContent).not.toContain('Synced')
          expect(container.textContent).not.toContain('Watch your Bitcoin grow')
        } finally {
          unsubscribe()
          client.clear()
        }
      })
    },
  )

  it.each(['failed', 'disabled/loading'])(
    'does not let a %s all-account query hide selected wallet data',
    async (state) => {
      await withTestSetup(async () => {
        mocks.holdings = []
        mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
        await render()
        await click('Select wallet')
        const defaultQuery = mocks.useQuery.getMockImplementation()
        assert.exists(defaultQuery, 'Expected the default query implementation')
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
        expect(container.textContent).not.toContain('Watch your Bitcoin grow')
        const [allInput, allOptions] = getQueryCall(-2)
        const [filteredInput, filteredOptions] = getQueryCall(-1)
        expect(allOptions.enabled).toBe(false)
        expect(filteredOptions.enabled).toBe(true)
        expect(allInput.customDateRange).toEqual(filteredInput.customDateRange)
      })
    },
  )

  it('uses selected-range sync status in the sidebar and ignores completion from a previous view', async () => {
    await withTestSetup(async () => {
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      await render()
      await click('Select wallet')
      mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['re_clmx_wallet'] }
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      mocks.useQuery.mockImplementation((input, options) =>
        input.claimIds === undefined && options?.enabled === false
          ? { ...defaultQuery(input), data: { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] } }
          : defaultQuery(input),
      )
      await click('Custom')
      await click('Apply')
      expect(mocks.sidebar.mock.lastCall?.[0].historySyncingAccountIds).toEqual(['re_clmx_wallet'])
      expect(mocks.sidebar.mock.lastCall?.[0].recentlySyncedAccountIds).toEqual([])

      // Clearing the selection briefly exposes cached data from another query.
      mocks.previous = true
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
      await click('Clear selection')
      expect(mocks.sidebar.mock.lastCall?.[0].recentlySyncedAccountIds).toEqual([])
      expect(container.textContent).not.toContain('Synced')

      mocks.previous = false
      mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['re_clmx_wallet'] }
      await render()
      mocks.rangeData = { ...mocks.base, historySyncedAccountIds: ['re_clmx_wallet'] }
      await render()
      expect(mocks.sidebar.mock.lastCall?.[0].recentlySyncedAccountIds).toEqual(['re_clmx_wallet'])
    })
  })

  it('shows a recoverable error instead of stale history when the selected range fails', async () => {
    await withTestSetup(async () => {
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
  })

  it.each([
    { range: 'Custom', archivedOnly: false },
    { range: 'All', archivedOnly: false },
    { range: 'All', archivedOnly: true },
  ])(
    'keeps a failed $range request recoverable without other holdings (archived only: $archivedOnly)',
    async ({ range, archivedOnly }) => {
      await withTestSetup(async () => {
        mocks.holdings = []
        mocks.claims = archivedOnly ? [] : [claimFixture('re_clmx_wallet', 'Test wallet')]
        const portfolioData = { ...mocks.base, verifiedClaimsCount: archivedOnly ? 0 : 1, manualAccountCount: 0 }
        const client = new QueryClient({
          logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
          defaultOptions: { queries: { retry: false, cacheTime: 0 } },
        })
        client.setQueryData(['portfolio', '90d'], portfolioData)
        const options = { staleTime: 300_000, keepPreviousData: true }
        const observer = new QueryObserver<typeof mocks.base, Error>(client, {
          ...options,
          queryKey: ['portfolio', '90d'],
        })
        const unsubscribe = observer.subscribe(() => undefined)
        const fetchRange = vi
          .fn<() => Promise<typeof mocks.base>>()
          .mockRejectedValueOnce(new Error('Connection lost'))
          .mockResolvedValue(portfolioData)

        try {
          observer.setOptions({ ...options, queryKey: ['portfolio', range], queryFn: fetchRange })
          const failedResult = await observer.refetch({ cancelRefetch: false })
          // Unlike a failed background refresh, a failed new range drops previous data.
          expect(failedResult).toMatchObject({ status: 'error', data: undefined, isPreviousData: false })
          const defaultQuery = mocks.useQuery.getMockImplementation()
          assert.exists(defaultQuery, 'Expected the default query implementation')
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
          expect(container.textContent).not.toContain('Watch your Bitcoin grow')
          expect(container.textContent).not.toContain('Add Your First Account')
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
      })
    },
  )

  it('still shows the empty state after successfully loading a genuinely empty portfolio', async () => {
    await withTestSetup(async () => {
      mocks.holdings = []
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      mocks.useQuery.mockImplementation((input) => ({
        ...defaultQuery(input),
        data: { ...mocks.base, currentTotalBalance: '0', manualAccountCount: 0, historicalData: [] },
      }))
      await render()
      expect(container.textContent).toContain('Watch your Bitcoin grow')
      expect(container.querySelector('a[href="/accounts/add"]')?.textContent).toBe('Add Your First Account')
      expect(container.textContent).not.toContain("Couldn't load this date range")
    })
  })

  it('does not let polling cancel a slow request that is still running', async () => {
    await withTestSetup(async () => {
      const interval = vi.spyOn(window, 'setInterval')
      mocks.rangeData = { ...mocks.base, historySyncingAccountIds: ['re_clmx_wallet'] }
      await click('All')
      const poll = interval.mock.calls.find(([, delay]) => delay === 10_000)?.[0]
      assert.exists(poll, 'Expected a polling callback')
      await act(async () => {
        poll()
      })
      expect(mocks.refetch).toHaveBeenCalledWith({ cancelRefetch: false })
    })
  })
})

it('uses the same current price for the headline and sidebar when history has an older price', async () => {
  await withTestSetup(async () => {
    const previousPrice = mocks.base.currentBtcPrice
    onTestFinished(() => {
      mocks.base.currentBtcPrice = previousPrice
    })
    mocks.base.currentBtcPrice = '83000'
    const [holding] = mocks.holdings
    assert.exists(holding)
    holding.balance = '100000000'
    await render()
    expect(container.textContent).toContain('$50,000.00')
    expect(container.textContent).not.toContain('$83,000.00')
    expect(mocks.sidebar.mock.lastCall?.[0].btcPrice).toBe(50000)
  })
})

describe('range summary', () => {
  async function renderHistory(points: [string, number][], currentSats: number): Promise<void> {
    const previousHistory = mocks.base.historicalData
    onTestFinished(() => {
      mocks.base.historicalData = previousHistory
    })
    mocks.base.historicalData = points.map(([day, sats]) => ({
      timestamp: `${day}T12:00:00.000Z`,
      totalBalance: String(sats),
    }))
    const [holding] = mocks.holdings
    assert.exists(holding)
    holding.balance = String(currentSats)
    await render()
  }

  function text(): string {
    return container.textContent
  }

  it('labels the view, the period, and a percentage change from a non-zero start', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 100_000_000],
          ['2026-08-01', 200_000_000],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text()).toContain('All accounts')
      expect(text()).toContain('Synced')
      expect(text()).toContain('+0.50000000BTC')
      expect(text()).toContain('+50.0%')
      expect(text()).toContain('Last 90 days')
    })
  })

  it('totals approximate in and out from balance changes, with the monthly average', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 100_000_000],
          ['2026-08-01', 200_000_000],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text()).toContain('Net accumulated')
      expect(text()).toContain('+$25,000.00')
      expect(text()).toContain('+1.00000000 in')
      expect(text()).toContain('+$50,000.00')
      expect(text()).toContain('−0.50000000 out')
      expect(text()).toContain('−$25,000.00')
      // Three months have history (June, August, September): 0.5 / 3.
      expect(text()).toContain('+0.16666667')
      expect(text()).toContain("USD at today's Bitcoin price")
    })
  })

  it('omits the percentage and the in/out split when the range starts at zero and nothing went out', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 0],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text()).toContain('+1.50000000BTC')
      expect(text()).not.toContain('%')
      expect(text()).not.toMatch(/\d (in|out)\b/)
    })
  })

  it('shows the percentage but omits the in/out split when nothing went out', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 100_000_000],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text()).toContain('+50.0%')
      expect(text()).not.toMatch(/\d (in|out)\b/)
    })
  })

  it("keeps the server's balance rather than a false drop when wallet balances are unavailable", async () => {
    await withTestSetup(async () => {
      // A self-custody wallet whose live balance failed to load, as when Electrum is unreachable.
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      const previousTotal = mocks.base.currentTotalBalance
      onTestFinished(() => {
        mocks.base.currentTotalBalance = previousTotal
      })
      mocks.base.currentTotalBalance = '150000000'
      mocks.base.walletBalancesAsOf = '2026-09-05T09:00:00.000Z'
      onTestFinished(() => {
        mocks.base.walletBalancesAsOf = null
      })
      await renderHistory(
        [
          ['2026-06-10', 100_000_000],
          ['2026-09-01', 150_000_000],
        ],
        0,
      )
      // The header says when the stored wallet balances last synced, rather than "Synced".
      const status = container.querySelector('output')
      expect(status?.textContent).toContain('Last synced 3 hours ago')
      // Screen readers get a fixed time, so the minute-by-minute change isn't announced.
      expect(status?.querySelector('span[aria-hidden="true"]')?.textContent).toBe('3 hours ago')
      expect(text()).toContain('1.50000000BTC')
      expect(text()).toContain('+0.50000000BTC')
      expect(text()).not.toContain('out')
      const points = chartData()
      assert(Array.isArray(points), 'Expected chart points')
      expect(points.at(-1)).toEqual({ timestamp: '2026-09-01T12:00:00.000Z', totalBalance: '150000000' })
    })
  })

  it('clears the account filter from beside its label', async () => {
    await withTestSetup(async () => {
      expect(container.querySelector('[aria-label="Clear account filter"]')).toBeNull()
      await click('Select holding')
      expect(text()).toContain('Test holding')
      const clear = container.querySelector<HTMLButtonElement>('button[aria-label="Clear account filter"]')
      assert.exists(clear, 'Expected the clear filter button')
      await act(async () => {
        clear.click()
      })
      expect(text()).toContain('All accounts')
      expect(mocks.sidebar.mock.lastCall?.[0].selected.size).toBe(0)
      expect(container.querySelector('[aria-label="Clear account filter"]')).toBeNull()
      // Focus stays near the control that went away.
      expect(document.activeElement?.textContent).toBe('All accounts')
    })
  })

  it('shows all accounts when the selected account is no longer available', async () => {
    await withTestSetup(async () => {
      // No wallet exists, as after it was removed elsewhere.
      await click('Select wallet')
      expect(text()).toContain('All accounts')
      expect(mocks.sidebar.mock.lastCall?.[0].selected.size).toBe(0)
      // The all-accounts query runs; the filtered one stays off.
      expect(getQueryCall(-2)[1].enabled).toBe(true)
      expect(getQueryCall(-1)[1].enabled).toBe(false)
    })
  })

  it('shows an unchanged range as +0 in both cards rather than as text', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 150_000_000],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text().match(/\+0\.00000000BTC/g)).toHaveLength(2)
      expect(text()).not.toContain('No change')
      expect(text()).not.toContain('%')
    })
  })

  it("keeps the server's balance while a range or selection loads during an outage", async () => {
    await withTestSetup(async () => {
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      const previousTotal = mocks.base.currentTotalBalance
      onTestFinished(() => {
        mocks.base.currentTotalBalance = previousTotal
      })
      mocks.base.currentTotalBalance = '150000000'
      mocks.rangeData = { ...mocks.base, historicalData: [] }
      await renderHistory([['2026-09-01', 150_000_000]], 0)
      // All time keeps showing 90 days' data while it loads; its total still applies.
      mocks.previous = true
      await click('All')
      expect(text()).toContain('1.50000000BTC')
      expect(text()).not.toContain('0.00000000BTC')
      // A selection the server hasn't reported yet shows no balance rather than a partial one.
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      mocks.useQuery.mockImplementation((input, options) =>
        input.claimIds === undefined
          ? defaultQuery(input, options)
          : {
              data: undefined,
              isLoading: true,
              isFetching: true,
              isPreviousData: false,
              error: null,
              refetch: mocks.refetch,
            },
      )
      await click('Select wallet')
      expect(text()).toContain('\u2014BTC')
      expect(text()).not.toContain('0.00000000BTC')
    })
  })

  it("reuses a selection's own last server balance but never another selection's", async () => {
    await withTestSetup(async () => {
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet'), claimFixture('re_clmx_other', 'Other wallet')]
      const walletData = { ...mocks.base, currentTotalBalance: '150000000' }
      let walletIsPrevious = false
      const defaultQuery = mocks.useQuery.getMockImplementation()
      assert.exists(defaultQuery, 'Expected the default query implementation')
      mocks.useQuery.mockImplementation((input, options) =>
        input.claimIds === undefined
          ? defaultQuery(input, options)
          : {
              data: walletData,
              isLoading: false,
              isFetching: walletIsPrevious,
              isPreviousData: walletIsPrevious,
              error: null,
              refetch: mocks.refetch,
            },
      )
      await click('Select wallet')
      expect(text()).toContain('1.50000000BTC')
      // Another range for the same wallet keeps its last total while loading.
      walletIsPrevious = true
      await click('1Y')
      expect(text()).toContain('1.50000000BTC')
      // A different wallet's previous data says nothing about this one.
      const sidebar = mocks.sidebar.mock.lastCall?.[0]
      assert.exists(sidebar, 'Expected the account filter')
      await act(async () => {
        sidebar.onSelectionChange(new Set(['re_clmx_other']))
      })
      expect(text()).toContain('\u2014BTC')
      expect(text()).not.toContain('1.50000000BTC')
    })
  })

  it('adds live wallet balances to the chart when they are available', async () => {
    await withTestSetup(async () => {
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      mocks.balances = new Map([['re_clmx_wallet', { current: new Decimal(200_000_000), usd: null }]])
      // The server fell back to stored balances, but the page has live ones.
      mocks.base.walletBalancesAsOf = '2026-09-05T09:00:00.000Z'
      onTestFinished(() => {
        mocks.base.walletBalancesAsOf = null
      })
      await renderHistory([['2026-09-01', 150_000_000]], 0)
      expect(container.querySelector('output')?.textContent).toBe('Synced')
      expect(text()).toContain('2.00000000BTC')
      const points = chartData()
      assert(Array.isArray(points), 'Expected chart points')
      expect(points.at(-1)).toMatchObject({ totalBalance: '200000000' })
    })
  })

  it('treats balances kept from before a failed fetch as stored, not live', async () => {
    await withTestSetup(async () => {
      mocks.claims = [claimFixture('re_clmx_wallet', 'Test wallet')]
      mocks.balances = new Map([['re_clmx_wallet', { current: new Decimal(200_000_000), usd: null }]])
      mocks.balancesFailed = true
      mocks.base.walletBalancesAsOf = '2026-09-05T09:00:00.000Z'
      onTestFinished(() => {
        mocks.base.walletBalancesAsOf = null
      })
      await renderHistory([['2026-09-01', 150_000_000]], 0)
      expect(container.querySelector('output')?.textContent).toContain('Last synced 3 hours ago')
    })
  })

  it('treats an unusable price as unavailable', async () => {
    await withTestSetup(async () => {
      mocks.btcPrice = 0
      await renderHistory(
        [
          ['2026-06-10', 100_000_000],
          ['2026-09-01', 150_000_000],
        ],
        150_000_000,
      )
      expect(text()).toContain('USD unavailable')
      expect(text()).not.toContain('$')
      expect(text()).not.toContain("USD at today's Bitcoin price")
      expect(mocks.sidebar.mock.lastCall?.[0].btcPrice).toBeNull()
    })
  })

  it('shows a change too small for one decimal as under 0.1%', async () => {
    await withTestSetup(async () => {
      await renderHistory(
        [
          ['2026-06-10', 1_000_000_000],
          ['2026-09-01', 1_000_001_000],
        ],
        1_000_001_000,
      )
      expect(text()).toContain('+<0.1%')
    })
  })
})
