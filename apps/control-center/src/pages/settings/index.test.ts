// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { type RouterOutput, trpc } from '../../trpc'
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

const savedConnection = {
  id: '00000000-0000-4000-8000-000000000001',
  nickname: 'Home node',
  host: 'electrum.example',
  port: 50002,
  protocol: 'ssl',
  torEnabled: false,
  revision: 1,
}

/** Answers the saved-connection list, which the Electrum form loads before it is shown. */
function savedConnections(input: RequestInfo | URL): Response | null {
  return parseUnknown(z.string(), input).unwrapOr('').includes('/settings.connectionProfiles.list')
    ? Response.json({
        result: { data: { json: { profiles: [savedConnection], activeId: savedConnection.id, limit: 5 } } },
      })
    : null
}

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
        : (savedConnections(input) ?? Response.json({ result: { data: { json: null } } })),
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
    // The form appears once the saved connections load.
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('#connection-host')).not.toBeNull()
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
type StatusPrice = PriceStatus['price']

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
const price = (source: PriceSourceOptions['selected'], lastKnown = false): StatusPrice => ({
  source,
  asOf: '2026-09-29T17:00:00.000Z',
  lastKnown,
})

const ChangeSchema = z.object({
  json: z.object({
    source: z.enum(['mempool', 'block', 'mempool.space', 'coinbase', 'coingecko']).optional(),
    fallbacks: z.boolean().optional(),
  }),
})

/**
 * A fake Sentinel for the price settings. The status describes the saved settings and the price
 * found under them; `status` overrides it to serve one that describes another choice.
 */
class PriceServer {
  public options: PriceSourceOptions
  public price: StatusPrice
  public status: PriceStatus | null = null
  public readonly saved: unknown[] = []
  public statusRequests = 0
  /** The price found after saving each value. */
  public readonly afterSave = new Map<string, StatusPrice>()
  public statusReply: 'answer' | 'hold' | 'fail' = 'answer'
  public failSave = false
  public saveReply: 'answer' | 'hold' = 'answer'
  public optionsRequests = 0
  private readonly held: Array<() => void> = []
  private readonly heldSaves: Array<() => void> = []

  public constructor(options: PriceSourceOptions = priceOptions, initialPrice: StatusPrice = price('block')) {
    this.options = options
    this.price = initialPrice
    fetchMock.mockImplementation(async (input, init) => {
      const url = parseUnknown(z.string(), input).unwrapOr('')
      if (url.includes('/settings.priceSource')) {
        this.optionsRequests += 1
        return Response.json({ result: { data: { json: this.options } } })
      }
      if (url.includes('/settings.priceStatus')) {
        this.statusRequests += 1
        return this.answerStatus()
      }
      if (url.endsWith('/settings.setPriceSettings')) {
        if (this.saveReply === 'hold') {
          await new Promise<void>((resolve) => {
            this.heldSaves.push(resolve)
          })
        }
        const change = parseUnknown(ChangeSchema, JSON.parse(parseUnknown(z.string(), init?.body).unwrapOr('null')))
        this.saved.push(change.expect('saved setting'))
        if (this.failSave) {
          return Response.json(
            { error: { json: { message: 'Sentinel is restarting', code: -32603 } } },
            { status: 500 },
          )
        }
        const { source, fallbacks } = change.expect('saved setting').json
        this.options = {
          ...this.options,
          selected: source ?? this.options.selected,
          fallbacks: fallbacks ?? this.options.fallbacks,
        }
        this.price = this.afterSave.get(String(source ?? fallbacks)) ?? this.price
        return Response.json({ result: { data: { json: this.options } } })
      }
      return Response.json({ result: { data: { json: null } } })
    })
  }

  public heldSaveCount(): number {
    return this.heldSaves.length
  }

  /** Lets held save requests reach the server. */
  public releaseSaves(): void {
    this.saveReply = 'answer'
    for (const release of this.heldSaves.splice(0)) {
      release()
    }
  }

  /** Releases held status requests with the current status. */
  public releaseStatus(): void {
    this.statusReply = 'answer'
    for (const release of this.held.splice(0)) {
      release()
    }
  }

  private async answerStatus(): Promise<Response> {
    if (this.statusReply === 'fail') {
      return Response.json({ error: { json: { message: 'Sentinel is restarting', code: -32603 } } }, { status: 500 })
    }
    if (this.statusReply === 'hold') {
      await new Promise<void>((resolve) => {
        this.held.push(resolve)
      })
    }
    const reply = this.status ?? {
      selected: this.options.selected,
      fallbacks: this.options.fallbacks,
      price: this.price,
    }
    return Response.json({ result: { data: { json: reply } } })
  }
}

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
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(priceOptions.sources.map((s) => s.label))
  })
  return select
}

