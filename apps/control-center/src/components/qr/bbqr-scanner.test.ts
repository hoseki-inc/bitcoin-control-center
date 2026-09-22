// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest'
import { BBQrScanner } from './bbqr-scanner'

const mocks = vi.hoisted(() => ({ start: vi.fn(), clear: vi.fn() }))
vi.mock('@hoseki/packages/ui/design-system', () => ({ Spinner: () => null }))
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    public static async getCameras(): Promise<Array<{ id: string }>> {
      return [{ id: 'test-camera' }]
    }
    public isScanning = false
    public start = mocks.start
    public clear = mocks.clear
  },
}))

let root: Root | null
let host: HTMLDivElement
let rejectStartup: ((reason: Error) => void) | undefined
const onError = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  rejectStartup = undefined
  mocks.start.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectStartup = reject
      }),
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const renderer = root
  await act(async () => {
    renderer.render(createElement(ChakraProvider, {}, createElement(BBQrScanner, { onComplete: vi.fn(), onError })))
  })
  await vi.waitFor(() => {
    expect(mocks.start).toHaveBeenCalledOnce()
  })
})

afterEach(async () => {
  const renderer = root
  await act(async () => {
    renderer?.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})

async function failStartup(): Promise<void> {
  await act(async () => {
    assert.exists(rejectStartup, 'Camera startup should be pending')
    rejectStartup(new Error('Camera permission denied'))
  })
}

it('reports a camera startup failure while mounted', async () => {
  await failStartup()
  expect(onError).toHaveBeenCalledWith('Camera permission denied')
  expect(host.textContent).toContain('Camera permission denied')
})

it('ignores a camera startup failure after unmounting', async () => {
  const renderer = root
  await act(async () => {
    renderer?.unmount()
  })
  root = null
  expect(mocks.clear).toHaveBeenCalledOnce()
  await failStartup()
  expect(onError).not.toHaveBeenCalled()
})
