import { parseUnknown } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { type DefaultOptions, QueryClient, notifyManager } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { TestTrpcProvider, createTestTrpcClient, notFound } from '../../../testing/trpc'
import { queryClient as appClient } from '../../../trpc/base'
import type { ClaimDto } from '../../../trpc/server-types'
import { ClaimsVerifyTrackPage } from './track'
import { resetXpubScanStore } from './xpub-scan-store'

const bip32Vector1Xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
const testZpub =
  'zpub6rTqhQyDDidVGmbSL1AAK4J8untSw4NKtK9ZbaeW4u6HcWuvTrxNUoAzrCFraECK9DNXybWkVPgsze6c9sWsfKnMXYEapnNTF1d7Hv5PP31'
const scanChunkInputSchema = z.object({
  account: z.string(),
  chain: z.enum(['receive', 'change']),
  startIndex: z.number(),
  count: z.number(),
})

type ScanChunkInput = z.infer<typeof scanChunkInputSchema>
interface ScanChunkResult {
  usedIndexes: number[]
  balanceSats: string
}

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

type ScanChunkHandler = (input: ScanChunkInput) => Promise<ScanChunkResult> | ScanChunkResult

/**
 * Render the track page; `existing` is the account Sentinel already has for the entered wallet, if any, and
 * `failCreate` makes saving a new wallet fail.
 */
async function renderTrackPage({
  existing,
  failCreate = false,
  scanChunk,
  defaultOptions,
}: {
  existing?: { id: string; status: ClaimDto['status']; isArchived?: boolean }
  failCreate?: boolean
  scanChunk?: ScanChunkHandler
  defaultOptions?: DefaultOptions
} = {}) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    switch (operation.path) {
      case 'portalProve.onchain.scanAccountChunk': {
        const parsed = parseUnknown(scanChunkInputSchema, operation.input).expect(
          'scanAccountChunk input must match schema',
        )
        return scanChunk !== undefined ? scanChunk(parsed) : { usedIndexes: [], balanceSats: '0' }
      }
      case 'portalProve.accounts.get.byAccount':
        if (existing === undefined) {
          throw notFound('Claim not found')
        }
        return { id: existing.id, status: existing.status, isArchived: existing.isArchived ?? false }
      case 'portalProve.accounts.track':
        return { id: existing?.id, status: 'unverified' }
      case 'portalProve.accounts.create.singlesig':
      case 'portalProve.accounts.create.multisig':
        if (failCreate) {
          throw new Error('Sentinel is not reachable')
        }
        return { claim: { id: 'acct_new' }, keystores: [] }
      default:
        return null
    }
  })
  const client = new QueryClient({
    defaultOptions,
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    resetXpubScanStore()
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={['/accounts/verify/track']}>
            <Routes>
              <Route path="/accounts/verify/track" element={<ClaimsVerifyTrackPage />} />
              <Route path="/accounts/:id" element={<p>Account page</p>} />
              <Route path="/accounts" element={<p>Accounts list</p>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })

  const fill = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    await act(async () => {
      // Set the value the way the browser does, so React sees the change.
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected the value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const nameInput = container.querySelector('input')
  const walletInput = container.querySelector('textarea')
  assert.exists(nameInput, 'Expected the display name input')
  assert.exists(walletInput, 'Expected the wallet input')
  const scriptTypeOptions = (): string[] =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[name="script-type"]')).map((radio) => radio.value)
  const pickedScriptType = (): string | undefined =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[name="script-type"]')).find((radio) => radio.checked)
      ?.value
  const pick = async (label: string): Promise<void> => {
    const radio = container.querySelector<HTMLInputElement>(`input[name="script-type"][value="${label}"]`)
    assert.exists(radio, `Expected the ${label} option`)
    await act(async () => {
      radio.click()
    })
  }
  const trackButton = (): HTMLButtonElement => {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Track Wallet')
    assert(button !== undefined, 'Expected the Track Wallet button')
    return button
  }
  const press = async (): Promise<void> => {
    await act(async () => {
      trackButton().click()
    })
  }
  const submit = async (opens = 'Account page'): Promise<void> => {
    await press()
    await vi.waitFor(() => {
      expect(container.textContent).toContain(opens)
    })
  }
  const created = (): Operation[] => requests.filter((request) => request.path.includes('.create.'))
  const tracked = (): Operation[] => requests.filter((request) => request.path === 'portalProve.accounts.track')
  return {
    fillName: async (value: string) => fill(nameInput, value),
    fillWallet: async (value: string) => fill(walletInput, value),
    scriptTypeOptions,
    pickedScriptType,
    pick,
    press,
    submit,
    text: () => container.textContent,
    isTrackEnabled: () => !trackButton().disabled,
    created,
    tracked,
  }
}

it('waits for a script type before tracking a plain xpub', async () => {
  const page = await renderTrackPage()
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  expect(page.scriptTypeOptions()).toEqual([
    'Legacy (P2PKH)',
    'Nested SegWit (P2SH)',
    'Native SegWit (P2WPKH)',
    'Taproot (P2TR)',
  ])
  expect(page.pickedScriptType()).toBeUndefined()
  expect(page.text()).not.toContain('Single-sig,')
  expect(page.text()).not.toContain('Enter an xpub, or a single-sig or multisig descriptor')
  expect(page.isTrackEnabled()).toBe(false)

  await page.press()
  expect(page.created()).toEqual([])

  await page.pick('Native SegWit (P2WPKH)')
  expect(page.pickedScriptType()).toBe('Native SegWit (P2WPKH)')
  expect(page.text()).toContain('Single-sig, Native SegWit (P2WPKH)')

  await page.pick('Legacy (P2PKH)')
  expect(page.pickedScriptType()).toBe('Legacy (P2PKH)')
  expect(page.text()).toContain('Single-sig, Legacy (P2PKH)')
  expect(page.isTrackEnabled()).toBe(true)

  await page.submit()
  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.accounts.create.singlesig',
      input: {
        account: `pkh(${bip32Vector1Xpub}/<0;1>/*)#nusm4y9w`,
        displayName: 'Cold storage',
        network: 'bitcoin_mainnet',
        trackOnly: true,
      },
    },
  ])
})

