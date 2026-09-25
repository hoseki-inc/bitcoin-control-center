// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import superjson from 'superjson'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { SettingsPage } from './index'

let root: Root
let container: HTMLDivElement
let client: QueryClient
let savedUnit: string
let failSave: boolean

const fetchMock = vi.fn<typeof fetch>()
const updateBody = z.object({ json: z.object({ value: z.string() }) })
const getInput = z.object({ json: z.object({ key: z.string() }) })

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 40)
    })
  })
}

async function mount(): Promise<void> {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() },
  })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          ChakraProvider,
          null,
          createElement(SettingsPage, { desktop: false }),
          createElement('div', { id: 'live-balance' }, createElement(BitcoinAmount, { btc: '2.1' })),
        ),
      ),
    )
  })
  await settle()
}

/** Serves the settings endpoints as the local Sentinel service would, persisting the display unit. */
async function serveSettings(input: string | URL | Request, options?: RequestInit): Promise<Response> {
  if (options?.method === 'POST') {
    if (failSave) {
      return new Response(null, { status: 500 })
    }
    const body = parseUnknown(z.string(), options.body).expect('Expected a settings update body')
    savedUnit = parseUnknown(updateBody, JSON.parse(body)).expect('Expected a settings update').json.value
    return new Response(null, { status: 200 })
  }
  const url = new URL(parseUnknown(z.string(), input).expect('Expected a settings URL'), 'http://localhost')
  const query = parseUnknown(z.string(), url.searchParams.get('input')).expect('Expected a settings query')
  const { key } = parseUnknown(getInput, JSON.parse(query)).expect('Expected a settings key').json
  return Response.json({ result: { data: superjson.serialize(key === 'bitcoin_display_unit' ? savedUnit : '') } })
}

function radio(unit: string): HTMLInputElement {
  const input = container.querySelector(`input[value="${unit}"]`)
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`Missing ${unit} option`)
  }
  return input
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  }))
  vi.spyOn(toast, 'error').mockReturnValue('test-toast')
  vi.spyOn(toast, 'success').mockReturnValue('test-toast')
  savedUnit = 'btc'
  failSave = false
  vi.stubGlobal('fetch', fetchMock.mockReset().mockImplementation(serveSettings))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

describe('Bitcoin display settings', () => {
  it.each([
    ['sats', '210,000,000 sats'],
    ['symbol', '₿ 210,000,000'],
  ])('persists %s across a fresh query cache and updates live balances', async (unit, expected) => {
    await withTestSetup(async () => {
      await mount()
      expect(container.textContent).toContain('₿ 210,000,000')
      expect(container.textContent).toContain('210,000,000 sats')
      expect(container.querySelector('#live-balance')?.textContent).toBe('2.1 BTC')
      await act(async () => {
        radio(unit).click()
      })
      await settle()
      expect(savedUnit).toBe(unit)
      expect(container.querySelector('#live-balance')?.textContent).toBe(expected)
      await act(async () => {
        root.unmount()
      })
      client.clear()
      root = createRoot(container)
      await mount()
      expect(radio(unit).checked).toBe(true)
      expect(container.querySelector('#live-balance')?.textContent).toBe(expected)
    })
  })

  it('keeps the saved selection and reports a failed save', async () => {
    await withTestSetup(async () => {
      await mount()
      failSave = true
      await act(async () => {
        radio('symbol').click()
      })
      await settle()
      expect(savedUnit).toBe('btc')
      expect(radio('btc').checked).toBe(true)
      expect(toast.error).toHaveBeenCalledWith('Could not save your display preference. Please try again.')
    })
  })
})
