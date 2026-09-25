// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { WelcomeReveal } from './welcome-reveal'

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

let container: HTMLDivElement
let root: Root

async function withTestSetup(reducedMotion: boolean, run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  const matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: reducedMotion,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  dom.window.matchMedia = matchMedia
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', matchMedia)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

async function render(key = 'first'): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <WelcomeReveal key={key}>
          <button>Try the demo</button>
        </WelcomeReveal>
      </ChakraProvider>,
    )
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

function demo(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Try the demo')
  assert(button !== undefined, 'Expected the demo button')
  return button
}

it('reveals the already-mounted demo and replays after remount without persisting a seen flag', async () => {
  await withTestSetup(false, async () => {
    await render()
    const button = demo()
    expect(button.parentElement?.inert).toBe(true)
    expect(container.textContent).toContain('Control Center')
    await advance(1280)
    expect(demo()).toBe(button)
    expect(button.parentElement?.inert).toBe(false)
    await advance(420)
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
    await render('refresh')
    expect(container.querySelector('[aria-label^="Skip welcome"]')).not.toBeNull()
    expect(demo().parentElement?.inert).toBe(true)
  })
})

it.each(['click', 'keyboard'])('allows immediate skipping by %s', async (input) => {
  await withTestSetup(false, async () => {
    await render()
    await act(async () => {
      if (input === 'click') {
        const skip = container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')
        assert(skip !== null, 'Expected the skip button')
        skip.click()
      } else {
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
      }
    })
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
    expect(demo().parentElement?.inert).toBe(false)
    if (input === 'keyboard') {
      expect(document.activeElement).toBe(demo().parentElement)
    }
    await advance(2000)
    expect(demo().parentElement?.inert).toBe(false)
  })
})

it('uses a shorter introduction for reduced motion', async () => {
  await withTestSetup(true, async () => {
    await render()
    await advance(600)
    expect(demo().parentElement?.inert).toBe(false)
    await advance(150)
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
  })
})
