// @vitest-environment node
import { Box } from '@chakra-ui/react'
import { Network, NetworkAccount } from '@hoseki/packages/bitcoin'
import { Wallets } from '@hoseki/packages/testing'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { type Dispatch, type SetStateAction, StrictMode, act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { BitcoinInput } from '../../utils/bitcoin'
import { BitcoinInputFormFields } from './bitcoin-input-form-fields'
import type { ScriptTypeBalances } from './script-type-radio-group'

const acquireDom = await vi.hoisted(async () => {
  // Keep Node's byte-array globals for the real Bitcoin parsers while rendering in a DOM.
  const { JSDOM } = await import('jsdom')
  function createDom() {
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

    return globals
  }
  let initialDom: ReturnType<typeof createDom> | undefined = createDom()
  for (const [name, value] of Object.entries(initialDom)) {
    vi.stubGlobal(name, value)
  }
  function takeDom() {
    const globalsForTest = initialDom ?? createDom()
    initialDom = undefined
    return globalsForTest
  }

  return takeDom
})

const onParentRender = vi.fn<(input: BitcoinInput | null) => void>()
let root: Root
let host: HTMLDivElement

function StatefulForm({
  initialValue,
  scriptTypeBalances,
  onRawInputChange,
}: {
  initialValue?: BitcoinInput
  scriptTypeBalances?: ScriptTypeBalances
  onRawInputChange?: (raw: string) => void
}): JSX.Element {
  const [input, setInput] = useState<BitcoinInput | null>(initialValue ?? null)
  // Fail promptly if an effect repeatedly republishes a fresh object into parent state.
  assert.isBelow(onParentRender.mock.calls.length, 30, 'The form must settle without a render loop')
  onParentRender(input)
  return (
    <BitcoinInputFormFields
      setBitcoinInput={setInput}
      defaultValues={input ?? undefined}
      scriptTypeBalances={scriptTypeBalances}
      onRawInputChange={onRawInputChange}
    />
  )
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const domGlobals = acquireDom()

  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    } finally {
      vi.unstubAllGlobals()
      domGlobals.window.close()
    }
  })
  onParentRender.mockClear()
  for (const [name, value] of Object.entries(domGlobals)) {
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

  await run()
}

async function render(
  initialValue?: BitcoinInput,
  options?: { scriptTypeBalances?: ScriptTypeBalances; onRawInputChange?: (raw: string) => void },
): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        <ChakraProvider>
          <StatefulForm
            initialValue={initialValue}
            scriptTypeBalances={options?.scriptTypeBalances}
            onRawInputChange={options?.onRawInputChange}
          />
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

const bip32Vector1Xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
const testYpub =
  'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK'
const testZpub =
  'zpub6rTqhQyDDidVGmbSL1AAK4J8untSw4NKtK9ZbaeW4u6HcWuvTrxNUoAzrCFraECK9DNXybWkVPgsze6c9sWsfKnMXYEapnNTF1d7Hv5PP31'

function scriptTypeRadios(): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('input[name="encoding"]'))
}

function checkedScriptType(): string | undefined {
  return scriptTypeRadios().find((radio) => radio.checked)?.value
}

async function pickScriptType(label: string): Promise<void> {
  const radio = host.querySelector(`input[type="radio"][name="encoding"][value="${label}"]`)
  assert(radio instanceof HTMLInputElement, `Expected the ${label} radio`)
  await act(async () => {
    radio.click()
  })
}

it('requires a script type before publishing a plain xpub', async () => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#display-name', 'UX-023 vector')
    await changeValue('#bitcoin-source', bip32Vector1Xpub)

    expect(scriptTypeRadios().map((radio) => radio.value)).toEqual([
      'Legacy (P2PKH)',
      'Nested SegWit (P2SH)',
      'Native SegWit (P2WPKH)',
      'Taproot (P2TR)',
    ])
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()
    expect(host.textContent).not.toContain('Encoding is required')

    await pickScriptType('Legacy (P2PKH)')
    expect(checkedScriptType()).toBe('Legacy (P2PKH)')
    expect(publishedInput().data.account.descriptor()).toBe(`pkh(${bip32Vector1Xpub}/<0;1>/*)#nusm4y9w`)
  })
})

it('requires another choice for a different bare key', async () => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#bitcoin-source', bip32Vector1Xpub)
    await pickScriptType('Taproot (P2TR)')
    expect(checkedScriptType()).toBe('Taproot (P2TR)')
    expect(publishedInput().data.account.scriptType).toBe('p2tr')

    await changeValue('#bitcoin-source', Wallets.legacyXpub.toString())
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()
  })
})

