// @vitest-environment node
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import Decimal from 'decimal.js'
import { act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../testing/claims'
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
  revision += 1
  const key = revision
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <Harness key={key} initial={selected} presentation={presentation} disconnected={disconnected} />
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

/** An icon button by its label, or a text button (such as an account) by the text it starts with. */
function button(label: string): HTMLButtonElement {
  const target = Array.from(document.querySelectorAll('button')).find((element) =>
    element.hasAttribute('aria-label')
      ? element.getAttribute('aria-label') === label
      : element.textContent.startsWith(label),
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
  // The box opens from the magnifying glass and stays open until closed.
  if (button('Search accounts').getAttribute('aria-pressed') !== 'true') {
    await click('Search accounts')
  }
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
      expect(button('Paper Wallet').getAttribute('aria-pressed')).toBe('false')
      await click('Paper Wallet')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['paper']))
      expect(button('Paper Wallet').getAttribute('aria-pressed')).toBe('true')
      await click('Cold Storage')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['paper', 'cold']))
      await click('Paper Wallet')
      expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['cold']))
      await click('Cold Storage')
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
      expect(accountOrder()).toEqual(['Cold Storage'])
      await click('Cold Storage')
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
    await click('Paper Wallet')
    await click('Done')
    await click('Filter accounts: Paper Wallet')
    expect(button('Paper Wallet').getAttribute('aria-pressed')).toBe('true')
    expect(button('Cold Storage').getAttribute('aria-pressed')).toBe('false')
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
      const reconnect = document.querySelector('a[href="/accounts/strike/strike"]')
      assert.exists(reconnect, 'Expected the reconnect link')
      expect(reconnect.textContent).toBe('Offline StrikeReconnect needed')
      expect(document.body.textContent).not.toContain('99.999')
      expect(accountOrder()).not.toContain('Offline Strike')
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
    await click('Detailed view')
    expect(getComputedStyle(rail).width).toBe('280px')
    expect(button('Compact view').hasAttribute('aria-pressed')).toBe(false)
    expect(button('Paper Wallet').getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('false')
    expect(document.body.textContent).toContain('$312,500.00 USD')
    await render(new Set(['paper']), 'sidebar')
    // The toggle names the view it switches to, so a remembered detailed view offers Compact.
    expect(container.querySelector('[aria-label="Detailed view"]')).toBeNull()
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
      const row = button('Paper Wallet')
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

const connectedStrike: AccountFilterProps['exchangeAccounts'][number] = {
  id: 'strike-live',
  displayName: 'Spending',
  exchange: 'strike',
  currency: 'BTC',
  balance: '400000000',
  balanceAsOf: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  connectionStatus: 'connected',
}

async function renderAccounts({
  claims = [],
  balances = new Map(),
  manualAccounts = accounts,
  exchangeAccounts = [],
}: {
  claims?: AccountFilterProps['claims']
  balances?: AccountFilterProps['balances']
  manualAccounts?: AccountFilterProps['manualAccounts']
  exchangeAccounts?: AccountFilterProps['exchangeAccounts']
}): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <AccountFilter
            presentation="sidebar"
            claims={claims}
            exchangeAccounts={exchangeAccounts}
            manualAccounts={manualAccounts}
            etfAccounts={[]}
            balances={balances}
            btcPrice={50_000}
            selected={new Set()}
            onSelectionChange={onSelectionChange}
            historySyncingAccountIds={[]}
            recentlySyncedAccountIds={[]}
          />
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

/** Account names in list order; each row is a toggle named by its content. */
function accountOrder(): string[] {
  return Array.from(document.querySelectorAll('button[aria-pressed]:not([aria-label])'))
    .filter((row) => !row.textContent.startsWith('All accounts'))
    .map(
      (row) =>
        Array.from(row.querySelectorAll('span')).find((span) => span.childElementCount === 0 && span.textContent !== '')
          ?.textContent ?? '',
    )
}

it('lists accounts largest first, whatever their type or the order they arrive in', async () => {
  await withTestSetup(async () => {
    await renderAccounts({ manualAccounts: [...accounts].reverse(), exchangeAccounts: [connectedStrike] })
    expect(accountOrder()).toEqual(['Paper Wallet', 'Spending', 'Cold Storage'])
  })
})

it('totals every account on All accounts and badges manually added ones', async () => {
  await withTestSetup(async () => {
    await renderAccounts({ exchangeAccounts: [connectedStrike] })
    expect(button('All accounts').textContent).toContain('12.85000000 BTC')
    const badges = Array.from(document.querySelectorAll('span')).filter((span) => span.textContent === 'Manually added')
    expect(badges).toHaveLength(2)
    await click('Detailed view')
    // Exchanges read as their proper names, not internal identifiers.
    expect(button('Spending').textContent).toContain('Strike')
    expect(button('Spending').textContent).not.toContain('strike')
    expect(button('All accounts').textContent).toContain('$642,500.00 USD')
  })
})

it('searches account names only and closes with Escape', async () => {
  await withTestSetup(async () => {
    await renderAccounts({ exchangeAccounts: [connectedStrike] })
    await search('manually')
    expect(document.body.textContent).toContain('No accounts match your search.')
    await search('strike')
    expect(document.body.textContent).toContain('No accounts match your search.')
    await search('spend')
    expect(accountOrder()).toEqual(['Spending'])
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search accounts"]')
    assert.exists(input, 'Expected the account search input')
    const view = input.ownerDocument.defaultView
    assert.exists(view, 'Expected the input window')
    await act(async () => {
      input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(button('Search accounts').getAttribute('aria-pressed')).toBe('false')
    expect(input.value).toBe('')
    expect(accountOrder()).toHaveLength(3)
  })
})

it.each(['sidebar', 'dropdown'] as const)(
  'returns focus to the search button when Escape closes search in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(), presentation)
      if (presentation === 'dropdown') {
        await click('Filter accounts: All accounts')
        // Opening moves focus into the panel rather than leaving it behind on the trigger.
        await vi.waitFor(() => {
          expect(document.activeElement).toBe(button('All accounts'))
        })
        expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Accounts')
      }
      await search('cold')
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search accounts"]')
      assert.exists(input, 'Expected the account search input')
      expect(document.activeElement).toBe(input)
      const view = input.ownerDocument.defaultView
      assert.exists(view, 'Expected the input window')
      await act(async () => {
        input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(document.activeElement).toBe(button('Search accounts'))
      // Escape closes only the search; a dropdown stays open with every account.
      expect(accountOrder()).toContain('Paper Wallet')
      expect(accountOrder()).toContain('Cold Storage')
    })
  },
)

it('shows a dash rather than zero for a wallet whose balance is unavailable', async () => {
  await withTestSetup(async () => {
    // Wallet avatars load their images through the window's Image.
    vi.stubGlobal('Image', document.defaultView?.Image)
    const balance: BalanceValue = { current: new Decimal(100_000_000), usd: null }
    await renderAccounts({
      claims: [claimFixture('re_clmx_live', 'Live wallet'), claimFixture('re_clmx_down', 'Offline wallet')],
      balances: new Map([
        ['re_clmx_live', balance],
        ['re_clmx_down', null],
      ]),
    })
    expect(button('Live wallet').textContent).toContain('1.00000000 BTC')
    expect(button('Offline wallet').textContent).toContain('\u2014')
    expect(button('Offline wallet').textContent).not.toContain('0.00000000')
    // An unknown balance would understate the total, so none is shown.
    expect(button('All accounts').textContent).toContain('\u2014')
    // Statuses are part of each account's button, so they're read with it.
    expect(button('Paper Wallet').textContent).toContain('Manually added')
  })
})

it.each(['sidebar', 'dropdown'] as const)('clears a selection from beside the count in %s', async (presentation) => {
  await withTestSetup(async () => {
    await render(new Set(), presentation)
    if (presentation === 'dropdown') {
      await click('Filter accounts: All accounts')
    }
    expect(Array.from(document.querySelectorAll('button')).some((element) => element.textContent === 'Clear')).toBe(
      false,
    )
    await click('Paper Wallet')
    await click('Cold Storage')
    expect(document.body.textContent).toContain('2 of 2')
    await click('Clear')
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
    expect(button('All accounts').getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(document.querySelectorAll('button')).some((element) => element.textContent === 'Clear')).toBe(
      false,
    )
  })
})
