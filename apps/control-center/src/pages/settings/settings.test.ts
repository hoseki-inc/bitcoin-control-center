// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import superjson from 'superjson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BitcoinAmount } from '../../components/bitcoin-amount'
import { SettingsPage } from './index'

vi.mock('../../mode', () => ({ isDesktop: false }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The wallpaper picker renders WebGL previews and reads the chain tip; it is covered separately.
vi.mock('./wallpaper-settings', () => ({ WallpaperSettings: () => null }))

let root: Root
let container: HTMLDivElement
let client: QueryClient
let savedUnit: string
let failSave: boolean

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
}

async function mount(): Promise<void> {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          ChakraProvider,
          null,
          createElement(SettingsPage),
          createElement('div', { id: 'live-balance' }, createElement(BitcoinAmount, { btc: '2.1' })),
        ),
      ),
    )
  })
  await settle()
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
  savedUnit = 'btc'
  failSave = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        if (failSave) return { ok: false }
        const { value } = superjson.deserialize<{ value: string }>(JSON.parse(options.body as string))
        savedUnit = value
        return { ok: true }
      }
      const key = superjson.deserialize<{ key: string }>(
        JSON.parse(new URL(url, 'http://localhost').searchParams.get('input')!),
      ).key
      return {
        ok: true,
        json: async () => ({ result: { data: superjson.serialize(key === 'bitcoin_display_unit' ? savedUnit : '') } }),
      }
    }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})

describe('Bitcoin display settings', () => {
  it.each([
    ['sats', '210,000,000 sats'],
    ['symbol', '₿ 210,000,000'],
  ])('persists %s across a fresh query cache and updates live balances', async (unit, expected) => {
    await mount()
    expect(container.textContent).toContain('₿ 210,000,000')
    expect(container.textContent).toContain('210,000,000 sats')
    expect(container.querySelector('#live-balance')?.textContent).toBe('2.1 BTC')
    await act(async () => (container.querySelector(`input[value="${unit}"]`) as HTMLInputElement).click())
    await settle()
    expect(savedUnit).toBe(unit)
    expect(container.querySelector('#live-balance')?.textContent).toBe(expected)
    await act(async () => root.unmount())
    client.clear()
    root = createRoot(container)
    await mount()
    expect((container.querySelector(`input[value="${unit}"]`) as HTMLInputElement).checked).toBe(true)
    expect(container.querySelector('#live-balance')?.textContent).toBe(expected)
  })

  it('keeps the saved selection and reports a failed save', async () => {
    const { toast } = await import('sonner')
    await mount()
    failSave = true
    await act(async () => (container.querySelector('input[value="symbol"]') as HTMLInputElement).click())
    await settle()
    expect(savedUnit).toBe('btc')
    expect((container.querySelector('input[value="btc"]') as HTMLInputElement).checked).toBe(true)
    expect(toast.error).toHaveBeenCalledWith('Could not save your display preference. Please try again.')
  })
})
