// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { WelcomeReveal } from '../onboarding/welcome-reveal'
import { AppLayout } from './app-layout'

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

async function render(load = 'first'): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MemoryRouter key={load} initialEntries={['/portfolio']}>
          <WelcomeReveal>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/portfolio" element={<Link to="/statements/example">Open statement</Link>} />
              </Route>
              <Route element={<AppLayout fullWidth />}>
                <Route path="/statements/:id" element={<p>Saved statement</p>} />
              </Route>
            </Routes>
          </WelcomeReveal>
        </MemoryRouter>
      </ChakraProvider>,
    )
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

function phase(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-welcome-phase]')
  assert(element !== null, 'Expected the welcome reveal')
  return element
}

function content(): HTMLElement {
  const element = phase().lastElementChild
  assert(element instanceof HTMLElement, 'Expected the revealed app content')
  return element
}

it.each(['complete', 'click', 'keyboard', 'reduced motion'])(
  'reveals the whole app on launch via %s and replays only after a fresh mount',
  async (action) => {
    await withTestSetup(action === 'reduced motion', async () => {
      await render()
      expect(phase().dataset['welcomePhase']).toBe('welcome')
      expect(content().inert).toBe(true)
      expect(content().contains(container.querySelector('[data-app-navbar]'))).toBe(true)
      const link = container.querySelector<HTMLAnchorElement>('a[href="/statements/example"]')
      assert(link !== null, 'Expected the statement link')
      if (action === 'complete' || action === 'reduced motion') {
        await advance(action === 'complete' ? 1280 : 600)
        expect(phase().dataset['welcomePhase']).toBe('reveal')
        expect(content().inert).toBe(false)
        expect(getComputedStyle(content()).visibility).toBe('visible')
        await advance(action === 'complete' ? 420 : 150)
      } else if (action === 'click') {
        const skip = container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')
        assert(skip !== null, 'Expected the skip button')
        await act(async () => {
          skip.click()
        })
      } else {
        await act(async () => {
          window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
        })
        expect(document.activeElement).toBe(content())
      }
      expect(phase().dataset['welcomePhase']).toBe('done')
      expect(content().inert).toBe(false)
      expect(container.querySelector('a[href="/statements/example"]')).toBe(link)
      await act(async () => {
        link.click()
      })
      expect(container.textContent).toContain('Saved statement')
      expect(phase().dataset['welcomePhase']).toBe('done')
      await render('reload')
      expect(phase().dataset['welcomePhase']).toBe('welcome')
      expect(content().inert).toBe(true)
    })
  },
)
