// @vitest-environment node
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { StatementDto } from '../trpc/server-types'
import { COMPLETED_HOLD_MS, RING_FILL_MS, useStatementGeneration } from './use-statement-generation'

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

interface Inputs {
  isConfirmedPending: boolean
  status: StatementDto['status']
  progress: number | null
  isDocumentLoaded: boolean
  isDocumentReady: boolean
}

const generating: Inputs = {
  isConfirmedPending: true,
  status: 'pending',
  progress: 0,
  isDocumentLoaded: false,
  isDocumentReady: false,
}

async function renderGeneration(initial: Inputs = generating) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  let generation: ReturnType<typeof useStatementGeneration> | undefined
  function Generation(inputs: Inputs): null {
    generation = useStatementGeneration(inputs)
    return null
  }
  const root = createRoot(document.createElement('div'))
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    vi.useRealTimers()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  let current = initial
  const update = async (changes: Partial<Inputs>): Promise<void> => {
    current = { ...current, ...changes }
    await act(async () => {
      root.render(createElement(Generation, current))
    })
  }
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }
  const state = () => {
    if (generation === undefined) {
      throw new Error('Generation did not render')
    }
    return generation
  }
  await update({})
  return { update, wait, state }
}

it('stays closed until a generating status is confirmed', async () => {
  const { update, state } = await renderGeneration({ ...generating, isConfirmedPending: false })
  expect(state()).toMatchObject({ isMounted: false, isOpen: false })
  await update({ isConfirmedPending: true })
  expect(state()).toMatchObject({ isMounted: true, isOpen: true, progress: 0, isCompleted: false })
})

it("shows Sentinel's progress as the first 90%, and never goes back", async () => {
  const { update, state } = await renderGeneration()
  await update({ progress: 50 })
  expect(state().progress).toBe(45)
  await update({ progress: 100 })
  expect(state().progress).toBe(90)
  await update({ progress: 20 })
  expect(state().progress).toBe(90)
})

it('fills the last 10% while the statement is loaded and drawn, then fills in to the check and closes', async () => {
  const { update, wait, state } = await renderGeneration()
  await update({ progress: 100, status: 'completed' })
  expect(state()).toMatchObject({ progress: 90, isCompleted: false })
  await update({ isDocumentLoaded: true })
  expect(state().progress).toBe(95)
  await update({ isDocumentReady: true })
  expect(state()).toMatchObject({ progress: 100, isCompleted: false })
  // The ring reaches 100% before it fills in.
  await wait(RING_FILL_MS)
  expect(state()).toMatchObject({ isCompleted: true, isOpen: true })
  await wait(COMPLETED_HOLD_MS - 1)
  expect(state().isOpen).toBe(true)
  await wait(1)
  // Still mounted, so the screen can fade out.
  expect(state()).toMatchObject({ isOpen: false, isMounted: true })
})

it('stays at 90% until the statement is drawn', async () => {
  const { update, wait, state } = await renderGeneration()
  await update({ status: 'completed' })
  await wait(COMPLETED_HOLD_MS * 5)
  expect(state()).toMatchObject({ progress: 90, isCompleted: false, isOpen: true })
})

it('closes straight away, without the check, when generation fails', async () => {
  const { update, state } = await renderGeneration()
  await update({ progress: 40, status: 'failed' })
  expect(state()).toMatchObject({ isOpen: false, isCompleted: false })
})

it('closes when asked, before the hold ends', async () => {
  const { update, wait, state } = await renderGeneration()
  await update({ status: 'completed', isDocumentLoaded: true, isDocumentReady: true })
  await wait(RING_FILL_MS)
  state().close()
  await wait(0)
  expect(state().isOpen).toBe(false)
})
