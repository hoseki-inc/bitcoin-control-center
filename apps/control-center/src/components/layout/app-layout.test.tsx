// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { type ReactNode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, vi } from 'vitest'
import { WelcomeReveal } from '../onboarding/welcome-reveal'
import { AppLayout } from './app-layout'

vi.mock('@hoseki/packages/ui/prove-verify-ui', () => ({
  AppLayout: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <>
      {header}
      {children}
    </>
  ),
  Logo: () => <span>Hoseki</span>,
  Menu: () => <nav>Home Accounts Portfolio Statements</nav>,
  Header: ({ logo, menu }: { logo: ReactNode; menu: ReactNode }) => (
    <header>
      {logo}
      {menu}
    </header>
  ),
  getEnvSlug: () => undefined,
}))
vi.mock('./user-info', () => ({ UserInfo: () => null }))

it.each(['complete', 'skip', 'leave'])('restores navigation when the welcome ends via %s', async (action) => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (welcome: boolean): Promise<void> => {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <MemoryRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route
                  path="/"
                  element={
                    welcome ? (
                      <WelcomeReveal>
                        <p>Demo</p>
                      </WelcomeReveal>
                    ) : (
                      <p>Accounts</p>
                    )
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </ChakraProvider>,
      ),
    )
  }
  try {
    await render(true)
    const navbar = container.querySelector<HTMLElement>('[data-app-navbar]')!
    expect(getComputedStyle(navbar).visibility).toBe('hidden')
    if (action === 'complete') {
      await act(async () => vi.advanceTimersByTime(1280))
      expect(container.querySelector('[data-welcome-phase="reveal"]')).not.toBeNull()
      expect(getComputedStyle(navbar).visibility).toBe('visible')
      expect(getComputedStyle(navbar).opacity).toBe('1')
      await act(async () => vi.advanceTimersByTime(420))
    } else if (action === 'skip') {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')!.click())
    } else {
      await render(false)
    }
    expect(getComputedStyle(navbar).visibility).toBe('visible')
    expect(getComputedStyle(navbar).opacity).toBe('1')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  }
})
