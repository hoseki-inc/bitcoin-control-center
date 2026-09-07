// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import superjson from 'superjson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient as applicationQueryClient } from '../../trpc/base'
import { SettingsPage } from './index'

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))
vi.mock('../../mode', () => ({ isDesktop: true }))

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let saved: Record<string, string | null>
let connected: boolean
let finishSave: (response: Response) => void
let saveResponse: Promise<Response>
let requests: Array<{ path: string; input: unknown }>

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
  expect(found).toBeDefined()
  return found!
}

function hostInput(): HTMLInputElement {
  return container.querySelector('input[placeholder="electrum.blockstream.info"]')!
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(hostInput().value).toBe('server-a.example')
  })
}

async function changeHost(): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hostInput(), 'server-b.example')
    hostInput().dispatchEvent(new Event('input', { bubbles: true }))
    hostInput().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function waitForToast(kind: 'success' | 'error'): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(toasts[kind]).toHaveBeenCalled()
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
  saved = {
    electrum_host: 'server-a.example',
    electrum_port: '50002',
    electrum_protocol: 'ssl',
    tor_enabled: 'false',
    user_name: null,
  }
  connected = true
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
      const input = init?.body
        ? superjson.deserialize<{ host: string; port: number; protocol: string; torEnabled?: boolean }>(
            JSON.parse(String(init.body)),
          )
        : null
      requests.push({ path, input })
      if (path === 'settings.get') {
        const { key } = superjson.deserialize<{ key: string }>(JSON.parse(parsed.searchParams.get('input')!))
        return response({ result: { data: superjson.serialize(saved[key] ?? null) } })
      }
      if (path === 'settings.electrumStatus')
        return response({
          result: {
            data: {
              json: {
                connected,
                host: saved['electrum_host'],
                port: Number(saved['electrum_port']),
                protocol: saved['electrum_protocol'],
              },
            },
          },
        })
      if (path === 'settings.reconnectElectrum') {
        const result = await saveResponse
        if (result.ok && input) {
          saved = {
            ...saved,
            electrum_host: input.host,
            electrum_port: String(input.port),
            electrum_protocol: input.protocol,
            tor_enabled: String(Boolean(input.torEnabled)),
          }
          connected = true
        }
        return result
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

describe('desktop connection settings', () => {
  it('loads local settings even when the computer reports no internet connection', async () => {
    onlineManager.setOnline(false)
    connected = false
    await render()
    expect(hostInput().disabled).toBe(false)
    expect(button('Save & Reconnect').disabled).toBe(false)
  })

  it('keeps the attempted settings editable after failure and never sends separate setting writes', async () => {
    await render()
    await changeHost()
    await act(async () => button('Save & Reconnect').click())
    await act(async () => finishSave(response({ error: { json: { message: 'Server unavailable' } } }, 500)))
    await waitForToast('error')
    expect(saved['electrum_host']).toBe('server-a.example')
    expect(hostInput().value).toBe('server-b.example')
    expect(button('Save & Reconnect').disabled).toBe(false)
    expect(toasts.success).not.toHaveBeenCalled()
    expect(requests.filter(({ path }) => path === 'settings.update')).toEqual([])
    expect(requests.filter(({ path }) => path === 'settings.reconnectElectrum')).toHaveLength(1)
  })

  it('disables conflicting edits while saving and refreshes the saved form only after success', async () => {
    await render()
    await changeHost()
    await act(async () => button('Save & Reconnect').click())
    expect(hostInput().disabled).toBe(true)
    expect(button('Test Connection').disabled).toBe(true)
    expect(toasts.success).not.toHaveBeenCalled()
    await act(async () => finishSave(response({ result: { data: null } })))
    await waitForToast('success')
    expect(saved['electrum_host']).toBe('server-b.example')
    expect(hostInput().value).toBe('server-b.example')
    expect(hostInput().disabled).toBe(false)
    expect(button('Save & Reconnect').disabled).toBe(true)
    expect(requests.filter(({ path }) => path === 'settings.update')).toEqual([])
  })

  it('offers retry without forcing users to edit an unchanged disconnected server', async () => {
    connected = false
    await render()
    expect(container.textContent).toContain('Your saved data is still on this device')
    expect(button('Save & Reconnect').disabled).toBe(false)
    await act(async () => button('Save & Reconnect').click())
    await act(async () => finishSave(response({ result: { data: null } })))
    await waitForToast('success')
    expect(saved['electrum_host']).toBe('server-a.example')
  })
})
