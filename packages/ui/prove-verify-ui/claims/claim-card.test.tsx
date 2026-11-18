// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { createBrowserDom } from '../../../testing/browser-dom'
import { ClaimCardKeystores } from './claim-card'

// A DOM only to read the markup back: a global jsdom would break the Bitcoin SDK's byte arrays.
const { document } = createBrowserDom().window

function render(element: JSX.Element): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<ChakraProvider>{element}</ChakraProvider>)
  return host
}

/** The images a screen reader reaches: not inside a hidden subtree, and not inside another image. */
function announcedImages(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[role="img"], img'))
    .filter((el) => el.parentElement?.closest('[aria-hidden="true"], [role="img"]') == null)
    .filter((el) => el.getAttribute('aria-hidden') !== 'true')
    .map((el) => el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? '(unnamed)')
}

it('names a known device logo and hides the generic picture of a watch-only wallet', () => {
  const device = render(
    <ClaimCardKeystores keystores={[{ id: 'k1', wallet: 'ledger' }]} alt="Savings" status="verified" />,
  )
  expect(announcedImages(device)).toEqual(['ledger wallet'])

  const watchOnly = render(
    <ClaimCardKeystores keystores={[{ id: 'k1', wallet: null }]} alt="Savings" status="unverified" />,
  )
  expect(announcedImages(watchOnly)).toEqual([])
  expect(watchOnly.innerHTML).not.toContain('null wallet')
})

it('names identified multisig keys and hides unidentified ones', () => {
  const host = render(
    <ClaimCardKeystores
      keystores={[
        { id: 'k1', wallet: 'trezor', isVerified: true },
        { id: 'k2', wallet: null },
        { id: 'k3', wallet: null },
      ]}
      alt="Family vault"
      status="pending"
    />,
  )
  expect(announcedImages(host)).toEqual(['trezor wallet'])
  expect(host.innerHTML).not.toContain('null wallet')
})
