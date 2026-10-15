// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { theme } from '@hoseki/packages/ui/design-system'
import { QueryClient } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { AccountFilter } from '../../components/dashboard-charts/account-filter'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import type { RouterOutput } from '../../trpc'
import { DashboardPage, type DashboardViews } from '../dashboard'
import { HomePage } from '../index'
import { ClaimsPage } from './index'

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

type Exchange = RouterOutput['portalProve']['exchange']['list'][number]
type Manual = RouterOutput['portalProve']['manual']['list'][number]
type Stored = RouterOutput['portalProve']['controlCenter']['storedWalletBalances']
const walletId = 're_clmx_wallet'
const savedAt = '2026-10-14T12:00:00.000Z'
const savedTime = new Date(savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const loaded = async (): Promise<Map<string, Decimal>> => new Map([[walletId, new Decimal(100_000_000)]])
const failed = async (): Promise<Map<string, Decimal>> => {
  throw new Error('Electrum unavailable')
}

interface Scenario {
  sentinelUnavailable: boolean
  claimsFailed: boolean
  historyComplete: boolean
  historyRequests: number
  balances: () => Promise<Map<string, Decimal>>
  stored: Stored
  exchanges: Exchange[]
  manuals: Manual[]
  priceAvailable: boolean
  priceLastKnown: boolean
  manualsFailed: boolean
  refresh: () => Promise<void>
}

type OverviewPage = 'accounts' | 'home' | 'portfolio'

const portfolioViews: DashboardViews = {
  AccountFilter,
  AccumulationChart: () => <div>Saved history</div>,
  MonthlyNetChangeChart: () => <div>Monthly history</div>,
  DateInput: () => <input aria-label="Date" />,
}
const homeViews = {
  AccumulationChart: () => <div>Saved history</div>,
  BitcoinPriceChart: () => <div>Market history</div>,
}

interface PageTest {
  navigate: (page: OverviewPage) => Promise<void>
  container: HTMLDivElement
  refetch: () => Promise<void>
  reload: () => Promise<void>
  startRefetch: () => void
}

let testClock = Date.parse('2026-10-15T12:00:00Z')

async function setup(
  run: (scenario: Scenario, page: PageTest) => Promise<void>,
  initialPage: OverviewPage = 'accounts',
): Promise<void> {
  let currentPage = initialPage
  const dom = browser.acquire()
  vi.useFakeTimers({ toFake: ['Date'] })
  testClock += 120_000
  vi.setSystemTime(testClock)
  const scenario: Scenario = {
    sentinelUnavailable: false,
    claimsFailed: false,
    historyComplete: true,
    historyRequests: 0,
    balances: loaded,
    stored: [],
    exchanges: [],
    manuals: [],
    priceAvailable: true,
    priceLastKnown: false,
    manualsFailed: false,
    refresh: async () => undefined,
  }
  const queryClient = new QueryClient({
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  })
  const rpc = createTestTrpcClient(async ({ path }) => {
    if (scenario.sentinelUnavailable) {
      throw new Error('Sentinel unavailable')
    }
    switch (path) {
      case 'portalProve.registry.claims.list':
        if (scenario.claimsFailed) {
          throw new Error('Wallet list unavailable')
        }
        return [claimFixture(walletId, 'Savings wallet')]
      case 'portalProve.statement.list':
        return []
      case 'portalProve.controlCenter.recordSnapshot':
        return undefined
      case 'portalProve.controlCenter.getData':
        scenario.historyRequests += 1
        return {
          currentTotalBalance: '100000000',
          knownTotalBalance: '100000000',
          currentBtcPrice: '50000',
          balanceStatus: {
            complete: scenario.historyComplete,
            missingAccountIds: scenario.historyComplete ? [] : [walletId],
            staleAccountIds: [],
            asOf: savedAt,
          },
          priceStatus: null,
          historicalData: [{ timestamp: savedAt, totalBalance: '100000000' }],
          verifiedClaimsCount: 1,
          exchangeAccountCount: 0,
          manualAccountCount: 0,
          etfAccountCount: 0,
          historySyncingAccountIds: [],
          historySyncedAccountIds: [],
          historyRefreshingAccountIds: [],
          historyFailedAccountIds: [],
        }
      case 'portalProve.registry.claims.listArchived':
        return []
      case 'portalProve.exchange.list':
        return scenario.exchanges
      case 'portalProve.manual.list':
        if (scenario.manualsFailed) {
          throw new Error('Account list unavailable')
        }
        return scenario.manuals
      case 'portalProve.etf.list':
        return []
      case 'portalProve.controlCenter.storedWalletBalances':
        return scenario.stored
      case 'portalProve.onchain.claimBalances':
        return scenario.balances()
      case 'portalProve.retrieveBitcoinPrice':
        if (!scenario.priceAvailable) {
          throw new Error('Price unavailable')
        }
        return {
          value: new Decimal(50_000),
          asOf: new Date(savedAt),
          source: 'block',
          lastKnown: scenario.priceLastKnown,
        }
      case 'portalProve.exchange.refreshAllBalances':
        return scenario.refresh()
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
  const emotionCache = createCache({ key: 'holdings-test', container: document.head })
  const container = document.createElement('div')
  document.body.append(container)
  let root = createRoot(container)
  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(
        <CacheProvider value={emotionCache}>
          <ChakraProvider theme={theme}>
            <TestTrpcProvider client={queryClient} rpc={rpc}>
              <MemoryRouter>
                {currentPage === 'accounts' ? (
                  <ClaimsPage />
                ) : currentPage === 'home' ? (
                  <HomePage views={homeViews} />
                ) : (
                  <DashboardPage views={portfolioViews} />
                )}
              </MemoryRouter>
            </TestTrpcProvider>
          </ChakraProvider>
        </CacheProvider>,
      )
    })
  }
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  const page: PageTest = {
    navigate: async (next) => {
      currentPage = next
      await render()
    },
    container,
    refetch: async () => {
      await act(async () => {
        await queryClient.refetchQueries({ type: 'active' })
      })
    },
    reload: async () => {
      await act(async () => {
        root.unmount()
      })
      queryClient.clear()
      root = createRoot(container)
      await render()
    },
    startRefetch: () => {
      void queryClient.refetchQueries({ type: 'active' })
    },
  }
  // Configure before the initial render, then start requests on demand in each test.
  await run(scenario, page)
}

async function waitForText(container: HTMLElement, text: string): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(container.textContent).toContain(text)
  })
}

