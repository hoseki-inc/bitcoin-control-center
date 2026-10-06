// @vitest-environment node
import * as pdfRenderer from '@hoseki/packages/pdf'
import { sampleCustomStatement } from '@hoseki/packages/pdf/preview/presets'
import type { PdfStatement } from '@hoseki/packages/schemas'
import { type ReactElement, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { type MockInstance, describe, expect, it, onTestFinished, vi } from 'vitest'
import { useRenderedStatement } from './use-rendered-statement'

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
let render: MockInstance<typeof pdfRenderer.renderStatementDocument>
const usd: PdfStatement = sampleCustomStatement
const cad: PdfStatement = { ...sampleCustomStatement, quoteCurrency: 'CAD' }
function deferred() {
  let resolve!: (value: ReactElement) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ReactElement>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
let container: HTMLDivElement
let root: Root
function Preview({ data, enabled = true }: { data?: PdfStatement; enabled?: boolean }) {
  const preview = useRenderedStatement(data, enabled)
  return createElement(
    'div',
    {},
    createElement('button', { disabled: !preview.document }, 'Generate'),
    createElement('button', { onClick: preview.retry }, 'Retry'),
    preview.isRendering ? 'Loading' : (preview.error ?? preview.document),
  )
}
async function show(data?: PdfStatement, enabled = true): Promise<void> {
  await act(async () => {
    root.render(createElement(Preview, { data, enabled }))
  })
}
function setup(): void {
  const dom = browser.acquire()
  render = vi.spyOn(pdfRenderer, 'renderStatementDocument')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })
}
describe('statement preview updates', () => {
  it('disables generation while rendering and ignores an older currency that finishes last', async () => {
    setup()
    const old = deferred(),
      current = deferred()
    render.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await show(usd)
    expect(container.querySelector('button')?.disabled).toBe(true)
    await show(cad)
    await act(async () => {
      current.resolve(createElement('span', {}, 'CAD PDF'))
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(container.querySelector('button')?.disabled).toBe(false)
    await act(async () => {
      old.resolve(createElement('span', {}, 'USD PDF'))
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(container.textContent).not.toContain('USD PDF')
  })
  it('immediately hides a completed preview when inputs change', async () => {
    setup()
    render.mockResolvedValueOnce(createElement('span', {}, 'USD PDF')).mockReturnValueOnce(deferred().promise)
    await show(usd)
    expect(container.textContent).toContain('USD PDF')
    await show(cad)
    expect(container.textContent).not.toContain('USD PDF')
    expect(container.textContent).toContain('Loading')
    expect(container.querySelector('button')?.disabled).toBe(true)
  })
  it('shows a retryable error and enables generation only when retry succeeds', async () => {
    setup()
    render
      .mockRejectedValueOnce(new Error('renderer failed'))
      .mockResolvedValueOnce(createElement('span', {}, 'CAD PDF'))
    await show(cad)
    expect(container.textContent).toContain('Failed to render statement preview')
    expect(container.querySelector('button')?.disabled).toBe(true)
    await act(async () => {
      const retry = container.querySelectorAll('button')[1]
      if (!retry) {
        expect.fail('Expected a retry button')
      }
      retry.click()
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(container.querySelector('button')?.disabled).toBe(false)
  })
  it('ignores a late failure after closing the preview', async () => {
    setup()
    const pending = deferred()
    render.mockReturnValue(pending.promise)
    await show(usd)
    await show(usd, false)
    await act(async () => {
      pending.reject(new Error('late failure'))
    })
    expect(container.textContent).not.toContain('Failed to render statement preview')
    expect(container.querySelector('button')?.disabled).toBe(true)
  })
})
