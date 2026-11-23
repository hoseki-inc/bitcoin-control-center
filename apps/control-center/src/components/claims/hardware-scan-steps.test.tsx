// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Wallets } from '@hoseki/packages/testing'
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import {
  type ColdcardGenericJsonFile,
  type HardwareWallet,
  type KeystoneExportFile,
  parseGenericJsonFile,
  parseKeystoneExport,
} from '@hoseki/packages/ui/wallet-ui'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { TRPCClientError } from '@trpc/client'
import { Decimal } from 'decimal.js'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { ColdcardQrConnectionSteps } from './coldcard/coldcard-qr-steps'
import { ColdcardIndentification } from './coldcard/coldcard-steps'
import { KeystoneQrConnectionSteps } from './keystone/keystone-qr-steps'

const ELECTRUM_SAFE_ERROR_MESSAGE =
  "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again."

const balanceInputSchema = z.object({ accounts: z.array(z.string()) })

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

type BalanceResponse = {
  accounts: Map<string, { current: Decimal; usd: Decimal | null }>
  archivedAccounts: Set<string>
}

type FlowId = 'coldcard-microsd' | 'coldcard-qr' | 'keystone-qr'

const coldcardFixturePath = resolvePath(import.meta.dirname, '../../../../../test/coldcard-export.json')
const parsedColdcard: ColdcardGenericJsonFile = parseGenericJsonFile(readFileSync(coldcardFixturePath, 'utf8')).expect(
  'test/coldcard-export.json must parse',
)

if (!parsedColdcard.bip49 || !parsedColdcard.bip84) {
  throw new Error('test/coldcard-export.json must include bip49 and bip84 accounts')
}

const exportBPrimaryAccount = new SingleSigAccount('p2wpkh', parsedColdcard.bip84.xpub)
const exportBNestedSegwitAccount = new SingleSigAccount('p2sh-p2wpkh', parsedColdcard.bip49.xpub)
const parsedKeystone: KeystoneExportFile = parseKeystoneExport(parsedColdcard.bip84.xpub.toString()).expect(
  'test xpub must parse as a Keystone export',
)

const coldcardNetworkAccounts = [parsedColdcard.bip44, parsedColdcard.bip49, parsedColdcard.bip84].map((acc) =>
  new NetworkAccount(Network.Mainnet, new SingleSigAccount(acc.name, acc.xpub)).toString(),
)
const keystoneNetworkAccounts = [new NetworkAccount(Network.Mainnet, exportBPrimaryAccount).toString()]

const previousKeyAccountA = Wallets.singlesigNativeSegwitAccount
const previousKeyWalletA: HardwareWallet = {
  accountIndex: 0,
  rawInput: previousKeyAccountA.toString(),
  account: previousKeyAccountA,
  btcBalance: new Decimal(100_000_000),
  usdBalance: new Decimal(50_000),
  displayName: 'Previous Device Account A',
  label: 'Previous Device Account A',
  derivationPath: null,
}

function makeElectrumInternalError(): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      message: ELECTRUM_SAFE_ERROR_MESSAGE,
      code: -32603,
      data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
    },
  })
}

