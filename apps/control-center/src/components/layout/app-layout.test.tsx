// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { type ReactNode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
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

it.each(['complete', 'click', 'keyboard', 'reduced motion'])(
  'reveals the whole app on launch via %s and replays only after a fresh mount',
  async (action) => {
    vi.useFakeTimers()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.matchMedia = vi.fn().mockReturnValue({
      matches: action === 'reduced motion',
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const render = async (load = 'first'): Promise<void> => {
      await act(async () =>
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
        ),
      )
    }
    try {
      await render()
      const phase = (): HTMLElement => container.querySelector<HTMLElement>('[data-welcome-phase]')!
      const content = (): HTMLElement => phase().lastElementChild as HTMLElement
      expect(phase().dataset['welcomePhase']).toBe('welcome')
      expect(content().inert).toBe(true)
      expect(content().contains(container.querySelector('[data-app-navbar]'))).toBe(true)
      const link = container.querySelector<HTMLAnchorElement>('a[href="/statements/example"]')!
      if (action === 'complete' || action === 'reduced motion') {
        await act(async () => vi.advanceTimersByTime(action === 'complete' ? 1280 : 600))
        expect(phase().dataset['welcomePhase']).toBe('reveal')
        expect(content().inert).toBe(false)
        expect(getComputedStyle(content()).visibility).toBe('visible')
        await act(async () => vi.advanceTimersByTime(action === 'complete' ? 420 : 150))
      } else if (action === 'click') {
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')!.click())
      } else {
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
        expect(document.activeElement).toBe(content())
      }
      expect(phase().dataset['welcomePhase']).toBe('done')
      expect(content().inert).toBe(false)
      expect(container.querySelector('a[href="/statements/example"]')).toBe(link)
      await act(async () => link.click())
      expect(container.textContent).toContain('Saved statement')
      expect(phase().dataset['welcomePhase']).toBe('done')
      await render('reload')
      expect(phase().dataset['welcomePhase']).toBe('welcome')
      expect(content().inert).toBe(true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  },
)
