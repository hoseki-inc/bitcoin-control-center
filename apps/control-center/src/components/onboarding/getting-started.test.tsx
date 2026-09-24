// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import superjson, { type SuperJSONResult } from 'superjson'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { FirstAccountReady, GettingStarted } from './getting-started'

vi.mock('../dashboard-charts/history-line-chart', () => ({
  HistoryLineChart: ({ data }: { data: Array<{ time: number }> }) => (
    <canvas data-testid="history-line" data-history-seconds={(data.at(-1)?.time ?? 0) - (data[0]?.time ?? 0)} />
  ),
}))

let container: HTMLDivElement
let root: Root
let client: QueryClient
let stored: string | null
let failSave: boolean

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown, so it runs once even after a failure or timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
  })

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
  stored = null
  failSave = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (failSave) {
          return { ok: false }
        }
        assert(typeof init.body === 'string', 'Expected a JSON body')
        const body: unknown = JSON.parse(init.body)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The app posts SuperJSON; this fake backend only reads the saved value back.
        stored = superjson.deserialize<{ value: string }>(body as SuperJSONResult).value
        return { ok: true }
      }
      return { ok: true, json: async () => ({ result: { data: superjson.serialize(stored) } }) }
    }),
  )
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

async function mount(ready?: boolean): Promise<void> {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ChakraProvider>
          <MemoryRouter>
            <Routes>
              <Route
                path="/"
                element={ready === undefined ? <GettingStarted /> : <FirstAccountReady ready={ready} />}
              />
              <Route path="/accounts/add" element={<p>Account picker</p>} />
              <Route path="/home" element={<p>Home overview</p>} />
              <Route path="/portfolio" element={<p>Portfolio overview</p>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })
  })
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')?.click())
}
async function click(label: string): Promise<void> {
  const button = expectElement(
    Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label),
    HTMLButtonElement,
  )
  await act(async () => {
    button.click()
  })
}
it('saves started before opening the real account picker', async () => {
  await withTestSetup(async () => {
    await mount()
    await click('Add First Account')
    expect(stored).toBe('started')
    expect(container.textContent).toContain('Account picker')
  })
})
it('persists dismissal and opens Home', async () => {
  await withTestSetup(async () => {
    await mount()
    await click('Explore First')
    expect(stored).toBe('dismissed')
    expect(container.textContent).toContain('Home overview')
  })
})
it('keeps the introduction available when saving fails', async () => {
  await withTestSetup(async () => {
    failSave = true
    await mount()
    await click('Explore First')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Try again')
    expect(stored).toBeNull()
  })
})
it('does not announce success before a balance is known', async () => {
  await withTestSetup(async () => {
    stored = 'started'
    await mount(false)
    expect(container.textContent).not.toContain('Your account is ready')
  })
})
it('completes onboarding when opening the portfolio after a known balance', async () => {
  await withTestSetup(async () => {
    stored = 'started'
    await mount(true)
    await click('View Portfolio')
    expect(stored).toBe('completed')
    expect(container.textContent).toContain('Portfolio overview')
  })
})

it('updates sample balances and period changes without changing onboarding progress', async () => {
  await withTestSetup(async () => {
    await mount()
    const total = (): string | null | undefined => container.querySelector('[aria-live="polite"]')?.textContent
    expect(total()).toBe('1.5200 BTC')
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).toContain('Sample portfolio')
    expect(container.textContent).not.toContain('2 accounts')
    expect(container.textContent).toContain('Monthly Net Change')
    const monthly = container.querySelector('[aria-label^="Sample monthly net change"]')?.getAttribute('aria-label')
    expect(monthly).toContain('+')
    expect(monthly).toContain('-')
    await click('30D')
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('over 30 days')
    expect(container.textContent).toContain('Starting balance')
    expect(container.querySelector('[data-testid="history-line"]')).not.toBeNull()
    expect(stored).toBeNull()
    expect(
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Add First Account')
        ?.querySelector('svg'),
    ).toBeNull()
  })
})

it('supplies the selected date range to the shared history chart', async () => {
  await withTestSetup(async () => {
    await mount()
    const chart = (): Element | null => container.querySelector('[data-testid="history-line"]')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(90 * 86400))
    await click('1Y')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(365 * 86400))
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('from 1.2000 BTC')
    await click('30D')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(30 * 86400))
  })
})
