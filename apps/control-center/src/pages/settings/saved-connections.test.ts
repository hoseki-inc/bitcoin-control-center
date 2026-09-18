// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import superjson from 'superjson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouterOutput } from '../../trpc'
import { queryClient as applicationQueryClient } from '../../trpc/base'
import { SettingsPage } from './index'

type Snapshot = RouterOutput['settings']['connectionProfiles']['list']
type Profile = Snapshot['profiles'][number]
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))
vi.mock('../../mode', () => ({ isDesktop: true }))

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let snapshot: Snapshot
let finishSave: (result: { ok: boolean; message?: string }) => void
let saveResponse: Promise<{ ok: boolean; message?: string }>
let requests: Array<{ path: string; input: Record<string, unknown> | null }>

function response(data: unknown): Response {
  return new Response(JSON.stringify({ result: { data: superjson.serialize(data) } }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
function failure(message: string): Response {
  return new Response(
    JSON.stringify({
      error: superjson.serialize({ message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } }),
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}
function button(label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(result).toBeDefined()
  return result!
}
function input(id: string): HTMLInputElement {
  return container.querySelector(`#${id}`)!
}
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage)),
      ),
    )
  })
  await vi.waitFor(async () => {
    await flush()
    expect(input('connection-host')?.value).toBe('server-a.example')
  })
}
async function change(id: string, value: string): Promise<void> {
  await act(async () => {
    const element = container.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function click(label: string): Promise<void> {
  await act(async () => button(label).click())
}
async function savedToast(): Promise<void> {
  await vi.waitFor(async () => {
    await flush()
    expect(toasts.success).toHaveBeenCalled()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const first: Profile = {
    id: '00000000-0000-4000-8000-000000000001',
    nickname: 'Home LAN',
    host: 'server-a.example',
    port: 50002,
    protocol: 'ssl',
    torEnabled: false,
    revision: 1,
  }
  const second: Profile = {
    ...first,
    id: '00000000-0000-4000-8000-000000000002',
    nickname: 'Away',
    host: 'server-b.example',
  }
  snapshot = {
    profiles: [first, second],
    activeId: first.id,
    status: {
      connected: true,
      host: first.host,
      port: first.port,
      protocol: first.protocol,
      tor: { state: 'unavailable' },
    },
  }
  requests = []
  toasts.success.mockClear()
  toasts.error.mockClear()
  saveResponse = new Promise((resolve) => {
    finishSave = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url, 'http://localhost:3400')
      const path = parsed.pathname.split('/').at(-1)!
      const body = init?.body
        ? JSON.parse(String(init.body))
        : parsed.searchParams.has('input')
          ? JSON.parse(parsed.searchParams.get('input')!)
          : null
      const payload = body ? superjson.deserialize<Record<string, unknown>>(body) : null
      requests.push({ path, input: payload })
      if (path === 'settings.get') return response(null)
      if (path === 'settings.connectionProfiles.list') return response(snapshot)
      if (path === 'settings.testElectrum') return response({ success: true, version: ['Electrum', '1.4'] })
      if (path === 'settings.connectionProfiles.create') {
        const created = {
          ...payload,
          id: `00000000-0000-4000-8000-${String(snapshot.profiles.length + 1).padStart(12, '0')}`,
          revision: 1,
        } as Profile
        snapshot.profiles.push(created)
        return response(created)
      }
      if (path === 'settings.connectionProfiles.rename') {
        const found = snapshot.profiles.find((item) => item.id === payload!['id'])!
        found.nickname = String(payload!['nickname'])
        found.revision++
        return response(found)
      }
      if (path === 'settings.connectionProfiles.connect') {
        const outcome = await saveResponse
        if (!outcome.ok) return failure(outcome.message ?? 'Server unavailable')
        const found = snapshot.profiles.find((item) => item.id === payload!['id'])!
        Object.assign(found, payload!['connection'])
        found.revision++
        snapshot.activeId = found.id
        snapshot.status = { ...snapshot.status, ...found, connected: true }
        return response(found)
      }
      throw new Error(`Unexpected request: ${path}`)
    }),
  )
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { ...applicationQueryClient.getDefaultOptions().queries, retry: false },
      mutations: { ...applicationQueryClient.getDefaultOptions().mutations, retry: false },
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  queryClient.clear()
  onlineManager.setOnline(true)
  container.remove()
  vi.unstubAllGlobals()
})

describe('desktop saved connections', () => {
  it('loads local profiles while offline and offers a retry for the unchanged active connection', async () => {
    onlineManager.setOnline(false)
    snapshot.status.connected = false
    await render()
    expect(input('connection-host').disabled).toBe(false)
    expect(button('Reconnect').disabled).toBe(false)
    expect(container.textContent).toContain('Your saved data is still on this device')
  })
  it('uses one connection form for both selectors, and selection never opens a connection', async () => {
    await render()
    expect(container.querySelectorAll('#connection-host')).toHaveLength(1)
    await change('saved-connection', snapshot.profiles[1]!.id)
    expect(input('connection-host').value).toBe('server-b.example')
    expect(container.textContent).toContain('Connected · Home LAN')
    expect(button('Connect').disabled).toBe(false)
    expect(requests.some(({ path }) => path.endsWith('.connect'))).toBe(false)
    const home = container.querySelector('aside button[aria-pressed="false"]') as HTMLButtonElement
    await act(async () => home.click())
    expect(input('connection-host').value).toBe('server-a.example')
    expect((container.querySelector('#saved-connection') as HTMLSelectElement).value).toBe(snapshot.activeId)
  })
  it('keeps edits and the active connection intact when switching fails', async () => {
    await render()
    await change('connection-host', 'attempted.example')
    await click('Save & Reconnect')
    expect(input('connection-host').disabled).toBe(true)
    expect(button('Test Connection').disabled).toBe(true)
    await act(async () => finishSave({ ok: false, message: 'Server unavailable' }))
    await vi.waitFor(async () => {
      await flush()
      expect(toasts.error).toHaveBeenCalled()
    })
    expect(input('connection-host').value).toBe('attempted.example')
    expect(snapshot.status.host).toBe('server-a.example')
    expect(button('Save & Reconnect').disabled).toBe(false)
    expect(requests.some(({ path }) => path === 'settings.update')).toBe(false)
  })
  it('updates the active connection only after a successful switch', async () => {
    await render()
    await change('saved-connection', snapshot.profiles[1]!.id)
    await click('Connect')
    expect(container.textContent).toContain('Connected · Home LAN')
    expect(toasts.success).not.toHaveBeenCalled()
    await act(async () => finishSave({ ok: true }))
    await savedToast()
    expect(container.textContent).toContain('Connected · Away')
    expect(input('connection-host').value).toBe('server-b.example')
    expect(button('Reconnect').disabled).toBe(true)
  })
  it('keeps public shortcuts in creation only, and saves a new nickname without connecting', async () => {
    await render()
    expect(container.textContent).not.toContain('Server Preset')
    expect(container.querySelector('#connection-starter')).toBeNull()
    await click('+ New connection')
    await change('connection-nickname', 'Travel')
    await change('connection-starter', 'electrum.blockstream.info')
    expect(input('connection-host').value).toBe('electrum.blockstream.info')
    await change('connection-starter', 'custom')
    expect(input('connection-host').value).toBe('')
    await change('connection-host', 'travel.example')
    await click('Save connection')
    await savedToast()
    expect(snapshot.profiles).toHaveLength(3)
    expect(snapshot.profiles[2]!.nickname).toBe('Travel')
    expect(snapshot.status.host).toBe('server-a.example')
    expect(container.querySelector('#connection-starter')).toBeNull()
    expect(requests.some(({ path }) => path.endsWith('.connect') || path.endsWith('.testElectrum'))).toBe(false)
  })
  it('renames another profile with one action and updates both selectors without connecting', async () => {
    await render()
    await act(async () => (container.querySelector('button[aria-label="Rename Away"]') as HTMLButtonElement).click())
    expect(input('connection-nickname').value).toBe('Away')
    await change('connection-nickname', 'Remote Tor')
    await click('Save name')
    await savedToast()
    expect(snapshot.profiles[1]!.nickname).toBe('Remote Tor')
    expect(container.querySelector('#saved-connection')!.textContent).toContain('Remote Tor')
    expect(container.querySelector('aside')!.textContent).toContain('Remote Tor')
    expect(snapshot.status.host).toBe('server-a.example')
    expect(requests.some(({ path }) => path.endsWith('.connect'))).toBe(false)
  })
  it('prevents a sixth connection in both layouts', async () => {
    while (snapshot.profiles.length < 5)
      snapshot.profiles.push({ ...snapshot.profiles[0]!, id: `extra-${snapshot.profiles.length}` })
    await render()
    const addButtons = [...container.querySelectorAll('button')].filter(
      (item) => item.textContent === '+ New connection',
    )
    expect(addButtons).toHaveLength(2)
    expect(addButtons.every((item) => item.disabled)).toBe(true)
    expect(container.textContent).toContain('Maximum reached')
  })
  it('preserves unsaved connection edits when renaming the selected profile', async () => {
    await render()
    await change('connection-host', 'unsaved.example')
    await act(async () =>
      (container.querySelector('button[aria-label="Rename Home LAN"]') as HTMLButtonElement).click(),
    )
    await change('connection-nickname', 'My node')
    await click('Save name')
    await savedToast()
    expect(input('connection-host').value).toBe('unsaved.example')
    expect(snapshot.profiles[0]!.nickname).toBe('My node')
    expect(snapshot.profiles[0]!.host).toBe('server-a.example')
    expect(button('Save & Reconnect').disabled).toBe(false)
    expect(requests.some(({ path }) => path.endsWith('.connect'))).toBe(false)
  })
  it('protects local edits when another window changes the selected profile', async () => {
    await render()
    await change('connection-host', 'unsaved.example')
    snapshot.profiles[0] = { ...snapshot.profiles[0]!, host: 'changed-elsewhere.example', revision: 2 }
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['connection-profiles'] })
    })
    await vi.waitFor(async () => {
      await flush()
      expect(container.textContent).toContain('This connection changed in another window')
    })
    expect(input('connection-host').value).toBe('unsaved.example')
    await click('Reload connection')
    await click('Keep editing')
    expect(input('connection-host').value).toBe('unsaved.example')
    await click('Reload connection')
    await click('Discard changes')
    expect(input('connection-host').value).toBe('changed-elsewhere.example')
    expect(container.textContent).not.toContain('This connection changed in another window')
    expect(requests.some(({ path }) => path.endsWith('.connect'))).toBe(false)
  })
  it('requires an explicit discard before replacing an edited form', async () => {
    await render()
    await change('connection-host', 'unsaved.example')
    await change('saved-connection', snapshot.profiles[1]!.id)
    expect(input('connection-host').value).toBe('unsaved.example')
    await click('Keep editing')
    expect(input('connection-host').value).toBe('unsaved.example')
    await change('saved-connection', snapshot.profiles[1]!.id)
    await click('Discard changes')
    expect(input('connection-host').value).toBe('server-b.example')
  })
  it('tests the draft without saving or activating it', async () => {
    await render()
    await change('connection-host', 'test.example')
    await click('Test Connection')
    await vi.waitFor(async () => {
      await flush()
      expect(container.textContent).toContain('Connection successful')
    })
    expect(snapshot.status.host).toBe('server-a.example')
    expect(snapshot.profiles[0]!.host).toBe('server-a.example')
    expect(requests.find(({ path }) => path === 'settings.testElectrum')!.input!['host']).toBe('test.example')
  })
})