function fallbackCheckbox(): HTMLInputElement {
  const checkbox = container.querySelector<HTMLInputElement>('#price-fallbacks')
  if (!checkbox) {
    throw new Error('Missing fallback checkbox')
  }
  return checkbox
}

async function pick(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Waits until no request is running and the page has rendered the result. */
async function idle(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(queryClient.isFetching()).toBe(0)
    expect(container.querySelector('#price-source')?.closest('[aria-busy="true"]')).toBeNull()
  })
  // React Query tells the page about a finished request on a later task.
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await pick(select, value)
  await idle()
  expect(select.value).toBe(value)
}

/** Ends any held status request, so a save finishes before the test tears down the page. */
async function finishSaves(server: PriceServer): Promise<void> {
  server.releaseStatus()
  await idle()
}

it('lists the price sources and saves a new choice', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    expect(select.value).toBe('block')
    expect(container.textContent).toContain('If your primary price source is unavailable, use the next best source.')

    await choose(select, 'coinbase')
    expect(server.saved).toEqual([{ json: { source: 'coinbase' } }])
    expect(toast.error).not.toHaveBeenCalled()
  })
})

it('saves the fallback choice', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    await renderPriceSettings()
    expect(fallbackCheckbox().checked).toBe(true)
    await act(async () => {
      fallbackCheckbox().click()
    })
    await idle()
    expect(server.saved).toEqual([{ json: { fallbacks: false } }])
    expect(fallbackCheckbox().checked).toBe(false)
  })
})

it('restores the previous choice when saving fails', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.failSave = true
    const select = await renderPriceSettings()
    await pick(select, 'coinbase')
    await idle()
    expect(select.value).toBe('block')
    expect(toast.error).toHaveBeenCalledWith('Could not save the price source. Please try again.')
    expect(container.textContent).not.toContain('Price settings saved')
  })
})

it('shows a status that arrives after the options', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, price('coinbase'))
    server.statusReply = 'hold'
    await renderPriceSettings()
    await act(async () => {})
    expect(container.textContent).not.toContain('Using Coinbase')

    await act(async () => {
      server.releaseStatus()
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
  })
})

it.each([
  ['a fallback supplied the price', price('coinbase'), 'Using Coinbase while Block is unavailable.'],
  [
    'only the last known price is available',
    price('block', true),
    'No price source is available right now. Showing the last known price.',
  ],
  ['no source supplied a price', null, 'No price is available right now.'],
] as const)('shows when %s', async (_label, statusPrice, message) => {
  await withTestSetup(async () => {
    new PriceServer(priceOptions, statusPrice)
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain(message)
    })
  })
})

it('updates the status when a background refresh changes it', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, null)
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('No price is available right now.')
    })

    server.price = price('coinbase')
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['price-status'] })
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    expect(container.textContent).not.toContain('No price is available right now.')
  })
})

it('keeps showing the status while it refreshes in the background', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, price('block', true))
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Showing the last known price.')
    })
    server.statusReply = 'hold'
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ['price-status'] })
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(queryClient.isFetching({ queryKey: ['price-status'] })).toBe(1)
    })
    expect(container.textContent).toContain('Showing the last known price.')
    server.releaseStatus()
  })
})

it.each([
  ['source', { selected: 'coinbase', fallbacks: true }],
  ['fallback setting', { selected: 'block', fallbacks: false }],
] as const)('hides a status that describes a different %s', async (_label, choice) => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.status = { ...choice, price: price('mempool.space') }
    await renderPriceSettings()
    await act(async () => {})
    expect(queryClient.getQueryState(['price-status'])?.status).toBe('success')
    expect(container.textContent).not.toContain('Using mempool.space')
    expect(container.textContent).not.toContain('No price')
  })
})

it('hides the status when a background refresh fails', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, price('coinbase'))
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    server.statusReply = 'fail'
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['price-status'] })
    })
    await idle()
    expect(container.textContent).not.toContain('Using Coinbase')
    expect(container.textContent).toContain('Could not check the price source.')
  })
})

it('confirms a new source once it supplies the price', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coinbase', price('coinbase'))
    const select = await renderPriceSettings()
    await choose(select, 'coinbase')
    expect(container.textContent).not.toContain('unavailable.')
    expect(container.textContent).not.toContain('No price')
    expect(container.textContent).toContain('Price settings saved')
  })
})

it.each([
  ['a fallback supplied the price', price('block'), 'Using Block while CoinGecko is unavailable.'],
  ['only the last known price is available', price('coingecko', true), 'Showing the last known price.'],
] as const)('does not confirm a new source when %s', async (_label, afterPrice, message) => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coingecko', afterPrice)
    const select = await renderPriceSettings()
    await choose(select, 'coingecko')
    expect(container.textContent).toContain(message)
    expect(container.textContent).not.toContain('Price settings saved')
  })
})

