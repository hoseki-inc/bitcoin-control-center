// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { BBQrScanner, type QrCamera, type QrCameraFactory, QrCameraProvider } from './bbqr-scanner'

const mocks = vi.hoisted(() => ({ start: vi.fn<QrCamera['start']>(), clear: vi.fn<QrCamera['clear']>() }))
const cameraFactory: QrCameraFactory = {
  getCameras: async () => [{ id: 'test-camera', label: 'Test camera' }],
  create: () => ({ isScanning: false, start: mocks.start, clear: mocks.clear, stop: async () => undefined }),
}

let root: Root | null
let host: HTMLDivElement
let rejectStartup: ((reason: Error) => void) | undefined
const onError = vi.fn<(error: string) => void>()

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const lifecycle = { finished: false }
  const isFinished = (): boolean => lifecycle.finished
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    lifecycle.finished = true

    const renderer = root
    await act(async () => {
      renderer?.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  rejectStartup = undefined
  mocks.start.mockImplementation(
    async () =>
      new Promise<null>((_resolve, reject) => {
        rejectStartup = reject
      }),
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const renderer = root
  await act(async () => {
    renderer.render(
      createElement(
        ChakraProvider,
        {},
        createElement(
          QrCameraProvider,
          { value: cameraFactory },
          createElement(BBQrScanner, { onComplete: vi.fn<() => void>(), onError }),
        ),
      ),
    )
  })
  if (isFinished()) {
    return
  }
  await vi.waitFor(() => {
    expect(mocks.start).toHaveBeenCalledOnce()
  })
  if (isFinished()) {
    return
  }

  await run()
}

async function failStartup(): Promise<void> {
  await act(async () => {
    assert.exists(rejectStartup, 'Camera startup should be pending')
    rejectStartup(new Error('Camera permission denied'))
  })
}

it('reports a camera startup failure while mounted', async () => {
  await withTestSetup(async () => {
    await failStartup()
    expect(onError).toHaveBeenCalledWith('Camera permission denied')
    expect(host.textContent).toContain('Camera permission denied')
  })
})

it('ignores a camera startup failure after unmounting', async () => {
  await withTestSetup(async () => {
    const renderer = root
    await act(async () => {
      renderer?.unmount()
    })
    root = null
    expect(mocks.clear).toHaveBeenCalledOnce()
    await failStartup()
    expect(onError).not.toHaveBeenCalled()
  })
})
