// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import type { PartialModuleMock } from '@hoseki/packages/testing/partial-module-mock'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import type * as Sonner from 'sonner'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SettingsPage } from './index'

vi.mock(import('../../mode'), () => ({ isDesktop: true }))
vi.mock(import('../../hooks/use-local-settings'), () => ({
  useLocalSetting: () => ({ data: null, isLoading: false, save: vi.fn<() => void>(), isSaving: false }),
}))
vi.mock<PartialModuleMock<typeof Sonner>>(import('sonner'), () => ({
  toast: Object.assign(vi.fn<typeof Sonner.toast>(), { success: vi.fn(), error: vi.fn() }),
}))

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>()

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
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
      if (typeof input === 'string' && input.endsWith('/settings.reconnectElectrum')) {
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 500 })
      }
      return Response.json({ result: { data: { json: null } } })
    })
    await act(async () => {
      root.render(createElement(ChakraProvider, null, createElement(SettingsPage)))
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
      if (typeof input === 'string' && input.endsWith('/settings.testElectrum')) {
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 500 })
      }
      return Response.json({ result: { data: { json: null } } })
    })
    await act(async () => {
      root.render(createElement(ChakraProvider, null, createElement(SettingsPage)))
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
      root.render(createElement(ChakraProvider, null, createElement(SettingsPage)))
    })
    if (visible) {
      expect(container.textContent).toContain('electrum.example:50002 (SSL)')
      expect(container.textContent).toContain('Connected')
    } else {
      expect(container.textContent).not.toContain('electrum.example')
    }
  })
})
