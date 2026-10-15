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
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import type { RouterOutput } from '../../trpc'
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
  balances: () => Promise<Map<string, Decimal>>
  stored: Stored
  exchanges: Exchange[]
  manuals: Manual[]
  priceAvailable: boolean
  priceLastKnown: boolean
  manualsFailed: boolean
  refresh: () => Promise<void>
}

interface PageTest {
  container: HTMLDivElement
  refetch: () => Promise<void>
  reload: () => Promise<void>
  startRefetch: () => void
}

let testClock = Date.parse('2026-10-15T12:00:00Z')

async function setup(run: (scenario: Scenario, page: PageTest) => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  vi.useFakeTimers({ toFake: ['Date'] })
  testClock += 120_000
  vi.setSystemTime(testClock)
  const scenario: Scenario = {
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
    switch (path) {
      case 'portalProve.registry.claims.list':
        return [claimFixture(walletId, 'Savings wallet')]
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
                <ClaimsPage />
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
    expect(page.container.textContent).not.toContain('Last known balance')
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
    const originalTime = walletCard(page.container).textContent
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
    await waitForText(page.container, 'Last known balance')
    const card = walletCard(page.container)
    expect(card.textContent).toContain('1.00000000 BTC')
    const previousAsOf = /As of .*(?=100.0%)/.exec(originalTime)?.[0]
    assert(previousAsOf !== undefined)
    expect(card.textContent).toContain(previousAsOf)
    scenario.balances = async () => new Map([[walletId, new Decimal(200_000_000)]])
    await page.refetch()
    await waitForText(page.container, '2.00000000 BTC')
    expect(card.textContent).not.toContain('Last known balance')
  })
})

it('uses Sentinel snapshots across reloads with their original timestamps', async () => {
  await setup(async (scenario, page) => {
    scenario.stored = [{ accountId: walletId, balanceSats: '125000000', timestamp: savedAt }]
    scenario.balances = failed
    await page.reload()
    await waitForText(page.container, 'Last known balance')
    expect(walletCard(page.container).textContent).toContain('1.25000000 BTC')
    expect(walletCard(page.container).textContent).toContain(savedTime)
    await page.reload()
    await waitForText(page.container, 'Last known balance')
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
    expect(page.container.textContent).not.toContain('Last known balance')
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
      savedTime.toLowerCase(),
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
    await waitForText(page.container, 'Last known balance')
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
    expect(walletCard(page.container).textContent).not.toContain('Last known balance')
    expect(walletCard(page.container).querySelector('[title^="Price as of"]')?.getAttribute('title')).toContain(
      savedTime.toLowerCase(),
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
    await waitForText(page.container, 'Last known balance')
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
    await waitForText(page.container, 'Last known balance')
    const refreshed = page.container.querySelector('a[href="/accounts/coinbase/first"]')
    const stale = page.container.querySelector('a[href="/accounts/coinbase/second"]')
    expect(refreshed?.textContent).not.toContain('Last known balance')
    expect(stale?.textContent).toContain('Last known balance')
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
