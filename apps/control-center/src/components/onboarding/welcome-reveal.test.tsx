// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { WelcomeReveal } from './welcome-reveal'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown, so it runs once even after a failure or timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
  })

  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
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

function demo(): HTMLButtonElement {
  return expectElement(
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try the demo'),
    HTMLButtonElement,
  )
}

it('reveals the already-mounted demo and replays after remount without persisting a seen flag', async () => {
  await withTestSetup(async () => {
    await render()
    const button = demo()
    expect(button.parentElement?.inert).toBe(true)
    expect(container.textContent).toContain('Control Center')
    await act(async () => vi.advanceTimersByTime(1280))
    expect(demo()).toBe(button)
    expect(button.parentElement?.inert).toBe(false)
    await act(async () => vi.advanceTimersByTime(420))
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
    await render('refresh')
    expect(container.querySelector('[aria-label^="Skip welcome"]')).not.toBeNull()
    expect(demo().parentElement?.inert).toBe(true)
  })
})

it.each(['click', 'keyboard'])('allows immediate skipping by %s', async (input) => {
  await withTestSetup(async () => {
    await render()
    await act(async () => {
      if (input === 'click') {
        expectElement(container.querySelector('[aria-label^="Skip welcome"]'), HTMLButtonElement).click()
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      }
    })
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
    expect(demo().parentElement?.inert).toBe(false)
    if (input === 'keyboard') {
      expect(document.activeElement).toBe(demo().parentElement)
    }
    await act(async () => vi.advanceTimersByTime(2000))
    expect(demo().parentElement?.inert).toBe(false)
  })
})

it('uses a shorter introduction for reduced motion', async () => {
  await withTestSetup(async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })
    await render()
    await act(async () => vi.advanceTimersByTime(600))
    expect(demo().parentElement?.inert).toBe(false)
    await act(async () => vi.advanceTimersByTime(150))
    expect(container.querySelector('[aria-label^="Skip welcome"]')).toBeNull()
  })
})
