// @vitest-environment jsdom
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useIsMobile } from './use-is-mobile'

let root: Root
let container: HTMLDivElement

function Probe(): React.ReactElement {
  return createElement('output', null, useIsMobile() ? 'mobile' : 'desktop')
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 1024)
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([
  ['mobile user agent', 'iPhone', '', undefined, 'mobile'],
  ['vendor fallback', '', 'Android', undefined, 'mobile'],
  ['Opera fallback', '', '', 'Opera Mini', 'mobile'],
  ['missing identification', '', '', undefined, 'desktop'],
  ['empty identification', '', '', '', 'desktop'],
  ['user agent precedence', 'Desktop Browser', 'Android', 'Opera Mini', 'desktop'],
  ['vendor precedence', '', 'Desktop Vendor', 'Opera Mini', 'desktop'],
] as const)('uses %s on a wide screen', async (_label, userAgent, vendor, opera, expected) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue(vendor)
  vi.stubGlobal('opera', opera)

  await act(async () => {
    root.render(createElement(Probe))
  })

  expect(container.textContent).toBe(expected)
})

it('updates the screen-width fallback on resize when browser identification is empty', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('')
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('')
  vi.stubGlobal('opera', undefined)
  await act(async () => {
    root.render(createElement(Probe))
  })
  expect(container.textContent).toBe('desktop')

  vi.stubGlobal('innerWidth', 768)
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
  })
  expect(container.textContent).toBe('mobile')

  vi.stubGlobal('innerWidth', 769)
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
  })
  expect(container.textContent).toBe('desktop')
})
