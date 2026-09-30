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
// A test that sets this decides when, and how, deletions answer.
let deleteResponse: Promise<Response> | null
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
  const input = container.querySelector<HTMLInputElement>('#connection-host')
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
  return Response.json(
    { error: { json: { message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: status } } } },
    { status },
  )
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
  const input = container.querySelector<HTMLInputElement>('#connection-tor')
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
  deleteResponse = null
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
        const request = CreateRequestSchema.parse(input)
        const created = { ...profile('New'), ...request, torEnabled: request.torEnabled ?? false }
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
          const answer = deleteResponse === null ? null : await deleteResponse
          if (answer !== null && !answer.ok) {
            return answer
          }
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

// ─── Saved connections ───────────────────────────────────────────────────────

interface HomeAndAway {
  home: ProfileFixture
  away: ProfileFixture
}

function homeAndAway(): HomeAndAway {
  const home = activeProfile()
  home.nickname = 'Home LAN'
  const away = profile('Away', { host: 'server-b.example' })
  profiles.push(away)
  return { home, away }
}

function fillTo(count: number): void {
  while (profiles.length < count) {
    profiles.push(profile(`Extra ${profiles.length}`))
  }
}

function field(id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) {
    throw new Error(`Missing field: ${id}`)
  }
  return input
}

