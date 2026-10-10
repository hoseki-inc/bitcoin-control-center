// @vitest-environment node
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { StatementDto } from '../../trpc/server-types'
import { COMPLETED_HOLD_MS, SHEET_PAUSE_MS, useGenerationSequence } from './statement-generation-modal'

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

async function renderSequence({ replaySheet = true }: { replaySheet?: boolean } = {}) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const replay = vi.fn<() => void>()
  const onFinished = vi.fn<() => void>()
  let sequence: ReturnType<typeof useGenerationSequence> | undefined
  function Sequence({ status }: { status: StatementDto['status'] }): null {
    sequence = useGenerationSequence({ status, replaySheet, replay, onFinished })
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
  const render = async (status: StatementDto['status']): Promise<void> => {
    await act(async () => {
      root.render(createElement(Sequence, { status }))
    })
  }
  const endSheet = async (): Promise<void> => {
    await act(async () => {
      sequence?.onSheetEnd()
    })
  }
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }
  const isCompleted = (): boolean => sequence?.isCompleted ?? false
  await render('pending')
  return { render, endSheet, wait, isCompleted, replay, onFinished }
}

it('rests on the last frame before each replay while the statement generates', async () => {
  const { endSheet, wait, replay, onFinished } = await renderSequence()
  await endSheet()
  await wait(SHEET_PAUSE_MS - 1)
  expect(replay).not.toHaveBeenCalled()
  await wait(1)
  expect(replay).toHaveBeenCalledOnce()
  await endSheet()
  await wait(SHEET_PAUSE_MS)
  expect(replay).toHaveBeenCalledTimes(2)
  expect(onFinished).not.toHaveBeenCalled()
})

it('rests without replaying when reduced motion is preferred', async () => {
  const { endSheet, wait, replay } = await renderSequence({ replaySheet: false })
  await endSheet()
  await wait(SHEET_PAUSE_MS * 3)
  expect(replay).not.toHaveBeenCalled()
})

it('shows the check as soon as a completed statement finishes during a rest, then finishes after the hold', async () => {
  const { render, endSheet, wait, isCompleted, replay, onFinished } = await renderSequence()
  await endSheet()
  await render('completed')
  expect(isCompleted()).toBe(true)
  await wait(COMPLETED_HOLD_MS - 1)
  expect(onFinished).not.toHaveBeenCalled()
  await wait(1)
  expect(onFinished).toHaveBeenCalledOnce()
  // The rest that was under way when it completed doesn't replay the sheet.
  await wait(SHEET_PAUSE_MS)
  expect(replay).not.toHaveBeenCalled()
})

it('lets the sheet finish playing when generation ends mid-play', async () => {
  const { render, endSheet, isCompleted } = await renderSequence()
  await render('completed')
  expect(isCompleted()).toBe(false)
  await endSheet()
  expect(isCompleted()).toBe(true)
})

it('finishes straight away, without the check, when generation fails', async () => {
  const { render, endSheet, isCompleted, onFinished } = await renderSequence()
  await render('failed')
  await endSheet()
  expect(isCompleted()).toBe(false)
  expect(onFinished).toHaveBeenCalledOnce()
})
