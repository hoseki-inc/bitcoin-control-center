// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import type { RouterOutput } from '../../trpc'
import { SettingsPage } from './index'

const browser = await vi.hoisted(async () => {
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

let queryClient: QueryClient
let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>()

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  for (const key of ['user_name', 'electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled']) {
    queryClient.setQueryData(['local-settings', key], null)
  }
  vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  vi.spyOn(toast, 'success').mockReturnValue('test-toast')
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock.mockReset())
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

it.each([
  ['SuperJSON error', { error: { json: { message: 'Server unavailable' } } }, 'Server unavailable'],
  ['plain error', { error: { message: 'Connection refused' } }, 'Connection refused'],
  ['both formats', { error: { json: { message: 'Preferred' }, message: 'Other' } }, 'Preferred'],
  ['empty message', { error: { json: { message: '' } } }, ''],
  ['invalid nested message', { error: { json: { message: 123 }, message: 'Plain fallback' } }, 'Plain fallback'],
  ['invalid nested error', { error: { json: null, message: 'Plain fallback' } }, 'Plain fallback'],
  ['non-string messages', { error: { json: { message: {} }, message: false } }, 'Failed to reconnect'],
  ['missing error', {}, 'Failed to reconnect'],
  ['null response', null, 'Failed to reconnect'],
  ['invalid JSON', '<html>Unavailable</html>', 'Failed to reconnect'],
])('handles a reconnect response with %s', async (_label, body, message) => {
  await withTestSetup(async () => {
    fetchMock.mockImplementation(async (input) => {
      if (parseUnknown(z.string(), input).unwrapOr('').endsWith('/settings.reconnectElectrum')) {
        return new Response(
          parseUnknown(z.string(), body).unwrapOrElse(() => JSON.stringify(body)),
          { status: 500 },
        )
      }
      return Response.json({ result: { data: { json: null } } })
    })
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage, { desktop: true })),
        ),
      )
    })
    const preset = container.querySelector<HTMLSelectElement>('#electrum-preset')
    if (!preset) {
      throw new Error('Missing server preset')
    }
    await act(async () => {
      preset.value = 'electrum.blockstream.info'
      preset.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save & Reconnect',
    )
    if (!saveButton) {
      throw new Error('Missing reconnect button')
    }
    expect(saveButton.disabled).toBe(false)
    await act(async () => {
      saveButton.click()
      await vi.waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(`Failed to connect: ${message}`)
      })
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(saveButton.disabled).toBe(false)
  })
})

it.each([
  ['SuperJSON error', { error: { json: { message: 'Server unavailable' } } }, 'Server unavailable'],
  ['plain error', { error: { message: 'Connection refused' } }, 'Connection refused'],
  ['invalid nested error', { error: { json: null, message: 'Plain fallback' } }, 'Plain fallback'],
  ['non-string message', { error: { message: {} } }, 'Connection failed'],
  ['null response', null, 'Connection failed'],
  ['invalid JSON', '<html>Unavailable</html>', 'Connection failed'],
])('handles a connection-test response with %s', async (_label, body, message) => {
  await withTestSetup(async () => {
    fetchMock.mockImplementation(async (input) => {
      if (parseUnknown(z.string(), input).unwrapOr('').endsWith('/settings.testElectrum')) {
        return new Response(
          parseUnknown(z.string(), body).unwrapOrElse(() => JSON.stringify(body)),
          { status: 500 },
        )
      }
      return Response.json({ result: { data: { json: null } } })
    })
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage, { desktop: true })),
        ),
      )
    })
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Test Connection',
    )
    if (!button) {
      throw new Error('Missing connection test button')
    }
    await act(async () => {
      button.click()
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.textContent).toContain(message)
    })
    expect(button.disabled).toBe(false)
  })
})

