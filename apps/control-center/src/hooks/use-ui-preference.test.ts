// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import superjson from 'superjson'
import { type MockInstance, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { useUiPreference } from './use-ui-preference'
import { useUiSettings } from './use-ui-settings'

const SettingRequestSchema = z.object({ json: z.object({ key: z.string(), value: z.string().optional() }) })

let root: Root
let container: HTMLDivElement
let client: QueryClient
let desktop: boolean
let settings: Map<string, string>
let failSave: boolean
let submitted: string[]
// Hold reads or writes open to reproduce a slow first read.
let readGate: Promise<void> | null
let writeGate: Promise<void> | null
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
let errorToast: MockInstance<typeof toast.error>

function Preferences(): React.ReactElement {
  const [compact, saveCompact] = useUiPreference('sidebar_compact', desktop)
  const { isStatementsMadeEasyDismissed: dismissed, updateUiSettings } = useUiSettings(desktop)
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        id: 'compact',
        'data-value': String(compact),
        onClick: () => {
          saveCompact(!compact)
        },
      },
      'Toggle sidebar',
    ),
    createElement(
      'button',
      {
        id: 'dismissed',
        'data-value': String(dismissed),
        onClick: () => {
          updateUiSettings({ isStatementsMadeEasyDismissed: !dismissed })
        },
      },
      'Toggle banner',
    ),
  )
}

function settingResponse(data: string | null | undefined): Response {
  return Response.json({ result: { data: superjson.serialize(data) } })
}

function button(id: 'compact' | 'dismissed'): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`#${id}`)
  assert.ok(found, `Missing button: ${id}`)
  return found
}

function shown(id: 'compact' | 'dismissed'): string | undefined {
  return button(id).dataset['value']
}

async function settled(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(client.isFetching() + client.isMutating()).toBe(0)
  })
}

async function render(wait = true): Promise<void> {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Preferences)))
  })
  if (wait) {
    await settled()
  }
}

async function toggleBoth(): Promise<void> {
  await act(async () => {
    button('compact').click()
    button('dismissed').click()
  })
  await settled()
}

async function close(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  client.clear()
}

function setup(inDesktop = true): void {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  desktop = inDesktop
  settings = new Map()
  failSave = false
  submitted = []
  readGate = null
  writeGate = null
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  errorToast = vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(parseUnknown(z.string(), url).expect('request URL'), 'http://localhost:3400')
    const body = parseUnknown(z.string(), init?.body).unwrapOr(null)
    const raw: unknown = JSON.parse(body ?? parsed.searchParams.get('input') ?? 'null')
    const request = parseUnknown(SettingRequestSchema, raw).expect('setting request').json
    const path = parsed.pathname.split('/').at(-1)
    if (path === 'settings.get') {
      await readGate
      return settingResponse(settings.get(request.key) ?? null)
    }
    if (path !== 'settings.update' || request.value === undefined) {
      throw new Error(`Unexpected request: ${path ?? ''}`)
    }
    submitted.push(request.value)
    await writeGate
    if (failSave) {
      return new Response(null, { status: 500 })
    }
    settings.set(request.key, request.value)
    return settingResponse(undefined)
  })
  vi.stubGlobal('fetch', fetchMock)
  onTestFinished(async () => {
    await close()
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
}

it('restores desktop preferences with fresh browser storage after a port change', async () => {
  setup()
  await render()
  expect(shown('compact')).toBe('false')
  expect(shown('dismissed')).toBe('false')
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
  expect(shown('compact')).toBe('true')
  expect(shown('dismissed')).toBe('true')
})

it('imports available legacy preferences once and does not overwrite a saved false', async () => {
  setup()
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
  expect(shown('compact')).toBe('false')
  expect(shown('dismissed')).toBe('false')
})

it('preserves browser-local preferences and makes no settings requests in StartOS mode', async () => {
  setup(false)
  await render()
  await toggleBoth()
  expect(localStorage.getItem('hoseki:sidebar-compact')).toBe('true')
  expect(localStorage.getItem('ui::settings::local')).toBe(JSON.stringify({ isStatementsMadeEasyDismissed: true }))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(settings.size).toBe(0)
  await close()
  await render()
  expect(shown('compact')).toBe('true')
  expect(shown('dismissed')).toBe('true')
})

it('reports a failed write without claiming the preference was saved, and allows retry', async () => {
  setup()
  failSave = true
  await render()
  await toggleBoth()
  expect(shown('compact')).toBe('false')
  expect(shown('dismissed')).toBe('false')
  expect(settings.size).toBe(0)
  expect(errorToast).toHaveBeenCalledWith('Could not save setting. Try again.')
  failSave = false
  await toggleBoth()
  expect(shown('compact')).toBe('true')
  expect(shown('dismissed')).toBe('true')
})

it('does not repeatedly retry failed legacy migration', async () => {
  setup()
  failSave = true
  localStorage.setItem('hoseki:sidebar-compact', 'true')
  await render()
  await settled()
  expect(errorToast).toHaveBeenCalledOnce()
  expect(shown('compact')).toBe('true')
  expect(settings.size).toBe(0)
})

it('does not migrate legacy values over a choice made before the first read finishes', async () => {
  setup()
  localStorage.setItem('hoseki:sidebar-compact', 'true')
  localStorage.setItem('ui::settings::local', JSON.stringify({ isStatementsMadeEasyDismissed: true }))
  let releaseReads: (() => void) | undefined
  let releaseWrites: (() => void) | undefined
  readGate = new Promise<void>((resolve) => {
    releaseReads = resolve
  })
  writeGate = new Promise<void>((resolve) => {
    releaseWrites = resolve
  })
  await render(false)
  // Choose before the first read returns; do not wait, since writes are held open.
  await act(async () => {
    button('compact').click()
    button('dismissed').click()
  })
  releaseReads?.()
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(client.isFetching()).toBe(0)
  })
  expect(submitted).toEqual(['false', 'false'])
  releaseWrites?.()
  await settled()
  expect(settings).toEqual(
    new Map([
      ['sidebar_compact', 'false'],
      ['statements_banner_dismissed', 'false'],
    ]),
  )
  expect(shown('compact')).toBe('false')
  expect(shown('dismissed')).toBe('false')
})

it('ignores malformed legacy storage', async () => {
  setup()
  localStorage.setItem('ui::settings::local', 'not json')
  await render()
  expect(shown('dismissed')).toBe('false')
})