async function waitForStale(container: HTMLElement): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(container.querySelector('[data-balance-state="stale"]')).not.toBeNull()
  })
}

function walletCard(container: HTMLElement): HTMLAnchorElement {
  const card = container.querySelector<HTMLAnchorElement>(`a[href="/accounts/${walletId}"]`)
  assert(card !== null)
  return card
}

it('keeps a first-load failure unknown, stops loading, and recovers through retry', async () => {
  await setup(async (scenario, page) => {
    scenario.balances = failed
    await page.reload()
    await waitForText(page.container, 'Balance unavailable')
    expect(walletCard(page.container).textContent).toContain('— BTC')
    expect(page.container.textContent).not.toContain('0.00000000 BTC')
    expect(page.container.textContent).not.toContain('Fetching balance')
    expect(page.container.textContent).toContain('Electrum connection in Settings')
    expect(page.container.querySelectorAll('[aria-label="Allocation unavailable"]')).toHaveLength(1)
    scenario.balances = loaded
    const retry = Array.from(page.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry balances',
    )
    assert(retry !== undefined)
    await act(async () => {
      retry.click()
    })
    await waitForText(page.container, '1.00000000 BTC')
    expect(walletCard(page.container).textContent).toContain('100.0%')
    expect(page.container.querySelector('[data-balance-state="stale"]')).toBeNull()
  })
})

