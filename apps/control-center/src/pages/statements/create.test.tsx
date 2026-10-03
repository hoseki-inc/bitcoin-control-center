// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { StatementPreviewModal } from '../../components/statement-preview-modal'
import { claimFixture } from '../../testing/claims'
import type { RouterInput } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { type StatementCreateDataSource, StatementCreatePage, type StatementCreateViews } from './create'

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

type GenerateInput = RouterInput['portalProve']['statement']['initiateGeneration']
type PreviewProps = Parameters<typeof StatementPreviewModal>[0]

const generate = vi.fn<(input: GenerateInput) => Promise<Pick<StatementDto, 'id'>>>()
const preview = vi.fn<(props: PreviewProps) => void>()

const dataSource: StatementCreateDataSource = {
  useClaims: () => ({ data: [claimFixture('re_clmx_wallet', 'Wallet')] }),
  useExchangeAccounts: () => ({ data: [] }),
  useInitiateGeneration: () => ({ mutateAsync: generate }),
  useSavedUserName: () => ({ data: null }),
  useStatementPolling: () => ({ startPolling: () => undefined, statement: null }),
}
const views: StatementCreateViews = {
  ClaimSelection: () => <></>,
  FullTransitionModal: () => <></>,
  StatementPreviewModal: (props) => {
    preview(props)
    return null
  },
}

const toDay = (date: Date): string => format(date, 'yyyy-MM-dd')

async function renderPage(): Promise<{ container: HTMLDivElement; blur: (target: HTMLElement) => Promise<void> }> {
  const dom = browser.acquire()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  generate.mockReset().mockResolvedValue({ id: 'statement' })
  preview.mockClear()
  // Vitest owns teardown so it has its own timeout and runs once, even after a test failure.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <ChakraProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <StatementCreatePage dataSource={dataSource} views={views} />
          </MemoryRouter>
        </QueryClientProvider>
      </ChakraProvider>,
    )
  })
  const blur = async (target: HTMLElement): Promise<void> => {
    await act(async () => {
      target.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
    })
  }
  return { container, blur }
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)
  assert.exists(button, `Missing button: ${label}`)
  return button
}

function getInput(container: HTMLElement, id: string): HTMLInputElement {
  const input = container.querySelector(`#${id}`)
  assert(input instanceof HTMLInputElement, `Expected #${id} to be an input`)
  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  assert(descriptor?.set !== undefined, 'Expected the input value setter')
  descriptor.set.call(input, value)
}

async function typeDate(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    setInputValue(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
  })
}

function lastPreviewProps(): PreviewProps {
  const call = preview.mock.lastCall
  assert.exists(call, 'Expected the preview modal to render')
  return call[0]
}

function lastGenerateInput(): GenerateInput {
  const call = generate.mock.lastCall
  assert.exists(call, 'Expected statement generation to be requested')
  return call[0]
}

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
    // Verify that Date arithmetic actually uses the requested timezone in the test worker.
    expect(new Date(`${firstDay}T00:00:00`).getTimezoneOffset()).toBe(offset)
    const { container } = await renderPage()
    const openingInput = getInput(container, 'opening-date')
    const closingInput = getInput(container, 'closing-date')
    const button = (label: string): HTMLButtonElement => getButton(container, label)

    expect(openingInput.min).toBe(firstDay)
    await typeDate(closingInput, '2023-05-01')
    await typeDate(openingInput, previousDay)
    expect(openingInput.validity.rangeUnderflow).toBe(true)
    expect(container.querySelector('#date-range-error')?.textContent).toBe('Start date must be after April 1, 2023.')
    expect(button('Preview Statement').disabled).toBe(true)
    expect(button('Generate Statement').disabled).toBe(true)
    await act(async () => {
      button('Preview Statement').click()
      button('Generate Statement').click()
    })
    expect(generate).not.toHaveBeenCalled()
    expect(lastPreviewProps()).toMatchObject({ isOpen: false })

    await typeDate(openingInput, firstDay)
    expect(openingInput.validity.rangeUnderflow).toBe(false)
    expect(container.querySelector('#date-range-error')).toBeNull()
    expect(button('Preview Statement').disabled).toBe(false)
    expect(button('Generate Statement').disabled).toBe(false)
    const dates = {
      openingDate: new Date(`${firstDay}T00:00:00`),
      closingDate: new Date('2023-05-01T23:59:59.999'),
    }
    await click(button('Preview Statement'))
    expect(lastPreviewProps()).toMatchObject({ isOpen: true, ...dates })
    await click(button('Generate Statement'))
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(expect.objectContaining(dates))
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
    const { container, blur: blurTarget } = await renderPage()
    const generateButton = (): HTMLButtonElement => getButton(container, 'Generate Statement')
    const previewButton = (): HTMLButtonElement => getButton(container, 'Preview Statement')
    const generatedDate = (): string => toDay(lastGenerateInput()[key])
    const previewDate = (): string => toDay(lastPreviewProps()[key])

    const input = getInput(container, id)
    const blur = async (): Promise<void> => {
      await blurTarget(input)
    }

    const previousDate = input.value
    expect(previousDate).not.toBe('')
    expect(generateButton().disabled).toBe(false)
    expect(previewDate()).toBe(previousDate)

    // Clearing the field (picker "Clear" or keyboard deletion) keeps the previous date.
    await typeDate(input, '')
    await blur()
    expect(input.value).toBe(previousDate)
    expect(generateButton().disabled).toBe(false)
    expect(previewButton().disabled).toBe(false)
    await click(generateButton())
    expect(generate).toHaveBeenCalledOnce()
    expect(generatedDate()).toBe(previousDate)
    await click(previewButton())
    expect(lastPreviewProps().isOpen).toBe(true)
    expect(previewDate()).toBe(previousDate)

    // A partially edited field that is left empty without a change event is restored on blur.
    await act(async () => {
      setInputValue(input, '')
    })
    expect(input.value).toBe('')
    await blur()
    expect(input.value).toBe(previousDate)
    expect(previewDate()).toBe(previousDate)

    // Dismissing the picker without choosing a date leaves it unchanged.
    await blur()
    expect(input.value).toBe(previousDate)
    expect(previewDate()).toBe(previousDate)

    // Choosing a replacement date uses the new date for preview and generation.
    await typeDate(input, replacement)
    await blur()
    expect(input.value).toBe(replacement)
    expect(previewDate()).toBe(replacement)
    await click(generateButton())
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generatedDate()).toBe(replacement)
  },
)