it('requires a fresh choice after replacing a prefixed key with a bare one', async () => {
  const page = await renderTrackPage()
  await page.fillName('Cold storage')
  await page.fillWallet(testZpub)
  expect(page.text()).toContain('Single-sig, Native SegWit (P2WPKH)')
  expect(page.isTrackEnabled()).toBe(true)

  await page.fillWallet(bip32Vector1Xpub)
  expect(page.pickedScriptType()).toBeUndefined()
  expect(page.text()).not.toContain('Single-sig,')
  expect(page.isTrackEnabled()).toBe(false)
})

it('keeps the picked script type when the xpub is edited, and saves that type', async () => {
  const page = await renderTrackPage()
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.nativeSegwitXpub.toString())
  await page.pick('Native SegWit (P2WPKH)')

  await page.fillWallet(`${Wallets.nativeSegwitXpub.toString()}\n`)

  expect(page.pickedScriptType()).toBe('Native SegWit (P2WPKH)')
  await page.submit()
  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.accounts.create.singlesig',
      input: {
        account: Wallets.singlesigNativeSegwitAccount.descriptor(),
        displayName: 'Cold storage',
        trackOnly: true,
      },
    },
  ])
})

it('saves a multisig descriptor as track-only', async () => {
  const page = await renderTrackPage()
  await page.fillName('Family vault')
  await page.fillWallet(Wallets.multisigNativeSegwitAccount.toString())

  await page.submit()

  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.accounts.create.multisig',
      input: {
        account: Wallets.multisigNativeSegwitAccount.descriptor(),
        displayName: 'Family vault',
        trackOnly: true,
      },
    },
  ])
})

it('opens a wallet that is already in Control Center without adding it again', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_existing', status: 'unverified' } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit()

  expect(page.created()).toEqual([])
  expect(page.tracked()).toEqual([])
})

it('tracks a wallet someone started proving instead of leaving it pending', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_pending', status: 'pending' } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit()

  expect(page.created()).toEqual([])
  expect(page.tracked()).toMatchObject([{ input: { id: 'acct_pending' } }])
})

it('describes the wallet it read, or says what it accepts', async () => {
  const page = await renderTrackPage()

  await page.fillWallet(Wallets.multisigNativeSegwitAccount.toString())
  expect(page.text()).toContain('Multisig, 2 of 3')
  expect(page.pickedScriptType()).toBeUndefined()

  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())
  expect(page.text()).toContain('Single-sig, Native SegWit (P2WPKH)')

  await page.fillWallet('not a wallet')
  expect(page.text()).toContain('Enter an xpub, or a single-sig or multisig descriptor')
  expect(page.isTrackEnabled()).toBe(false)
})