function makeBalanceResponse(
  accounts: string[],
  satsByIndex: Record<number, number> = {},
  archivedIndices: number[] = [],
): BalanceResponse {
  const result = new Map<string, { current: Decimal; usd: Decimal | null }>()
  const archivedAccounts = new Set<string>()
  for (const [index, account] of accounts.entries()) {
    const sats = satsByIndex[index] ?? 0
    const current = new Decimal(sats)
    result.set(account, {
      current,
      usd: sats > 0 ? current.div(100_000_000).mul(50_000) : new Decimal(0),
    })
    if (archivedIndices.includes(index)) {
      archivedAccounts.add(account)
    }
  }
  return { accounts: result, archivedAccounts }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type SelectionControls = {
  current: HardwareWallet | null
  set: (wallet: HardwareWallet | null) => void
}

function FlowHarness({
  flow,
  initialSelectedWallet = null,
  onConfirm,
  onSelectionChange,
  controls,
}: {
  flow: FlowId
  initialSelectedWallet?: HardwareWallet | null
  onConfirm: (wallet: HardwareWallet | null) => void
  onSelectionChange: (wallet: HardwareWallet | null) => void
  controls: SelectionControls
}): JSX.Element {
  const [selectedWallet, setSelectedWalletState] = useState<HardwareWallet | null>(initialSelectedWallet)
  const setSelectedWallet = (wallet: HardwareWallet | null): void => {
    controls.current = wallet
    onSelectionChange(wallet)
    setSelectedWalletState(wallet)
  }
  controls.current = selectedWallet
  controls.set = (wallet: HardwareWallet | null) => {
    controls.current = wallet
    setSelectedWalletState(wallet)
  }

  if (flow === 'coldcard-microsd') {
    return (
      <ColdcardIndentification
        step={6}
        model="MK4"
        connectionMethod="airgapping"
        onBack={() => undefined}
        onNext={() => undefined}
        onSwitchToAirgapping={() => undefined}
        coldcardJson={parsedColdcard}
        setColdcardJson={() => undefined}
        selectedWallet={selectedWallet}
        setSelectedWallet={setSelectedWallet}
        isStep6Loading={false}
        handleAccountSelectConfirm={() => {
          onConfirm(selectedWallet)
        }}
      />
    )
  }

  if (flow === 'coldcard-qr') {
    return (
      <ColdcardQrConnectionSteps
        step={4}
        onBack={() => undefined}
        onNext={() => undefined}
        coldcardJson={parsedColdcard}
        setColdcardJson={() => undefined}
        selectedWallet={selectedWallet}
        setSelectedWallet={setSelectedWallet}
        isStep4Loading={false}
        handleAccountSelectConfirm={() => {
          onConfirm(selectedWallet)
        }}
      />
    )
  }

  return (
    <KeystoneQrConnectionSteps
      step={4}
      onBack={() => undefined}
      onNext={() => undefined}
      keystoneJson={parsedKeystone}
      setKeystoneJson={() => undefined}
      selectedWallet={selectedWallet}
      setSelectedWallet={setSelectedWallet}
      isStep4Loading={false}
      handleAccountSelectConfirm={() => {
        onConfirm(selectedWallet)
      }}
    />
  )
}

async function mountFlow(
  flow: FlowId,
  handleBalances: (accounts: string[], callIndex: number) => Promise<BalanceResponse>,
  options?: { initialSelectedWallet?: HardwareWallet | null },
) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const requestedAccounts: string[][] = []
  const onConfirm = vi.fn<(wallet: HardwareWallet | null) => void>()
  const onSelectionChange = vi.fn<(wallet: HardwareWallet | null) => void>()
  const controls: SelectionControls = {
    current: options?.initialSelectedWallet ?? null,
    set: () => undefined,
  }
  const rpc = createTestTrpcClient(async (operation) => {
    if (operation.path === 'portalProve.onchain.bitcoinAccountBalances') {
      const input = parseUnknown(balanceInputSchema, operation.input).expect(
        'bitcoinAccountBalances input must match schema',
      )
      requestedAccounts.push(input.accounts)
      return handleBalances(input.accounts, requestedAccounts.length)
    }
    throw new Error(`Unexpected tRPC request: ${operation.path}`)
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
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
        <TestChakraProvider>
          <MemoryRouter>
            <FlowHarness
              flow={flow}
              initialSelectedWallet={options?.initialSelectedWallet ?? null}
              onConfirm={onConfirm}
              onSelectionChange={onSelectionChange}
              controls={controls}
            />
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })

  return { container, client, requestedAccounts, onConfirm, onSelectionChange, selection: controls }
}

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

function setReactInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  if (!descriptor?.set) {
    throw new Error('HTMLInputElement value setter is unavailable')
  }
  descriptor.set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const ALL_FLOWS: Array<{
  flow: FlowId
  label: string
  expectedAccounts: string[]
  expectedPrimaryDescriptor: string
}> = [
  {
    flow: 'coldcard-microsd',
    label: 'COLDCARD MicroSD Step6',
    expectedAccounts: coldcardNetworkAccounts,
    expectedPrimaryDescriptor: exportBPrimaryAccount.descriptor(),
  },
  {
    flow: 'coldcard-qr',
    label: 'COLDCARD Q AccountSelectionStep',
    expectedAccounts: coldcardNetworkAccounts,
    expectedPrimaryDescriptor: exportBPrimaryAccount.descriptor(),
  },
  {
    flow: 'keystone-qr',
    label: 'Keystone AccountSelectionStep',
    expectedAccounts: keystoneNetworkAccounts,
    expectedPrimaryDescriptor: exportBPrimaryAccount.descriptor(),
  },
]

const COLDCARD_FLOWS = ALL_FLOWS.filter((entry) => entry.flow !== 'keystone-qr')

