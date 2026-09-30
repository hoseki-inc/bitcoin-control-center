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
  protocol: z.enum(['tcp', 'ssl']),
  torEnabled: z.boolean().optional(),
})
const ConnectRequestSchema = z.object({ id: z.string(), revision: z.number(), connection: connectionSchema })
const CreateRequestSchema = connectionSchema.extend({ nickname: z.string() })
const ReferenceSchema = z.object({ id: z.string(), revision: z.number(), nickname: z.string().optional() })
interface ProfileFixture {
  id: string
  nickname: string
  host: string
  port: number
  protocol: 'tcp' | 'ssl'
  torEnabled: boolean
  revision: number
}
let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
let profiles: ProfileFixture[]
let activeId: string
let connected: boolean
let finishSave: (response: Response) => void
let saveResponse: Promise<Response>
let requests: Array<{ path: string; input: unknown }>
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
  const input = container.querySelector<HTMLInputElement>('#electrum-host')
  if (!input) {
    throw new Error('Missing host input')
  }
  return input
}

function profile(nickname: string, values: Partial<ProfileFixture> = {}): ProfileFixture {
  return {
    id: `00000000-0000-4000-8000-00000000000${profiles.length + 1}`,
    nickname,
    host: `${nickname.toLowerCase().replaceAll(' ', '-')}.example`,
    port: 50002,
    protocol: 'ssl',
    torEnabled: false,
    revision: 1,
    ...values,
  }
}

function activeProfile(): ProfileFixture {
  const found = profiles.find((item) => item.id === activeId)
  if (!found) {
    throw new Error('Missing active profile')
  }
  return found
}

function requestsTo(procedure: string): unknown[] {
  return requests.filter(({ path }) => path === `settings.${procedure}`).map(({ input }) => input)
}

function connectRequests(): Array<z.infer<typeof ConnectRequestSchema>> {
  return requestsTo('connectionProfiles.connect').map((input) =>
    parseUnknown(ConnectRequestSchema, input).expect('connect request'),
  )
}

type TrpcValue =
  | ProfileFixture
  | { profiles: ProfileFixture[]; activeId: string; limit: number }
  | { id: string }
  | { success: boolean; version: string[] }
  | null

function trpcResult(value: TrpcValue): Response {
  return Response.json({ result: { data: superjson.serialize(value) } })
}

