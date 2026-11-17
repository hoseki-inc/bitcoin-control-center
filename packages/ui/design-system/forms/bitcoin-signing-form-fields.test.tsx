// @vitest-environment node
import { Wallets } from '@hoseki/packages/testing'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { BitcoinSigningFormFields } from './bitcoin-signing-form-fields'

const dom = await vi.hoisted(async () => {
  // Keep Node's byte-array globals for the real Bitcoin parsers while rendering in a DOM.
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  const browserDom = createBrowserDom()
  installBrowserDom(browserDom)
  return browserDom
})

it('reports a cleared signature as required, not as an invalid extended public key', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  await act(async () => {
    root.render(
      <ChakraProvider>
        <BitcoinSigningFormFields message="Sign this" address={Wallets.satoshiAddress} setSignature={() => {}} />
      </ChakraProvider>,
    )
  })

  const textarea = host.querySelector('#signature')
  assert(textarea instanceof dom.window.HTMLTextAreaElement)
  const descriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')
  for (const value of ['signature', '']) {
    await act(async () => {
      assert(descriptor?.set !== undefined)
      descriptor.set.call(textarea, value)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  expect(host.textContent).toContain('Signature is required')
  expect(host.textContent).not.toContain('xPub')
})
