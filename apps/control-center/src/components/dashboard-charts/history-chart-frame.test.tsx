// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { HistoryChartFrame, HistoryRangeLoading } from './history-chart-frame'

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

async function withTestSetup(run: (root: Root, container: HTMLDivElement) => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    } finally {
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })

  await run(root, container)
}

it.each([false, true])('retains chart nodes while disabling stale inspection, reduced motion = %s', async (reduced) => {
  await withTestSetup(async (root, container) => {
    const render = async (viewKey: string, updating: boolean): Promise<void> => {
      await act(async () => {
        root.render(
          <ChakraProvider>
            <HistoryChartFrame
              height="220px"
              viewKey={viewKey}
              loading={false}
              updating={updating}
              refreshing={false}
              reduceMotion={reduced}
            >
              <button>Inspect chart</button>
            </HistoryChartFrame>
          </ChakraProvider>,
        )
      })
    }
    await render('all', false)
    const inspection = container.querySelector('button')
    assert.exists(inspection, 'Expected the chart content')
    const frame = inspection.parentElement
    assert.exists(frame, 'Expected the chart frame')
    if (reduced) {
      expect(frame.style.opacity).toBe('1')
    }
    await render('account-a', true)
    expect(container.querySelector('button')).toBe(inspection)
    expect(frame.hasAttribute('inert')).toBe(true)
    expect(frame.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    // The retained chart and the sweep across it are both hidden from assistive technology.
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
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
    expect(container.textContent).toBe('Preparing history for this date range')
    expect(container.querySelector('button')).toBeNull()
  })
})

it('marks a background refresh busy without sweeping over the current chart', async () => {
  await withTestSetup(async (root, container) => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <HistoryChartFrame height="220px" viewKey="all" loading={false} updating={false} refreshing>
            <button>Inspect chart</button>
          </HistoryChartFrame>
        </ChakraProvider>,
      )
    })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
    expect(container.querySelector('[inert]')).toBeNull()
  })
})