it('shimmers only for the initial request and reserves the balance layout', async () => {
  await setup(async (scenario, page) => {
    let answer: (value: Map<string, Decimal>) => void = () => undefined
    scenario.balances = async () =>
      new Promise((resolve) => {
        answer = resolve
      })
    await page.reload()
    await waitForText(page.container, 'Fetching balance…')
    const card = walletCard(page.container)
    expect(card.textContent).not.toContain('0.00000000 BTC')
    const css =
      Array.from(document.querySelectorAll('style'))
        .map((style) => style.textContent)
        .join('\n') +
      Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
        .join('\n')
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('2s ease-in-out 3')
    expect(css).toContain('min-height: 104px')
    await act(async () => {
      answer(new Map([[walletId, new Decimal(0)]]))
    })
    await waitForText(page.container, '0.00000000 BTC')
  })
})

it('keeps the last loaded amount and timestamp during refresh and after failure', async () => {
  await setup(async (scenario, page) => {
    await page.reload()
    await waitForText(page.container, '1.00000000 BTC')
    const originalTime = walletCard(page.container).querySelector('[data-balance-state]')?.getAttribute('title')
    vi.setSystemTime(testClock + 60_000)
    let failRefresh: (error: Error) => void = () => undefined
    scenario.balances = async () =>
      new Promise((_resolve, reject) => {
        failRefresh = reject
      })
    await act(async () => {
      page.startRefetch()
    })
    await waitForText(page.container, 'Updating…')
    expect(walletCard(page.container).textContent).toContain('1.00000000 BTC')
    expect(walletCard(page.container).textContent).not.toContain('Fetching balance')
    await act(async () => {
      failRefresh(new Error('Electrum unavailable'))
    })
    await waitForStale(page.container)
    const card = walletCard(page.container)
    expect(card.textContent).toContain('1.00000000 BTC')
    expect(card.querySelector('[data-balance-state]')?.getAttribute('title')).toBe(originalTime)
    scenario.balances = async () => new Map([[walletId, new Decimal(200_000_000)]])
    await page.refetch()
    await waitForText(page.container, '2.00000000 BTC')
    expect(card.querySelector('[data-balance-state="stale"]')).toBeNull()
  })
})

it('uses Sentinel snapshots across reloads with their original timestamps', async () => {
  await setup(async (scenario, page) => {
    scenario.stored = [{ accountId: walletId, balanceSats: '125000000', timestamp: savedAt }]
    scenario.balances = failed
    await page.reload()
    await waitForStale(page.container)
    expect(walletCard(page.container).textContent).toContain('1.25000000 BTC')
    expect(walletCard(page.container).textContent).toContain(savedTime)
    await page.reload()
    await waitForStale(page.container)
    expect(walletCard(page.container).textContent).toContain('1.25000000 BTC')
    expect(walletCard(page.container).textContent).toContain(savedTime)
  })
})

it('labels partial totals and withholds every allocation until all balances are known', async () => {
  await setup(async (scenario, page) => {
    scenario.balances = failed
    scenario.manuals = [
      {
        id: 'manual',
        displayName: 'Cold storage',
        balance: '200000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
      },
    ]
    await page.reload()
    await waitForText(page.container, 'Known balance · 2.00000000 BTC')
    expect(page.container.textContent).toContain('1 of 2 balances available')
    expect(page.container.querySelectorAll('[aria-label="Allocation unavailable"]')).toHaveLength(2)
    expect(page.container.textContent).not.toContain('100.0%')
    scenario.balances = loaded
    await page.refetch()
    await waitForText(page.container, '3.00000000 BTC')
    expect(page.container.textContent).toContain('33.3%')
    expect(page.container.textContent).toContain('66.7%')
    expect(page.container.textContent).not.toContain('Known balance')
  })
})

it('withholds a complete total when an account list has never loaded', async () => {
  await setup(async (scenario, page) => {
    scenario.manualsFailed = true
    await page.reload()
    await waitForText(page.container, 'Known balance · 1.00000000 BTC')
    expect(page.container.textContent).toContain('Account list incomplete')
    expect(walletCard(page.container).textContent).not.toContain('100.0%')
    scenario.manualsFailed = false
    await page.refetch()
    await waitForText(page.container, '100.0%')
  })
})

