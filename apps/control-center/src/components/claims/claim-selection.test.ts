// @vitest-environment node
import { Box } from '@chakra-ui/react'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { Decimal } from 'decimal.js'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ClaimSelection } from './claim-selection'

const { claimId, acquireDom } = await vi.hoisted(async () => {
  // Preserve Node byte-array globals used by the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  const { installAnimationPlaceholder } = await import('@hoseki/packages/testing/animation-dom')
  function createDom() {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    })
    installAnimationPlaceholder(window.HTMLCanvasElement)
    const globals = {
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLElement: window.HTMLElement,
      HTMLInputElement: window.HTMLInputElement,
      Element: window.Element,
      Node: window.Node,
      Event: window.Event,
      MouseEvent: window.MouseEvent,
      getComputedStyle: window.getComputedStyle.bind(window),
      requestAnimationFrame: window.requestAnimationFrame.bind(window),
      cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    }

    return globals
  }
  let initialDom: ReturnType<typeof createDom> | undefined = createDom()
  for (const [name, value] of Object.entries(initialDom)) {
    vi.stubGlobal(name, value)
  }
  function takeDom() {
    const globalsForTest = initialDom ?? createDom()
    initialDom = undefined
    return globalsForTest
  }

  return { claimId: 're_clmx_wallet' as const, acquireDom: takeDom }
})

let queryClient: QueryClient
// Requests to these paths never answer, so their queries stay loading.
const pendingPaths = new Set<string>()
const rpc = createTestTrpcClient(async ({ path }) => {
  if (pendingPaths.has(path)) {
    return new Promise<never>(() => undefined)
  }
  throw new Error(`Unexpected request: ${path}`)
})
let root: Root
let container: HTMLDivElement

async function withTestSetup(
  run: () => Promise<void>,
  {
    claims = [claimFixture(claimId, 'Savings wallet')],
    price = null,
    balances = new Map(),
  }: { claims?: ClaimDto[]; price?: Decimal | null; balances?: Map<string, Decimal> | 'loading' } = {},
): Promise<void> {
  const domGlobals = acquireDom()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData<ClaimDto[]>(
    getQueryKey(trpc.portalProve.registry.claims.list, { excludePending: true }, 'query'),
    claims,
  )
  queryClient.setQueryData(
    getQueryKey(trpc.portalProve.retrieveBitcoinPrice, undefined, 'query'),
    price === null ? null : { value: price, asOf: new Date(), source: 'mempool', lastKnown: false },
  )
  if (balances === 'loading') {
    pendingPaths.add('portalProve.onchain.claimBalances')
  } else {
    queryClient.setQueryData(
      getQueryKey(trpc.portalProve.onchain.claimBalances, { claimIds: claims.map((claim) => claim.id) }, 'query'),
      balances,
    )
  }

  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      queryClient.clear()
      pendingPaths.clear()
    } finally {
      vi.unstubAllGlobals()
      domGlobals.window.close()
    }
  })
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

it.each([
  ['selected without disabled accounts', undefined, true, true, false],
  ['selected with an empty disabled set', false, true, true, false],
  ['unselected without disabled accounts', undefined, false, false, false],
  ['unselected with an empty disabled set', false, false, false, false],
  ['disabled and unselected', true, false, true, true],
  ['disabled and selected', true, true, true, true],
] as const)('renders an account that is %s', async (_label, disabled, selected, checked, isDisabled) => {
  await withTestSetup(async () => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(
            TestTrpcProvider,
            { client: queryClient, rpc },
            createElement(
              MemoryRouter,
              null,
              createElement(ClaimSelection, {
                disabledClaims: disabled === undefined ? undefined : new Set(disabled ? [claimId] : []),
                selectedClaimIds: new Set(selected ? [claimId] : []),
                setSelectedClaimIds: vi.fn<() => void>(),
              }),
            ),
          ),
        ),
      )
    })

    const checkbox = container.querySelector('input[type="checkbox"]')
    assert(checkbox instanceof HTMLInputElement)
    expect(checkbox.checked).toBe(checked)
    expect(checkbox.disabled).toBe(isDisabled)
    expect(container.textContent).toContain('Savings wallet')
  })
})

it.each([1, 2])('preserves Chakra visibility styles across test documents (%s)', async () => {
  await withTestSetup(async () => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(Box, { 'data-style-probe': true, display: 'none' }, 'Style probe'),
        ),
      )
    })
    const probe = container.querySelector('[data-style-probe]')
    assert.exists(probe)
    expect(getComputedStyle(probe).display).toBe('none')

    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(Box, { 'data-style-probe': true, display: 'flex' }, 'Style probe'),
        ),
      )
    })
    expect(getComputedStyle(probe).display).toBe('flex')
  })
})

async function renderSelectedAccount(selected: ClaimDto['id'][] = [claimId]): Promise<string> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          TestTrpcProvider,
          { client: queryClient, rpc },
          createElement(
            MemoryRouter,
            null,
            createElement(ClaimSelection, {
              selectedClaimIds: new Set(selected),
              setSelectedClaimIds: vi.fn<() => void>(),
            }),
          ),
        ),
      ),
    )
  })
  return container.textContent
}

it('shows an account in Bitcoin and dollars, with a total matching the rows', async () => {
  await withTestSetup(
    async () => {
      const text = await renderSelectedAccount()
      expect(text).toContain('0.12345678 BTC')
      // The row rounds down, and the total adds up what the rows show.
      expect(text.match(/\$[\d,]+\.\d\d/g)).toEqual(['$6,172.83', '$6,172.83'])
    },
    { price: new Decimal(50_000), balances: new Map([[claimId, new Decimal(12_345_678)]]) },
  )
})

it('shows n/a rather than a $0.00 total when there is no price', async () => {
  await withTestSetup(
    async () => {
      const text = await renderSelectedAccount()
      expect(text).toContain('0.12345678 BTC')
      expect(text.match(/n\/a/g)).toHaveLength(2)
      expect(text).not.toContain("'n/a'")
      expect(text).not.toContain('$0.00')
    },
    { balances: new Map([[claimId, new Decimal(12_345_678)]]) },
  )
})

it('waits for balances before showing a total', async () => {
  await withTestSetup(
    async () => {
      const text = await renderSelectedAccount()
      expect(text).not.toContain('$')
      expect(text).not.toContain('n/a')
    },
    { balances: 'loading' },
  )
})

it('totals only the selected accounts', async () => {
  const claims = [
    claimFixture(claimId, 'Savings wallet'),
    claimFixture('re_clmx_spending', 'Spending wallet'),
    claimFixture('re_clmx_cold', 'Cold storage'),
  ]
  await withTestSetup(
    async () => {
      await renderSelectedAccount([claimId, 're_clmx_spending'])
      expect(container.querySelector('tfoot')?.textContent).toBe('Total$6,172.83')
    },
    {
      claims,
      price: new Decimal(50_000),
      balances: new Map([
        [claimId, new Decimal(12_345_678)],
        ['re_clmx_spending', new Decimal(18)],
        ['re_clmx_cold', new Decimal(100_000_000)],
      ]),
    },
  )
})
