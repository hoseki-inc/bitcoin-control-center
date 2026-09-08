// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountFilter } from './account-filter'

vi.mock('../../utils/claim-utils', () => ({ ensureClaimStatusNotExpired: () => 'verified' }))
vi.mock('../../hooks/use-bitcoin-display', () => ({ useBitcoinDisplay: () => ({ unit: 'btc' }) }))
vi.mock('../sensitive-value', () => ({ SensitiveValue: ({ children }: { children: React.ReactNode }) => children }))

let root: Root
let container: HTMLDivElement
const onSelectionChange = vi.fn()
const accounts = [
  { id: 'paper', displayName: 'Paper Wallet', balance: '625000000' },
  { id: 'cold', displayName: 'Cold Storage', balance: '260000000' },
] as React.ComponentProps<typeof AccountFilter>['manualAccounts']

async function render(
  selected = new Set<string>(),
  presentation: 'dropdown' | 'sidebar' = 'dropdown',
  disconnected = false,
): Promise<void> {
  await act(async () =>
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <AccountFilter
            presentation={presentation}
            claims={[]}
            exchangeAccounts={
              disconnected
                ? ([
                    {
                      id: 'strike',
                      displayName: 'Offline Strike',
                      exchange: 'strike',
                      balance: '9999900000',
                      connectionStatus: 'needs_reconnect',
                    },
                  ] as React.ComponentProps<typeof AccountFilter>['exchangeAccounts'])
                : []
            }
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
    ),
  )
}

async function click(text: string): Promise<void> {
  const button = Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent === text || element.getAttribute('aria-label') === text,
  )
  expect(button).toBeDefined()
  await act(async () => button!.click())
}

async function toggle(index: number): Promise<void> {
  const checkbox = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[index]!
  await act(async () => checkbox.click())
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  onSelectionChange.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await render()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it('shows all accounts checked, and applies a subset only after Apply', async () => {
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

it('prevents an empty selection from becoming an all-accounts query', async () => {
  await click('Filter accounts: All accounts')
  await toggle(0)
  await toggle(1)
  const apply = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Apply')!
  expect(apply.disabled).toBe(true)
  expect(document.body.textContent).toContain('Select at least one account.')
  await click('Select all')
  await click('Apply')
  expect(onSelectionChange).toHaveBeenCalledWith(new Set())
})

it('discards draft changes on Cancel and restores the applied selection on reopen', async () => {
  await render(new Set(['paper']))
  await click('Filter accounts: Paper Wallet')
  await toggle(1)
  await click('Cancel')
  expect(onSelectionChange).not.toHaveBeenCalled()
  await click('Filter accounts: Paper Wallet')
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  expect(inputs[0]!.checked).toBe(true)
  expect(inputs[1]!.checked).toBe(false)
})

it('searches without losing selections hidden by the search', async () => {
  await click('Filter accounts: All accounts')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search accounts"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cold')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
  await toggle(0)
  await click('Apply')
  expect(onSelectionChange).toHaveBeenCalledWith(new Set(['paper']))
})

it('resets the applied filter with Show all', async () => {
  await render(new Set(['cold']))
  await click('Show all')
  expect(onSelectionChange).toHaveBeenCalledWith(new Set())
})

it.each(['dropdown', 'sidebar'] as const)(
  'routes disconnected exchanges to reconnect without exposing or selecting their saved balance in %s',
  async (presentation) => {
    await render(new Set(), presentation, true)
    if (presentation === 'dropdown') await click('Filter accounts: All accounts')
    const reconnect = document.querySelector<HTMLAnchorElement>('[aria-label="Reconnect Offline Strike"]')!
    expect(reconnect.getAttribute('href')).toBe('/accounts/strike/strike')
    expect(document.body.textContent).not.toContain('99.999')
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    if (presentation === 'dropdown') {
      await click('Select all')
      await click('Apply')
      expect(onSelectionChange).toHaveBeenCalledWith(new Set())
    }
  },
)

it('supports immediate row selection beside the charts and remembers compact mode', async () => {
  await render(new Set(), 'sidebar')
  const allButton = (): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'All accounts')!
  const borderWidth = getComputedStyle(allButton()).borderWidth
  expect(borderWidth).toBe('1px')
  expect(allButton().getAttribute('aria-pressed')).toBe('true')
  const name = Array.from(container.querySelectorAll('p')).find((element) => element.textContent === 'Paper Wallet')!
  await act(async () => name.click())
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['cold']))
  await render(new Set(['paper']), 'sidebar')
  expect(getComputedStyle(allButton()).borderWidth).toBe(borderWidth)
  expect(allButton().getAttribute('aria-pressed')).toBe('false')
  await toggle(1)
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set())
  expect(document.body.textContent).not.toContain('Apply')
  const sidebar = container.querySelector<HTMLElement>('[aria-label="Portfolio accounts"]')!
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

it('collapses the sidebar and restores the selected accounts and detail view', async () => {
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

it.each(['sidebar', 'dropdown'] as const)(
  'toggles once from the full row, balance, or checkbox in %s',
  async (presentation) => {
    await render(new Set(), presentation)
    if (presentation === 'dropdown') await click('Filter accounts: All accounts')
    const input = (): HTMLInputElement => document.querySelector('input[aria-label="Include Paper Wallet"]')!
    const row = (): HTMLLabelElement => input().closest('label')!
    const balance = (): HTMLElement =>
      Array.from(row().querySelectorAll('p')).find((element) => element.textContent?.includes('6.25'))!
    for (const target of [row, balance, input]) {
      onSelectionChange.mockClear()
      await act(async () => target().click())
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
  },
)
