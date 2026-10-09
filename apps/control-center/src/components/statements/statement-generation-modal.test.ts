// @vitest-environment node
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { StatementDto } from '../../trpc/server-types'
import { SHEET_PAUSE_MS, useSheetCycle } from './statement-generation-modal'

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

async function renderSheet() {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const replay = vi.fn<() => void>()
  const onGenerationEnd = vi.fn<(status: string) => void>()
  let endSheet = (): void => undefined
  function Sheet({ status }: { status: StatementDto['status'] }): null {
    endSheet = useSheetCycle({ status, replay, onGenerationEnd })
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
      root.render(createElement(Sheet, { status }))
    })
  }
  const end = async (): Promise<void> => {
    await act(async () => {
      endSheet()
    })
  }
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      vi.advanceTimersByTime(ms)
    })
  }
  await render('pending')
  return { render, end, wait, replay, onGenerationEnd }
}

it('rests on the last frame before replaying while the statement generates', async () => {
  const { end, wait, replay, onGenerationEnd } = await renderSheet()
  await end()
  await wait(SHEET_PAUSE_MS - 1)
  expect(replay).not.toHaveBeenCalled()
  await wait(1)
  expect(replay).toHaveBeenCalledOnce()
  expect(onGenerationEnd).not.toHaveBeenCalled()
})

it('ends straight away when generation finishes during a rest', async () => {
  const { render, end, wait, replay, onGenerationEnd } = await renderSheet()
  await end()
  await render('completed')
  expect(onGenerationEnd).toHaveBeenCalledExactlyOnceWith('completed')
  await wait(SHEET_PAUSE_MS)
  expect(replay).not.toHaveBeenCalled()
})

it('lets the sheet finish playing when generation ends mid-play', async () => {
  const { render, end, onGenerationEnd } = await renderSheet()
  await render('failed')
  expect(onGenerationEnd).not.toHaveBeenCalled()
  await end()
  expect(onGenerationEnd).toHaveBeenCalledExactlyOnceWith('failed')
})
