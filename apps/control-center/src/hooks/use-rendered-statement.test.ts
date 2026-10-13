// @vitest-environment node
import * as pdfRenderer from '@hoseki/packages/pdf'
import { sampleCustomStatement } from '@hoseki/packages/pdf/preview/presets'
import type { PdfStatement } from '@hoseki/packages/schemas'
import { act, createElement } from 'react'
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
let render: MockInstance<typeof pdfRenderer.renderStatementPdf>
let revoke: MockInstance<typeof URL.revokeObjectURL>
const usd: PdfStatement = sampleCustomStatement
const cad: PdfStatement = { ...sampleCustomStatement, quoteCurrency: 'CAD' }
// Each built PDF's object URL names it, so tests can tell which one is shown.
const pdfNames = new Map<unknown, string>()
function pdfFile(name: string): Blob {
  const file = new Blob()
  pdfNames.set(file, name)
  return file
}
function deferred() {
  let resolve!: (value: Blob) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Blob>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
let container: HTMLDivElement
let root: Root
function Viewer({ data, enabled = true }: { data?: PdfStatement; enabled?: boolean }) {
  const rendered = useRenderedStatement(data, enabled)
  return createElement(
    'div',
    { 'data-ready': rendered.url !== null },
    createElement('button', { onClick: rendered.retry }, 'Retry'),
    rendered.isRendering ? 'Loading' : (rendered.error ?? rendered.url),
  )
}
const isReady = (): boolean => container.querySelector('[data-ready]')?.getAttribute('data-ready') === 'true'
async function show(data?: PdfStatement, enabled = true): Promise<void> {
  await act(async () => {
    root.render(createElement(Viewer, { data, enabled }))
  })
}
function setup(): void {
  const dom = browser.acquire()
  render = vi.spyOn(pdfRenderer, 'renderStatementPdf')
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${pdfNames.get(file)}`)
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
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
describe('rendered statement updates', () => {
  it('has no document while rendering and ignores an older currency that finishes last', async () => {
    setup()
    const old = deferred(),
      current = deferred()
    render.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await show(usd)
    expect(isReady()).toBe(false)
    await show(cad)
    await act(async () => {
      current.resolve(pdfFile('CAD PDF'))
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(isReady()).toBe(true)
    await act(async () => {
      old.resolve(pdfFile('USD PDF'))
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(container.textContent).not.toContain('USD PDF')
  })
  it('immediately hides a completed render when inputs change, and releases it', async () => {
    setup()
    render.mockResolvedValueOnce(pdfFile('USD PDF')).mockReturnValueOnce(deferred().promise)
    await show(usd)
    expect(container.textContent).toContain('USD PDF')
    await show(cad)
    expect(container.textContent).not.toContain('USD PDF')
    expect(container.textContent).toContain('Loading')
    expect(isReady()).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:USD PDF')
  })
  it('shows a retryable error and has a PDF only when retry succeeds', async () => {
    setup()
    render.mockRejectedValueOnce(new Error('renderer failed')).mockResolvedValueOnce(pdfFile('CAD PDF'))
    await show(cad)
    expect(container.textContent).toContain('Failed to render statement')
    expect(isReady()).toBe(false)
    await act(async () => {
      const retry = container.querySelector('button')
      if (!retry) {
        expect.fail('Expected a retry button')
      }
      retry.click()
    })
    expect(container.textContent).toContain('CAD PDF')
    expect(isReady()).toBe(true)
  })
  it('ignores a late failure after the viewer closes', async () => {
    setup()
    const pending = deferred()
    render.mockReturnValue(pending.promise)
    await show(usd)
    await show(usd, false)
    await act(async () => {
      pending.reject(new Error('late failure'))
    })
    expect(container.textContent).not.toContain('Failed to render statement')
    expect(isReady()).toBe(false)
  })
})
