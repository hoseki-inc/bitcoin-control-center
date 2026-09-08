// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, vi } from 'vitest'
import { StrikeAccountDetailsPage } from './[id]'

vi.mock('@hoseki/packages/ui/design-system', () => ({ ErrorBanner: () => null }))
vi.mock('@hoseki/packages/ui/prove-verify-ui', () => ({ CheckCircleFilledIcon: () => null, StatusBadge: () => null }))
vi.mock('../../../hooks/use-bitcoin-display', () => ({ useBitcoinDisplay: () => ({ unit: 'btc' }) }))
vi.mock('../../../trpc', () => ({
  trpc: {
    useUtils: () => ({}),
    portalProve: {
      exchange: {
        refreshBalance: { useMutation: () => ({}) },
        delete: { useMutation: () => ({}) },
        strike: {
          list: {
            useQuery: () => ({
              data: [
                {
                  id: 'strike',
                  displayName: 'Test Strike',
                  createdAt: '2026-08-01T00:00:00Z',
                  balance: '24690000',
                  connectionStatus: 'connected',
                },
              ],
            }),
          },
          importStatement: { useMutation: () => ({}) },
          deleteStatementMonth: { useMutation: () => ({}) },
          listStatementMonths: { useQuery: () => ({ data: ['2026-08'] }) },
          listStatementTransactions: {
            useQuery: () => ({
              data: [
                {
                  id: 'transaction',
                  transactedAt: '2026-08-01T12:00:00Z',
                  type: 'purchase',
                  amountBtc: '0.2469',
                  amountUsd: '12345',
                  exchangeRate: '50000',
                },
              ],
            }),
          },
        },
      },
    },
  },
}))

it('masks and restores all financial values in the actual Strike transaction table', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
  localStorage.clear()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <MemoryRouter initialEntries={['/accounts/strike/strike']}>
            <Routes>
              <Route path="/accounts/strike/:accountId" element={<StrikeAccountDetailsPage />} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>,
      ),
    )
    const month = Array.from(container.querySelectorAll('p')).find((p) => p.textContent === 'August 2026')!
    await act(async () => month.click())
    const table = (): HTMLTableElement => container.querySelector('table')!
    expect(table().textContent).toContain('$12345.00')
    for (const hidden of [true, false]) {
      await act(async () => {
        localStorage.setItem('control-center:privacy', String(hidden))
        window.dispatchEvent(new StorageEvent('storage', { key: 'control-center:privacy' }))
      })
      for (const value of ['12345', '50,000', '0.2469']) {
        expect(table().textContent?.includes(value)).toBe(!hidden)
      }
    }
  } finally {
    await act(async () => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  }
})
