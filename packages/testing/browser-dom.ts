import { JSDOM } from 'jsdom'
import { vi } from 'vitest'
import { installAnimationPlaceholder } from './animation-dom'

export function createBrowserDom(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  })
  installAnimationPlaceholder(dom.window.HTMLCanvasElement)
  dom.window.matchMedia = (media) => ({
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  return dom
}

/** Install browser APIs while retaining Node's byte-array globals for the Bitcoin SDK. */
export function installBrowserDom(dom: JSDOM): void {
  const { window } = dom
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    // Chakra's modal focus trap checks for iframes.
    HTMLIFrameElement: window.HTMLIFrameElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    FileReader: window.FileReader,
    localStorage: window.localStorage,
    matchMedia: window.matchMedia.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [name, value] of Object.entries(globals)) {
    vi.stubGlobal(name, value)
  }
}