it('keeps BTC available without a fiat price and restores fiat values when price recovers', async () => {
  await setup(async (scenario, page) => {
    scenario.priceAvailable = false
    await page.reload()
    await waitForText(page.container, 'USD price unavailable')
    expect(walletCard(page.container).textContent).toContain('1.00000000 BTC')
    expect(walletCard(page.container).textContent).toContain('100.0%')
    expect(page.container.textContent).not.toContain('$0.00')
    expect(page.container.querySelector('[data-balance-state="stale"]')).toBeNull()
    scenario.priceAvailable = true
    await page.refetch()
    await waitForText(page.container, '$50,000.00')
  })
})

it('labels cached fiat quotes and preserves a confirmed zero balance', async () => {
  await setup(async (scenario, page) => {
    scenario.balances = async () => new Map([[walletId, new Decimal(0)]])
    scenario.priceLastKnown = true
    await page.reload()
    await waitForText(page.container, '0.00000000 BTC')
    expect(walletCard(page.container).textContent).toContain('$0.00 · Last known price')
    expect(walletCard(page.container).textContent).toContain('0.0%')
    expect(walletCard(page.container).querySelector('[title^="Price as of"]')?.getAttribute('title')).toContain(
      savedTime,
    )
    expect(page.container.textContent).not.toContain('Balance unavailable')
  })
})

it('preserves exchange amounts after partial refresh failure and never invents a balance for reconnecting accounts', async () => {
  await setup(async (scenario, page) => {
    scenario.exchanges = [
      {
        id: 'exchange',
        exchange: 'coinbase',
        displayName: 'Exchange savings',
        balance: '300000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
        connectionStatus: 'connected',
      },
      {
        id: 'reconnect',
        exchange: 'kraken',
        displayName: 'Reconnect account',
        balance: null,
        balanceAsOf: null,
        createdAt: savedAt,
        currency: 'BTC',
        connectionStatus: 'needs_reconnect',
      },
    ]
    await page.reload()
    await waitForText(page.container, 'Known balance · 4.00000000 BTC')
    await waitForStale(page.container)
    const exchange = page.container.querySelector('a[href="/accounts/coinbase/exchange"]')
    expect(exchange?.textContent).toContain('3.00000000 BTC')
    expect(exchange?.textContent).toContain(savedTime)
    const reconnect = page.container.querySelector('a[href="/accounts/kraken/reconnect"]')
    expect(reconnect?.textContent).toContain('Balance unavailable')
    expect(reconnect?.textContent).toContain('Open this account to reconnect')
    expect(page.container.textContent).not.toContain('0.00000000 BTC')
  })
})

it('keeps a cached fiat quote with its original date after a price refresh fails', async () => {
  await setup(async (scenario, page) => {
    await page.reload()
    await waitForText(page.container, '$50,000.00')
    scenario.priceAvailable = false
    vi.setSystemTime(testClock + 60_000)
    await page.refetch()
    await waitForText(page.container, '$50,000.00 · Last known price')
    expect(walletCard(page.container).querySelector('[data-balance-state="stale"]')).toBeNull()
    expect(walletCard(page.container).querySelector('[title^="Price as of"]')?.getAttribute('title')).toContain(
      savedTime,
    )
  })
})

it('keeps exchange amounts visible during a refresh and after the whole refresh fails', async () => {
  await setup(async (scenario, page) => {
    scenario.exchanges = [
      {
        id: 'exchange',
        exchange: 'coinbase',
        displayName: 'Exchange savings',
        balance: '300000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
        connectionStatus: 'connected',
      },
    ]
    let failRefresh: (error: Error) => void = () => undefined
    scenario.refresh = async () =>
      new Promise((_resolve, reject) => {
        failRefresh = reject
      })
    await page.reload()
    await waitForText(page.container, 'Updating…')
    const exchange = page.container.querySelector('a[href="/accounts/coinbase/exchange"]')
    expect(exchange?.textContent).toContain('3.00000000 BTC')
    expect(exchange?.textContent).not.toContain('Fetching balance')
    await act(async () => {
      failRefresh(new Error('Exchange unreachable'))
    })
    await waitForStale(page.container)
    expect(exchange?.textContent).toContain('3.00000000 BTC')
    expect(exchange?.textContent).toContain(savedTime)
  })
})