it('waits for a name before it can track a wallet', async () => {
  const page = await renderTrackPage()
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())
  expect(page.isTrackEnabled()).toBe(false)

  await page.fillName('  ')
  expect(page.isTrackEnabled()).toBe(false)

  await page.fillName('Cold storage')
  expect(page.isTrackEnabled()).toBe(true)
})

it('opens the archived list for an archived wallet, without tracking it', async () => {
  const page = await renderTrackPage({ existing: { id: 'acct_archived', status: 'pending', isArchived: true } })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.submit('Accounts list')

  expect(page.tracked()).toEqual([])
  expect(page.created()).toEqual([])
})

it('stays on the page, ready to try again, when the wallet cannot be saved', async () => {
  const page = await renderTrackPage({ failCreate: true })
  await page.fillName('Cold storage')
  await page.fillWallet(Wallets.singlesigNativeSegwitAccount.descriptor())

  await page.press()

  await vi.waitFor(() => {
    expect(page.created()).toHaveLength(1)
    expect(page.isTrackEnabled()).toBe(true)
  })
  expect(page.text()).not.toContain('Account page')
})

it('auto-selects a plain xpub script type when exactly one has a balance and limits empty types to one change wave', async () => {
  const scannedChunks: Array<{ account: string; chain: 'receive' | 'change'; startIndex: number }> = []
  const page = await renderTrackPage({
    scanChunk: ({ account, chain, startIndex }) => {
      scannedChunks.push({ account, chain, startIndex })
      if (account.includes(':wpkh(') && chain === 'receive' && startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '100000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(page.text()).toContain('1.00000000 BTC')
    expect(page.pickedScriptType()).toBe('Native SegWit (P2WPKH)')
    expect(page.isTrackEnabled()).toBe(true)
  })
  expect(page.text()).toContain('Single-sig, Native SegWit (P2WPKH)')
  expect(
    scannedChunks.some(
      (entry) => entry.chain === 'change' && entry.startIndex === 10 && entry.account.includes(':wpkh('),
    ),
  ).toBe(true)
  expect(
    scannedChunks.some(
      (entry) => entry.chain === 'change' && entry.startIndex === 0 && !entry.account.includes(':wpkh('),
    ),
  ).toBe(true)
  expect(
    scannedChunks.some(
      (entry) => entry.chain === 'change' && entry.startIndex > 0 && !entry.account.includes(':wpkh('),
    ),
  ).toBe(false)

  await page.submit()
  expect(page.created()).toMatchObject([
    {
      path: 'portalProve.accounts.create.singlesig',
      input: {
        account: `wpkh(${bip32Vector1Xpub}/<0;1>/*)#3zpr76xn`,
        displayName: 'Cold storage',
        network: 'bitcoin_mainnet',
        trackOnly: true,
      },
    },
  ])
})

it('shows running balance progressively across chunks while scanning and lets the user pick early', async () => {
  let resolveSecondChunk: ((result: ScanChunkResult) => void) | undefined
  const page = await renderTrackPage({
    scanChunk: async ({ account, chain, startIndex }) => {
      if (account.includes(':wpkh(') && chain === 'receive' && startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '25000000' }
      }
      if (account.includes(':wpkh(') && chain === 'receive' && startIndex === 10) {
        return new Promise<ScanChunkResult>((resolve) => {
          resolveSecondChunk = resolve
        })
      }
      if (account.includes(':wpkh(') && chain === 'change' && startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '25000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(page.text()).toContain('0.25000000 BTC')
    expect(resolveSecondChunk).toBeDefined()
  })
  expect(page.pickedScriptType()).toBeUndefined()

  await act(async () => {
    resolveSecondChunk?.({ usedIndexes: [12], balanceSats: '50000000' })
  })

  await vi.waitFor(() => {
    expect(page.text()).toContain('1.00000000 BTC')
    expect(page.pickedScriptType()).toBe('Native SegWit (P2WPKH)')
  })
})

it('keeps a manual pick when Electrum balance scanning finishes later', async () => {
  let resolveNative: ((value: ScanChunkResult) => void) | undefined
  const page = await renderTrackPage({
    scanChunk: async ({ account, chain, startIndex }) => {
      if (account.includes(':wpkh(') && chain === 'receive' && startIndex === 0) {
        return new Promise<ScanChunkResult>((resolve) => {
          resolveNative = resolve
        })
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(page.text()).toContain('Scanning…')
    expect(resolveNative).toBeDefined()
  })
  expect(page.pickedScriptType()).toBeUndefined()

  await page.pick('Legacy (P2PKH)')
  expect(page.pickedScriptType()).toBe('Legacy (P2PKH)')

  await act(async () => {
    resolveNative?.({ usedIndexes: [0], balanceSats: '100000000' })
  })

  await vi.waitFor(() => {
    expect(page.text()).toContain('1.00000000 BTC')
  })
  expect(page.pickedScriptType()).toBe('Legacy (P2PKH)')
})

it('leaves script type unselected when multiple script types have balances', async () => {
  const page = await renderTrackPage({
    scanChunk: ({ account, chain, startIndex }) => {
      if (chain === 'receive' && startIndex === 0) {
        if (account.includes(':pkh(')) {
          return { usedIndexes: [0], balanceSats: '5000' }
        }
        if (account.includes(':wpkh(')) {
          return { usedIndexes: [0], balanceSats: '142000000' }
        }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(page.text()).toContain('0.00005000 BTC')
    expect(page.text()).toContain('1.42000000 BTC')
  })
  expect(page.pickedScriptType()).toBeUndefined()
  expect(page.isTrackEnabled()).toBe(false)
})

it('stays usable when Electrum balance checks fail', async () => {
  const page = await renderTrackPage({
    scanChunk: () => {
      throw new Error('Electrum is unreachable')
    },
  })
  await page.fillName('Cold storage')
  await page.fillWallet(bip32Vector1Xpub)

  await vi.waitFor(() => {
    expect(page.text()).toContain('Balance unavailable')
  })
  expect(page.pickedScriptType()).toBeUndefined()
  expect(page.isTrackEnabled()).toBe(false)

  await page.pick('Legacy (P2PKH)')
  expect(page.isTrackEnabled()).toBe(true)
  await page.submit()
  expect(page.created()).toHaveLength(1)
})

it('cancels in-flight scans for key A when replaced with key B mid-scan', async () => {
  const keyA = bip32Vector1Xpub
  const keyB = Wallets.nativeSegwitXpub.toString()
  const keyACalls: ScanChunkInput[] = []
  const keyAResolvers: Array<(result: ScanChunkResult) => void> = []

  const page = await renderTrackPage({
    scanChunk: async (input) => {
      if (input.account.includes(keyA)) {
        keyACalls.push(input)
        return new Promise<ScanChunkResult>((resolve) => {
          keyAResolvers.push(resolve)
        })
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })

  await page.fillWallet(keyA)
  await vi.waitFor(() => {
    expect(keyAResolvers).toHaveLength(4)
  })
  const callsBeforeReplace = keyACalls.length

  await page.fillWallet(keyB)

  await act(async () => {
    for (const resolve of keyAResolvers) {
      resolve({ usedIndexes: [0], balanceSats: '50000000' })
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })

  expect(keyACalls).toHaveLength(callsBeforeReplace)
})

it('cancels pending React Query retries when key A is replaced by key B while keeping retries for the active scan', async () => {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })

  const keyA = bip32Vector1Xpub
  const keyB = Wallets.nativeSegwitXpub.toString()
  const keyACalls: ScanChunkInput[] = []
  const keyARejecters: Array<(error: Error) => void> = []
  let keyBWpkhAttempts = 0

  const page = await renderTrackPage({
    defaultOptions: appClient.getDefaultOptions(),
    scanChunk: async (input) => {
      if (input.account.includes(keyA)) {
        keyACalls.push(input)
        return new Promise<ScanChunkResult>((_, reject) => {
          keyARejecters.push(reject)
        })
      }
      if (
        input.account.includes(keyB) &&
        input.account.includes(':wpkh(') &&
        input.chain === 'receive' &&
        input.startIndex === 0
      ) {
        keyBWpkhAttempts += 1
        if (keyBWpkhAttempts === 1) {
          throw new Error('Tor circuit dropped')
        }
        return { usedIndexes: [0], balanceSats: '100000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
  })

  await page.fillWallet(keyA)
  await act(async () => {
    await Promise.resolve()
  })
  expect(keyARejecters).toHaveLength(4)

  await page.fillWallet(keyB)
  await act(async () => {
    await Promise.resolve()
  })

  await act(async () => {
    for (const reject of keyARejecters) {
      reject(new Error('Tor circuit dropped'))
    }
    await Promise.resolve()
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })

  expect(keyACalls).toHaveLength(4)
  expect(keyBWpkhAttempts).toBe(2)
  expect(page.text()).toContain('1.00000000 BTC')
})
