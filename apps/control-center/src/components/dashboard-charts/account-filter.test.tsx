// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { AccountFilter } from './account-filter'

vi.mock('../../utils/claim-utils', () => ({ ensureClaimStatusNotExpired: () => 'verified' }))
vi.mock('../../hooks/use-bitcoin-display', () => ({ useBitcoinDisplay: () => ({ unit: 'btc' }) }))
vi.mock('../sensitive-value', () => ({ SensitiveValue: ({ children }: { children: React.ReactNode }) => children }))

type Presentation = 'dropdown' | 'sidebar'
let root: Root
let container: HTMLDivElement
let revision = 0
const onSelectionChange = vi.fn<(ids: Set<string>) => void>()
const accounts: React.ComponentProps<typeof AccountFilter>['manualAccounts'] = [
  { id: 'paper', displayName: 'Paper Wallet', currency: 'BTC', balance: '625000000', balanceAsOf: null, createdAt: '' },
  { id: 'cold', displayName: 'Cold Storage', currency: 'BTC', balance: '260000000', balanceAsOf: null, createdAt: '' },
]

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
      exchangeAccounts={
        disconnected
          ? [
              {
                id: 'strike',
                displayName: 'Offline Strike',
                exchange: 'strike',
                currency: 'BTC',
                balance: '9999900000',
                balanceAsOf: null,
                createdAt: '',
                connectionStatus: 'needs_reconnect',
              },
            ]
          : []
      }
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
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <Harness key={++revision} initial={selected} presentation={presentation} disconnected={disconnected} />
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

function button(label: string): HTMLButtonElement {
  const target = Array.from(document.querySelectorAll('button')).find(
    (element) =>
      element.getAttribute('aria-label') === label ||
      (!element.hasAttribute('aria-label') && element.textContent === label),
  )
  return expectElement(target, HTMLButtonElement, `button ${label}`)
}
async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click()
  })
}
async function search(value: string): Promise<void> {
  const input = expectElement(document.querySelector('input[aria-label="Search accounts"]'), HTMLInputElement)
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  assert(descriptor?.set !== undefined, 'Expected the input value setter')
  descriptor.set.call(input, value)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown, so it runs once even after a failure or timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  })

  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  localStorage.clear()
  onSelectionChange.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
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
      expect(document.querySelector('[aria-label="Reconnect Offline Strike"]')?.getAttribute('href')).toBe(
        '/accounts/strike/strike',
      )
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
    const rail = expectElement(container.querySelector('[aria-label="Portfolio accounts"]'), HTMLElement)
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
      const name = expectElement(
        Array.from(row.querySelectorAll('span')).find((element) => element.textContent === 'Paper Wallet'),
        HTMLElement,
      )
      await act(async () => {
        name.click()
      })
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set(['paper']))
      onSelectionChange.mockClear()
      const balance = expectElement(
        Array.from(row.querySelectorAll('span')).find((element) => element.textContent.includes('6.25')),
        HTMLElement,
      )
      await act(async () => {
        balance.click()
      })
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set())
    })
  },
)
