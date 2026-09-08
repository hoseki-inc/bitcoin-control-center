// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { HistorySyncStatus } from './history-sync-status'

it('preserves one status slot across completion, dismissal and a restarted sync', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = async (syncing: boolean, synced: boolean): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <HistorySyncStatus syncing={syncing} synced={synced} compact={false} />
        </ChakraProvider>,
      )
    })
  }

  try {
    await render(true, false)
    const slot = container.querySelector('[role="status"]')!
    const size = getComputedStyle(slot).width
    expect(slot.getAttribute('aria-label')).toBe('Updating history')

    await render(false, true)
    expect(container.querySelector('[role="status"]')).toBe(slot)
    expect(slot.getAttribute('aria-label')).toBe('History updated')
    expect(getComputedStyle(slot).width).toBe(size)

    await render(false, false)
    expect(container.querySelector('[role="status"]')).toBe(slot)
    expect(slot.hasAttribute('aria-label')).toBe(false)
    expect(getComputedStyle(slot).width).toBe(size)

    // A new sync takes precedence even if the previous completion is still recorded.
    await render(true, true)
    expect(slot.getAttribute('aria-label')).toBe('Updating history')
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