const status = { connected: true, host: 'electrum.example', port: 50002, protocol: 'ssl' }
it.each([
  ['SuperJSON', { result: { data: { json: status } } }, true],
  ['plain JSON', { result: { data: status } }, true],
  ['null wrapper fallback', { result: { data: { ...status, json: null } } }, true],
  ['missing protocol', { result: { data: { host: 'electrum.example' } } }, false],
  ['invalid protocol', { result: { data: { ...status, protocol: 1 } } }, false],
  ['invalid connection flag', { result: { data: { ...status, connected: 'false' } } }, false],
  ['null response', null, false],
])('validates the %s Electrum status response', async (_label, body, visible) => {
  await withTestSetup(async () => {
    fetchMock.mockImplementation(async (input) =>
      parseUnknown(z.string(), input).unwrapOr('').endsWith('/settings.electrumStatus')
        ? Response.json(body)
        : Response.json({ result: { data: { json: null } } }),
    )
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage, { desktop: true })),
        ),
      )
    })
    if (visible) {
      expect(container.textContent).toContain('electrum.example:50002 (SSL)')
      expect(container.textContent).toContain('Connected')
    } else {
      expect(container.textContent).not.toContain('electrum.example')
    }
  })
})

type PriceSourceOptions = RouterOutput['settings']['priceSource']
type PriceStatus = RouterOutput['settings']['priceStatus']

const priceOptions: PriceSourceOptions = {
  selected: 'block',
  fallbacks: true,
  sources: [
    { name: 'block', label: 'Block' },
    { name: 'mempool.space', label: 'mempool.space' },
    { name: 'coinbase', label: 'Coinbase' },
    { name: 'coingecko', label: 'CoinGecko' },
  ],
}
const blockStatus: PriceStatus = {
  selected: 'block',
  price: { source: 'block', asOf: '2026-09-29T17:00:00.000Z', lastKnown: false },
}

/** A fake Sentinel for the price settings: answers both queries and applies saved settings. */
class PriceServer {
  public options: PriceSourceOptions
  public status: PriceStatus
  public readonly saved: unknown[] = []
  /** Status the server reports after each save, keyed by the saved value. */
  public readonly afterSave = new Map<string, PriceStatus>()
  /** A status request that never answers, like a lookup waiting on the network. */
  public holdStatus = false

  public constructor(options: PriceSourceOptions = priceOptions, initialStatus: PriceStatus = blockStatus) {
    this.options = options
    this.status = initialStatus
    fetchMock.mockImplementation(async (input, init) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      if (url.includes('/settings.priceSource')) {
        return Response.json({ result: { data: { json: this.options } } })
      }
      if (url.includes('/settings.priceStatus')) {
        if (this.holdStatus) {
          return new Promise<Response>(() => undefined)
        }
        return Response.json({ result: { data: { json: this.status } } })
      }
      if (url.endsWith('/settings.update')) {
        const body = parseUnknown(
          z.object({ json: z.object({ key: z.string(), value: z.string() }) }),
          JSON.parse(parseUnknown(z.string(), init?.body).unwrapOr('null')),
        ).expect('saved setting')
        this.saved.push(body)
        const { key, value } = body.json
        if (key === 'price_source') {
          this.options = { ...this.options, selected: parseUnknown(PriceSourceNameSchema, value).expect('source') }
        } else {
          this.options = { ...this.options, fallbacks: value === 'true' }
        }
        this.status = this.afterSave.get(value) ?? this.status
      }
      return Response.json({ result: { data: { json: null } } })
    })
  }
}

const PriceSourceNameSchema = z.enum(['mempool', 'block', 'mempool.space', 'coinbase', 'coingecko'])

async function renderPriceSettings(): Promise<HTMLSelectElement> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage, { desktop: false })),
      ),
    )
  })
  const select = container.querySelector<HTMLSelectElement>('#price-source')
  if (!select) {
    throw new Error('Missing price source')
  }
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(Array.from(select.options, (option) => option.textContent)).toEqual([
      'Block',
      'mempool.space',
      'Coinbase',
      'CoinGecko',
    ])
  })
  return select
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(select.value).toBe(value)
    expect(queryClient.isFetching()).toBe(0)
  })
}

