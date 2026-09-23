// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('../hooks/use-local-settings', () => ({ useLocalSetting: () => ({ data: 'Satoshi Nakamoto' }) }))

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

  beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  const render = async (path: string, key = 'first'): Promise<void> => {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <MemoryRouter key={key} initialEntries={[path]}>
            <Shell />
          </MemoryRouter>
        </ChakraProvider>,
      ),
    )
  }
  const phase = (): HTMLElement => container.querySelector<HTMLElement>('[data-welcome-phase]')!
  const content = (): HTMLElement => phase().lastElementChild as HTMLElement
  const location = (): string | null => container.querySelector('[data-testid="location"]')!.textContent
  // Each welcome phase schedules the next after it renders, so advance one phase at a time.
  const finishWelcome = async (): Promise<void> => {
    await act(async () => vi.advanceTimersByTime(1280))
    await act(async () => vi.advanceTimersByTime(420))
  }

  it.each(['complete', 'click', 'keyboard', 'reduced motion'])(
    'reveals the whole shell on launch via %s and replays only after a fresh mount',
    async (action) => {
      mockMatchMedia(action === 'reduced motion')
      await render('/portfolio')
      expect(phase().dataset['welcomePhase']).toBe('welcome')
      expect(content().inert).toBe(true)
      expect(content().contains(container.querySelector('[data-app-dock]'))).toBe(true)
      const link = container.querySelector<HTMLAnchorElement>('a[href="/statements/example"]')!
      if (action === 'complete' || action === 'reduced motion') {
        await act(async () => vi.advanceTimersByTime(action === 'complete' ? 1280 : 600))
        expect(phase().dataset['welcomePhase']).toBe('reveal')
        expect(content().inert).toBe(false)
        await act(async () => vi.advanceTimersByTime(action === 'complete' ? 420 : 150))
      } else if (action === 'click') {
        await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Skip welcome"]')!.click())
      } else {
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
        expect(document.activeElement).toBe(content())
      }
      expect(phase().dataset['welcomePhase']).toBe('done')
      // Escape only skipped the welcome; it did not also close the sheet underneath.
      expect(location()).toBe('/portfolio')
      expect(container.querySelector('a[href="/statements/example"]')).toBe(link)
      await act(async () => link.click())
      expect(container.textContent).toContain('Saved statement')
      await render('/portfolio', 'reload')
      expect(phase().dataset['welcomePhase']).toBe('welcome')
    },
  )

  it('opens sections in a sheet, marks the current one in the dock, and closes on Escape', async () => {
    mockMatchMedia(true)
    await render('/home')
    await finishWelcome()
    expect(container.querySelector('#main-content')).toBeNull()
    expect(container.querySelector('h1')!.textContent).toMatch(/^Good (morning|afternoon|evening), Satoshi\.$/)
    expect(container.querySelector('a[aria-label="Home"]')!.getAttribute('aria-current')).toBe('page')

    await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label="Accounts"]')!.click())
    expect(location()).toBe('/accounts')
    expect(container.querySelector('#main-content')!.textContent).toContain('Your accounts')
    expect(container.querySelector('a[aria-label="Accounts"]')!.getAttribute('aria-current')).toBe('page')
    expect(container.querySelector('a[aria-label="Home"]')!.getAttribute('aria-current')).toBeNull()

    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(location()).toBe('/home')
  })

  it('closes the sheet with its close button', async () => {
    mockMatchMedia(true)
    await render('/accounts')
    await finishWelcome()
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    expect(location()).toBe('/home')
  })

  it('toggles privacy from the dock', async () => {
    mockMatchMedia(true)
    localStorage.removeItem('control-center:privacy')
    await render('/home')
    await finishWelcome()
    const privacy = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('button[aria-pressed]')!
    expect(privacy().getAttribute('aria-label')).toBe('Hide balances')
    await act(async () => privacy().click())
    expect(privacy().getAttribute('aria-pressed')).toBe('true')
    expect(privacy().getAttribute('aria-label')).toBe('Show balances')
  })
})
