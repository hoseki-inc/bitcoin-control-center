// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { AccountFilter } from './account-filter'

type AccountFilterProps = React.ComponentProps<typeof AccountFilter>

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

let root: Root
let container: HTMLDivElement
const onSelectionChange = vi.fn<(ids: Set<string>) => void>()
const accounts: AccountFilterProps['manualAccounts'] = [
  {
    id: 'paper',
    displayName: 'Paper Wallet',
    currency: 'BTC',
    balance: '625000000',
    balanceAsOf: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cold',
    displayName: 'Cold Storage',
    currency: 'BTC',
    balance: '260000000',
    balanceAsOf: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]
const disconnectedExchangeAccounts: AccountFilterProps['exchangeAccounts'] = [
  {
    id: 'strike',
    displayName: 'Offline Strike',
    exchange: 'strike',
    currency: 'BTC',
    balance: '9999900000',
    balanceAsOf: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    connectionStatus: 'needs_reconnect',
  },
]

type Presentation = 'dropdown' | 'sidebar'
let revision = 0

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    } finally {
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })
  localStorage.clear()
  onSelectionChange.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

function Harness({
  initial,
  presentation,
  disconnected,
}: {
  initial: Set<string>
  presentation: Presentation
  disconnected: boolean
}): JSX.Element {
  const [selected, setSelected] = useState(initial)
  return (
    <AccountFilter
      presentation={presentation}
      claims={[]}
      exchangeAccounts={disconnected ? disconnectedExchangeAccounts : []}
      manualAccounts={accounts}
      etfAccounts={[]}
      balances={new Map()}
      btcPrice={50_000}
      selected={selected}
      onSelectionChange={(next) => {
        onSelectionChange(next)
        setSelected(next)
      }}
      historySyncingAccountIds={[]}
      recentlySyncedAccountIds={[]}
    />
  )
}

async function render(
  selected = new Set<string>(),
  presentation: Presentation = 'dropdown',
  disconnected = false,
): Promise<void> {
  // Seed the stored display preference the same way a loaded settings query would.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  queryClient.setQueryData(['local-settings', 'bitcoin_display_unit'], 'btc')
  revision += 1
  const key = revision
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChakraProvider>
          <MemoryRouter>
            <Harness key={key} initial={selected} presentation={presentation} disconnected={disconnected} />
          </MemoryRouter>
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
}

function button(label: string): HTMLButtonElement {
  const target = Array.from(document.querySelectorAll('button')).find(
    (element) =>
      element.getAttribute('aria-label') === label ||
      (!element.hasAttribute('aria-label') && element.textContent === label),
  )
  assert.exists(target, `Missing button: ${label}`)
  return target
}

async function click(label: string): Promise<void> {
  const target = button(label)
  await act(async () => {
    target.click()
  })
}

async function search(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search accounts"]')
  assert.exists(input, 'Expected the account search input')
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    assert(descriptor?.set !== undefined, 'Expected the input value setter')
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it.each(['sidebar', 'dropdown'] as const)(
  'isolates from All, adds accounts, toggles off, and returns to All in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(), presentation)
      if (presentation === 'dropdown') {
        await click('Filter accounts: All accounts')
      }
      expect(button('All accounts').getAttribute('aria-pressed')).toBe('true')
      expect(button('Include Paper Wallet').getAttribute('aria-pressed')).toBe('false')
      await click('Include Paper Wallet')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['paper']))
      expect(button('Include Paper Wallet').getAttribute('aria-pressed')).toBe('true')
      await click('Include Cold Storage')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['paper', 'cold']))
      await click('Include Paper Wallet')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['cold']))
      await click('Include Cold Storage')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
      expect(button('All accounts').getAttribute('aria-pressed')).toBe('true')
      expect(document.body.textContent).not.toContain('Apply')
      expect(document.body.textContent).not.toContain('Cancel')
    })
  },
)

it.each(['sidebar', 'dropdown'] as const)(
  'preserves hidden selections through search and resets explicitly in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(['paper']), presentation)
      if (presentation === 'dropdown') {
        await click('Filter accounts: Paper Wallet')
      }
      await search('cold')
      expect(document.querySelectorAll('button[aria-label^="Include"]')).toHaveLength(1)
      await click('Include Cold Storage')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['paper', 'cold']))
      await search('missing')
      expect(document.body.textContent).toContain('No accounts match your search.')
      await click('All accounts')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
    })
  },
)

it('retains immediate popover changes after closing and reopening', async () => {
  await withTestSetup(async () => {
    await render()
    await click('Filter accounts: All accounts')
    await click('Include Paper Wallet')
    await click('Done')
    await click('Filter accounts: Paper Wallet')
    expect(button('Include Paper Wallet').getAttribute('aria-pressed')).toBe('true')
    expect(button('Include Cold Storage').getAttribute('aria-pressed')).toBe('false')
  })
})

it.each(['dropdown', 'sidebar'] as const)(
  'routes disconnected exchanges to reconnect without exposing or selecting saved balances in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(), presentation, true)
      if (presentation === 'dropdown') {
        await click('Filter accounts: All accounts')
      }
      const reconnect = document.querySelector('[aria-label="Reconnect Offline Strike"]')
      assert.exists(reconnect, 'Expected the reconnect link')
      expect(reconnect.getAttribute('href')).toBe('/accounts/strike/strike')
      expect(document.body.textContent).not.toContain('99.999')
      expect(document.querySelector('[aria-label="Include Offline Strike"]')).toBeNull()
      await click('All accounts')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
    })
  },
)

it('keeps the rail visible and its width stable across persisted density changes', async () => {
  await withTestSetup(async () => {
    await render(new Set(['paper']), 'sidebar')
    const rail = container.querySelector<HTMLElement>('[aria-label="Portfolio accounts"]')
    assert.exists(rail, 'Expected the accounts rail')
    expect(getComputedStyle(rail).width).toBe('280px')
    expect(container.querySelector('[aria-label="Collapse accounts"]')).toBeNull()
    await click('Detailed view')
    expect(getComputedStyle(rail).width).toBe('280px')
    expect(button('Include Paper Wallet').getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('false')
    expect(document.body.textContent).toContain('$312,500.00 USD')
    await render(new Set(['paper']), 'sidebar')
    expect(button('Detailed view').getAttribute('aria-pressed')).toBe('true')
    await click('Compact view')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('true')
    expect(onSelectionChange).not.toHaveBeenCalled()
  })
})

it.each(['sidebar', 'dropdown'] as const)(
  'toggles once from the name or balance inside a native button in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(), presentation)
      if (presentation === 'dropdown') {
        await click('Filter accounts: All accounts')
      }
      const row = button('Include Paper Wallet')
      expect(row.type).toBe('button')
      expect(row.tabIndex).toBe(0)
      const name = Array.from(row.querySelectorAll('span')).find((element) => element.textContent === 'Paper Wallet')
      assert.exists(name, 'Expected the Paper Wallet name')
      await act(async () => {
        name.click()
      })
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set(['paper']))
      onSelectionChange.mockClear()
      const balance = Array.from(row.querySelectorAll('span')).find((element) => element.textContent.includes('6.25'))
      assert.exists(balance, 'Expected the Paper Wallet balance')
      await act(async () => {
        balance.click()
      })
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set())
    })
  },
)
