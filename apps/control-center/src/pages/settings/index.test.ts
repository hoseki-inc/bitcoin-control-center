// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
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
    const preset = container.querySelector('select')
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
    fetchMock.mockResolvedValue(Response.json(body))
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
