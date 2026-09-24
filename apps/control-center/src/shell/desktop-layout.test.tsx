// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { WelcomeReveal } from '../components/onboarding/welcome-reveal'
import { DesktopLayout } from './desktop-layout'
import { SheetPage } from './sheet'

vi.mock('./wallpaper/wallpaper', () => ({ Wallpaper: () => null }))
vi.mock('./wallpaper/use-wallpaper', async () => {
  const { WALLPAPER_PRESETS } = await import('./wallpaper/presets')
  return {
    useWallpaper: () => ({ preset: WALLPAPER_PRESETS[0], setWallpaper: vi.fn() }),
    useBlockSeed: () => [0, 0, 0, 0],
  }
})
vi.mock('../hooks/use-local-settings', () => ({
  useLocalSetting: (key: string) => ({ data: key === 'user_name' ? 'Satoshi Nakamoto' : 'completed' }),
}))
// The shell's job is navigation; the desktop's widgets and data have their own tests.
vi.mock('./widgets/desktop-widgets', () => ({
  HoldingsWidget: () => null,
  PriceWidget: () => null,
  ConnectionsWidget: () => null,
  VerificationWidget: () => null,
}))
vi.mock('./search/command-palette', () => ({
  CommandPalette: ({ open }: { open: boolean }) => (open ? <dialog open aria-label="Search" /> : null),
}))
vi.mock('../hooks/use-accounts', () => ({
  useAccounts: () => ({
    accounts: [],
    totals: { accountCount: 1 },
    btcUsdPrice: null,
    isLoading: false,
    isError: false,
    retry: vi.fn(),
  }),
}))

function mockMatchMedia(reducedMotion: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function LocationProbe(): JSX.Element {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function Shell(): JSX.Element {
  return (
    <WelcomeReveal>
      <Routes>
        <Route element={<DesktopLayout />}>
          <Route path="/home" element={null} />
          <Route element={<SheetPage fullWidth />}>
            <Route path="/portfolio" element={<Link to="/statements/example">Open statement</Link>} />
            <Route path="/statements/:id" element={<p>Saved statement</p>} />
          </Route>
          <Route element={<SheetPage />}>
            <Route path="/accounts" element={<p>Your accounts</p>} />
          </Route>
        </Route>
      </Routes>
      <LocationProbe />
    </WelcomeReveal>
  )
}

describe('DesktopLayout', () => {
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
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await run()
  }

  const render = async (path: string, key = 'first'): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <MemoryRouter key={key} initialEntries={[path]}>
            <Shell />
          </MemoryRouter>
        </ChakraProvider>,
      )
    })
  }
  const phase = (): HTMLElement => expectElement(container.querySelector('[data-welcome-phase]'), HTMLElement)
  const content = (): HTMLElement => expectElement(phase().lastElementChild, HTMLElement)
  const location = (): string | null =>
    expectElement(container.querySelector('[data-testid="location"]'), Element).textContent
  // Each welcome phase schedules the next after it renders, so advance one phase at a time.
  const finishWelcome = async (): Promise<void> => {
    await act(async () => vi.advanceTimersByTime(1280))
    await act(async () => vi.advanceTimersByTime(420))
  }

  it.each(['complete', 'click', 'keyboard', 'reduced motion'])(
    'reveals the whole shell on launch via %s and replays only after a fresh mount',
    async (action) => {
      await withTestSetup(async () => {
        mockMatchMedia(action === 'reduced motion')
        await render('/portfolio')
        expect(phase().dataset['welcomePhase']).toBe('welcome')
        expect(content().inert).toBe(true)
        expect(content().contains(container.querySelector('[data-app-dock]'))).toBe(true)
        const link = expectElement(container.querySelector('a[href="/statements/example"]'), HTMLAnchorElement)
        if (action === 'complete' || action === 'reduced motion') {
          await act(async () => vi.advanceTimersByTime(action === 'complete' ? 1280 : 600))
          expect(phase().dataset['welcomePhase']).toBe('reveal')
          expect(content().inert).toBe(false)
          await act(async () => vi.advanceTimersByTime(action === 'complete' ? 420 : 150))
        } else if (action === 'click') {
          await act(async () => {
            expectElement(container.querySelector('[aria-label^="Skip welcome"]'), HTMLButtonElement).click()
          })
        } else {
          await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
          expect(document.activeElement).toBe(content())
        }
        expect(phase().dataset['welcomePhase']).toBe('done')
        // Escape only skipped the welcome; it did not also close the sheet underneath.
        expect(location()).toBe('/portfolio')
        expect(container.querySelector('a[href="/statements/example"]')).toBe(link)
        await act(async () => {
          link.click()
        })
        expect(container.textContent).toContain('Saved statement')
        await render('/portfolio', 'reload')
        expect(phase().dataset['welcomePhase']).toBe('welcome')
      })
    },
  )

  it('opens sections in a sheet, marks the current one in the dock, and closes on Escape', async () => {
    await withTestSetup(async () => {
      mockMatchMedia(true)
      await render('/home')
      await finishWelcome()
      expect(container.querySelector('#main-content')).toBeNull()
      expect(expectElement(container.querySelector('h1'), Element).textContent).toMatch(
        /^Good (morning|afternoon|evening), Satoshi\.$/,
      )
      expect(expectElement(container.querySelector('a[aria-label="Home"]'), Element).getAttribute('aria-current')).toBe(
        'page',
      )

      await act(async () => {
        expectElement(container.querySelector('a[aria-label="Accounts"]'), HTMLAnchorElement).click()
      })
      expect(location()).toBe('/accounts')
      expect(expectElement(container.querySelector('#main-content'), Element).textContent).toContain('Your accounts')
      expect(
        expectElement(container.querySelector('a[aria-label="Accounts"]'), Element).getAttribute('aria-current'),
      ).toBe('page')
      expect(
        expectElement(container.querySelector('a[aria-label="Home"]'), Element).getAttribute('aria-current'),
      ).toBeNull()

      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
      expect(location()).toBe('/home')
    })
  })

  it('closes the sheet with its close button', async () => {
    await withTestSetup(async () => {
      mockMatchMedia(true)
      await render('/accounts')
      await finishWelcome()
      await act(async () => {
        expectElement(container.querySelector('button[aria-label="Close"]'), HTMLButtonElement).click()
      })
      expect(location()).toBe('/home')
    })
  })

  it('opens and closes search with ⌘K or Ctrl+K once the welcome has cleared', async () => {
    await withTestSetup(async () => {
      mockMatchMedia(true)
      await render('/home')
      const search = (): Element | null => container.querySelector('dialog[aria-label="Search"]')
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })))
      expect(search()).toBeNull()
      await finishWelcome()
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })))
      expect(search()).not.toBeNull()
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', ctrlKey: true })))
      expect(search()).toBeNull()
    })
  })

  it('toggles privacy from the top-right pill', async () => {
    await withTestSetup(async () => {
      mockMatchMedia(true)
      localStorage.removeItem('control-center:privacy')
      await render('/home')
      await finishWelcome()
      const privacy = (): HTMLButtonElement =>
        expectElement(container.querySelector('button[aria-pressed]'), HTMLButtonElement)
      expect(privacy().getAttribute('aria-label')).toBe('Hide balances')
      await act(async () => {
        privacy().click()
      })
      expect(privacy().getAttribute('aria-pressed')).toBe('true')
      expect(privacy().getAttribute('aria-label')).toBe('Show balances')
    })
  })
})
