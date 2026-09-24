// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet/hardware-wallet'
import { type FormEvent, type ReactNode, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, assert, beforeEach, expect, it, vi } from 'vitest'
import type { StatementDto } from '../trpc/server-types'
import { AccountsSidebar } from './dashboard-charts/accounts-sidebar'
import { StatementCard } from './dashboard/statement-card'
import { SelectWalletType } from './multisig/multisig-select-wallet-type'

const domGlobals = await vi.hoisted(async () => {
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
    HTMLButtonElement: window.HTMLButtonElement,
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
  return globals
})

vi.mock('lottie-react', () => ({ default: () => null }))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})
afterAll(() => {
  domGlobals.window.close()
})
async function render(child: ReactNode): Promise<void> {
  await act(async () => {
    root.render(createElement(ChakraProvider, null, createElement(MemoryRouter, null, child)))
  })
}
function button(text: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find((element) => element.textContent.includes(text))
  assert(match instanceof HTMLButtonElement)
  return match
}
const statement: StatementDto = {
  id: 'test-statement',
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
  openingDate: new Date('2026-08-01'),
  closingDate: new Date('2026-08-31'),
  counter: 1,
  timezone: 'UTC',
  status: 'completed',
  user: { name: null, email: null },
  integrator: { name: 'Test partner' },
  userId: 'test-user',
}
it('activates a statement once from View without nesting controls or submitting a form', async () => {
  const onView = vi.fn<() => void>()
  const onSubmit = vi.fn((event: FormEvent) => {
    event.preventDefault()
  })
  await render(createElement('form', { onSubmit }, createElement(StatementCard, { statement, onView })))
  expect(host.querySelectorAll('button')).toHaveLength(1)
  const card = button('Statement')
  expect(card.type).toBe('button')
  expect(card.querySelector('button, a, input, div, p')).toBeNull()
  const view = Array.from(card.querySelectorAll('span')).find((element) => element.textContent === 'View')
  assert(view instanceof HTMLElement)
  await act(async () => {
    view.click()
  })
  expect(onView).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()
})
it.each([false, true])('keeps account reset and view mode controls operable (compact=%s)', async (compact) => {
  const onClearAll = vi.fn<() => void>()
  const onToggleCompact = vi.fn<() => void>()
  await render(
    createElement(AccountsSidebar, {
      claims: [],
      balances: new Map(),
      selected: new Set<string>(),
      onToggle: vi.fn<(id: string) => void>(),
      onClearAll,
      totalBtcSats: 0,
      totalUsd: 0,
      compact,
      onToggleCompact,
    }),
  )
  const reset = button('All Accounts')
  expect(reset.getAttribute('aria-pressed')).toBe('true')
  expect(reset.querySelector('div,p,button')).toBeNull()
  await act(async () => {
    reset.click()
  })
  expect(onClearAll).toHaveBeenCalledTimes(1)
  const mode = host.querySelector('button[aria-label]')
  assert(mode instanceof HTMLButtonElement)
  await act(async () => {
    mode.click()
  })
  expect(onToggleCompact).toHaveBeenCalledTimes(1)
})
it('offers native signing-device buttons and preserves the selected device', async () => {
  const onConnectionTypeClick = vi.fn<(walletType: SupportedHardwareWallet) => void>()
  await render(createElement(SelectWalletType, { signedMessagesLength: 0, onConnectionTypeClick }))
  for (const device of ['Trezor', 'Ledger', 'COLDCARD', 'Keystone']) {
    const target = button(device)
    expect(target.type).toBe('button')
    expect(target.querySelector('div,p,button')).toBeNull()
    await act(async () => {
      target.click()
    })
  }
  expect(onConnectionTypeClick.mock.calls.map((call) => call[0])).toEqual(['trezor', 'ledger', 'coldcard', 'keystone'])
})
