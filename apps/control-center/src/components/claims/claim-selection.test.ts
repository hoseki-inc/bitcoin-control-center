// @vitest-environment node
import { Box } from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { ClaimSelection } from './claim-selection'

const { claimId, acquireDom } = await vi.hoisted(async () => {
  // Preserve Node byte-array globals used by the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  function createDom() {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost',
      pretendToBeVisual: true,
    })
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

vi.mock('../../trpc', () => ({
  trpc: {
    portalProve: {
      registry: {
        claims: {
          list: {
            useQuery: () => ({
              data: [{ id: claimId, displayName: 'Savings wallet' }],
              isLoading: false,
              isError: false,
            }),
          },
        },
      },
      exchange: { list: { useQuery: () => ({ data: [] }) } },
      retrieveBitcoinPrice: { useQuery: () => ({ data: undefined }) },
    },
  },
}))
vi.mock('../../lib/balances', () => ({
  useGetBalancesPerClaimIds: () => ({ data: new Map<ClaimId, null>(), isLoading: false, isSuccess: true }),
}))

let root: Root
let container: HTMLDivElement

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const domGlobals = acquireDom()

  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
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
            MemoryRouter,
            null,
            createElement(ClaimSelection, {
              disabledClaims: disabled === undefined ? undefined : new Set(disabled ? [claimId] : []),
              selectedClaimIds: new Set(selected ? [claimId] : []),
              setSelectedClaimIds: vi.fn<() => void>(),
              selectedExchangeAccountIds: new Set<string>(),
              setSelectedExchangeAccountIds: vi.fn<() => void>(),
            }),
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
