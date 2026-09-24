// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectrumRow, formatServer } from './electrum-settings'

interface Status {
  host: string
  port: number
  protocol: 'tcp' | 'ssl'
  tor: boolean
  connected: boolean
  torAvailable: boolean
  error: string | null
}

const reconnect = vi.fn<(input: Omit<Status, 'connected' | 'torAvailable' | 'error'>) => Promise<Status>>()
const setData = vi.fn()
let status: Status

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../trpc/base', () => ({
  trpc: {
    useUtils: () => ({ settings: { electrumStatus: { setData } } }),
    settings: {
      electrumStatus: { useQuery: () => ({ data: status, isError: false }) },
      reconnectElectrum: { useMutation: () => useMutation({ mutationFn: reconnect }) },
    },
  },
}))

let root: Root
let container: HTMLDivElement
let client: QueryClient

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

async function mount(next: Partial<Status> = {}): Promise<void> {
  status = {
    host: 'umbrel.local',
    port: 50001,
    protocol: 'tcp',
    tor: false,
    connected: true,
    torAvailable: true,
    error: null,
    ...next,
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ChakraProvider>
          <ElectrumRow tone={0} />
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
  await settle()
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((element) => element.textContent === label)
  if (match === undefined) throw new Error(`No ${label} button`)
  return match
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click())
  await settle()
}

async function type(selector: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (input === null) throw new Error(`No ${selector}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function radio(name: string, value: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
  if (input === null) throw new Error(`No ${name}=${value}`)
  return input
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  Element.prototype.scrollIntoView = vi.fn()
  reconnect.mockReset()
  setData.mockReset()
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
})

describe('Electrum server row', () => {
  it('shows the live connection, including Tor', async () => {
    await mount({ tor: true })
    expect(container.textContent).toContain('Connected to umbrel.local:50001 · through Tor')
  })

  it('says when the server cannot be reached', async () => {
    await mount({ connected: false, error: 'getaddrinfo ENOTFOUND umbrel.local' })
    expect(container.textContent).toContain('Can’t reach umbrel.local:50001. Retrying…')
  })

  it('opens on the server in use', async () => {
    await mount()
    await click(button('Change'))
    expect(radio('electrum-server', 'custom').checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('#electrum-host')?.value).toBe('umbrel.local')
    expect(container.querySelector<HTMLInputElement>('#electrum-port')?.value).toBe('50001')
    expect(radio('electrum-protocol', 'tcp').checked).toBe(true)
  })

  it('recognises a public server as its preset', async () => {
    await mount({ host: 'electrum.blockstream.info', port: 50002, protocol: 'ssl' })
    await click(button('Change'))
    expect(radio('electrum-server', 'blockstream').checked).toBe(true)
    expect(container.querySelector('#electrum-host')).toBeNull()
  })

  it('keeps Tor on when a preset is picked, and saves through one Connect', async () => {
    const next = { host: 'electrum.mempool.space', port: 50002, protocol: 'ssl' as const, tor: true }
    reconnect.mockResolvedValue({ ...next, connected: true, torAvailable: true, error: null })
    await mount({ tor: true })
    await click(button('Change'))
    await click(radio('electrum-server', 'mempool'))
    await click(button('Connect'))
    expect(reconnect).toHaveBeenCalledWith(next)
    expect(setData).toHaveBeenCalledWith(undefined, expect.objectContaining({ host: 'electrum.mempool.space' }))
    expect(button('Change')).toBeDefined()
  })

  it('stays open with the reason when the server does not answer', async () => {
    reconnect.mockRejectedValue(new Error('connect ECONNREFUSED 192.168.1.20:50001'))
    await mount()
    await click(button('Change'))
    await type('#electrum-host', '192.168.1.20')
    await click(button('Connect'))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t connect. connect ECONNREFUSED 192.168.1.20:50001',
    )
    expect(setData).not.toHaveBeenCalled()
    expect(container.querySelector('#electrum-editor')).not.toBeNull()
  })

  it('asks for Tor before connecting to an onion address', async () => {
    await mount()
    await click(button('Change'))
    await type('#electrum-host', 'abcdef.onion')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Onion addresses can only be reached through Tor.',
    )
    expect(button('Connect').disabled).toBe(true)
    await click(container.querySelector<HTMLInputElement>('#electrum-tor')!)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(button('Connect').disabled).toBe(false)
  })

  it('rejects a port outside 1–65535', async () => {
    await mount()
    await click(button('Change'))
    await type('#electrum-port', '70000')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter a port between 1 and 65535.')
    expect(button('Connect').disabled).toBe(true)
  })

  it('offers Tor only where this build has it', async () => {
    await mount({ torAvailable: false })
    await click(button('Change'))
    expect(container.querySelector<HTMLInputElement>('#electrum-tor')?.disabled).toBe(true)
    expect(container.textContent).toContain('Tor is only available in the desktop app.')
  })
})

describe('formatServer', () => {
  it('brackets IPv6 hosts', () => {
    expect(formatServer({ host: 'umbrel.local', port: 50001 })).toBe('umbrel.local:50001')
    expect(formatServer({ host: 'fd00::1', port: 50001 })).toBe('[fd00::1]:50001')
  })
})
