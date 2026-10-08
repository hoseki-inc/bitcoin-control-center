// @vitest-environment node
import { Box } from '@chakra-ui/react'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet/hardware-wallet'
import { type FormEvent, type ReactNode, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { statementFixture } from '../testing/statements'
import { AccountFilter } from './dashboard-charts/account-filter'
import { StatementCard } from './dashboard/statement-card'
import { SelectWalletType } from './multisig/multisig-select-wallet-type'

const acquireDom = await vi.hoisted(async () => {
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
      HTMLButtonElement: window.HTMLButtonElement,
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

  return takeDom
})

let root: Root
let host: HTMLDivElement
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const domGlobals = acquireDom()

  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    } finally {
      vi.unstubAllGlobals()
      domGlobals.window.close()
    }
  })
  for (const [name, value] of Object.entries(domGlobals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  await run()
}

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
const statement = statementFixture({ id: 'test-statement', integrator: { name: 'Test partner' } })
it('activates a statement once from View without nesting controls or submitting a form', async () => {
  await withTestSetup(async () => {
    const onView = vi.fn<() => void>()
    const onSubmit = vi.fn((event: FormEvent) => {
      event.preventDefault()
    })
    await render(createElement('form', { onSubmit }, createElement(StatementCard, { statement, onView })))
    expect(host.querySelectorAll('button')).toHaveLength(1)
    const view = button('View')
    expect(view.type).toBe('button')
    expect(view.getAttribute('aria-label')).toBe('View statement created 01 Sep 2026 12:00 PM')
    expect(view.querySelector('button, a, input, div, p')).toBeNull()
    await act(async () => {
      view.click()
    })
    expect(onView).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
it.each([false, true])('keeps account reset and view mode controls operable (compact=%s)', async (compact) => {
  await withTestSetup(async () => {
    vi.stubGlobal('localStorage', window.localStorage)
    localStorage.setItem('hoseki:sidebar-compact', String(compact))
    const onSelectionChange = vi.fn<(ids: Set<string>) => void>()
    await render(
      createElement(AccountFilter, {
        presentation: 'sidebar',
        claims: [],
        exchangeAccounts: [],
        manualAccounts: [],
        etfAccounts: [],
        balances: new Map(),
        btcPrice: null,
        selected: new Set<string>(),
        onSelectionChange,
        historySyncingAccountIds: [],
        recentlySyncedAccountIds: [],
      }),
    )
    const reset = button('All accounts')
    expect(reset.getAttribute('aria-pressed')).toBe('true')
    expect(reset.querySelector('div,p,button')).toBeNull()
    await act(async () => {
      reset.click()
    })
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set())
    const mode = host.querySelector(`button[aria-label="${compact ? 'Detailed view' : 'Compact view'}"]`)
    assert(mode instanceof HTMLButtonElement)
    expect(mode.getAttribute('aria-pressed')).toBe('false')
    await act(async () => {
      mode.click()
    })
    expect(mode.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe(String(!compact))
  })
})
it('offers native signing-device buttons and preserves the selected device', async () => {
  await withTestSetup(async () => {
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
    expect(onConnectionTypeClick.mock.calls.map((call) => call[0])).toEqual([
      'trezor',
      'ledger',
      'coldcard',
      'keystone',
    ])
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
    const probe = host.querySelector('[data-style-probe]')
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