it.each([
  { name: 'Legacy descriptor', raw: Wallets.singlesigLegacyAccount.descriptor() },
  { name: 'Nested SegWit descriptor', raw: Wallets.singlesigNestedSegwitAccount.descriptor() },
  { name: 'Native SegWit descriptor', raw: Wallets.singlesigNativeSegwitAccount.descriptor() },
  { name: 'Taproot descriptor', raw: Wallets.singlesigTaprootAccount.descriptor() },
  { name: 'zpub', raw: testZpub },
])('settles with no script type selected when a $name is replaced by a plain xpub', async ({ raw }) => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#bitcoin-source', raw)
    onParentRender.mockClear()

    await changeValue('#bitcoin-source', bip32Vector1Xpub)
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()
  })
})

it('uses the implied script type for ypub and zpub after a plain-xpub pick', async () => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#bitcoin-source', bip32Vector1Xpub)
    await pickScriptType('Taproot (P2TR)')
    expect(publishedInput().data.account.scriptType).toBe('p2tr')

    await changeValue('#bitcoin-source', testYpub)
    expect(scriptTypeRadios()).toHaveLength(0)
    expect(publishedInput().data.account.scriptType).toBe('p2sh-p2wpkh')

    await changeValue('#bitcoin-source', testZpub)
    expect(scriptTypeRadios()).toHaveLength(0)
    expect(publishedInput().data.account.scriptType).toBe('p2wpkh')
  })
})

it.each([
  {
    name: 'extended public key',
    raw: Wallets.legacyXpub.toString(),
    pickLabel: 'Legacy (P2PKH)',
    scriptType: 'p2pkh',
  },
  {
    name: 'descriptor',
    raw: Wallets.singlesigNativeSegwitAccount.descriptor(),
    pickLabel: undefined,
    scriptType: 'p2wpkh',
  },
])('settles after publishing an $name and still responds to edits', async ({ raw, pickLabel, scriptType }) => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#bitcoin-source', raw)
    if (pickLabel !== undefined) {
      await pickScriptType(pickLabel)
    }
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
})

it.each([
  {
    label: 'Legacy (P2PKH)',
    account: Wallets.singlesigLegacyAccount,
    raw: Wallets.legacyXpub.toString(),
    overrideLabel: 'Taproot (P2TR)',
    overrideScriptType: 'p2tr',
  },
  {
    label: 'Nested SegWit (P2SH)',
    account: Wallets.singlesigNestedSegwitAccount,
    raw: Wallets.nestedSegwitXpub.toString(),
    overrideLabel: 'Native SegWit (P2WPKH)',
    overrideScriptType: 'p2wpkh',
  },
  {
    label: 'Native SegWit (P2WPKH)',
    account: Wallets.singlesigNativeSegwitAccount,
    raw: Wallets.nativeSegwitXpub.toString(),
    overrideLabel: 'Taproot (P2TR)',
    overrideScriptType: 'p2tr',
  },
  {
    label: 'Taproot (P2TR)',
    account: Wallets.singlesigTaprootAccount,
    raw: Wallets.taproot.toString(),
    overrideLabel: 'Legacy (P2PKH)',
    overrideScriptType: 'p2pkh',
  },
])(
  'preserves the saved $label script type through rename, rerender, and override',
  async ({ label, account, raw, overrideLabel, overrideScriptType }) => {
    await withTestSetup(async () => {
      const initialValue: BitcoinInput = {
        variant: 'singlesig',
        data: new NetworkAccount(Network.Mainnet, account),
        rawInput: raw,
        displayName: 'Saved account',
      }
      await render(initialValue)
      expect(checkedScriptType()).toBe(label)
      expect(publishedInput().data.account.descriptor()).toBe(account.descriptor())

      await changeValue('#display-name', 'Renamed account')
      expect(checkedScriptType()).toBe(label)
      expect(publishedInput().data.account.descriptor()).toBe(account.descriptor())

      await render(initialValue)
      expect(checkedScriptType()).toBe(label)
      expect(publishedInput().data.account.descriptor()).toBe(account.descriptor())

      await pickScriptType(overrideLabel)
      expect(checkedScriptType()).toBe(overrideLabel)
      expect(publishedInput().data.account.scriptType).toBe(overrideScriptType)

      await changeValue('#display-name', 'Overridden account')
      await render(initialValue)
      expect(checkedScriptType()).toBe(overrideLabel)
      expect(publishedInput().data.account.scriptType).toBe(overrideScriptType)
    })
  },
)

