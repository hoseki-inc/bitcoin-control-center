// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, vi } from 'vitest'
import { ManualAccountDetailsPage } from './[id]'

const mocks = vi.hoisted(() => ({
  remove: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn().mockResolvedValue(undefined),
}))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@hoseki/packages/ui/design-system', () => ({
  ErrorBanner: ({ message }: { message: string }) => createElement('p', { role: 'alert' }, message),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../components/bitcoin-amount', () => ({ BitcoinAmount: () => createElement('span', null, '1 BTC') }))
vi.mock('../../../trpc', () => {
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isLoading: false })
  return {
    trpc: {
      useUtils: () => ({
        portalProve: {
          manual: {
            get: { invalidate: mocks.invalidate },
            list: { invalidate: mocks.invalidate },
            transactions: { list: { invalidate: mocks.invalidate } },
          },
          controlCenter: { invalidate: mocks.invalidate },
        },
      }),
      portalProve: {
        manual: {
          get: {
            useQuery: () => ({
              data: {
                id: 'test',
                displayName: 'Test holding',
                balance: '100000000',
                balanceAsOf: '2026-09-01T00:00:00Z',
                createdAt: '2026-09-01T00:00:00Z',
              },
              isLoading: false,
            }),
          },
          updateBalance: { useMutation: mutation },
          delete: { useMutation: () => ({ mutateAsync: mocks.remove, isLoading: false }) },
          transactions: {
            list: { useQuery: () => ({ data: [], isLoading: false }) },
            add: { useMutation: mutation },
            delete: { useMutation: mutation },
          },
        },
      },
    },
  }
})

it('requires confirmation and allows cancellation before removing an account', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const click = async (label: string): Promise<void> => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent === label)
    expect(button).toBeTruthy()
    await act(async () => button?.click())
  }
  try {
    await act(async () =>
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(
            MemoryRouter,
            { initialEntries: ['/accounts/manual/test'] },
            createElement(
              Routes,
              null,
              createElement(Route, {
                path: '/accounts/manual/:accountId',
                element: createElement(ManualAccountDetailsPage),
              }),
              createElement(Route, { path: '/accounts', element: createElement('p', null, 'Accounts') }),
            ),
          ),
        ),
      ),
    )
    await click('Remove Account')
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Test holding')
    expect(mocks.remove).not.toHaveBeenCalled()
    await click('Cancel')
    expect(mocks.remove).not.toHaveBeenCalled()
    await click('Remove Account')
    await click('Remove')
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ accountId: 'test' })
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
