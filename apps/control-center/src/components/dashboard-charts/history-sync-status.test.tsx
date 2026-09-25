// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { HistorySyncStatus } from './history-sync-status'

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

it('preserves one status slot across completion, dismissal and a restarted sync', async () => {
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
  const render = async (syncing: boolean, synced: boolean): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <HistorySyncStatus syncing={syncing} synced={synced} compact={false} />
        </ChakraProvider>,
      )
    })
  }

  await render(true, false)
  const slot = container.querySelector('output')
  assert.exists(slot, 'Expected the history status slot')
  const size = getComputedStyle(slot).width
  expect(slot.getAttribute('aria-label')).toBe('Updating history')

  await render(false, true)
  expect(container.querySelector('output')).toBe(slot)
  expect(slot.getAttribute('aria-label')).toBe('History updated')
  expect(getComputedStyle(slot).width).toBe(size)

  await render(false, false)
  expect(container.querySelector('output')).toBe(slot)
  expect(slot.hasAttribute('aria-label')).toBe(false)
  expect(getComputedStyle(slot).width).toBe(size)

  // A new sync takes precedence even if the previous completion is still recorded.
  await render(true, true)
  expect(slot.getAttribute('aria-label')).toBe('Updating history')
  expect(container.querySelectorAll('output')).toHaveLength(1)
})