it('preserves explicit network selection after parsing a testnet descriptor', async () => {
  await withTestSetup(async () => {
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
})

it('publishes to a replacement setter even when the input text is unchanged', async () => {
  await withTestSetup(async () => {
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
})

it.each([1, 2])('preserves Chakra visibility styles across test documents (%s)', async () => {
  await withTestSetup(async () => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <Box data-style-probe display="none">
            Style probe
          </Box>
        </ChakraProvider>,
      )
    })
    const probe = host.querySelector('[data-style-probe]')
    assert.exists(probe)
    expect(getComputedStyle(probe).display).toBe('none')

    await act(async () => {
      root.render(
        <ChakraProvider>
          <Box data-style-probe display="flex">
            Style probe
          </Box>
        </ChakraProvider>,
      )
    })
    expect(getComputedStyle(probe).display).toBe('flex')
  })
})

it('explains how to abandon and re-add when the script-type balance looks wrong', async () => {
  await withTestSetup(async () => {
    await render()
    await changeValue('#bitcoin-source', Wallets.legacyXpub.toString())
    const label = host.querySelector('label[for="encoding"]')
    assert.exists(label)
    const trigger = label.parentElement?.querySelector('svg')
    assert.exists(trigger)
    await act(async () => {
      trigger.dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }))
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    const tooltip = document.querySelector('[role="tooltip"]')
    assert.exists(tooltip)
    expect(tooltip.textContent).toBe(
      "Not sure? Pick one and check the balance. If it's wrong, abandon it and try another.",
    )
  })
})

it('auto-selects a uniquely funded script type without overriding a manual pick', async () => {
  await withTestSetup(async () => {
    const onRawInputChange = vi.fn<(raw: string) => void>()
    const scanning: ScriptTypeBalances = {
      p2pkh: { status: 'loaded', balanceSats: 0n },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 0n },
      p2wpkh: { status: 'loading' },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: scanning, onRawInputChange })
    await changeValue('#bitcoin-source', bip32Vector1Xpub)
    expect(onRawInputChange).toHaveBeenCalledWith(bip32Vector1Xpub)
    expect(host.textContent).toContain('Scanning…')
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()

    const rolling: ScriptTypeBalances = {
      p2pkh: { status: 'loaded', balanceSats: 0n },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 0n },
      p2wpkh: { status: 'loading', balanceSats: 25_000_000n },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: rolling, onRawInputChange })
    expect(host.textContent).toContain('0.25000000 BTC')
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()

    const uniqueMatch: ScriptTypeBalances = {
      p2pkh: { status: 'loaded', balanceSats: 0n },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 0n },
      p2wpkh: { status: 'loaded', balanceSats: 100_000_000n },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: uniqueMatch, onRawInputChange })
    expect(host.textContent).toContain('1.00000000 BTC')
    expect(checkedScriptType()).toBe('Native SegWit (P2WPKH)')
    expect(publishedInput().data.account.scriptType).toBe('p2wpkh')

    await pickScriptType('Legacy (P2PKH)')
    expect(checkedScriptType()).toBe('Legacy (P2PKH)')
    expect(publishedInput().data.account.scriptType).toBe('p2pkh')
  })
})

it('keeps selection empty when multiple script types are funded or when balance checks fail', async () => {
  await withTestSetup(async () => {
    const multipleFunded: ScriptTypeBalances = {
      p2pkh: { status: 'loaded', balanceSats: 5_000n },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 0n },
      p2wpkh: { status: 'loaded', balanceSats: 142_000_000n },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: multipleFunded })
    await changeValue('#bitcoin-source', bip32Vector1Xpub)
    expect(host.textContent).toContain('0.00005000 BTC')
    expect(host.textContent).toContain('1.42000000 BTC')
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()

    const partialError: ScriptTypeBalances = {
      p2pkh: { status: 'error' },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 0n },
      p2wpkh: { status: 'loaded', balanceSats: 100_000_000n },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: partialError })
    expect(host.textContent).toContain('Balance unavailable')
    expect(checkedScriptType()).toBeUndefined()
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()
  })
})

