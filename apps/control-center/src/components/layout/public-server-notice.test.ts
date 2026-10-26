// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { PublicServerNotice } from './public-server-notice'

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

const SettingInput = z.object({ json: z.object({ key: z.string() }) })
const SettingUpdate = z.object({ json: z.object({ key: z.string(), value: z.string() }) })

/** A fake Sentinel holding saved settings. */
class SettingsServer {
  public readonly saved = new Map<string, string>()

  public constructor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(parseUnknown(z.string(), input).unwrapOr(''), 'http://sentinel.test')
      if (url.pathname.endsWith('/settings.update')) {
        const body: unknown = JSON.parse(parseUnknown(z.string(), init?.body).unwrapOr('null'))
        const update = parseUnknown(SettingUpdate, body)
        if (update.isOk()) {
          this.saved.set(update.unwrap().json.key, update.unwrap().json.value)
        }
        return Response.json({ result: { data: { json: null } } })
      }
      const key = parseUnknown(SettingInput, JSON.parse(url.searchParams.get('input') ?? '{}'))
        .map((parsed) => parsed.json.key)
        .unwrapOr('')
      return Response.json({ result: { data: { json: this.saved.get(key) ?? null } } })
    })
  }
}

interface Rendered {
  server: SettingsServer
  container: HTMLDivElement
  remount: () => Promise<void>
}

async function render(saved: Record<string, string> = {}): Promise<Rendered> {
  const dom = browser.acquire()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server = new SettingsServer(fetchMock)
  for (const [key, value] of Object.entries(saved)) {
    server.saved.set(key, value)
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  let root: Root = createRoot(container)
  const mount = async (): Promise<void> => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, null, createElement(PublicServerNotice)),
          ),
        ),
      )
    })
    // Both settings answered.
    await vi.waitFor(async () => {
      await act(async () => {})
      for (const key of ['electrum_host', 'electrum_notice_v1']) {
        const state = queryClient.getQueryState(['local-settings', key])
        expect(state?.status === 'success' && state.fetchStatus === 'idle').toBe(true)
      }
    })
    // React Query tells the notice on a timer, so let one pass before reading what it shows.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
  }
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
  await mount()
  return {
    server,
    container,
    // Mounted again, as when moving to another page group; the app itself keeps running.
    remount: async (): Promise<void> => {
      await act(async () => {
        root.unmount()
      })
      root = createRoot(container)
      await queryClient.invalidateQueries()
      await mount()
    },
  }
}

it('points to Settings while no server has been chosen', async () => {
  const { container } = await render()
  expect(container.textContent).toContain('You’re using a public Electrum server.')
  const link = container.querySelector<HTMLAnchorElement>('a')
  expect(link?.textContent).toBe('Use your own node')
  expect(link?.getAttribute('href')).toBe('/settings#electrum-server')
})

it.each([
  ['a server was connected', { electrum_host: 'umbrel.local' }],
  ['the notice was closed', { electrum_notice_v1: 'dismissed' }],
])('stays hidden once %s', async (_case, saved) => {
  const { container } = await render(saved)
  expect(container.textContent).toBe('')
})

// Closing it hides it for the rest of the session, so this runs last.
it('closes for good and saves that', async () => {
  const { container, server, remount } = await render()
  const close = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
  assert(close !== null, 'Expected the Dismiss button')
  await act(async () => {
    close.click()
  })
  expect(container.textContent).toBe('')
  await vi.waitFor(() => {
    expect(server.saved.get('electrum_notice_v1')).toBe('dismissed')
  })
  await remount()
  expect(container.textContent).toBe('')
})
