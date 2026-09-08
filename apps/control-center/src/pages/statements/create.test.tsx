// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { StatementCreatePage } from './create'

vi.mock('@hoseki/packages/ui/design-system', async () => ({
  DateInput: (await import('@hoseki/packages/ui/design-system/forms/date-input')).DateInput,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const generate = vi.hoisted(() => vi.fn(async (_input: unknown) => ({ id: 'statement' })))
vi.mock('../../trpc', () => ({
  trpc: {
    portalProve: {
      registry: { claims: { list: { useQuery: () => ({ data: [{ id: 'wallet' }] }) } } },
      exchange: { list: { useQuery: () => ({ data: [] }) } },
      statement: { initiateGeneration: { useMutation: () => ({ mutateAsync: generate }) } },
    },
  },
}))
vi.mock('../../hooks/use-local-settings', () => ({ useLocalSetting: () => ({ data: null }) }))
vi.mock('../../providers/statement-polling-provider', () => ({
  useStatementPolling: () => ({ startPolling: vi.fn() }),
}))
vi.mock('../../components/claims/claim-selection', () => ({ ClaimSelection: () => null }))
vi.mock('../../components/statement-preview-modal', () => ({ StatementPreviewModal: () => null }))
vi.mock('../../components/full-transition-modal', () => ({ FullTransitionModal: () => null, getContent: () => null }))

it.each(['opening-date', 'closing-date'])(
  'clearing %s disables generation until the displayed date is valid',
  async (id) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    generate.mockClear()
    try {
      await act(async () =>
        root.render(
          <ChakraProvider>
            <QueryClientProvider client={client}>
              <MemoryRouter>
                <StatementCreatePage />
              </MemoryRouter>
            </QueryClientProvider>
          </ChakraProvider>,
        ),
      )
      const button = (): HTMLButtonElement =>
        Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Generate Statement')!
      expect(button().disabled).toBe(false)
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!
      const setDate = async (value: string): Promise<void> => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
      }
      await setDate('')
      expect(input.value).toBe('')
      expect(button().disabled).toBe(true)
      await act(async () => button().click())
      expect(generate).not.toHaveBeenCalled()
      await setDate(id === 'opening-date' ? '2026-04-02' : '2026-09-07')
      expect(button().disabled).toBe(false)
      await act(async () => button().click())
      expect(generate).toHaveBeenCalledOnce()
      const args = generate.mock.calls[0]?.[0] as unknown as { openingDate: Date; closingDate: Date }
      const date = id === 'opening-date' ? args.openingDate : args.closingDate
      expect([date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')).toBe(
        id === 'opening-date' ? '2026-4-2' : '2026-9-7',
      )
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  },
)