it('lists the price sources and saves a new choice', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    expect(select.value).toBe('block')
    expect(container.textContent).toContain('If your primary price source is unavailable, use the next best source.')

    await choose(select, 'coinbase')
    expect(server.saved).toEqual([{ json: { key: 'price_source', value: 'coinbase' } }])
    expect(toast.error).not.toHaveBeenCalled()
  })
})

it('lets you change the source while the price lookup is still waiting', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.holdStatus = true
    const select = await renderPriceSettings()
    expect(select.disabled).toBe(false)
    await act(async () => {
      select.value = 'coinbase'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await vi.waitFor(() => {
      expect(server.saved).toEqual([{ json: { key: 'price_source', value: 'coinbase' } }])
    })
  })
})

it('saves the fallback choice', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    await renderPriceSettings()
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (!checkbox) {
      throw new Error('Missing fallback checkbox')
    }
    expect(checkbox.checked).toBe(true)

    await act(async () => {
      checkbox.click()
    })
    await vi.waitFor(() => {
      expect(server.saved).toEqual([{ json: { key: 'price_fallbacks_enabled', value: 'false' } }])
    })
  })
})

it('shows when a fallback source supplied the price', async () => {
  await withTestSetup(async () => {
    new PriceServer(priceOptions, {
      selected: 'block',
      price: { source: 'coinbase', asOf: '2026-09-29T17:00:00.000Z', lastKnown: false },
    })
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    expect(container.textContent).not.toContain('No price')
  })
})

it('shows when only the last known price is available', async () => {
  await withTestSetup(async () => {
    new PriceServer(priceOptions, {
      selected: 'block',
      price: { source: 'block', asOf: '2026-09-29T16:50:00.000Z', lastKnown: true },
    })
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No price source is available right now. Showing the last known price.')
    })
    expect(container.textContent).not.toContain('while Block is unavailable')
  })
})

it('shows when no source supplied a price', async () => {
  await withTestSetup(async () => {
    new PriceServer({ ...priceOptions, fallbacks: false }, { selected: 'block', price: null })
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No price is available right now.')
    })
    expect(container.textContent).not.toContain('while Block is unavailable')
  })
})

it('confirms a new source once it supplies the price', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coinbase', {
      selected: 'coinbase',
      price: { source: 'coinbase', asOf: '2026-09-29T17:01:00.000Z', lastKnown: false },
    })
    const select = await renderPriceSettings()
    await choose(select, 'coinbase')
    expect(container.textContent).not.toContain('unavailable.')
    expect(container.textContent).not.toContain('No price')
    expect(container.textContent).toContain('Price settings saved')
  })
})

it.each([
  [
    'a fallback supplied the price',
    { selected: 'coingecko', price: { source: 'block', asOf: '2026-09-29T17:00:00.000Z', lastKnown: false } },
    'Using Block while CoinGecko is unavailable.',
  ],
  [
    'only the last known price is available',
    { selected: 'coingecko', price: { source: 'coingecko', asOf: '2026-09-29T16:50:00.000Z', lastKnown: true } },
    'Showing the last known price.',
  ],
] as const)('does not confirm a new source when %s', async (_label, nextStatus, message) => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coingecko', nextStatus)
    const select = await renderPriceSettings()
    await choose(select, 'coingecko')
    expect(container.textContent).toContain(message)
    expect(container.textContent).not.toContain('Price settings saved')
  })
})

it('does not show a status from before the source changed', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, {
      selected: 'block',
      price: { source: 'coinbase', asOf: '2026-09-29T17:00:00.000Z', lastKnown: false },
    })
    const select = await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    server.holdStatus = true
    await act(async () => {
      select.value = 'mempool.space'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(select.value).toBe('mempool.space')
    })
    expect(container.textContent).not.toContain('unavailable.')
  })
})
