import { ChakraProvider } from '@chakra-ui/react'
// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import superjson from 'superjson'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { queryClient as applicationQueryClient } from '../../trpc/base'
import { SettingsPage } from './index'

const browser = await vi.hoisted(async () => {
  vi.stubEnv('VITE_PLATFORM', 'desktop')
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
const connectionSchema = z.object({
  host: z.string(),
  port: z.number(),
  protocol: z.string(),
  torEnabled: z.boolean().optional(),
})
let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let saved: Map<string, string | null>
let connected: boolean
let finishSave: (response: Response) => void
let saveResponse: Promise<Response>
let requests: Array<{ path: string; input: z.infer<typeof connectionSchema> | null }>

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

function hostInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="electrum.blockstream.info"]')
  if (!input) {
    throw new Error('Missing host input')
  }
  return input
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage, { desktop: true })),
      ),
    )
  })
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(hostInput().value).toBe('server-a.example')
  })
}

async function changeHost(): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (!descriptor?.set) {
      throw new Error('Missing input setter')
    }
    descriptor.set.call(hostInput(), 'server-b.example')
    hostInput().dispatchEvent(new Event('input', { bubbles: true }))
    hostInput().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function waitForToast(kind: 'success' | 'error'): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(toast[kind]).toHaveBeenCalled()
  })
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    onlineManager.setOnline(true)
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    dom.window.close()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  saved = new Map([
    ['electrum_host', 'server-a.example'],
    ['electrum_port', '50002'],
    ['electrum_protocol', 'ssl'],
    ['tor_enabled', 'false'],
    ['user_name', null],
  ])
  connected = true
  requests = []
  vi.spyOn(toast, 'success').mockReturnValue('test-toast')
  vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  saveResponse = new Promise((resolve) => {
    finishSave = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      const parsed = new URL(parseUnknown(z.string(), url).expect('request URL'), 'http://localhost:3400')
      const path = parsed.pathname.split('/').at(-1) ?? ''
      const body = parseUnknown(z.string(), init?.body).unwrapOr(null)
      // SAFETY: Serialized request text is validated as a connection payload below.
      const input =
        body === null
          ? null
          : parseUnknown(z.object({ json: connectionSchema }), JSON.parse(body) as unknown).expect('connection payload')
              .json
      requests.push({ path, input })
      if (path === 'settings.get') {
        // SAFETY: The query envelope is validated before its setting key is used.
        const { key } = parseUnknown(
          z.object({ json: z.object({ key: z.string() }) }),
          JSON.parse(parsed.searchParams.get('input') ?? '') as unknown,
        ).expect('setting query').json
        return Response.json({ result: { data: superjson.serialize(saved.get(key) ?? null) } })
      }
      if (path === 'settings.electrumStatus') {
        return Response.json({
          result: {
            data: {
              json: {
                connected,
                host: saved.get('electrum_host'),
                port: Number(saved.get('electrum_port')),
                protocol: saved.get('electrum_protocol'),
              },
            },
          },
        })
      }
      if (path === 'settings.reconnectElectrum') {
        const result = await saveResponse
        if (result.ok && input) {
          saved.set('electrum_host', input.host)
          saved.set('electrum_port', String(input.port))
          saved.set('electrum_protocol', input.protocol)
          saved.set('tor_enabled', String(Boolean(input.torEnabled)))
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
  await run()
}

describe('desktop connection settings', () => {
  it('loads local settings even when the computer reports no internet connection', async () => {
    await withTestSetup(async () => {
      onlineManager.setOnline(false)
      connected = false
      await render()
      expect(hostInput().disabled).toBe(false)
      expect(button('Save & Reconnect').disabled).toBe(false)
    })
  })

  it('keeps the attempted settings editable after failure and never sends separate setting writes', async () => {
    await withTestSetup(async () => {
      await render()
      await changeHost()
      await act(async () => {
        button('Save & Reconnect').click()
      })
      await act(async () => {
        finishSave(Response.json({ error: { json: { message: 'Server unavailable' } } }, { status: 500 }))
      })
      await waitForToast('error')
      expect(saved.get('electrum_host')).toBe('server-a.example')
      expect(hostInput().value).toBe('server-b.example')
      expect(button('Save & Reconnect').disabled).toBe(false)
      expect(toast.success).not.toHaveBeenCalled()
      expect(requests.filter(({ path }) => path === 'settings.update')).toEqual([])
      expect(requests.filter(({ path }) => path === 'settings.reconnectElectrum')).toHaveLength(1)
    })
  })

  it('disables conflicting edits while saving and refreshes the saved form only after success', async () => {
    await withTestSetup(async () => {
      await render()
      await changeHost()
      await act(async () => {
        button('Save & Reconnect').click()
      })
      expect(hostInput().disabled).toBe(true)
      expect(button('Test Connection').disabled).toBe(true)
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(saved.get('electrum_host')).toBe('server-b.example')
      expect(hostInput().value).toBe('server-b.example')
      expect(hostInput().disabled).toBe(false)
      expect(button('Save & Reconnect').disabled).toBe(true)
      expect(requests.filter(({ path }) => path === 'settings.update')).toEqual([])
    })
  })

  it('offers retry without forcing users to edit an unchanged disconnected server', async () => {
    await withTestSetup(async () => {
      connected = false
      await render()
      expect(container.textContent).toContain('Your saved data is still on this device')
      expect(button('Save & Reconnect').disabled).toBe(false)
      await act(async () => {
        button('Save & Reconnect').click()
      })
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(saved.get('electrum_host')).toBe('server-a.example')
    })
  })
})
