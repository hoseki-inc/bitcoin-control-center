// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { HardwareDeviceError } from '../../wallet'
import { HardwareWalletError, type HardwareWalletErrorProps } from './hardware-wallet-error'

await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  installBrowserDom(createBrowserDom())
})

let root: Root
let host: HTMLDivElement

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  await run()
}

async function renderError(error: HardwareWalletErrorProps['error']): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <HardwareWalletError error={error} />
      </ChakraProvider>,
    )
  })
}

it('renders a string message as is without an Unknown error prefix', async () => {
  await withTestSetup(async () => {
    await renderError('Error signing message')
    expect(host.textContent).toContain('Error signing message')
    expect(host.textContent).not.toContain('Unknown error')
  })
})

it('renders the friendly message for a HardwareDeviceError', async () => {
  await withTestSetup(async () => {
    await renderError(new HardwareDeviceError('raw-device-error', 'ledger', 'Signing canceled'))
    expect(host.textContent).toContain('Signing canceled')
    expect(host.textContent).not.toContain('raw-device-error')
    expect(host.textContent).not.toContain('Unknown error')
  })
})

it('renders Unknown error prefix for a plain Error', async () => {
  await withTestSetup(async () => {
    await renderError(new Error('x'))
    expect(host.textContent).toContain('Unknown error: x')
  })
})