async function choose(id: string, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`)
  if (!select) {
    throw new Error(`Missing select: ${id}`)
  }
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** The Electrum section's own buttons; the page's name form also has a "Save name" button. */
function formButton(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('.connection-layout button')).find(
    (item) => item.textContent === label,
  )
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

function labelled(label: string, scope = ''): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(`${scope} button[aria-label="${label}"]`))
}

function firstLabelled(label: string, scope = ''): HTMLButtonElement {
  const found = labelled(label, scope)[0]
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

function alertDialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="alertdialog"]')
}

function alertDialogButton(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
    (item) => item.textContent === label,
  )
  if (!found) {
    throw new Error(`Missing dialog button: ${label}`)
  }
  return found
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

async function refetchConnections(): Promise<void> {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['connection-profiles'] })
  })
}

function holdDeletes(): (response: Response) => void {
  let finish: (response: Response) => void = () => undefined
  deleteResponse = new Promise((resolve) => {
    finish = resolve
  })
  return finish
}

function pickerOption(): string | null | undefined {
  return container.querySelector<HTMLSelectElement>('#saved-connection')?.selectedOptions[0]?.textContent
}

describe('desktop saved connections', () => {
  it('uses one connection form for both selectors, and selection never opens a connection', async () => {
    await withTestSetup(async () => {
      const { home, away } = homeAndAway()
      await render()
      expect(container.querySelectorAll('#connection-host')).toHaveLength(1)
      await choose('saved-connection', away.id)
      expect(hostInput().value).toBe('server-b.example')
      expect(container.textContent).toContain('Connected · Home LAN')
      expect(button('Connect').disabled).toBe(false)
      expect(connectRequests()).toEqual([])
      const homeRow = container.querySelector<HTMLButtonElement>('aside button[aria-pressed="false"]')
      assert.ok(homeRow, 'Expected the Home LAN row')
      await click(homeRow)
      expect(hostInput().value).toBe('server-a.example')
      expect(container.querySelector<HTMLSelectElement>('#saved-connection')?.value).toBe(home.id)
    })
  })

  it('updates the active connection only after a successful switch', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      await render()
      await choose('saved-connection', away.id)
      await click(button('Connect'))
      expect(container.textContent).toContain('Connected · Home LAN')
      expect(toast.success).not.toHaveBeenCalled()
      await act(async () => {
        finishSave(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      await waitForText('Connected · Away')
      expect(hostInput().value).toBe('server-b.example')
      expect(button('Reconnect').disabled).toBe(true)
    })
  })

  it('keeps public shortcuts in creation only, and saves a new nickname without connecting', async () => {
    await withTestSetup(async () => {
      homeAndAway()
      await render()
      expect(container.querySelector('#connection-starter')).toBeNull()
      await click(formButton('+ New connection'))
      await type(field('connection-nickname'), 'Travel')
      await choose('connection-starter', 'electrum.blockstream.info')
      expect(hostInput().value).toBe('electrum.blockstream.info')
      await choose('connection-starter', 'custom')
      expect(hostInput().value).toBe('')
      await type(hostInput(), 'travel.example')
      await click(button('Save connection'))
      await waitForToast('success')
      expect(profiles.map(({ nickname }) => nickname)).toEqual(['Home LAN', 'Away', 'Travel'])
      expect(activeProfile().host).toBe('server-a.example')
      expect(container.querySelector('#connection-starter')).toBeNull()
      expect([...connectRequests(), ...requestsTo('testElectrum')]).toEqual([])
    })
  })

  it('renames another profile with one action and updates both selectors without connecting', async () => {
    await withTestSetup(async () => {
      homeAndAway()
      await render()
      await click(firstLabelled('Rename Away'))
      expect(field('connection-nickname').value).toBe('Away')
      await type(field('connection-nickname'), 'Remote Tor')
      await click(formButton('Save name'))
      await waitForToast('success')
      expect(profiles.map(({ nickname }) => nickname)).toEqual(['Home LAN', 'Remote Tor'])
      await vi.waitFor(async () => {
        await flush()
        expect(container.querySelector('#saved-connection')?.textContent).toContain('Remote Tor')
        expect(container.querySelector('aside')?.textContent).toContain('Remote Tor')
      })
      expect(connectRequests()).toEqual([])
    })
  })

  it('prevents a sixth connection in both layouts', async () => {
    await withTestSetup(async () => {
      fillTo(5)
      await render()
      const addButtons = Array.from(container.querySelectorAll('button')).filter(
        (item) => item.textContent === '+ New connection',
      )
      expect(addButtons.map((item) => item.disabled)).toEqual([true, true])
      expect(container.textContent).toContain('Maximum reached')
    })
  })

  it('preserves unsaved connection edits when renaming the selected profile', async () => {
    await withTestSetup(async () => {
      const { home } = homeAndAway()
      await render()
      await type(hostInput(), 'unsaved.example')
      await click(firstLabelled('Rename Home LAN'))
      await type(field('connection-nickname'), 'My node')
      await click(formButton('Save name'))
      await waitForToast('success')
      expect(hostInput().value).toBe('unsaved.example')
      expect(profiles.find(({ id }) => id === home.id)?.nickname).toBe('My node')
      expect(activeProfile().host).toBe('server-a.example')
      expect(button('Save & Reconnect').disabled).toBe(false)
      expect(connectRequests()).toEqual([])
    })
  })

  it('protects local edits when another window changes the selected profile', async () => {
    await withTestSetup(async () => {
      const { home } = homeAndAway()
      await render()
      await type(hostInput(), 'unsaved.example')
      profiles[0] = { ...home, host: 'changed-elsewhere.example', revision: 2 }
      await refetchConnections()
      await waitForText('This connection changed in another window')
      expect(hostInput().value).toBe('unsaved.example')
      await click(button('Reload connection'))
      await click(button('Keep editing'))
      expect(hostInput().value).toBe('unsaved.example')
      await click(button('Reload connection'))
      await click(button('Discard changes'))
      expect(hostInput().value).toBe('changed-elsewhere.example')
      expect(container.textContent).not.toContain('This connection changed in another window')
      expect(connectRequests()).toEqual([])
    })
  })

  it('requires an explicit discard before replacing an edited form', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      await render()
      await type(hostInput(), 'unsaved.example')
      await choose('saved-connection', away.id)
      expect(hostInput().value).toBe('unsaved.example')
      await click(button('Keep editing'))
      expect(hostInput().value).toBe('unsaved.example')
      await choose('saved-connection', away.id)
      await click(button('Discard changes'))
      expect(hostInput().value).toBe('server-b.example')
    })
  })

  it('blocks rename and reconnect until the pending discard is resolved', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      await render()
      await type(hostInput(), 'unsaved.example')
      await choose('saved-connection', away.id)
      const rename = firstLabelled('Rename Home LAN')
      expect(rename.disabled).toBe(true)
      expect(button('Save & Reconnect').disabled).toBe(true)
      expect(button('Test Connection').disabled).toBe(true)
      expect(hostInput().disabled).toBe(true)
      await click(rename)
      await click(button('Save & Reconnect'))
      await click(firstLabelled('Delete Away', 'aside'))
      expect(container.querySelector('#connection-nickname')).toBeNull()
      expect(alertDialog()).toBeNull()
      expect([...connectRequests(), ...requestsTo('connectionProfiles.rename')]).toEqual([])
      await click(button('Discard changes'))
      expect(hostInput().value).toBe('server-b.example')
      expect(container.querySelector('#connection-nickname')).toBeNull()
      await click(formButton('Rename'))
      await type(field('connection-nickname'), 'Remote')
      await click(formButton('Save name'))
      await waitForToast('success')
      expect(profiles.map(({ nickname }) => nickname)).toEqual(['Home LAN', 'Remote'])
    })
  })

  it('locks a new nickname while discarding, and unlocks it when keeping edits', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      await render()
      await click(formButton('+ New connection'))
      await type(field('connection-nickname'), 'Travel')
      await type(hostInput(), 'travel.example')
      await choose('saved-connection', away.id)
      expect(field('connection-nickname').disabled).toBe(true)
      expect(formButton('Cancel').disabled).toBe(true)
      expect(button('Save connection').disabled).toBe(true)
      await click(button('Keep editing'))
      expect(field('connection-nickname').value).toBe('Travel')
      expect(field('connection-nickname').disabled).toBe(false)
      expect(button('Save connection').disabled).toBe(false)
      await click(button('Save connection'))
      await waitForToast('success')
      expect(profiles.at(-1)?.nickname).toBe('Travel')
    })
  })

  it('tests the draft without saving or activating it', async () => {
    await withTestSetup(async () => {
      await render()
      await type(hostInput(), 'test.example')
      await click(button('Test Connection'))
      await waitForText('Connection successful')
      expect(activeProfile().host).toBe('server-a.example')
      expect(requestsTo('testElectrum')).toEqual([
        { host: 'test.example', port: 50002, protocol: 'ssl', torEnabled: false },
      ])
    })
  })

  it('protects the active connection from deletion in both layouts', async () => {
    await withTestSetup(async () => {
      homeAndAway()
      await render()
      expect(labelled('Delete Home LAN').map((icon) => icon.disabled)).toEqual([true, true])
      await click(firstLabelled('Delete Home LAN', 'aside'))
      expect(alertDialog()).toBeNull()
      expect(requestsTo('connectionProfiles.delete')).toEqual([])
    })
  })

  it('confirms deletion from the list without selecting or connecting to that profile', async () => {
    await withTestSetup(async () => {
      homeAndAway()
      const finishDelete = holdDeletes()
      await render()
      await click(firstLabelled('Delete Away', 'aside'))
      expect(alertDialog()?.textContent).toContain('Delete “Away”?')
      expect(requestsTo('connectionProfiles.delete')).toEqual([])
      await click(alertDialogButton('Cancel'))
      expect(hostInput().value).toBe('server-a.example')
      await click(firstLabelled('Delete Away', 'aside'))
      await click(alertDialogButton('Delete connection'))
      expect(alertDialogButton('Cancel').disabled).toBe(true)
      await act(async () => {
        finishDelete(Response.json({ result: { data: null } }))
      })
      await waitForToast('success')
      await vi.waitFor(async () => {
        await flush()
        expect(container.querySelector('aside')?.textContent).not.toContain('Away')
      })
      expect(container.querySelector('#saved-connection')?.textContent).not.toContain('Away')
      expect(hostInput().value).toBe('server-a.example')
      expect(container.textContent).toContain('Connected · Home LAN')
      expect([...connectRequests(), ...requestsTo('testElectrum')]).toEqual([])
    })
  })

  it('deletes the selected profile from the compact picker, discards its edits, and frees a slot', async () => {
    await withTestSetup(async () => {
      const { home, away } = homeAndAway()
      fillTo(5)
      await render()
      await choose('saved-connection', away.id)
      await type(hostInput(), 'unsaved.example')
      await click(firstLabelled('Delete Away', '.connection-picker'))
      expect(alertDialog()?.textContent).toContain('unsaved changes')
      await click(alertDialogButton('Cancel'))
      expect(hostInput().value).toBe('unsaved.example')
      await click(firstLabelled('Delete Away', '.connection-picker'))
      await click(alertDialogButton('Delete connection'))
      await waitForToast('success')
      expect(hostInput().value).toBe('server-a.example')
      expect(container.querySelector<HTMLSelectElement>('#saved-connection')?.value).toBe(home.id)
      await vi.waitFor(async () => {
        await flush()
        const addButtons = Array.from(container.querySelectorAll('button')).filter(
          (item) => item.textContent === '+ New connection',
        )
        expect(addButtons.map((item) => item.disabled)).toEqual([false, false])
      })
      expect(profiles).toHaveLength(4)
    })
  })

  it('preserves a new draft when deleting another profile', async () => {
    await withTestSetup(async () => {
      homeAndAway()
      await render()
      await click(formButton('+ New connection'))
      await type(field('connection-nickname'), 'New draft')
      await type(hostInput(), 'new.example')
      await click(firstLabelled('Delete Away', 'aside'))
      await click(alertDialogButton('Delete connection'))
      await waitForToast('success')
      expect(field('connection-nickname').value).toBe('New draft')
      expect(hostInput().value).toBe('new.example')
      expect(button('Save connection').disabled).toBe(false)
    })
  })

  it('keeps the profile and draft when deletion fails and shows the error in the dialog', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      const finishDelete = holdDeletes()
      await render()
      await choose('saved-connection', away.id)
      await type(hostInput(), 'unsaved.example')
      await click(firstLabelled('Delete Away', 'aside'))
      await click(alertDialogButton('Delete connection'))
      await act(async () => {
        finishDelete(trpcError('Connection changed in another window', 409))
      })
      await vi.waitFor(async () => {
        await flush()
        expect(alertDialog()?.textContent).toContain('Connection changed in another window')
      })
      await click(alertDialogButton('Cancel'))
      expect(hostInput().value).toBe('unsaved.example')
      expect(profiles).toHaveLength(2)
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  it('disables deletion if the target becomes active in another window while confirming', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      await render()
      await click(firstLabelled('Delete Away', 'aside'))
      activeId = away.id
      await refetchConnections()
      await vi.waitFor(async () => {
        await flush()
        expect(alertDialogButton('Delete connection').disabled).toBe(true)
      })
      expect(alertDialog()?.textContent).toContain('Connect to another profile')
      expect(requestsTo('connectionProfiles.delete')).toEqual([])
    })
  })

  it('keeps an externally deleted draft visible without mislabeling it as another saved connection', async () => {
    await withTestSetup(async () => {
      const { home, away } = homeAndAway()
      await render()
      await choose('saved-connection', away.id)
      await type(hostInput(), 'unsaved.example')
      profiles = [home]
      await refetchConnections()
      await waitForText('This connection was deleted in another window')
      expect(pickerOption()).toBe('Away — Deleted')
      expect(hostInput().value).toBe('unsaved.example')
      expect(button('Save & Reconnect').disabled).toBe(true)
      await choose('saved-connection', home.id)
      await click(button('Discard changes'))
      expect(hostInput().value).toBe('server-a.example')
    })
  })

  it('keeps each connection’s own Tor setting and asks before leaving Tor for a direct one', async () => {
    await withTestSetup(async () => {
      const { away } = homeAndAway()
      activeProfile().torEnabled = true
      torStatus = { state: 'ready' }
      await render()
      await vi.waitFor(() => {
        expect(torSwitch().checked).toBe(true)
      })
      await choose('saved-connection', away.id)
      expect(torSwitch().checked).toBe(false)
      await click(button('Connect'))
      expect(document.body.textContent).toContain('The server will see your IP address and the addresses you look up.')
      const cancel = dialogButton('Cancel')
      assert.ok(cancel, 'Expected the confirmation dialog')
      await click(cancel)
      expect(connectRequests()).toEqual([])
    })
  })
})
