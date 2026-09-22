// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsPage } from './index'

vi.mock('../../mode', () => ({ isDesktop: true }))
vi.mock('../../hooks/use-local-settings', () => ({
  useLocalSetting: () => ({ data: null, isLoading: false, save: vi.fn(), isSaving: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock.mockReset())
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

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
