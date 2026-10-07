// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { FirstAccountReady, GettingStarted, ONBOARDING_KEY } from './getting-started'
import type { PortfolioDemoViews } from './portfolio-demo'

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

const SavedSettingSchema = z.object({ json: z.object({ value: z.string() }) })

const views: PortfolioDemoViews = {
  HistoryLineChart: ({ data }) => (
    <canvas data-testid="history-line" data-history-seconds={(data.at(-1)?.time ?? 0) - (data[0]?.time ?? 0)} />
  ),
}

let container: HTMLDivElement
let root: Root
let client: QueryClient
let stored: string | null
let failSave: boolean

async function withTestSetup(initial: string | null, run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  stored = initial
  failSave = false
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
  })
  // The saved onboarding progress is already known, so only saves reach the local API.
  client.setQueryData(['local-settings', ONBOARDING_KEY], initial)
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method !== 'POST') {
        throw new Error('Unexpected settings request')
      }
      if (failSave) {
        return new Response(null, { status: 500 })
      }
      const body: unknown = JSON.parse(parseUnknown(z.string(), init.body).unwrapOr('null'))
      stored = parseUnknown(SavedSettingSchema, body)
        .map((saved) => saved.json.value)
        .unwrapOr(null)
      return new Response(null, { status: 200 })
    }),
  )
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
                element={ready === undefined ? <GettingStarted views={views} /> : <FirstAccountReady ready={ready} />}
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
}

async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
  assert(button !== undefined, `Expected a ${label} button`)
  await act(async () => {
    button.click()
  })
}

it('saves started before opening the real account picker', async () => {
  await withTestSetup(null, async () => {
    await mount()
    await click('Add First Account')
    expect(stored).toBe('started')
    expect(container.textContent).toContain('Account picker')
  })
})

it('persists dismissal and opens Home', async () => {
  await withTestSetup(null, async () => {
    await mount()
    await click('Explore First')
    expect(stored).toBe('dismissed')
    expect(container.textContent).toContain('Home overview')
  })
})

it('keeps the introduction available when saving fails', async () => {
  await withTestSetup(null, async () => {
    failSave = true
    await mount()
    await click('Explore First')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Try again')
    expect(stored).toBeNull()
  })
})

it('does not announce success before a balance is known', async () => {
  await withTestSetup('started', async () => {
    await mount(false)
    expect(container.textContent).not.toContain('Your account is ready')
  })
})

it('completes onboarding when opening the portfolio after a known balance', async () => {
  await withTestSetup('started', async () => {
    await mount(true)
    await click('View Portfolio')
    expect(stored).toBe('completed')
    expect(container.textContent).toContain('Portfolio overview')
  })
})

it('updates sample balances and period changes without changing onboarding progress', async () => {
  await withTestSetup(null, async () => {
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
    expect(container.querySelector('figure')?.getAttribute('aria-label')).toContain('over 30 days')
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
  await withTestSetup(null, async () => {
    await mount()
    const chart = (): Element | null => container.querySelector('[data-testid="history-line"]')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(90 * 86400))
    await click('1Y')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(365 * 86400))
    expect(container.querySelector('figure')?.getAttribute('aria-label')).toContain('from 1.2000 BTC')
    await click('30D')
    expect(chart()?.getAttribute('data-history-seconds')).toBe(String(30 * 86400))
  })
})
