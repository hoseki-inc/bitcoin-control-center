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

it('keeps investments inside the existing Track card', async () => {
  const container = await render(<AddAccountFlow onClose={() => undefined} />)

  expect(links(container).slice(-2)).toEqual([
    ['Manually Sign', '/accounts/verify/advanced'],
    ['Track Balance, ETF,\nor xpub', '/accounts/verify/manual-type'],
  ])
  expect(container.textContent).not.toContain('Advanced')
  expect(container.textContent).not.toContain('Manual Entry')
  expect(container.textContent).not.toContain('Other Bitcoin Investments')
})

it('offers Investment Balance as the fourth tracking option', async () => {
  const container = await render(<ManualTypeSelectorPage />)

  expect(container.querySelector('h1, h2')?.textContent).toBe('Track Balance, ETF, or xpub')
  expect(
    links(container)
      .slice(1)
      .map(([, href]) => href),
  ).toEqual([
    '/accounts/verify/manual',
    '/accounts/verify/etf',
    '/accounts/verify/track',
    '/accounts/verify/investments',
  ])
  expect(container.textContent).not.toContain('Other Bitcoin Investments')
  expect(container.textContent).toContain('xpub or Descriptor')
  const investmentCard = container.querySelector('a[href="/accounts/verify/investments"]')
  expect(investmentCard?.textContent).toContain('Investment Balance')
  expect(investmentCard?.textContent).toContain('New')
  expect(investmentCard?.textContent).toContain(
    'Track the USD balance of Bitcoin treasury stocks, preferred shares, and other investments.',
  )
  expect(container.textContent).toContain(
    "Track a wallet's live balance, single-sig or multisig, without proving ownership.",
  )
})
