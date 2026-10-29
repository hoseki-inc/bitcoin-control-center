// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionGlobalConfig } from 'framer-motion'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import superjson from 'superjson'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { FirstRunOnboarding } from './first-run-onboarding'

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

const DetailsSchema = z.object({
  host: z.string(),
  port: z.number(),
  protocol: z.enum(['ssl', 'tcp']),
  torEnabled: z.boolean(),
})
const ConnectSchema = z.object({ id: z.string(), revision: z.number(), connection: DetailsSchema.optional() })
const CreateSchema = DetailsSchema.extend({ nickname: z.string() })
const KeySchema = z.object({ key: z.string() })
const UpdateSchema = z.object({ key: z.string(), value: z.string() })

type Profile = z.infer<typeof DetailsSchema> & { id: string; nickname: string; revision: number }

/** A fake desktop Sentinel, started on Blockstream's public server as a new installation is. */
class DesktopServer {
  public readonly saved = new Map<string, string>()
  public readonly profiles: Profile[] = [
    {
      id: 'public',
      nickname: 'Current connection',
      host: 'electrum.blockstream.info',
      port: 50002,
      protocol: 'ssl',
      torEnabled: false,
      revision: 1,
    },
  ]
  public activeId = 'public'
  public readonly requests: Array<{ path: string; input: unknown }> = []

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (url, init) => {
      const parsed = new URL(parseUnknown(z.string(), url).unwrapOr(''), 'http://sentinel.test')
      const path = parsed.pathname.split('/').at(-1) ?? ''
      const body = parseUnknown(z.string(), init?.body).unwrapOr(parsed.searchParams.get('input') ?? 'null')
      const input = parseUnknown(z.object({ json: z.unknown() }), JSON.parse(body))
        .map((envelope) => envelope.json)
        .unwrapOr(null)
      this.requests.push({ path, input })
      return this.answer(path, input)
    })
  }

  public requested(path: string): unknown[] {
    return this.requests.filter((request) => request.path === path).map((request) => request.input)
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Request bodies are untrusted until each handler parses them.
  private answer(path: string, input: unknown): Response {
    if (path === 'settings.get') {
      return result(this.saved.get(parseUnknown(KeySchema, input).expect('setting key').key) ?? null)
    }
    if (path === 'settings.update') {
      const { key, value } = parseUnknown(UpdateSchema, input).expect('setting update')
      this.saved.set(key, value)
      return result(null)
    }
    if (path === 'settings.startTor') {
      return result({ state: 'starting', progress: 0, attempt: 1 })
    }
    if (path === 'settings.connectionProfiles.list') {
      return result({ profiles: this.profiles, activeId: this.activeId, limit: 5 })
    }
    if (path === 'settings.connectionProfiles.create') {
      const created = { ...parseUnknown(CreateSchema, input).expect('new connection'), id: 'node', revision: 1 }
      this.profiles.push(created)
      return result(created)
    }
    if (path === 'settings.connectionProfiles.connect') {
      const request = parseUnknown(ConnectSchema, input).expect('connection')
      const index = this.profiles.findIndex((profile) => profile.id === request.id)
      const current = this.profiles[index]
      assert(current !== undefined && current.revision === request.revision, 'Expected the current revision')
      const connected = { ...current, ...request.connection, revision: current.revision + 1 }
      this.profiles[index] = connected
      this.activeId = connected.id
      // Like Sentinel, connecting saves the server.
      this.saved.set('electrum_host', connected.host)
      return result(connected)
    }
    throw new Error(`Unexpected request: ${path}`)
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Any JSON value tRPC can carry.
function result(value: unknown): Response {
  return Response.json({ result: { data: superjson.serialize(value) } })
}

async function render(): Promise<DesktopServer> {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server = new DesktopServer(fetchMock)
  // Steps turn over at once, so each check sees only the step on screen.
  MotionGlobalConfig.skipAnimations = true
  // The previews draw the app's charts, which watch their size and the reduced-motion setting.
  const matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: true,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  dom.window.matchMedia = matchMedia
  vi.stubGlobal('matchMedia', matchMedia)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn<() => void>()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    MotionGlobalConfig.skipAnimations = false
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MemoryRouter, null, createElement(FirstRunOnboarding, { accountCount: 0 })),
        ),
      ),
    )
  })
  // Open, with desktop's server steps.
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain('Step 1 of 6')
  })
  return server
}

/** The title of the step on screen, not one on its way out. */
function heading(): string {
  const titles = Array.from(document.body.querySelectorAll('[role="dialog"] h2'))
  return titles.find((title) => title.closest('[aria-hidden="true"]') === null)?.textContent ?? ''
}

async function click(name: string): Promise<void> {
  const found = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent === name)
  assert(found !== undefined, `Expected a ${name} button`)
  await act(async () => {
    found.click()
  })
}

async function clickInput(selector: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>(selector)
  assert(input !== null, `Expected ${selector}`)
  await act(async () => {
    input.click()
  })
}

async function type(id: string, value: string): Promise<void> {
  const field = document.body.querySelector<HTMLInputElement>(`#${id}`)
  assert(field !== null, `Expected the ${id} field`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

async function toServerStep(): Promise<void> {
  for (let step = 1; step < 5; step++) {
    await click('Continue')
  }
  expect(heading()).toBe('Choose your Electrum server')
}

it('keeps the public server without saving anything', async () => {
  const server = await render()
  await toServerStep()
  await click('Continue')
  expect(heading()).toBe('Start with one account')
  expect(server.requested('settings.connectionProfiles.connect')).toEqual([])
  expect(server.saved.has('electrum_host')).toBe(false)
})

it('connects the public server through Tor and carries on with the introduction', async () => {
  const server = await render()
  await toServerStep()
  await clickInput('#public-tor')
  // Tor starts while you read, so connecting waits less.
  expect(server.requested('settings.startTor')).toHaveLength(1)
  expect(document.body.textContent).toContain('Hidden by Tor')
  await click('Continue')
  // Connecting saves a server; the introduction keeps its steps anyway.
  await vi.waitFor(() => {
    expect(heading()).toBe('Start with one account')
  })
  expect(document.body.textContent).toContain('Step 6 of 6')
  expect(server.requested('settings.connectionProfiles.connect')).toEqual([
    {
      id: 'public',
      revision: 1,
      connection: { host: 'electrum.blockstream.info', port: 50002, protocol: 'ssl', torEnabled: true },
    },
  ])
  // Back and on again connects nothing new.
  await click('Back')
  expect(heading()).toBe('Choose your Electrum server')
  await click('Continue')
  expect(heading()).toBe('Start with one account')
  expect(server.requested('settings.connectionProfiles.connect')).toHaveLength(1)
})

it('goes back to the public server from a node connected in the introduction', async () => {
  const server = await render()
  await toServerStep()
  await clickInput('input[type="radio"][value="own"]')
  await click('Continue')
  await type('node-host', 'umbrel.local')
  await click('Connect')
  await vi.waitFor(() => {
    expect(heading()).toBe('Start with one account')
  })
  expect(server.activeId).toBe('node')
  await click('Back')
  await click('Back')
  await clickInput('input[type="radio"][value="public"]')
  await click('Continue')
  await vi.waitFor(() => {
    expect(heading()).toBe('Start with one account')
  })
  expect(server.activeId).toBe('public')
  expect(server.requested('settings.connectionProfiles.connect').at(-1)).toEqual({
    id: 'public',
    revision: 1,
    connection: { host: 'electrum.blockstream.info', port: 50002, protocol: 'ssl', torEnabled: false },
  })
})