it('identifies which exchange did not update in a partially successful refresh', async () => {
  await setup(async (scenario, page) => {
    const exchange: Exchange = {
      id: 'first',
      exchange: 'coinbase',
      displayName: 'First exchange',
      balance: '100000000',
      balanceAsOf: savedAt,
      createdAt: savedAt,
      currency: 'BTC',
      connectionStatus: 'connected',
    }
    const second: Exchange = { ...exchange, id: 'second', displayName: 'Second exchange' }
    scenario.exchanges = [exchange, second]
    scenario.refresh = async () => {
      scenario.exchanges = [{ ...exchange, balanceAsOf: new Date(testClock).toISOString() }, second]
    }
    await page.reload()
    await waitForStale(page.container)
    const refreshed = page.container.querySelector('a[href="/accounts/coinbase/first"]')
    const stale = page.container.querySelector('a[href="/accounts/coinbase/second"]')
    expect(refreshed?.querySelector('[data-balance-state="stale"]') ?? null).toBeNull()
    expect(stale?.querySelector('[data-balance-state="stale"]') ?? null).not.toBeNull()
    expect(stale?.textContent).toContain(savedTime)
  })
})

it('leaves an omitted wallet balance unavailable instead of assuming a successful zero', async () => {
  await setup(async (scenario, page) => {
    scenario.balances = async () => new Map()
    await page.reload()
    await waitForText(page.container, 'Balance unavailable')
    expect(walletCard(page.container).textContent).toContain('— BTC')
    expect(page.container.textContent).not.toContain('0.00000000 BTC')
  })
})

const overviewPages: OverviewPage[] = ['accounts', 'home', 'portfolio']
function hero(container: HTMLElement): string {
  return container.querySelector('[aria-label="Current Bitcoin balance"]')?.textContent.replace(/\s/g, '') ?? ''
}

it.each(overviewPages)('%s: a first wallet failure stays unknown until recovery', async (view) => {
  await setup(async (scenario, page) => {
    scenario.balances = failed
    await page.reload()
    await waitForText(page.container, 'Allocation unavailable')
    expect(hero(page.container)).not.toContain('0.00000000')
    expect(hero(page.container)).not.toContain('1.00000000')
    expect(page.container.querySelector('[data-balance-state="current"]')).toBeNull()
    scenario.balances = loaded
    await page.refetch()
    await waitForText(page.container, 'Last synced')
    expect(hero(page.container)).toContain('1.00000000BTC')
  }, view)
})

it.each(overviewPages)('%s: an Electrum outage retains saved amounts and the original last-sync time', async (view) => {
  await setup(async (scenario, page) => {
    scenario.balances = failed
    scenario.stored = [{ accountId: walletId, balanceSats: '125000000', timestamp: savedAt }]
    await page.reload()
    await waitForStale(page.container)
    expect(hero(page.container)).toContain('1.25000000BTC')
    expect(page.container.textContent).toContain('Last synced')
    expect(page.container.querySelector('[data-balance-state="stale"]')?.getAttribute('title')).toContain(savedTime)
    await page.reload()
    await waitForStale(page.container)
    expect(hero(page.container)).toContain('1.25000000BTC')
  }, view)
})

it.each(overviewPages)('%s: partial balances remain labeled and allocations stay unavailable', async (view) => {
  await setup(async (scenario, page) => {
    scenario.balances = failed
    scenario.manuals = [
      {
        id: 'manual',
        displayName: 'Cold storage',
        balance: '200000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
      },
    ]
    await page.reload()
    await waitForText(page.container, 'Allocation unavailable')
    expect(hero(page.container)).toContain('Knownbalance')
    expect(hero(page.container)).toContain('2.00000000BTC')
    expect(page.container.textContent).toContain('1 of 2 balances available')
    expect(page.container.textContent).not.toContain('100.0%')
  }, view)
})

it.each(overviewPages)('%s: a price outage leaves BTC and its sync status available', async (view) => {
  await setup(async (scenario, page) => {
    scenario.priceAvailable = false
    await page.reload()
    await waitForText(page.container, 'USD price unavailable')
    expect(hero(page.container)).toContain('1.00000000BTC')
    expect(page.container.querySelector('[data-balance-state="stale"]')).toBeNull()
    expect(page.container.textContent).not.toContain('$0.00')
  }, view)
})

