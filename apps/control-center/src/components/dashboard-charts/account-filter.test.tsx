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

async function render(selected = new Set<string>()): Promise<void> {
  await act(async () =>
    root.render(
      <ChakraProvider>
        <MemoryRouter>
          <AccountFilter
            claims={[]}
            exchangeAccounts={[]}
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