it('does not confirm a new source when checking its price fails', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(['price-status'])?.status).toBe('success')
    })
    server.statusReply = 'fail'
    await choose(select, 'coinbase')
    expect(container.textContent).not.toContain('Price settings saved')
    expect(container.textContent).toContain('Could not check the price source.')
  })
})

it('does not keep a fallback message after fallbacks are turned off and the check fails', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, price('coinbase'))
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    server.statusReply = 'fail'
    await act(async () => {
      fallbackCheckbox().click()
    })
    await idle()
    expect(container.textContent).not.toContain('Using Coinbase while Block is unavailable.')
    expect(container.textContent).toContain('Could not check the price source.')
  })
})

it('checks the new choice with a new request when saved during the first check', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.statusReply = 'hold'
    server.afterSave.set('coinbase', price('coinbase'))
    const select = await renderPriceSettings()
    await vi.waitFor(() => {
      expect(server.statusRequests).toBe(1)
    })

    await pick(select, 'coinbase')
    await vi.waitFor(() => {
      expect(server.saved).toHaveLength(1)
    })
    await finishSaves(server)
    expect(server.statusRequests).toBe(2)
    expect(container.textContent).toContain('Price settings saved')
  })
})

it('keeps the controls usable and focused, and saves changes made while a save is checking', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coingecko', price('coingecko'))
    const select = await renderPriceSettings()
    await idle()
    server.statusReply = 'hold'
    select.focus()
    await pick(select, 'coinbase')
    await vi.waitFor(() => {
      expect(server.statusRequests).toBe(2)
    })

    expect(select.disabled).toBe(false)
    expect(document.activeElement).toBe(select)
    expect(container.textContent).toContain('Checking the price source')
    await pick(select, 'coingecko')
    await act(async () => {
      fallbackCheckbox().click()
    })
    expect(select.value).toBe('coingecko')
    expect(fallbackCheckbox().checked).toBe(false)
    await vi.waitFor(() => {
      expect(server.options).toMatchObject({ selected: 'coingecko', fallbacks: false })
      expect(server.statusRequests).toBeGreaterThan(2)
    })
    // The superseded check has ended, but the latest one is still running.
    await act(async () => {})
    expect(container.textContent).toContain('Checking the price source')

    await finishSaves(server)
    expect(server.saved[0]).toEqual({ json: { source: 'coinbase' } })
    expect(select.value).toBe('coingecko')
    expect(fallbackCheckbox().checked).toBe(false)
    expect(container.textContent).toContain('Price settings saved')
  })
})

it('saves only the last of several quick changes, as when choosing with the arrow keys', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    await idle()
    await act(async () => {
      for (const value of ['mempool.space', 'coinbase', 'coingecko']) {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await idle()
    expect(server.saved).toEqual([{ json: { source: 'coingecko' } }])
    expect(select.value).toBe('coingecko')
  })
})

it.each([
  ['a new source', async (select: HTMLSelectElement) => choose(select, 'coinbase')],
  [
    'turning fallbacks off',
    async () => {
      await act(async () => {
        fallbackCheckbox().click()
      })
      await idle()
    },
  ],
])('refreshes the USD values and forgets the old price after %s', async (_label, makeChange) => {
  await withTestSetup(async () => {
    new PriceServer()
    const refreshed = getQueryKey(trpc.portalProve.controlCenter.getData)
    // A failed request for the current price must not leave a price from a source no longer allowed.
    const forgotten = [
      getQueryKey(trpc.portalProve.retrieveBitcoinPrice),
      getQueryKey(trpc.portalProve.retrieveBitcoinPriceHistory),
      getQueryKey(trpc.portalProve.onchain.bitcoinAccountBalances),
    ]
    for (const queryKey of [refreshed, ...forgotten]) {
      queryClient.setQueryData(queryKey, 'cached')
    }
    const select = await renderPriceSettings()
    await makeChange(select)
    expect(queryClient.getQueryState(refreshed)?.isInvalidated).toBe(true)
    for (const queryKey of forgotten) {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()
    }
  })
})

it('does not hold up another attempt while a failed save reconciles', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    await idle()
    server.failSave = true
    server.statusReply = 'hold'
    await pick(select, 'coinbase')
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not save the price source. Please try again.')
      expect(container.querySelector('#price-source')?.closest('[aria-busy="true"]')).toBeNull()
    })
    expect(select.value).toBe('block')
    await finishSaves(server)
  })
})

it('does not show an earlier status while a change back to the same choice is checked', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer(priceOptions, price('coinbase'))
    await renderPriceSettings()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
    })
    server.statusReply = 'hold'
    await act(async () => {
      fallbackCheckbox().click()
    })
    await act(async () => {
      fallbackCheckbox().click()
    })
    expect(fallbackCheckbox().checked).toBe(true)
    expect(container.textContent).not.toContain('Using Coinbase while Block is unavailable.')
    await finishSaves(server)
    expect(container.textContent).toContain('Using Coinbase while Block is unavailable.')
  })
})

