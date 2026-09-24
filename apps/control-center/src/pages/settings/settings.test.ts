// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import superjson, { type SuperJSONResult } from 'superjson'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { SettingsPage } from './index'

vi.mock('../../mode', () => ({ isDesktop: false }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The wallpaper picker renders WebGL previews and reads the chain tip; it is covered separately.
vi.mock('./wallpaper-settings', () => ({ WallpaperRow: () => null }))

/** The SuperJSON input of a tRPC GET, as the app sent it. */
function parseInput(url: string): SuperJSONResult {
  const input = new URL(url, 'http://localhost').searchParams.get('input')
  assert(input !== null, 'Expected a tRPC input')
  const parsed: unknown = JSON.parse(input)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The app serialised this with SuperJSON.
  return parsed as SuperJSONResult
}

let root: Root
let container: HTMLDivElement
let client: QueryClient
let savedUnit: string
let failSave: boolean

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
          createElement(MemoryRouter, null, createElement(SettingsPage)),
          createElement('div', { id: 'live-balance' }, createElement(BitcoinAmount, { btc: '2.1' })),
        ),
      ),
    )
  })
  await settle()
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown, so it runs once even after a failure or timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.unstubAllGlobals()
  })

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  savedUnit = 'btc'
  failSave = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        if (failSave) {
          return { ok: false }
        }
        assert(typeof options.body === 'string', 'Expected a JSON body')
        const body: unknown = JSON.parse(options.body)
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The app posts SuperJSON; this fake backend reads the value back.
        const { value } = superjson.deserialize<{ value: string }>(body as SuperJSONResult)
        savedUnit = value
        return { ok: true }
      }
      const key = superjson.deserialize<{ key: string }>(parseInput(url)).key
      return {
        ok: true,
        json: async () => ({ result: { data: superjson.serialize(key === 'bitcoin_display_unit' ? savedUnit : '') } }),
      }
    }),
  )
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
        expectElement(container.querySelector(`input[value="${unit}"]`), HTMLInputElement).click()
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
      expect(expectElement(container.querySelector(`input[value="${unit}"]`), HTMLInputElement).checked).toBe(true)
      expect(container.querySelector('#live-balance')?.textContent).toBe(expected)
    })
  })

  it('keeps the saved selection and reports a failed save', async () => {
    await withTestSetup(async () => {
      const { toast } = await import('sonner')
      await mount()
      failSave = true
      await act(async () => {
        expectElement(container.querySelector('input[value="symbol"]'), HTMLInputElement).click()
      })
      await settle()
      expect(savedUnit).toBe('btc')
      expect(expectElement(container.querySelector('input[value="btc"]'), HTMLInputElement).checked).toBe(true)
      expect(toast.error).toHaveBeenCalledWith('Could not save your display preference. Please try again.')
    })
  })
})
