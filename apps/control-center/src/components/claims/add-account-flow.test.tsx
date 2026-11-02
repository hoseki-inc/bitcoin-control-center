// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ManualTypeSelectorPage } from '../../pages/claims/verify/manual-type'
import { AddAccountFlow } from './add-account-flow'

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

async function render(element: JSX.Element): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  vi.stubGlobal('Image', document.defaultView?.Image)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestChakraProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </TestChakraProvider>,
    )
  })
  return container
}

/** Each link's text and where it goes. */
function links(container: HTMLElement): [string, string | null][] {
  return Array.from(container.querySelectorAll('a')).map((link) => [link.textContent, link.getAttribute('href')])
}

it('ends the Add Account grid with Manually Sign and Track, without the Advanced section', async () => {
  const container = await render(<AddAccountFlow onClose={() => undefined} />)

  expect(links(container).slice(-2)).toEqual([
    ['Manually Sign', '/accounts/verify/advanced'],
    ['Track Balance, ETF,\nor xpub', '/accounts/verify/manual-type'],
  ])
  expect(container.textContent).not.toContain('Advanced')
  expect(container.textContent).not.toContain('Manual Entry')
})

it('offers Bitcoin Holdings, ETF and xpub or Descriptor to track', async () => {
  const container = await render(<ManualTypeSelectorPage />)

  expect(container.querySelector('h1, h2')?.textContent).toBe('Track Balance, ETF, or xpub')
  expect(
    links(container)
      .slice(1)
      .map(([, href]) => href),
  ).toEqual(['/accounts/verify/manual', '/accounts/verify/etf', '/accounts/verify/track'])
  expect(container.textContent).toContain('xpub or Descriptor')
  expect(container.textContent).toContain(
    "Track a wallet's live balance, single-sig or multisig, without proving ownership.",
  )
})