it('trims surrounding spaces, tabs, and newlines on pasted keys and descriptors', async () => {
  await withTestSetup(async () => {
    await render()

    await changeValue('#bitcoin-source', ' \t\n ')
    expect(host.textContent).not.toContain('Invalid input')
    expect(onParentRender.mock.lastCall?.[0]).toBeNull()

    await changeValue('#bitcoin-source', `\t ${bip32Vector1Xpub}\n`)
    expect(host.textContent).not.toContain('Invalid input')
    expect(scriptTypeRadios()).toHaveLength(4)
    expect(checkedScriptType()).toBeUndefined()
    await pickScriptType('Native SegWit (P2WPKH)')
    expect(publishedInput().rawInput).toBe(bip32Vector1Xpub)
    expect(publishedInput().data.account.scriptType).toBe('p2wpkh')

    await changeValue('#bitcoin-source', `  ${testZpub}\t\n`)
    expect(host.textContent).not.toContain('Invalid input')
    expect(scriptTypeRadios()).toHaveLength(0)
    expect(publishedInput().rawInput).toBe(testZpub)
    expect(publishedInput().data.account.scriptType).toBe('p2wpkh')

    const descriptor = Wallets.singlesigTaprootAccount.descriptor()
    await changeValue('#bitcoin-source', `\n\t${descriptor}\n`)
    expect(host.textContent).not.toContain('Invalid input')
    expect(publishedInput().rawInput).toBe(descriptor)
    expect(publishedInput().data.account.scriptType).toBe('p2tr')
  })
})

it('exposes accessible radio names and descriptions without hiding labels behind aria-hidden', async () => {
  const accessibleText = (element: Element): string => {
    if (element.closest('[aria-hidden="true"]') !== null) {
      return ''
    }
    const parts: string[] = []
    const walk = (node: Node): void => {
      if (node.nodeType === 3) {
        parts.push(node.textContent ?? '')
        return
      }
      if (node instanceof window.Element) {
        if (node.getAttribute('aria-hidden') === 'true') {
          return
        }
        for (const child of node.childNodes) {
          walk(child)
        }
      }
    }
    walk(element)
    return parts.join('').replace(/\s+/g, ' ').trim()
  }

  const resolveIdsText = (ids: string | null): string =>
    (ids ?? '')
      .split(/\s+/)
      .filter((id) => id !== '')
      .map((id) => {
        const target = document.getElementById(id)
        assert.exists(target, `Expected referenced element #${id}`)
        expect(target.closest('[aria-hidden="true"]')).toBeNull()
        return accessibleText(target)
      })
      .join(' ')
      .trim()

  await withTestSetup(async () => {
    const balances: ScriptTypeBalances = {
      p2pkh: { status: 'error' },
      'p2sh-p2wpkh': { status: 'loading' },
      p2wpkh: { status: 'loaded', balanceSats: 100_000_000n },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: balances })
    await changeValue('#bitcoin-source', bip32Vector1Xpub)

    const group = host.querySelector('[role="radiogroup"]')
    assert.exists(group)
    expect(group.getAttribute('aria-label')).toBe('Script type')

    const radios = scriptTypeRadios()
    expect(radios).toHaveLength(4)

    const resolved = radios.map((radio) => ({
      name: resolveIdsText(radio.getAttribute('aria-labelledby')),
      description: resolveIdsText(radio.getAttribute('aria-describedby')),
    }))

    expect(resolved).toEqual([
      { name: 'Legacy (P2PKH)', description: '1… Balance unavailable' },
      { name: 'Nested SegWit (P2SH)', description: '3… Scanning…' },
      { name: 'Native SegWit (P2WPKH)', description: 'bc1q… 1.00000000 BTC' },
      { name: 'Taproot (P2TR)', description: 'bc1p… 0 BTC' },
    ])

    const hiddenDecoratives = Array.from(group.querySelectorAll('[aria-hidden="true"]'))
    expect(hiddenDecoratives.length).toBeGreaterThanOrEqual(3)

    const progressiveBalances: ScriptTypeBalances = {
      p2pkh: { status: 'loading', balanceSats: 25_000_000n },
      'p2sh-p2wpkh': { status: 'loaded', balanceSats: 25_000_000n },
      p2wpkh: { status: 'loading' },
      p2tr: { status: 'loaded', balanceSats: 0n },
    }
    await render(undefined, { scriptTypeBalances: progressiveBalances })

    const progressiveResolved = scriptTypeRadios().map((radio) => ({
      name: resolveIdsText(radio.getAttribute('aria-labelledby')),
      description: resolveIdsText(radio.getAttribute('aria-describedby')),
    }))

    expect(progressiveResolved).toEqual([
      { name: 'Legacy (P2PKH)', description: '1… 0.25000000 BTC Scanning…' },
      { name: 'Nested SegWit (P2SH)', description: '3… 0.25000000 BTC' },
      { name: 'Native SegWit (P2WPKH)', description: 'bc1q… Scanning…' },
      { name: 'Taproot (P2TR)', description: 'bc1p… 0 BTC' },
    ])
  })
})
