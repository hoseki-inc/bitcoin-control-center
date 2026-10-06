// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SuccessConfetti } from './success-confetti'

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

async function renderConfetti({ reducedMotion }: { reducedMotion: boolean }): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  dom.window.matchMedia = (media) => ({
    media,
    matches: reducedMotion && media === '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Unmounting before the 500 ms autorun delay keeps the canvas from drawing in the test DOM.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <ChakraProvider>
        <SuccessConfetti />
      </ChakraProvider>,
    )
  })
  return container
}

it('celebrates with confetti by default', async () => {
  const container = await renderConfetti({ reducedMotion: false })
  expect(container.querySelector('canvas')).not.toBeNull()
})

it('never mounts the confetti canvas when the viewer prefers reduced motion', async () => {
  const container = await renderConfetti({ reducedMotion: true })
  expect(container.querySelector('canvas')).toBeNull()
})
