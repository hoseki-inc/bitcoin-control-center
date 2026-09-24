// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { expectElement } from '@hoseki/packages/testing/dom'
import type * as FramerMotion from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { HistoryChartFrame, HistoryRangeLoading } from './history-chart-frame'

const preference = vi.hoisted(() => ({ reduced: false }))
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof FramerMotion>()),
  useReducedMotion: () => preference.reduced,
}))

it.each([false, true])('retains chart nodes while disabling stale inspection, reduced motion = %s', async (reduced) => {
  preference.reduced = reduced
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addListener: vi.fn(), removeListener: vi.fn() }))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (viewKey: string, updating: boolean): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <HistoryChartFrame height="220px" viewKey={viewKey} loading={false} updating={updating} refreshing={false}>
            <button>Inspect chart</button>
          </HistoryChartFrame>
        </ChakraProvider>,
      )
    })
  }
  try {
    await render('all', false)
    const inspection = expectElement(container.querySelector('button'), HTMLButtonElement)
    const frame = expectElement(inspection.parentElement, HTMLElement)
    if (reduced) {
      expect(frame.style.opacity).toBe('1')
    }
    await render('account-a', true)
    expect(container.querySelector('button')).toBe(inspection)
    expect(frame.hasAttribute('inert')).toBe(true)
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.textContent).toContain('Updating view')
    await render('account-b', false)
    expect(container.querySelector('button')).toBe(inspection)
    expect(frame.hasAttribute('inert')).toBe(false)
    expect(frame.hasAttribute('aria-hidden')).toBe(false)
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    if (reduced) {
      expect(frame.style.opacity).toBe('1')
    }
    await act(async () => {
      root.render(
        <ChakraProvider>
          <HistoryRangeLoading height="220px" />
        </ChakraProvider>,
      )
    })
    expect(container.querySelector('output')?.getAttribute('aria-label')).toBe('Preparing history for this date range')
    expect(container.querySelector('button')).toBeNull()
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
  }
})
