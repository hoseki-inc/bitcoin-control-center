// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { ClaimsPage } from './index'

vi.mock('../../hooks/use-bitcoin-display', () => ({ useBitcoinDisplay: () => ({ unit: 'btc' }) }))
vi.mock('../../hooks/use-auto-refresh-exchanges', () => ({ useAutoRefreshExchanges: () => undefined }))
vi.mock('../../hooks/use-query-error-toast', () => ({ useQueryErrorToast: () => undefined }))
vi.mock('../../lib/balances', () => ({ useGetBalancesPerClaimIds: () => ({ data: new Map() }) }))
vi.mock('../../utils/claim-utils', () => ({
  ensureClaimStatusNotExpired: () => 'verified',
  mapClaimToClaimCardProps: () => ({}),
}))
vi.mock('../../components/onboarding/getting-started', () => ({ FirstAccountReady: () => null }))
vi.mock('../../components/claims/claim-details/delete-claim-modal', () => ({ DeleteClaimModal: () => null }))
vi.mock('@hoseki/packages/ui/design-system', () => ({
  EmptyView: () => null,
  ErrorBanner: () => null,
  Spinner: () => null,
}))
vi.mock('@hoseki/packages/ui/prove-verify-ui', () => ({
  ClaimCardKeystores: () => null,
  getBadgeConfigForClaim: () => ({}),
}))
vi.mock('../../trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    portalProve: {
      registry: {
        claims: {
          list: { useQuery: () => ({ data: [] }) },
          listArchived: { useQuery: () => ({ data: [] }) },
          getCountLimit: { useQuery: () => ({ data: null }) },
          restore: { useMutation: () => ({}) },
        },
      },
      exchange: {
        list: {
          useQuery: () => ({
            data: [
              {
                id: 'strike',
                displayName: 'Offline Strike',
                exchange: 'strike',
                balance: '98765000000',
                connectionStatus: 'needs_reconnect',
              },
            ],
          }),
        },
      },
      manual: {
        list: { useQuery: () => ({ data: [{ id: 'manual', displayName: 'Savings', balance: '100000000' }] }) },
      },
      etf: { list: { useQuery: () => ({ data: [] }) } },
      retrieveBitcoinPrice: { useQuery: () => ({ data: { value: 50000 } }) },
    },
  },
}))

it('defaults to cards, remembers view across remounts, and offers add/reconnect links in both views', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
  localStorage.clear()
  const container = document.createElement('div')
  document.body.append(container)
  let root = createRoot(container)
  const mount = async (): Promise<void> => {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <MemoryRouter>
            <ClaimsPage />
          </MemoryRouter>
        </ChakraProvider>,
      ),
    )
  }
  const verifyLinks = (): void => {
    expect(container.querySelector('[aria-label="Add account"]')?.getAttribute('href')).toBe('/accounts/add')
    expect(container.querySelector('a[href="/accounts/strike/strike"]')?.textContent).not.toContain('987.65')
    expect(container.textContent).not.toContain('987.65')
    expect(container.textContent).toContain('Some balances are unavailable')
  }
  try {
    await mount()
    expect(container.querySelector('[aria-label="Card view"]')?.getAttribute('aria-pressed')).toBe('true')
    verifyLinks()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="List view"]')!.click())
    verifyLinks()
    expect(container.querySelector('a[href="/accounts/strike/strike"]')?.textContent).toContain('Reconnect needed')
    await act(async () => root.unmount())
    root = createRoot(container)
    await mount()
    expect(container.querySelector('[aria-label="List view"]')?.getAttribute('aria-pressed')).toBe('true')
    verifyLinks()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  }
})
