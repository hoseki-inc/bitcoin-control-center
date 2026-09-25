// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
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
  onSelectionChange.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render()

  await run()
}

async function render(
  selected = new Set<string>(),
  presentation: 'dropdown' | 'sidebar' = 'dropdown',
  disconnected = false,
): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <AccountFilter
            presentation={presentation}
            claims={[]}
            exchangeAccounts={disconnected ? disconnectedExchangeAccounts : []}
            manualAccounts={accounts}
            etfAccounts={[]}
            balances={new Map()}
            btcPrice={50_000}
            selected={selected}
            onSelectionChange={onSelectionChange}
            historySyncingAccountIds={[]}
            recentlySyncedAccountIds={[]}
          />
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

function findButton(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent === text || element.getAttribute('aria-label') === text,
  )
  assert.exists(button, `Missing button: ${text}`)
  return button
}

async function click(text: string): Promise<void> {
  const button = findButton(text)
  await act(async () => {
    button.click()
  })
}

function checkbox(index: number): HTMLInputElement {
  const input = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]
  assert.exists(input, `Missing checkbox at index ${index}`)
  return input
}

async function toggle(index: number): Promise<void> {
  const input = checkbox(index)
  await act(async () => {
    input.click()
  })
}

it('shows all accounts checked, and applies a subset only after Apply', async () => {
  await withTestSetup(async () => {
    await click('Filter accounts: All accounts')
    expect(document.body.textContent).toContain('$312,500.00 USD')
    expect(document.body.textContent).toContain('$130,000.00 USD')
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((input) => input.checked),
    ).toBe(true)
    await toggle(0)
    expect(onSelectionChange).not.toHaveBeenCalled()
    await click('Apply')
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['cold']))
  })
})

it('prevents an empty selection from becoming an all-accounts query', async () => {
  await withTestSetup(async () => {
    await click('Filter accounts: All accounts')
    await toggle(0)
    await toggle(1)
    expect(findButton('Apply').disabled).toBe(true)
    expect(document.body.textContent).toContain('Select at least one account.')
    await click('Select all')
    await click('Apply')
    expect(onSelectionChange).toHaveBeenCalledWith(new Set())
  })
})

it('discards draft changes on Cancel and restores the applied selection on reopen', async () => {
  await withTestSetup(async () => {
    await render(new Set(['paper']))
    await click('Filter accounts: Paper Wallet')
    await toggle(1)
    await click('Cancel')
    expect(onSelectionChange).not.toHaveBeenCalled()
    await click('Filter accounts: Paper Wallet')
    expect(checkbox(0).checked).toBe(true)
    expect(checkbox(1).checked).toBe(false)
  })
})

it('searches without losing selections hidden by the search', async () => {
  await withTestSetup(async () => {
    await click('Filter accounts: All accounts')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search accounts"]')
    assert.exists(input, 'Expected the account search input')
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      assert(descriptor?.set !== undefined, 'Expected the input value setter')
      descriptor.set.call(input, 'cold')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    await toggle(0)
    await click('Apply')
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['paper']))
  })
})

it('resets the applied filter with Show all', async () => {
  await withTestSetup(async () => {
    await render(new Set(['cold']))
    await click('Show all')
    expect(onSelectionChange).toHaveBeenCalledWith(new Set())
  })
})

it.each(['dropdown', 'sidebar'] as const)(
  'routes disconnected exchanges to reconnect without exposing or selecting their saved balance in %s',
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
      expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
      if (presentation === 'dropdown') {
        await click('Select all')
        await click('Apply')
        expect(onSelectionChange).toHaveBeenCalledWith(new Set())
      }
    })
  },
)

it('supports immediate row selection beside the charts and remembers compact mode', async () => {
  await withTestSetup(async () => {
    await render(new Set(), 'sidebar')
    const allButton = (): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (element) => element.textContent === 'All accounts',
      )
      assert.exists(button, 'Expected the All accounts button')
      return button
    }
    const borderWidth = getComputedStyle(allButton()).borderWidth
    expect(borderWidth).toBe('1px')
    expect(allButton().getAttribute('aria-pressed')).toBe('true')
    const name = Array.from(container.querySelectorAll('p')).find((element) => element.textContent === 'Paper Wallet')
    assert.exists(name, 'Expected the Paper Wallet name')
    await act(async () => {
      name.click()
    })
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['cold']))
    await render(new Set(['paper']), 'sidebar')
    expect(getComputedStyle(allButton()).borderWidth).toBe(borderWidth)
    expect(allButton().getAttribute('aria-pressed')).toBe('false')
    await toggle(1)
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
    expect(document.body.textContent).not.toContain('Apply')
    const sidebar = container.querySelector<HTMLElement>('[aria-label="Portfolio accounts"]')
    assert.exists(sidebar, 'Expected the accounts sidebar')
    const compactWidth = getComputedStyle(sidebar).width
    expect(compactWidth).toBe('280px')
    await click('Detailed view')
    expect(getComputedStyle(sidebar).width).toBe(compactWidth)
    expect(container.querySelector('[aria-label="Detailed view"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('false')
    expect(document.body.textContent).toContain('$312,500.00 USD')
    await click('Compact view')
    expect(getComputedStyle(sidebar).width).toBe(compactWidth)
    expect(container.querySelector('[aria-label="Compact view"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('true')
  })
})

it('collapses the sidebar and restores the selected accounts and detail view', async () => {
  await withTestSetup(async () => {
    await render(new Set(['paper']), 'sidebar')
    await click('Detailed view')
    onSelectionChange.mockClear()
    await click('Collapse accounts')
    expect(container.querySelector('[aria-label="Search accounts"]')).toBeNull()
    expect(container.querySelector('[aria-label="Expand accounts"]')?.getAttribute('aria-expanded')).toBe('false')
    await click('Expand accounts')
    expect(container.querySelector('[aria-label="Detailed view"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Include Paper Wallet"]')?.checked).toBe(true)
    expect(onSelectionChange).not.toHaveBeenCalled()
  })
})

it.each(['sidebar', 'dropdown'] as const)(
  'toggles once from the full row, balance, or checkbox in %s',
  async (presentation) => {
    await withTestSetup(async () => {
      await render(new Set(), presentation)
      if (presentation === 'dropdown') {
        await click('Filter accounts: All accounts')
      }
      const input = (): HTMLInputElement => {
        const element = document.querySelector<HTMLInputElement>('input[aria-label="Include Paper Wallet"]')
        assert.exists(element, 'Expected the Paper Wallet checkbox')
        return element
      }
      const row = (): HTMLLabelElement => {
        const element = input().closest('label')
        assert.exists(element, 'Expected the Paper Wallet row')
        return element
      }
      const balance = (): HTMLElement => {
        const element = Array.from(row().querySelectorAll('p')).find((paragraph) =>
          paragraph.textContent.includes('6.25'),
        )
        assert.exists(element, 'Expected the Paper Wallet balance')
        return element
      }
      for (const target of [row, balance, input]) {
        onSelectionChange.mockClear()
        await act(async () => {
          target().click()
        })
        if (presentation === 'sidebar') {
          expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set(['cold']))
        } else {
          expect(onSelectionChange).not.toHaveBeenCalled()
        }
      }
      if (presentation === 'dropdown') {
        expect(input().checked).toBe(false)
        await click('Apply')
        expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(new Set(['cold']))
      }
    })
  },
)
