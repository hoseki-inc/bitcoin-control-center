import assert from 'node:assert/strict'
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
interface TorStatusFixture {
  state: string
  message?: string
  progress?: number
  attempt?: number
}
let torStatus: TorStatusFixture
let torAttempts: number
// Simulates Tor failing before settings can observe "starting", such as a missing binary.
let torFailsInstantly: string | null

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

function torSwitch(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('#electrum-tor')
  if (!input) {
    throw new Error('Missing Tor switch')
  }
  return input
}

// Chakra renders dialogs in a portal outside the settings container.
function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
    (item) => item.textContent === label,
  )
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.click()
  })
}

function useStepTimers(): (milliseconds: number) => Promise<void> {
  // Jump over the status refresh and notice timers instead of waiting for them.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  return async (milliseconds) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds)
    })
  }
}

async function turnTorOn(): Promise<void> {
  await act(async () => {
    torSwitch().click()
  })
}

async function waitForText(text: string): Promise<void> {
  // Status refreshes every second while Tor starts.
  await vi.waitFor(
    async () => {
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50)
        })
      })
      expect(container.textContent).toContain(text)
    },
    { timeout: 4000 },
  )
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
  torStatus = { state: 'stopped' }
  torAttempts = 0
  torFailsInstantly = null
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
                tor: torStatus,
              },
            },
          },
        })
      }
      if (path === 'settings.priceSource') {
        return Response.json({ result: { data: { json: null } } })
      }
      if (path === 'settings.startTor') {
        torAttempts += 1
        const started = { state: 'starting', progress: 0, attempt: torAttempts }
        torStatus =
          torFailsInstantly === null ? started : { state: 'failed', message: torFailsInstantly, attempt: torAttempts }
        return Response.json({ result: { data: { json: started } } })
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

  it('starts Tor when the switch is turned on and blocks testing until Tor is ready', async () => {
    await withTestSetup(async () => {
      // Jump over the status refresh and the notice timers instead of waiting for them.
      vi.useFakeTimers({ shouldAdvanceTime: true })
      onTestFinished(() => {
        vi.useRealTimers()
      })
      const advance = async (milliseconds: number): Promise<void> => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(milliseconds)
        })
      }
      await render()
      await turnTorOn()
      expect(requests.filter(({ path }) => path === 'settings.startTor')).toHaveLength(1)
      torStatus = { state: 'starting', progress: 45 }
      await advance(1000)
      expect(container.textContent).toContain('Starting Tor… 45%')
      expect(torSwitch().checked).toBe(true)
      expect(button('Test Connection').disabled).toBe(true)
      expect(button('Save & Reconnect').disabled).toBe(true)
      torStatus = { state: 'ready' }
      await advance(1000)
      expect(container.textContent).toContain('Tor ready')
      expect(container.textContent).not.toContain('Starting Tor')
      expect(button('Test Connection').disabled).toBe(false)
      expect(button('Save & Reconnect').disabled).toBe(false)
      // The notice fades away on its own; the solid switch keeps showing Tor is on.
      // Visible period, then the fade; React schedules the fade after re-rendering.
      await advance(3100)
      await advance(700)
      expect(container.textContent).not.toContain('Tor ready')
      expect(torSwitch().checked).toBe(true)
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  it('turns the switch off after a failed Tor start and asks before connecting without Tor', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      await render()
      await turnTorOn()
      torStatus = { state: 'failed', message: 'Tor could not connect within two minutes.', attempt: 1 }
      await advance(1000)
      expect(container.textContent).toContain('Tor could not connect within two minutes.')
      expect(torSwitch().checked).toBe(false)
      // Retrying with Save or Test must not quietly connect directly.
      await click(button('Save & Reconnect'))
      expect(document.body.textContent).toContain('The server will see your IP address and the addresses you look up.')
      const cancel = dialogButton('Cancel')
      assert.ok(cancel, 'Expected the confirmation dialog')
      await click(cancel)
      await click(button('Test Connection'))
      expect(document.body.textContent).toContain('The server will see your IP address.')
      const cancelTest = dialogButton('Cancel')
      assert.ok(cancelTest, 'Expected the confirmation dialog')
      await click(cancelTest)
      expect(
        requests.filter(({ path }) => path === 'settings.reconnectElectrum' || path === 'settings.testElectrum'),
      ).toEqual([])
      expect(saved.get('tor_enabled')).toBe('false')
      await turnTorOn()
      expect(container.textContent).not.toContain('Tor could not connect')
      expect(requests.filter(({ path }) => path === 'settings.startTor')).toHaveLength(2)
    })
  })

  it('switches a saved Tor connection to direct only after confirmation', async () => {
    await withTestSetup(async () => {
      saved.set('tor_enabled', 'true')
      torStatus = { state: 'ready' }
      await render()
      await vi.waitFor(() => {
        expect(torSwitch().checked).toBe(true)
      })
      await click(torSwitch())
      await click(button('Save & Reconnect'))
      expect(requests.filter(({ path }) => path === 'settings.reconnectElectrum')).toEqual([])
      const confirm = dialogButton('Connect without Tor')
      assert.ok(confirm, 'Expected the confirmation dialog')
      await click(confirm)
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(
        requests.filter(({ path }) => path === 'settings.reconnectElectrum').map(({ input }) => input?.torEnabled),
      ).toEqual([false])
      expect(saved.get('tor_enabled')).toBe('false')
    })
  })

  it('does not announce Tor when it was already running before settings opened', async () => {
    await withTestSetup(async () => {
      saved.set('tor_enabled', 'true')
      torStatus = { state: 'ready' }
      await render()
      await vi.waitFor(() => {
        expect(torSwitch().checked).toBe(true)
      })
      expect(toast.success).not.toHaveBeenCalled()
      expect(container.textContent).not.toContain('Tor ready')
    })
  })

  it('turns a saved Tor connection off in the form when Tor has failed, keeping the saved setting', async () => {
    await withTestSetup(async () => {
      saved.set('tor_enabled', 'true')
      torStatus = { state: 'failed', message: 'Tor stopped unexpectedly.' }
      connected = false
      await render()
      await waitForText('Tor stopped unexpectedly.')
      expect(torSwitch().checked).toBe(false)
      expect(saved.get('tor_enabled')).toBe('true')
      expect(container.textContent).toContain('Turn Tor on to try again, or choose a different server below.')
      expect(container.textContent).not.toContain('then use Save & Reconnect')
      expect(requests.filter(({ path }) => path === 'settings.reconnectElectrum')).toEqual([])
    })
  })

  it('shows a failure even when a retried Tor start fails before settings sees it starting', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      await render()
      torFailsInstantly = 'Bundled Tor is missing. Reinstall the desktop app to use Tor.'
      await turnTorOn()
      await advance(0)
      expect(torSwitch().checked).toBe(false)
      expect(container.textContent).toContain('Bundled Tor is missing.')
      // A second fast failure after retrying must show again, not stay hidden.
      torFailsInstantly = 'Tor could not start. Turn Tor on to try again.'
      await turnTorOn()
      await advance(0)
      expect(torSwitch().checked).toBe(false)
      expect(container.textContent).toContain('Tor could not start. Turn Tor on to try again.')
      expect(torAttempts).toBe(2)
    })
  })

  it('turns the switch back on when a saved Tor connection recovers by itself', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      saved.set('tor_enabled', 'true')
      torStatus = { state: 'failed', message: 'Tor stopped unexpectedly.', attempt: 1 }
      await render()
      await advance(0)
      expect(torSwitch().checked).toBe(false)
      expect(container.textContent).toContain('Tor stopped unexpectedly.')
      // A data request restarted Tor for the saved connection.
      torStatus = { state: 'ready', attempt: 2 }
      await advance(10_000)
      expect(torSwitch().checked).toBe(true)
      expect(container.textContent).not.toContain('Tor stopped unexpectedly.')
      expect(requests.filter(({ path }) => path === 'settings.startTor')).toEqual([])
    })
  })

  it('reassures during a slow Tor start begun by a saved connection', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      saved.set('tor_enabled', 'true')
      torStatus = { state: 'starting', progress: 50, attempt: 1 }
      await render()
      await advance(0)
      expect(container.textContent).toContain('Starting Tor… 50%')
      expect(container.textContent).not.toContain('This can take up to two minutes.')
      await advance(31_000)
      expect(container.textContent).toContain('This can take up to two minutes.')
    })
  })

  it('clears the Tor failure once a direct connection is deliberately saved', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      await render()
      torFailsInstantly = 'Tor could not start. Turn Tor on to try again.'
      await turnTorOn()
      await advance(0)
      await click(button('Save & Reconnect'))
      const confirm = dialogButton('Connect without Tor')
      assert.ok(confirm, 'Expected the confirmation dialog')
      await click(confirm)
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      await advance(0)
      expect(container.textContent).not.toContain('Tor could not start')
      // The saved connection is direct now, so testing it runs without asking again.
      await click(button('Test Connection'))
      expect(requests.filter(({ path }) => path === 'settings.testElectrum')).toHaveLength(1)
    })
  })
})
