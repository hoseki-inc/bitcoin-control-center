// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import type { ClaimId } from '@hoseki/packages/schemas'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, assert, beforeEach, expect, it, vi } from 'vitest'
import { ClaimSelection } from './claim-selection'

const { claimId, domGlobals } = await vi.hoisted(async () => {
  // Preserve Node byte-array globals used by the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
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
  for (const [name, value] of Object.entries(globals)) {
    vi.stubGlobal(name, value)
  }
  return { claimId: 're_clmx_wallet' as const, domGlobals: globals }
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

beforeEach(() => {
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

afterAll(() => {
  domGlobals.window.close()
})

it.each([
  ['selected without disabled accounts', undefined, true, true, false],
  ['selected with an empty disabled set', false, true, true, false],
  ['unselected without disabled accounts', undefined, false, false, false],
  ['unselected with an empty disabled set', false, false, false, false],
  ['disabled and unselected', true, false, true, true],
  ['disabled and selected', true, true, true, true],
] as const)('renders an account that is %s', async (_label, disabled, selected, checked, isDisabled) => {
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
            setSelectedClaimIds: vi.fn(),
            selectedExchangeAccountIds: new Set<string>(),
            setSelectedExchangeAccountIds: vi.fn(),
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