it('does not read the settings again while a save is running', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.saveReply = 'hold'
    const select = await renderPriceSettings()
    await idle()
    const before = server.optionsRequests
    await pick(select, 'coinbase')
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['price-source'] })
    })
    expect(server.optionsRequests).toBe(before)
    server.releaseSaves()
    await idle()
    expect(select.value).toBe('coinbase')
  })
})

it('keeps a successful save when an older options refresh finishes afterward', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coinbase', price('coinbase'))
    const select = await renderPriceSettings()
    await idle()
    const implementation = fetchMock.getMockImplementation()
    if (!implementation) {
      throw new Error('Missing price server')
    }
    let release = (): void => undefined
    let captured = false
    fetchMock.mockImplementation(async (input, init) => {
      const response = await implementation(input, init)
      if (parseUnknown(z.string(), input).unwrapOr('').includes('/settings.priceSource') && !captured) {
        captured = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return response
    })
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: ['price-source'] })
    })
    await vi.waitFor(() => {
      expect(captured).toBe(true)
    })
    await choose(select, 'coinbase')
    await act(async () => {
      release()
      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
    })
    expect(select.value).toBe('coinbase')
    expect(server.options.selected).toBe('coinbase')
    expect(container.textContent).toContain('Price settings saved')
  })
})

it('reconciles a committed setting after its save response is lost', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coinbase', price('coinbase'))
    const select = await renderPriceSettings()
    await idle()
    const implementation = fetchMock.getMockImplementation()
    if (!implementation) {
      throw new Error('Missing price server')
    }
    fetchMock.mockImplementation(async (input, init) => {
      const response = await implementation(input, init)
      if (parseUnknown(z.string(), input).unwrapOr('').endsWith('/settings.setPriceSettings')) {
        throw new TypeError('Save response lost')
      }
      return response
    })
    await pick(select, 'coinbase')
    await idle()
    expect(toast.error).toHaveBeenCalledWith('Could not save the price source. Please try again.')
    expect(server.options.selected).toBe('coinbase')
    expect(select.value).toBe('coinbase')
    expect(container.textContent).not.toContain('Price settings saved')
  })
})

it('shows changes made during a save at once and sends them together when it finishes', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.saveReply = 'hold'
    const select = await renderPriceSettings()
    await idle()
    await pick(select, 'coinbase')
    await vi.waitFor(() => {
      expect(server.heldSaveCount()).toBe(1)
    })
    await pick(select, 'coingecko')
    await act(async () => {
      fallbackCheckbox().click()
    })
    expect(select.value).toBe('coingecko')
    expect(fallbackCheckbox().checked).toBe(false)
    expect(server.heldSaveCount()).toBe(1)

    server.releaseSaves()
    await idle()
    expect(server.saved).toEqual([
      { json: { source: 'coinbase' } },
      { json: { source: 'coingecko', fallbacks: false } },
    ])
    expect(select.value).toBe('coingecko')
    expect(fallbackCheckbox().checked).toBe(false)
  })
})

it('drops changes queued behind a save that fails', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.saveReply = 'hold'
    server.failSave = true
    const select = await renderPriceSettings()
    await idle()
    await pick(select, 'coinbase')
    await vi.waitFor(() => {
      expect(server.heldSaveCount()).toBe(1)
    })
    await pick(select, 'coingecko')
    server.releaseSaves()
    await idle()
    expect(server.saved).toEqual([{ json: { source: 'coinbase' } }])
    expect(select.value).toBe('block')
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

it('follows the saved settings again after a save', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    const select = await renderPriceSettings()
    await choose(select, 'coinbase')
    server.options = { ...server.options, selected: 'coingecko' }
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['price-source'] })
    })
    await idle()
    expect(select.value).toBe('coingecko')
  })
})

it('clears the confirmation when another change is made', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.afterSave.set('coinbase', price('coinbase'))
    const select = await renderPriceSettings()
    await choose(select, 'coinbase')
    expect(container.textContent).toContain('Price settings saved')
    server.statusReply = 'fail'
    await choose(select, 'coingecko')
    expect(container.textContent).not.toContain('Price settings saved')
  })
})

it('says when the fallback setting could not be saved', async () => {
  await withTestSetup(async () => {
    const server = new PriceServer()
    server.failSave = true
    await renderPriceSettings()
    await act(async () => {
      fallbackCheckbox().click()
    })
    await idle()
    expect(toast.error).toHaveBeenCalledWith('Could not save the fallback setting. Please try again.')
    expect(fallbackCheckbox().checked).toBe(true)
  })
})