it.each(overviewPages)('%s: a confirmed zero remains a complete balance', async (view) => {
  await setup(async (scenario, page) => {
    scenario.balances = async () => new Map([[walletId, new Decimal(0)]])
    await page.reload()
    await waitForText(page.container, 'Last synced')
    expect(hero(page.container)).toContain('0.00000000BTC')
    expect(page.container.textContent).not.toContain('Allocation unavailable')
    expect(page.container.textContent).not.toContain('Balance unavailable')
  }, view)
})

it('keeps exchange outage status when navigating among the three pages during the debounce', async () => {
  await setup(async (scenario, page) => {
    scenario.exchanges = [
      {
        id: 'exchange',
        exchange: 'coinbase',
        displayName: 'Exchange savings',
        balance: '300000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
        connectionStatus: 'connected',
      },
    ]
    scenario.refresh = async () => {
      throw new Error('Exchange unreachable')
    }
    await page.reload()
    await waitForStale(page.container)
    for (const next of overviewPages) {
      await page.navigate(next)
      await waitForStale(page.container)
      expect(hero(page.container)).toContain('4.00000000BTC')
      expect(page.container.querySelector('[data-balance-state="stale"]')?.getAttribute('title')).toContain(savedTime)
    }
  })
})

it.each(overviewPages)('%s: a failed fiat refresh preserves the quote with its original timestamp', async (view) => {
  await setup(async (scenario, page) => {
    await page.reload()
    await waitForText(page.container, '$50,000.00')
    scenario.priceAvailable = false
    await page.refetch()
    await waitForText(page.container, '$50,000.00 · Last known price')
    expect(hero(page.container)).toContain('1.00000000BTC')
    expect(page.container.querySelector('[title^="Price as of"]')?.getAttribute('title')).toContain(savedTime)
    expect(page.container.querySelector('[data-balance-state="stale"]')).toBeNull()
  }, view)
})

it.each(['home', 'portfolio'] as const)(
  '%s: recovering balances also refreshes incomplete history metadata',
  async (view) => {
    await setup(async (scenario, page) => {
      scenario.balances = failed
      scenario.historyComplete = false
      await page.reload()
      await waitForText(page.container, 'Allocation unavailable')
      const requests = scenario.historyRequests
      scenario.historyComplete = true
      scenario.balances = loaded
      const retry = Array.from(page.container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Retry balances',
      )
      assert(retry !== undefined)
      await act(async () => {
        retry.click()
      })
      await waitForText(page.container, 'Last synced')
      await vi.waitFor(async () => {
        await act(async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 0)
          })
        })
        expect(scenario.historyRequests).toBeGreaterThan(requests)
      })
      expect(page.container.textContent).not.toContain('Allocation unavailable')
    }, view)
  },
)

it.each(overviewPages)('%s: a failed wallet list does not hide known balances from other accounts', async (view) => {
  await setup(async (scenario, page) => {
    scenario.claimsFailed = true
    scenario.manuals = [
      {
        id: 'manual',
        displayName: 'Cold storage',
        balance: '200000000',
        balanceAsOf: savedAt,
        createdAt: savedAt,
        currency: 'BTC',
      },
    ]
    await page.reload()
    await waitForText(page.container, 'Account list incomplete')
    expect(hero(page.container)).toContain('Knownbalance')
    expect(hero(page.container)).toContain('2.00000000BTC')
    expect(page.container.textContent).toContain('Allocation unavailable')
  }, view)
})

it.each(overviewPages)('%s: a Sentinel outage retains cached values, while a reload stays unknown', async (view) => {
  await setup(async (scenario, page) => {
    await page.reload()
    await waitForText(page.container, 'Last synced')
    const confirmed = hero(page.container)
    scenario.sentinelUnavailable = true
    await page.refetch()
    await waitForStale(page.container)
    expect(hero(page.container)).toBe(confirmed)
    await page.reload()
    await waitForText(page.container, 'unavailable')
    expect(hero(page.container)).not.toContain('0.00000000')
    expect(hero(page.container)).not.toContain('1.00000000')
  }, view)
})
