// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import superjson from 'superjson'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useUiPreference } from './use-ui-preference'
import { useUiSettings } from './use-ui-settings'

const mode = vi.hoisted(() => ({ isDesktop: true }))
const errorToast = vi.hoisted(() => vi.fn())
vi.mock('../mode', () => mode)
vi.mock('sonner', () => ({ toast: { error: errorToast } }))

let root: Root
let container: HTMLDivElement
let client: QueryClient
let settings: Map<string, string>
let failSave: boolean

function Preferences(): React.ReactElement {
  const [compact, saveCompact] = useUiPreference('sidebar_compact')
  const { isStatementsMadeEasyDismissed: dismissed, updateUiSettings } = useUiSettings()
  return createElement(
    'div',
    null,
    createElement(
      'button',
      { id: 'compact', 'data-value': compact, onClick: () => saveCompact(!compact) },
      'Toggle sidebar',
    ),
    createElement(
      'button',
      {
        id: 'dismissed',
        'data-value': dismissed,
        onClick: () => updateUiSettings({ isStatementsMadeEasyDismissed: !dismissed }),
      },
      'Toggle banner',
    ),
  )
}

function response(value: unknown): Response {
  return new Response(JSON.stringify({ result: { data: superjson.serialize(value) } }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
async function settled(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(client.isFetching() + client.isMutating()).toBe(0)
  })
}
async function render(wait = true): Promise<void> {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  root = createRoot(container)
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Preferences))))
  if (wait) await settled()
}
function value(id: string): string | undefined {
  return container.querySelector<HTMLButtonElement>(`#${id}`)?.dataset['value']
}
async function toggleBoth(): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('#compact')!.click()
    container.querySelector<HTMLButtonElement>('#dismissed')!.click()
  })
  await settled()
}
async function close(): Promise<void> {
  await act(async () => root.unmount())
  client.clear()
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mode.isDesktop = true
  settings = new Map()
  failSave = false
  errorToast.mockClear()
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, 'http://localhost:3400')
      const payload = superjson.deserialize<{ key: string; value?: string }>(
        JSON.parse(init?.body ? String(init.body) : parsed.searchParams.get('input')!),
      )
      if (parsed.pathname === '/settings.get') return response(settings.get(payload.key) ?? null)
      expect(parsed.pathname).toBe('/settings.update')
      if (failSave) return new Response(null, { status: 500 })
      settings.set(payload.key, payload.value!)
      return response(undefined)
    }),
  )
})

afterEach(async () => {
  await close()
  container.remove()
  vi.unstubAllGlobals()
})

it('restores desktop preferences with fresh browser storage after a port change', async () => {
  await render()
  expect(value('compact')).toBe('false')
  expect(value('dismissed')).toBe('false')
  await toggleBoth()
  expect(settings).toEqual(
    new Map([
      ['sidebar_compact', 'true'],
      ['statements_banner_dismissed', 'true'],
    ]),
  )
  await close()
  localStorage.clear()
  await render()
  expect(value('compact')).toBe('true')
  expect(value('dismissed')).toBe('true')
})

it('imports available legacy preferences once and does not overwrite a saved false', async () => {
  localStorage.setItem('hoseki:sidebar-compact', 'true')
  localStorage.setItem('ui::settings::local', JSON.stringify({ isStatementsMadeEasyDismissed: true }))
  await render()
  expect(settings).toEqual(
    new Map([
      ['sidebar_compact', 'true'],
      ['statements_banner_dismissed', 'true'],
    ]),
  )
  await toggleBoth()
  await close()
  await render()
  expect(value('compact')).toBe('false')
  expect(value('dismissed')).toBe('false')
})

it('preserves browser-local preferences and makes no settings requests in StartOS mode', async () => {
  mode.isDesktop = false
  await render()
  await toggleBoth()
  expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('true')
  expect(JSON.parse(localStorage.getItem('ui::settings::local')!)).toEqual({ isStatementsMadeEasyDismissed: true })
  expect(fetch).not.toHaveBeenCalled()
  expect(settings.size).toBe(0)
  await close()
  await render()
  expect(value('compact')).toBe('true')
  expect(value('dismissed')).toBe('true')
})

it('reports a failed write without claiming the preference was saved, and allows retry', async () => {
  failSave = true
  await render()
  await toggleBoth()
  expect(value('compact')).toBe('false')
  expect(value('dismissed')).toBe('false')
  expect(settings.size).toBe(0)
  expect(errorToast).toHaveBeenCalledWith('Could not save setting. Try again.')
  failSave = false
  await toggleBoth()
  expect(value('compact')).toBe('true')
  expect(value('dismissed')).toBe('true')
})

it('does not repeatedly retry failed legacy migration', async () => {
  failSave = true
  localStorage.setItem('hoseki:sidebar-compact', 'true')
  await render()
  await settled()
  expect(errorToast).toHaveBeenCalledOnce()
  expect(value('compact')).toBe('true')
  expect(settings.size).toBe(0)
})

it('does not migrate legacy values over a choice made before the first read finishes', async () => {
  localStorage.setItem('hoseki:sidebar-compact', 'true')
  localStorage.setItem('ui::settings::local', JSON.stringify({ isStatementsMadeEasyDismissed: true }))
  let releaseReads!: () => void
  let releaseWrites!: () => void
  const reads = new Promise<void>((resolve) => {
    releaseReads = resolve
  })
  const writes = new Promise<void>((resolve) => {
    releaseWrites = resolve
  })
  const originalFetch = fetch
  const submitted: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submitted.push(superjson.deserialize<{ value: string }>(JSON.parse(String(init.body))).value)
        await writes
      } else await reads
      return originalFetch(url, init)
    }),
  )
  await render(false)
  await act(async () => {
    container.querySelector<HTMLButtonElement>('#compact')!.click()
    container.querySelector<HTMLButtonElement>('#dismissed')!.click()
  })
  releaseReads()
  try {
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(client.isFetching()).toBe(0)
    })
    expect(submitted).toEqual(['false', 'false'])
  } finally {
    releaseWrites()
    await settled()
  }
  expect(settings).toEqual(
    new Map([
      ['sidebar_compact', 'false'],
      ['statements_banner_dismissed', 'false'],
    ]),
  )
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(value('compact')).toBe('false')
    expect(value('dismissed')).toBe('false')
  })
})

it('ignores malformed legacy storage', async () => {
  localStorage.setItem('ui::settings::local', 'not json')
  await render()
  expect(value('dismissed')).toBe('false')
})