function trpcError(message: string, status = 400): Response {
  return Response.json({ error: { json: { message } } }, { status })
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

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (!descriptor?.set) {
      throw new Error('Missing input setter')
    }
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function changeHost(): Promise<void> {
  await type(hostInput(), 'server-b.example')
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
  profiles = []
  profiles.push(profile('Server A'))
  activeId = profiles[0]?.id ?? ''
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
      const parsed = new URL(parseUnknown(z.string(), url).expect('request URL'), 'http://127.0.0.1')
      const path = parsed.pathname.split('/').at(-1) ?? ''
      const body = parseUnknown(z.string(), init?.body).unwrapOr(null)
      // SAFETY: Serialized request text is validated by each handler's schema before use.
      const input =
        body === null
          ? null
          : parseUnknown(z.object({ json: z.unknown() }), JSON.parse(body) as unknown).expect('request').json
      requests.push({ path, input })
      if (path === 'settings.get') {
        return trpcResult(null)
      }
      if (path === 'settings.electrumStatus') {
        const { host, port, protocol } = activeProfile()
        return Response.json({ result: { data: { json: { connected, host, port, protocol, tor: torStatus } } } })
      }
      if (path === 'settings.priceSource' || path === 'settings.priceStatus') {
        return Response.json({ result: { data: { json: null } } })
      }
      if (path === 'settings.startTor') {
        torAttempts += 1
        const started = { state: 'starting', progress: 0, attempt: torAttempts }
        torStatus =
          torFailsInstantly === null ? started : { state: 'failed', message: torFailsInstantly, attempt: torAttempts }
        return Response.json({ result: { data: { json: started } } })
      }
      if (path === 'settings.testElectrum') {
        return trpcResult({ success: true, version: ['Test Electrum', '1.4'] })
      }
      if (path === 'settings.connectionProfiles.list') {
        return trpcResult({ profiles, activeId, limit: 5 })
      }
      if (path === 'settings.connectionProfiles.create') {
        const created = { ...profile('New'), ...CreateRequestSchema.parse(input), torEnabled: false }
        profiles.push(created)
        return trpcResult(created)
      }
      if (path === 'settings.connectionProfiles.rename' || path === 'settings.connectionProfiles.delete') {
        const reference = ReferenceSchema.parse(input)
        const index = profiles.findIndex((item) => item.id === reference.id)
        const current = profiles[index]
        if (!current || current.revision !== reference.revision) {
          return trpcError('This connection changed in another window. Reload it before trying again.', 409)
        }
        if (path.endsWith('.delete')) {
          profiles.splice(index, 1)
          return trpcResult({ id: reference.id })
        }
        const renamed = { ...current, nickname: reference.nickname ?? current.nickname, revision: current.revision + 1 }
        profiles[index] = renamed
        return trpcResult(renamed)
      }
      if (path === 'settings.connectionProfiles.connect') {
        const request = ConnectRequestSchema.parse(input)
        const result = await saveResponse
        const index = profiles.findIndex((item) => item.id === request.id)
        const current = profiles[index]
        if (!result.ok || !current) {
          return result
        }
        const updated = {
          ...current,
          ...request.connection,
          torEnabled: request.connection.torEnabled ?? false,
          revision: current.revision + 1,
        }
        profiles[index] = updated
        activeId = updated.id
        connected = true
        return trpcResult(updated)
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
  it('loads saved connections even when the computer reports no internet connection', async () => {
    await withTestSetup(async () => {
      onlineManager.setOnline(false)
      connected = false
      await render()
      expect(hostInput().disabled).toBe(false)
      expect(button('Reconnect').disabled).toBe(false)
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
      expect(activeProfile().host).toBe('server-a.example')
      expect(hostInput().value).toBe('server-b.example')
      expect(button('Save & Reconnect').disabled).toBe(false)
      expect(toast.success).not.toHaveBeenCalled()
      expect(requestsTo('update')).toEqual([])
      expect(connectRequests()).toHaveLength(1)
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
      expect(activeProfile().host).toBe('server-b.example')
      expect(hostInput().value).toBe('server-b.example')
      expect(hostInput().disabled).toBe(false)
      expect(button('Reconnect').disabled).toBe(true)
      expect(requestsTo('update')).toEqual([])
    })
  })

  it('offers retry without forcing users to edit an unchanged disconnected server', async () => {
    await withTestSetup(async () => {
      connected = false
      await render()
      expect(container.textContent).toContain('Your saved data is still on this device')
      expect(button('Reconnect').disabled).toBe(false)
      await act(async () => {
        button('Reconnect').click()
      })
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(activeProfile().host).toBe('server-a.example')
      expect(connectRequests().map(({ id }) => id)).toEqual([activeId])
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
      expect([...connectRequests(), ...requestsTo('testElectrum')]).toEqual([])
      expect(activeProfile().torEnabled).toBe(false)
      await turnTorOn()
      expect(container.textContent).not.toContain('Tor could not connect')
      expect(requests.filter(({ path }) => path === 'settings.startTor')).toHaveLength(2)
    })
  })

  it('switches a saved Tor connection to direct only after confirmation', async () => {
    await withTestSetup(async () => {
      activeProfile().torEnabled = true
      torStatus = { state: 'ready' }
      await render()
      await vi.waitFor(() => {
        expect(torSwitch().checked).toBe(true)
      })
      await click(torSwitch())
      await click(button('Save & Reconnect'))
      expect(connectRequests()).toEqual([])
      const confirm = dialogButton('Connect without Tor')
      assert.ok(confirm, 'Expected the confirmation dialog')
      await click(confirm)
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(connectRequests().map(({ connection }) => connection.torEnabled)).toEqual([false])
      expect(activeProfile().torEnabled).toBe(false)
    })
  })

  it('does not announce Tor when it was already running before settings opened', async () => {
    await withTestSetup(async () => {
      activeProfile().torEnabled = true
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
      activeProfile().torEnabled = true
      torStatus = { state: 'failed', message: 'Tor stopped unexpectedly.' }
      connected = false
      await render()
      await waitForText('Tor stopped unexpectedly.')
      expect(torSwitch().checked).toBe(false)
      expect(activeProfile().torEnabled).toBe(true)
      expect(container.textContent).toContain('Turn Tor on to try again, or choose another saved connection.')
      expect(container.textContent).not.toContain('Check your connection')
      expect(connectRequests()).toEqual([])
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
      activeProfile().torEnabled = true
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
      activeProfile().torEnabled = true
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

function field(selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) {
    throw new Error(`Missing field: ${selector}`)
  }
  return input
}

async function chooseConnection(id: string): Promise<void> {
  const picker = container.querySelector<HTMLSelectElement>('#saved-connection')
  if (!picker) {
    throw new Error('Missing saved connection picker')
  }
  await act(async () => {
    picker.value = id
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function optionLabels(): string[] {
  return Array.from(container.querySelectorAll('#saved-connection option'), (option) => option.textContent)
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

describe('saved connections', () => {
  it('saves a new connection without connecting, then connects when chosen', async () => {
    await withTestSetup(async () => {
      await render()
      await click(button('New connection'))
      expect(button('Save connection').disabled).toBe(true)
      await type(field('#connection-nickname'), 'Home node')
      await type(hostInput(), 'home.example')
      await click(button('Save connection'))
      await waitForToast('success')
      expect(requestsTo('connectionProfiles.create')).toHaveLength(1)
      expect(connectRequests()).toEqual([])
      expect(activeProfile().nickname).toBe('Server A')
      await vi.waitFor(async () => {
        await settle()
        expect(button('Connect').disabled).toBe(false)
      })
      expect(optionLabels()).toEqual(['Server A (active)', 'Home node'])
      await click(button('Connect'))
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await vi.waitFor(async () => {
        await settle()
        expect(activeProfile().nickname).toBe('Home node')
        expect(container.textContent).toContain('Connected · Home node')
      })
      expect(connectRequests().map(({ connection }) => connection.host)).toEqual(['home.example'])
    })
  })

  it('keeps each connection’s own Tor setting and uses it when connecting', async () => {
    await withTestSetup(async () => {
      const viaTor = profile('Away', { host: 'node.onion', protocol: 'tcp', port: 50001, torEnabled: true })
      profiles.push(viaTor)
      torStatus = { state: 'ready' }
      await render()
      expect(torSwitch().checked).toBe(false)
      await chooseConnection(viaTor.id)
      expect(hostInput().value).toBe('node.onion')
      expect(torSwitch().checked).toBe(true)
      await click(button('Connect'))
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      expect(connectRequests()).toEqual([
        {
          id: viaTor.id,
          revision: 1,
          connection: { host: 'node.onion', port: 50001, protocol: 'tcp', torEnabled: true },
        },
      ])
    })
  })

  it('asks before connecting to a direct connection while the active one uses Tor', async () => {
    await withTestSetup(async () => {
      activeProfile().torEnabled = true
      const direct = profile('Public server')
      profiles.push(direct)
      torStatus = { state: 'ready' }
      await render()
      await chooseConnection(direct.id)
      await click(button('Connect'))
      expect(document.body.textContent).toContain('The server will see your IP address and the addresses you look up.')
      const cancel = dialogButton('Cancel')
      assert.ok(cancel, 'Expected the confirmation dialog')
      await click(cancel)
      expect(connectRequests()).toEqual([])
    })
  })

  it('asks before discarding unsaved edits when choosing another connection', async () => {
    await withTestSetup(async () => {
      const other = profile('Server C')
      profiles.push(other)
      await render()
      await changeHost()
      await chooseConnection(other.id)
      expect(container.textContent).toContain('You have unsaved changes. Discard them?')
      await click(button('Keep editing'))
      expect(hostInput().value).toBe('server-b.example')
      await chooseConnection(other.id)
      await click(button('Discard changes'))
      expect(hostInput().value).toBe('server-c.example')
      expect(connectRequests()).toEqual([])
    })
  })

  it('renames a connection without connecting to it', async () => {
    await withTestSetup(async () => {
      await render()
      await click(button('Rename'))
      await type(field('#connection-nickname'), 'My node')
      await click(button('Save nickname'))
      await waitForToast('success')
      await vi.waitFor(async () => {
        await settle()
        expect(optionLabels()).toEqual(['My node (active)'])
      })
      expect(connectRequests()).toEqual([])
      expect(activeProfile().revision).toBe(2)
    })
  })

  it('deletes a saved connection only after confirmation, and never the active one', async () => {
    await withTestSetup(async () => {
      const other = profile('Old server')
      profiles.push(other)
      await render()
      const deleteButton = (): HTMLButtonElement | null =>
        container.querySelector<HTMLButtonElement>('button[aria-label^="Delete "]')
      expect(deleteButton()?.disabled).toBe(true)
      await chooseConnection(other.id)
      const remove = deleteButton()
      assert.ok(remove, 'Expected a delete button')
      await click(remove)
      expect(document.body.textContent).toContain('Delete “Old server”?')
      expect(requestsTo('connectionProfiles.delete')).toEqual([])
      const confirm = dialogButton('Delete connection')
      assert.ok(confirm, 'Expected the delete confirmation')
      await click(confirm)
      await waitForToast('success')
      expect(profiles.map(({ nickname }) => nickname)).toEqual(['Server A'])
      await vi.waitFor(async () => {
        await settle()
        expect(optionLabels()).toEqual(['Server A (active)'])
      })
      expect(hostInput().value).toBe('server-a.example')
    })
  })

  it('stops offering new connections at the limit', async () => {
    await withTestSetup(async () => {
      for (const nickname of ['Two', 'Three', 'Four', 'Five']) {
        profiles.push(profile(nickname))
      }
      await render()
      expect(container.textContent).not.toContain('New connection')
      expect(container.textContent).toContain('You can save up to 5 connections.')
    })
  })

  it('does not overwrite a connection changed in another window', async () => {
    await withTestSetup(async () => {
      const advance = useStepTimers()
      await render()
      await changeHost()
      // Another window saves a different server for the same connection.
      const index = profiles.findIndex(({ id }) => id === activeId)
      profiles[index] = { ...activeProfile(), host: 'server-z.example', revision: 2 }
      await advance(10_000)
      expect(container.textContent).toContain('This connection changed in another window.')
      expect(button('Save & Reconnect').disabled).toBe(true)
      await click(button('Reload connection'))
      expect(hostInput().value).toBe('server-z.example')
      expect(connectRequests()).toEqual([])
    })
  })
})