describe('Hardware wallet scan results', () => {
  it.each(ALL_FLOWS)(
    '$label: shows only the safe Electrum error when bitcoinAccountBalances fails (never empty state or Continue)',
    async ({ flow, expectedAccounts }) => {
      const { container, requestedAccounts } = await mountFlow(flow, async () => {
        throw makeElectrumInternalError()
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })

      expect(requestedAccounts).toEqual([expectedAccounts])
      expect(container.textContent).not.toContain('An unexpected error occurred')
      expect(container.textContent).not.toContain('Scan complete.')
      expect(container.textContent).not.toContain('Scan complete!')
      expect(container.textContent).not.toContain('non-zero balance')
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
      expect(findButtonByText(container, 'Back')).toBeDefined()
      expect(findButtonByText(container, 'Retry')).toBeDefined()
      expect(container.querySelector('a[href="/accounts"]')).toBeNull()
    },
  )

  it.each(ALL_FLOWS)('$label: shows the genuine empty state when every account returns 0 sats', async ({ flow }) => {
    const { container } = await mountFlow(flow, async (accounts) => makeBalanceResponse(accounts))

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Scan complete.')
    })

    expect(container.textContent).toContain('We were unable to find any accounts with a non-zero balance.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
  })

  it.each(ALL_FLOWS)(
    '$label: shows SingleAccount and auto-selects when one funded account is found',
    async ({ flow, expectedPrimaryDescriptor }) => {
      const { container, onConfirm } = await mountFlow(flow, async (accounts) =>
        makeBalanceResponse(accounts, { [accounts.length - 1]: 75_000_000 }),
      )

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })

      expect(container.textContent).toContain('0.75')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()

      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
    },
  )

  it.each(COLDCARD_FLOWS)('$label: shows AccountsList when several funded accounts are found', async ({ flow }) => {
    const { container, onConfirm } = await mountFlow(flow, async (accounts) =>
      makeBalanceResponse(accounts, { 0: 10_000_000, 1: 20_000_000, 2: 30_000_000 }),
    )

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Scan complete!')
    })

    expect(container.textContent).toContain('Select one to continue:')
    expect(container.textContent).toContain('0.1')
    expect(container.textContent).toContain('0.2')
    expect(container.textContent).toContain('0.3')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

    const selectButtons = container.querySelectorAll('button[aria-label^="Select "]')
    const selectNested = selectButtons[1]
    expect(selectNested).toBeDefined()
    await act(async () => {
      selectNested?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const continueButton = findButtonByText(container, 'Yes, Continue')
    expect(continueButton).toBeDefined()
    await act(async () => {
      continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(exportBNestedSegwitAccount.descriptor())
  })

  it.each(ALL_FLOWS)('$label: still lists an archived account with 0 BTC', async ({ flow }) => {
    const { container } = await mountFlow(flow, async (accounts) =>
      makeBalanceResponse(accounts, {}, [accounts.length - 1]),
    )

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Scan complete!')
    })

    expect(container.textContent).not.toContain('We were unable to find any accounts with a non-zero balance.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(findButtonByText(container, 'Yes, Continue')).toBeDefined()
  })

  it.each(ALL_FLOWS)(
    '$label: shows only the scanning indicator while the balance request is pending',
    async ({ flow }) => {
      const pending = deferred<BalanceResponse>()
      const { container } = await mountFlow(flow, async () => pending.promise)

      expect(container.textContent).toContain('Scanning for active accounts...')
      expect(container.textContent).not.toContain('Scan complete.')
      expect(container.textContent).not.toContain('non-zero balance')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
    },
  )

  it.each(ALL_FLOWS)(
    '$label: Retry clears the old error while scanning and recovers in place with a funded account',
    async ({ flow, expectedAccounts, expectedPrimaryDescriptor }) => {
      const secondAttempt = deferred<BalanceResponse>()
      const { container, requestedAccounts, onConfirm } = await mountFlow(flow, async (accounts, callIndex) => {
        if (callIndex === 1) {
          throw makeElectrumInternalError()
        }
        return secondAttempt.promise.then(() => makeBalanceResponse(accounts, { [accounts.length - 1]: 50_000_000 }))
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      const retryButton = findButtonByText(container, 'Retry')
      expect(retryButton).toBeDefined()
      await act(async () => {
        retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scanning for active accounts...')
      })
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      await act(async () => {
        secondAttempt.resolve(makeBalanceResponse([]))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.5')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(requestedAccounts).toEqual([expectedAccounts, expectedAccounts])

      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
    },
  )

  it.each(ALL_FLOWS)(
    '$label: hides Yes, Continue while scanning or after an error even with a stale selectedWallet',
    async ({ flow }) => {
      const pending = deferred<BalanceResponse>()
      const { container } = await mountFlow(flow, async () => pending.promise, {
        initialSelectedWallet: previousKeyWalletA,
      })

      expect(container.textContent).toContain('Scanning for active accounts...')
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      await act(async () => {
        pending.reject(makeElectrumInternalError())
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
    },
  )

  it.each(ALL_FLOWS)(
    '$label: Retry after an error replaces a stale selectedWallet from another key with the single found account',
    async ({ flow, expectedAccounts, expectedPrimaryDescriptor }) => {
      expect(previousKeyAccountA.descriptor()).not.toBe(expectedPrimaryDescriptor)

      const { container, requestedAccounts, onConfirm } = await mountFlow(
        flow,
        async (accounts, callIndex) => {
          if (callIndex === 1) {
            throw makeElectrumInternalError()
          }
          return makeBalanceResponse(accounts, { [accounts.length - 1]: 50_000_000 })
        },
        { initialSelectedWallet: previousKeyWalletA },
      )

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      await act(async () => {
        findButtonByText(container, 'Retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.5')
      expect(requestedAccounts).toEqual([expectedAccounts, expectedAccounts])

      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).not.toBe(previousKeyAccountA.descriptor())
    },
  )

  it.each(COLDCARD_FLOWS)(
    '$label: Retry with multiple accounts clears a stale selection from another key and requires a fresh choice',
    async ({ flow, expectedPrimaryDescriptor }) => {
      expect(previousKeyAccountA.descriptor()).not.toBe(expectedPrimaryDescriptor)

      const { container, onConfirm } = await mountFlow(
        flow,
        async (accounts, callIndex) => {
          if (callIndex === 1) {
            throw makeElectrumInternalError()
          }
          return makeBalanceResponse(accounts, { 1: 20_000_000, 2: 30_000_000 })
        },
        { initialSelectedWallet: previousKeyWalletA },
      )

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })

      await act(async () => {
        findButtonByText(container, 'Retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('Select one to continue:')
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      const selectButtons = container.querySelectorAll('button[aria-label^="Select "]')
      const selectNative = selectButtons[1]
      expect(selectNative).toBeDefined()
      await act(async () => {
        selectNative?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).not.toBe(previousKeyAccountA.descriptor())
    },
  )

  it.each(ALL_FLOWS)(
    '$label: preserves a user-edited displayName when the same account is still selected after rescan',
    async ({ flow, expectedPrimaryDescriptor }) => {
      const { container, client, onConfirm } = await mountFlow(flow, async (accounts, callIndex) =>
        makeBalanceResponse(accounts, { [accounts.length - 1]: callIndex === 1 ? 50_000_000 : 75_000_000 }),
      )

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.5')

      const expandButton = container.querySelector('button[aria-label="Expand wallet details"]')
      expect(expandButton).not.toBeNull()
      await act(async () => {
        expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const nameInput = container.querySelector('input')
      expect(nameInput).not.toBeNull()
      await act(async () => {
        if (nameInput) {
          setReactInputValue(nameInput, 'My Cold Storage')
        }
      })

      await act(async () => {
        await client.refetchQueries()
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('0.75')
      })

      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
      expect(onConfirm.mock.calls[0]?.[0]?.displayName).toBe('My Cold Storage')
    },
  )

  it.each(ALL_FLOWS)(
    '$label: rescan while old results are cached hides the card and Continue while fetching, shows only the error on failure, and recovers on deferred Retry',
    async ({ flow, expectedAccounts, expectedPrimaryDescriptor }) => {
      const refetchAttempt = deferred<BalanceResponse>()
      const retryAttempt = deferred<BalanceResponse>()

      const { container, client, requestedAccounts, onConfirm } = await mountFlow(flow, async (accounts, callIndex) => {
        if (callIndex === 1) {
          return makeBalanceResponse(accounts, { [accounts.length - 1]: 50_000_000 })
        }
        if (callIndex === 2) {
          return refetchAttempt.promise
        }
        return retryAttempt.promise.then(() => makeBalanceResponse(accounts, { [accounts.length - 1]: 85_000_000 }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.5')
      expect(findButtonByText(container, 'Yes, Continue')).toBeDefined()

      let refetchPromise: Promise<void> | undefined
      await act(async () => {
        refetchPromise = client.refetchQueries()
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scanning for active accounts...')
      })
      expect(container.textContent).not.toContain('Scan complete!')
      expect(container.textContent).not.toContain('0.5')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      await act(async () => {
        refetchAttempt.reject(makeElectrumInternalError())
        await refetchPromise
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(container.textContent).not.toContain('Scanning for active accounts...')
      expect(container.textContent).not.toContain('Scan complete!')
      expect(container.textContent).not.toContain('0.5')
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      const retryButton = findButtonByText(container, 'Retry')
      expect(retryButton).toBeDefined()
      await act(async () => {
        retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scanning for active accounts...')
      })
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.textContent).not.toContain('Scan complete!')
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()

      await act(async () => {
        retryAttempt.resolve(makeBalanceResponse([]))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.85')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(requestedAccounts).toEqual([expectedAccounts, expectedAccounts, expectedAccounts])

      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
    },
  )

  it.each(ALL_FLOWS)(
    '$label: does not auto-select a cached singleton wallet while a refetch is in flight or has failed',
    async ({ flow, expectedPrimaryDescriptor }) => {
      const refetchAttempt = deferred<BalanceResponse>()

      const { container, client, onSelectionChange, selection, onConfirm } = await mountFlow(
        flow,
        async (accounts, callIndex) => {
          if (callIndex === 1) {
            return makeBalanceResponse(accounts, { [accounts.length - 1]: 50_000_000 })
          }
          if (callIndex === 2) {
            return refetchAttempt.promise
          }
          return makeBalanceResponse(accounts, { [accounts.length - 1]: 60_000_000 })
        },
      )

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(selection.current?.account.descriptor()).toBe(expectedPrimaryDescriptor)

      onSelectionChange.mockClear()
      let refetchPromise: Promise<void> | undefined
      await act(async () => {
        selection.set(null)
        refetchPromise = client.refetchQueries()
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scanning for active accounts...')
      })
      expect(selection.current).toBeNull()
      expect(onSelectionChange).not.toHaveBeenCalled()

      await act(async () => {
        refetchAttempt.reject(makeElectrumInternalError())
        await refetchPromise
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(selection.current).toBeNull()
      expect(onSelectionChange).not.toHaveBeenCalled()

      await act(async () => {
        findButtonByText(container, 'Retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(selection.current?.account.descriptor()).toBe(expectedPrimaryDescriptor)
      const continueButton = findButtonByText(container, 'Yes, Continue')
      expect(continueButton).toBeDefined()
      await act(async () => {
        continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm.mock.calls[0]?.[0]?.account.descriptor()).toBe(expectedPrimaryDescriptor)
    },
  )

  it.each(ALL_FLOWS)(
    '$label: Retry transitions cleanly from error to genuine empty Scan complete when all balances are 0',
    async ({ flow }) => {
      const { container, requestedAccounts } = await mountFlow(flow, async (accounts, callIndex) => {
        if (callIndex === 1) {
          throw makeElectrumInternalError()
        }
        return makeBalanceResponse(accounts)
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })

      await act(async () => {
        findButtonByText(container, 'Retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete.')
      })
      expect(container.textContent).toContain('We were unable to find any accounts with a non-zero balance.')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(requestedAccounts).toHaveLength(2)
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
    },
  )

  it.each(ALL_FLOWS)(
    '$label: repeated failure on Retry stays an error with the safe message and never shows empty state',
    async ({ flow }) => {
      const secondAttempt = deferred<BalanceResponse>()
      const { container, requestedAccounts } = await mountFlow(flow, async (_accounts, callIndex) => {
        if (callIndex === 1) {
          throw makeElectrumInternalError()
        }
        return secondAttempt.promise
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })

      await act(async () => {
        findButtonByText(container, 'Retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scanning for active accounts...')
      })
      expect(container.querySelector('[role="alert"]')).toBeNull()

      await act(async () => {
        secondAttempt.reject(makeElectrumInternalError())
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })
      expect(container.textContent).not.toContain('Scan complete.')
      expect(container.textContent).not.toContain('non-zero balance')
      expect(requestedAccounts).toHaveLength(2)
      expect(findButtonByText(container, 'Yes, Continue')).toBeUndefined()
    },
  )

  it.each(ALL_FLOWS)(
    '$label: fail-then-refetch on the open screen clears the error and shows the funded account without unmounting',
    async ({ flow }) => {
      const { container, client, requestedAccounts } = await mountFlow(flow, async (accounts, callIndex) => {
        if (callIndex === 1) {
          throw makeElectrumInternalError()
        }
        return makeBalanceResponse(accounts, { [accounts.length - 1]: 25_000_000 })
      })

      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(ELECTRUM_SAFE_ERROR_MESSAGE)
      })

      await act(async () => {
        await client.refetchQueries()
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('Scan complete!')
      })
      expect(container.textContent).toContain('0.25')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(requestedAccounts).toHaveLength(2)
      expect(findButtonByText(container, 'Yes, Continue')).toBeDefined()
    },
  )
})
