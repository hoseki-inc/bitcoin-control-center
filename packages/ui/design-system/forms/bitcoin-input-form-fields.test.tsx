// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { Network, NetworkAccount } from '@hoseki/packages/bitcoin'
import { Wallets } from '@hoseki/packages/testing'
import { type Dispatch, type SetStateAction, StrictMode, act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterAll, afterEach, assert, beforeEach, expect, it, vi } from 'vitest'
import type { BitcoinInput } from '../../utils/bitcoin'
import { BitcoinInputFormFields } from './bitcoin-input-form-fields'

const dom = await vi.hoisted(async () => {
  // Keep Node's byte-array globals for the real Bitcoin parsers while rendering in a DOM.
  const { JSDOM } = await import('jsdom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  })
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Event: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  }
  for (const [name, value] of Object.entries(globals)) {
    vi.stubGlobal(name, value)
  }
  return { window, globals }
})

const onParentRender = vi.fn<(input: BitcoinInput | null) => void>()
let root: Root
let host: HTMLDivElement

function StatefulForm({ initialValue }: { initialValue?: BitcoinInput }): JSX.Element {
  const [input, setInput] = useState<BitcoinInput | null>(initialValue ?? null)
  // Fail promptly if an effect repeatedly republishes a fresh object into parent state.
  assert.isBelow(onParentRender.mock.calls.length, 30, 'The form must settle without a render loop')
  onParentRender(input)
  return <BitcoinInputFormFields setBitcoinInput={setInput} defaultValues={input ?? undefined} />
}

beforeEach(() => {
  onParentRender.mockClear()
  for (const [name, value] of Object.entries(dom.globals)) {
    vi.stubGlobal(name, value)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.unstubAllGlobals()
})

afterAll(() => {
  dom.window.close()
})

async function render(initialValue?: BitcoinInput): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        <ChakraProvider>
          <StatefulForm initialValue={initialValue} />
        </ChakraProvider>
      </StrictMode>,
    )
  })
}

async function changeValue(selector: string, value: string): Promise<void> {
  const input = host.querySelector(selector)
  assert(
    input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement,
  )
  const prototype =
    input instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  await act(async () => {
    assert(descriptor?.set !== undefined)
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function publishedInput(): BitcoinInput {
  const input = onParentRender.mock.lastCall?.[0]
  assert.exists(input, 'Expected a parsed account in parent state')
  return input
}

it.each([
  { name: 'extended public key', raw: Wallets.legacyXpub.toString(), scriptType: 'p2pkh' },
  { name: 'descriptor', raw: Wallets.singlesigNativeSegwitAccount.descriptor(), scriptType: 'p2wpkh' },
])('settles after publishing an $name and still responds to edits', async ({ raw, scriptType }) => {
  await render()
  await changeValue('#bitcoin-source', raw)
  const input = publishedInput()
  expect(input.rawInput).toBe(raw)
  expect(input.data.account.scriptType).toBe(scriptType)
  expect(input.data.network).toBe(Network.Mainnet)

  await render()
  expect(publishedInput()).toBe(input)

  await changeValue('#display-name', 'Updated account')
  expect(publishedInput().displayName).toBe('Updated account')
  expect(publishedInput().data.account.descriptor()).toBe(input.data.account.descriptor())

  await changeValue('#bitcoin-source', 'invalid account')
  expect(onParentRender.mock.lastCall?.[0]).toBeNull()
  expect(host.textContent).toContain('Invalid input')
})

it('preserves the selected script type through parent feedback and unrelated renders', async () => {
  const initialValue: BitcoinInput = {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, Wallets.singlesigNativeSegwitAccount),
    rawInput: Wallets.nativeSegwitXpub.toString(),
    displayName: 'Saved account',
  }
  await render(initialValue)
  expect(publishedInput().data.account.scriptType).toBe('p2wpkh')
  const radio = host.querySelector('input[type="radio"][value="Taproot (P2TR)"]')
  assert(radio instanceof HTMLInputElement)
  await act(async () => {
    radio.click()
  })
  expect(publishedInput().data.account.scriptType).toBe('p2tr')
  await changeValue('#display-name', 'Renamed account')
  await render(initialValue)
  expect(publishedInput().data.account.scriptType).toBe('p2tr')
})

it('preserves explicit network selection after parsing a testnet descriptor', async () => {
  const raw =
    'pkh(tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA/<0;1>/*)#c4nu0fm0'
  await render()
  await changeValue('#bitcoin-source', raw)
  expect(publishedInput().data.network).toBe(Network.Regtest)
  await changeValue('select', 'bitcoin_testnet')
  expect(publishedInput().data.network).toBe(Network.Testnet)
  await changeValue('#display-name', 'Testnet account')
  await render()
  expect(publishedInput().data.network).toBe(Network.Testnet)
})

it('publishes to a replacement setter even when the input text is unchanged', async () => {
  const initialValue: BitcoinInput = {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, Wallets.singlesigLegacyAccount),
    rawInput: Wallets.legacyXpub.toString(),
    displayName: 'Account',
  }
  const first = vi.fn<Dispatch<SetStateAction<BitcoinInput | null>>>()
  const second = vi.fn<Dispatch<SetStateAction<BitcoinInput | null>>>()
  for (const setter of [first, second]) {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <BitcoinInputFormFields setBitcoinInput={setter} defaultValues={initialValue} />
        </ChakraProvider>,
      )
    })
    expect(setter).toHaveBeenCalledWith(expect.objectContaining({ rawInput: initialValue.rawInput }))
  }
  expect(first).toHaveBeenCalledOnce()
  expect(second).toHaveBeenCalledOnce()
})
