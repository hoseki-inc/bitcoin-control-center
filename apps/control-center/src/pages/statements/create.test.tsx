// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
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
const preview = vi.hoisted(() => vi.fn((_props: unknown) => null))
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
vi.mock('../../components/statement-preview-modal', () => ({ StatementPreviewModal: preview }))
vi.mock('../../components/full-transition-modal', () => ({ FullTransitionModal: () => null, getContent: () => null }))

type DateArgs = { openingDate: Date; closingDate: Date }
const toDay = (date: Date): string => format(date, 'yyyy-MM-dd')

it.each([
  { timezone: 'UTC', firstDay: '2023-04-02', previousDay: '2023-04-01', offset: 0 },
  { timezone: 'America/Los_Angeles', firstDay: '2023-04-01', previousDay: '2023-03-31', offset: 420 },
  { timezone: 'Europe/Berlin', firstDay: '2023-04-02', previousDay: '2023-04-01', offset: -120 },
])(
  'validates the picker minimum as a calendar day in $timezone',
  async ({ timezone, firstDay, previousDay, offset }) => {
    vi.stubEnv('TZ', timezone)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    generate.mockClear()
    preview.mockClear()
    try {
      // Verify that Date arithmetic actually uses the requested timezone in the test worker.
      expect(new Date(`${firstDay}T00:00:00`).getTimezoneOffset()).toBe(offset)
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
      const openingInput = container.querySelector<HTMLInputElement>('#opening-date')!
      const closingInput = container.querySelector<HTMLInputElement>('#closing-date')!
      const button = (label: string): HTMLButtonElement =>
        Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!
      const setDate = async (input: HTMLInputElement, value: string): Promise<void> => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }

      expect(openingInput.min).toBe(firstDay)
      await setDate(closingInput, '2023-05-01')
      await setDate(openingInput, previousDay)
      expect(openingInput.validity.rangeUnderflow).toBe(true)
      expect(container.querySelector('#date-range-error')?.textContent).toBe('Start date must be after April 1, 2023.')
      expect(button('Preview Statement').disabled).toBe(true)
      expect(button('Generate Statement').disabled).toBe(true)
      await act(async () => {
        button('Preview Statement').click()
        button('Generate Statement').click()
      })
      expect(generate).not.toHaveBeenCalled()
      expect(preview.mock.calls.at(-1)![0]).toMatchObject({ isOpen: false })

      await setDate(openingInput, firstDay)
      expect(openingInput.validity.rangeUnderflow).toBe(false)
      expect(container.querySelector('#date-range-error')).toBeNull()
      expect(button('Preview Statement').disabled).toBe(false)
      expect(button('Generate Statement').disabled).toBe(false)
      const dates = {
        openingDate: new Date(`${firstDay}T00:00:00`),
        closingDate: new Date('2023-05-01T23:59:59.999'),
      }
      await act(async () => button('Preview Statement').click())
      expect(preview.mock.calls.at(-1)![0]).toMatchObject({ isOpen: true, ...dates })
      await act(async () => button('Generate Statement').click())
      expect(generate).toHaveBeenCalledOnce()
      expect(generate).toHaveBeenCalledWith(expect.objectContaining(dates))
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      vi.useRealTimers()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  },
)

it.each([
  { id: 'opening-date', key: 'openingDate', replacement: '2026-04-02' },
  { id: 'closing-date', key: 'closingDate', replacement: '2026-09-07' },
] as const)(
  'clearing $id restores the previous date and keeps generation available',
  async ({ id, key, replacement }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    generate.mockClear()
    preview.mockClear()
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
      const button = (label: string): HTMLButtonElement =>
        Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!
      const generateButton = (): HTMLButtonElement => button('Generate Statement')
      const previewButton = (): HTMLButtonElement => button('Preview Statement')
      const generatedDate = (): string => toDay((generate.mock.calls.at(-1)![0] as DateArgs)[key])
      const previewProps = (): { isOpen: boolean } & DateArgs =>
        preview.mock.calls.at(-1)![0] as { isOpen: boolean } & DateArgs
      const previewDate = (): string => toDay(previewProps()[key])

      const input = container.querySelector<HTMLInputElement>(`#${id}`)!
      const setValue = (value: string): void => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      }
      const type = async (value: string): Promise<void> => {
        await act(async () => {
          setValue(value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }
      const blur = async (): Promise<void> => {
        await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
      }

      const previousDate = input.value
      expect(previousDate).not.toBe('')
      expect(generateButton().disabled).toBe(false)
      expect(previewDate()).toBe(previousDate)

      // Clearing the field (picker "Clear" or keyboard deletion) keeps the previous date.
      await type('')
      await blur()
      expect(input.value).toBe(previousDate)
      expect(generateButton().disabled).toBe(false)
      expect(previewButton().disabled).toBe(false)
      await act(async () => generateButton().click())
      expect(generate).toHaveBeenCalledOnce()
      expect(generatedDate()).toBe(previousDate)
      await act(async () => previewButton().click())
      expect(previewProps().isOpen).toBe(true)
      expect(previewDate()).toBe(previousDate)

      // A partially edited field that is left empty without a change event is restored on blur.
      await act(async () => setValue(''))
      expect(input.value).toBe('')
      await blur()
      expect(input.value).toBe(previousDate)
      expect(previewDate()).toBe(previousDate)

      // Dismissing the picker without choosing a date leaves it unchanged.
      await blur()
      expect(input.value).toBe(previousDate)
      expect(previewDate()).toBe(previousDate)

      // Choosing a replacement date uses the new date for preview and generation.
      await type(replacement)
      await blur()
      expect(input.value).toBe(replacement)
      expect(previewDate()).toBe(replacement)
      await act(async () => generateButton().click())
      expect(generate).toHaveBeenCalledTimes(2)
      expect(generatedDate()).toBe(replacement)
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  },
)
