// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountSummary } from '../hooks/use-accounts'
import { Desktop, greetingFor } from './desktop'

const mocks = vi.hoisted(() => ({
  accounts: [] as AccountSummary[],
  accountsLoading: false,
  onboarding: 'completed' as string | null,
  userName: 'Satoshi Nakamoto' as string | null,
  openSearch: vi.fn(),
}))

vi.mock('../hooks/use-local-settings', () => ({
  useLocalSetting: (key: string) => ({
    data: key === 'user_name' ? mocks.userName : key === 'onboarding_v1' ? mocks.onboarding : 'symbol',
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('../hooks/use-accounts', () => ({
  useAccounts: () => ({
    accounts: mocks.accounts,
    totals: {
      totalSats: 150_000_000,
      totalUsd: 90_000,
      hasUnknownBalance: false,
      accountCount: mocks.accounts.length,
      selfCustodyCount: mocks.accounts.filter((a) => a.kind === 'wallet').length,
      verifiedCount: mocks.accounts.filter((a) => a.state === 'verified').length,
      pendingCount: mocks.accounts.filter((a) => a.state === 'pending').length,
      reconnectCount: 0,
    },
    btcUsdPrice: 60_000,
    isLoading: mocks.accountsLoading,
    isError: false,
    retry: vi.fn(),
  }),
}))

vi.mock('../trpc', () => ({
  trpc: {
    portalProve: {
      retrieveBitcoinPriceHistory: {
        useQuery: () => ({
          data: [
            { time: 1, value: 50_000 },
            { time: 2, value: 55_000 },
          ],
          isError: false,
        }),
      },
      controlCenter: {
        getData: { useQuery: () => ({ data: { historySyncingAccountIds: [], historyFailedAccountIds: [] } }) },
      },
    },
    settings: { electrumStatus: { useQuery: () => ({ data: { connected: true } }) } },
    blocks: { tip: { useQuery: () => ({ data: { height: 914_203 }, isError: false }) } },
  },
}))

vi.mock('./wallpaper-picker', () => ({ WallpaperPicker: () => <div role="dialog" aria-label="Choose a wallpaper" /> }))

const account = (overrides: Partial<AccountSummary>): AccountSummary => ({
  id: 'id',
  kind: 'wallet',
  name: 'Wallet',
  to: '/accounts/id',
  sats: 1,
  state: 'verified',
  wallet: 'trezor',
  exchange: null,
  quorum: null,
  ...overrides,
})

function LocationProbe(): JSX.Element {
  return <output data-testid="location">{useLocation().pathname}</output>
}

describe('Desktop', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    localStorage.clear()
    mocks.accounts = [
      account({ id: 'a', name: 'Cold Wallet', state: 'verified' }),
      account({ id: 'b', name: 'Spending', state: 'pending', to: '/accounts/b' }),
      account({
        id: 'c',
        kind: 'manual',
        name: 'Paper Wallet',
        state: 'manual',
        wallet: null,
        to: '/accounts/manual/c',
      }),
    ]
    mocks.accountsLoading = false
    mocks.onboarding = 'completed'
    mocks.userName = 'Satoshi Nakamoto'
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const render = async (): Promise<void> => {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <MemoryRouter initialEntries={['/home']}>
            <Routes>
              <Route path="*" element={<Desktop covered={false} onOpenSearch={mocks.openSearch} />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ChakraProvider>,
      ),
    )
  }
  const text = (): string => container.textContent ?? ''

  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 0, 1, 8))).toBe('Good morning')
    expect(greetingFor(new Date(2026, 0, 1, 14))).toBe('Good afternoon')
    expect(greetingFor(new Date(2026, 0, 1, 20))).toBe('Good evening')
  })

  it('shows the greeting, the four widgets, and every account as an icon', async () => {
    await render()
    expect(container.querySelector('h1')!.textContent).toMatch(/, Satoshi\.$/)
    expect(text()).toContain('₿ 150,000,000')
    expect(text()).toContain('$90,000.00 · 3 accounts')
    expect(text()).toContain('$55,000')
    expect(text()).toContain('+10.00% · 7 days')
    expect(text()).toContain('Connected')
    expect(text()).toContain('914,203')
    expect(text()).toContain('1 of 2')
    expect(text()).toContain('1 awaiting a signature')

    const icons = [...container.querySelectorAll<HTMLAnchorElement>('[data-desktop-item]')]
    expect(icons.map((icon) => icon.getAttribute('aria-label'))).toEqual([
      'Cold Wallet, verified',
      'Spending, awaiting a signature',
      'Paper Wallet, tracked manually',
      'Add account, connect a wallet or exchange, or track holdings manually',
    ])
    expect(icons.map((icon) => icon.getAttribute('href'))).toEqual([
      '/accounts/id',
      '/accounts/b',
      '/accounts/manual/c',
      '/accounts/add',
    ])
    // Each widget opens its section.
    expect(container.querySelector('a[href="/portfolio"]')).not.toBeNull()
    expect(container.querySelector('a[href="/settings"]')).not.toBeNull()
  })

  it('hides balances in privacy mode', async () => {
    localStorage.setItem('control-center:privacy', 'true')
    await render()
    expect(text()).not.toContain('150,000,000')
    expect(container.querySelectorAll('[aria-label="Hidden value"]').length).toBeGreaterThan(0)
  })

  it('offers account actions on right-click, including verification for pending wallets', async () => {
    await render()
    const pending = container.querySelector<HTMLElement>('[aria-label="Spending, awaiting a signature"]')!
    await act(async () =>
      pending.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })),
    )
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)
    expect(items).toEqual(['Open', 'Verify ownership', 'Create statement'])
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]:last-of-type')!.click())
    expect(container.querySelector('[data-testid="location"]')!.textContent).toBe('/statements/create')
  })

  it('switches appearance and opens the wallpaper picker from the desktop menu', async () => {
    await render()
    const desktop = container.querySelector<HTMLElement>('[aria-label="Overview"]')!
    await act(async () =>
      desktop.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })),
    )
    const dark = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent === 'Dark',
    )!
    await act(async () => dark.click())
    expect(localStorage.getItem('control-center:appearance')).toBe('dark')

    await act(async () =>
      desktop.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })),
    )
    const wallpaper = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
      item.textContent?.startsWith('Change wallpaper'),
    )!
    await act(async () => wallpaper.click())
    expect(container.querySelector('[aria-label="Choose a wallpaper"]')).not.toBeNull()
  })

  it('opens search from the pill above the dock', async () => {
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Search"]')!.click())
    expect(mocks.openSearch).toHaveBeenCalledOnce()
  })

  it('opens Getting Started on first run', async () => {
    mocks.accounts = []
    mocks.onboarding = null
    await render()
    expect(container.querySelector('[data-testid="location"]')!.textContent).toBe('/getting-started')
  })

  it('never shows a zero total when no balance is known yet', async () => {
    mocks.accounts = mocks.accounts.map((item) => ({ ...item, sats: null }))
    await render()
    expect(text()).not.toContain('₿ 150,000,000')
    expect(text()).toContain('Balances unavailable right now')
  })

  it('stays on the desktop without accounts once onboarding was dismissed', async () => {
    mocks.accounts = []
    mocks.onboarding = 'dismissed'
    await render()
    expect(container.querySelector('[data-testid="location"]')!.textContent).toBe('/home')
    expect(text()).toContain('No accounts yet')
  })
})
