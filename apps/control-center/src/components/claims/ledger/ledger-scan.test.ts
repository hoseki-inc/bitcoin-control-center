// @vitest-environment node
import { getBuiltinModule } from 'node:process'
import { bip32 } from '@hoseki/packages/bitcoin'
import type { PartialModuleMock } from '@hoseki/packages/testing/partial-module-mock'
import type * as WalletUiModule from '@hoseki/packages/ui/wallet-ui'
import type { LedgerScanUI } from '@hoseki/packages/ui/wallet-ui'
import type * as LedgerBtcModule from '@ledgerhq/hw-app-btc'
import Transport from '@ledgerhq/hw-transport'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { type ComponentProps, Fragment, StrictMode, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import type * as LoggerModule from '../../../logger'
import type * as TrpcModule from '../../../trpc'
import type { RouterOutput } from '../../../trpc'
import { LedgerScan } from './ledger-scan'
import { probeLedger } from './probe-ledger'

type Balances = RouterOutput['portalProve']['onchain']['bitcoinAccountBalances']
type ScanProps = ComponentProps<typeof LedgerScanUI>

const mocks = await vi.hoisted(async () => {
  // Preserve Node's byte-array globals for the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', window.navigator)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return {
    fetch: vi.fn<(input: { accounts: string[] }) => Promise<Balances>>(),
    getXpub: vi.fn<(transport: Transport, path: string) => Promise<string>>(),
    scan: vi.fn<(props: ScanProps) => void>(),
  }
})
// Keep the SDK's actual operation lock while replacing USB exchanges with synthetic data.
vi.mock<PartialModuleMock<typeof LedgerBtcModule>>(import('@ledgerhq/hw-app-btc'), () => ({
  default: class LedgerBtcApp {
    private readonly transport: Transport
    public constructor({ transport }: { transport: Transport }) {
      this.transport = transport
      transport.decorateAppAPIMethods(this, ['getWalletXpub'], 'BTC')
    }
    public async getWalletXpub(input: { path: string }): Promise<string> {
      return mocks.getXpub(this.transport, input.path)
    }
  },
}))
vi.mock<PartialModuleMock<typeof WalletUiModule>>(import('@hoseki/packages/ui/wallet-ui'), async () => ({
  createLedgerStore: (await import('@hoseki/packages/ui/wallet-ui/ledger/device-store')).createLedgerStore,
  LedgerScanUI: (props: ScanProps) => {
    mocks.scan(props)
    return createElement(Fragment)
  },
}))
vi.mock<PartialModuleMock<typeof LoggerModule>>(import('../../../logger'), () => ({
  browserLogger: { debug: vi.fn<() => void>(), error: vi.fn<() => void>() },
  captureHardwareWalletError: vi.fn<() => void>(),
}))
vi.mock<PartialModuleMock<typeof TrpcModule>>(import('../../../trpc'), () => ({
  trpc: { useUtils: () => ({ portalProve: { onchain: { bitcoinAccountBalances: { fetch: mocks.fetch } } } }) },
}))

const { Buffer: NativeBuffer } = getBuiltinModule('node:buffer')
const xpub = bip32.fromSeed(NativeBuffer.alloc(32, 1)).neutered().toBase58()
let root: Root
let host: HTMLDivElement
let client: QueryClient

function fakeTransport(): Transport {
  return Object.assign(new Transport(), {
    setScrambleKey: vi.fn(),
    close: vi.fn(async () => undefined),
    deviceModel: { productName: 'Ledger Flex', id: 'flex' },
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T): void => {}
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function balances(accounts: string[], funded = false): Balances {
  return {
    accounts: new Map(
      accounts.map((account, index) => [account, { current: new Decimal(funded && index === 0 ? 1 : 0), usd: null }]),
    ),
    archivedAccounts: new Set(),
  }
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    await useLedgerStore.getState().reset()
    host.remove()
  })
  vi.clearAllMocks()
  mocks.getXpub.mockResolvedValue(xpub)
  mocks.fetch.mockImplementation(async ({ accounts }) => balances(accounts))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  await run()
}

async function mountScan(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LedgerScan, {
          isLoadingOnContinue: false,
          onContinue: vi.fn<() => void>(),
          onBack: vi.fn<() => void>(),
          onCancel: vi.fn<() => void>(),
        }),
      ),
    )
  })
}

async function reconnect(): Promise<void> {
  await act(async () => {
    root.render(null)
  })
  await client.cancelQueries({ queryKey: ['ledger-wallets'] })
  client.removeQueries({ queryKey: ['ledger-wallets'] })
  await useLedgerStore.getState().reset(async (device) => device.close())
  await useLedgerStore.getState().init(async () => fakeTransport())
}

async function waitForScan(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isLoading).toBe(false)
  })
}

it('Strict Mode restarts a scan without locking the Ledger with the cancelled invocation', async () => {
  await withTestSetup(async () => {
    const firstRead = deferred<string>()
    mocks.getXpub.mockImplementationOnce(async () => firstRead.promise)
    await useLedgerStore.getState().init(async () => fakeTransport())
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            QueryClientProvider,
            { client },
            createElement(LedgerScan, {
              isLoadingOnContinue: false,
              onContinue: vi.fn<() => void>(),
              onBack: vi.fn<() => void>(),
              onCancel: vi.fn<() => void>(),
            }),
          ),
        ),
      )
    })
    await act(async () => {
      firstRead.resolve(xpub)
    })
    await waitForScan()
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery).toMatchObject({
      isLoading: false,
      isError: false,
      error: null,
    })
    expect(mocks.getXpub).toHaveBeenCalledTimes(4)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
})

it('a cancelled scan cannot use or lock the next Ledger when its balance response arrives late', async () => {
  await withTestSetup(async () => {
    const oldBalances = deferred<Balances>()
    const oldRead = deferred<string>()
    mocks.fetch.mockImplementationOnce(async () => oldBalances.promise)
    mocks.getXpub.mockImplementation(async (_transport, path) => (path.endsWith("/1'") ? oldRead.promise : xpub))
    await useLedgerStore.getState().init(async () => fakeTransport())
    await mountScan()
    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledOnce()
    })
    const oldAccounts = mocks.fetch.mock.calls[0]?.[0].accounts ?? []
    await reconnect()
    try {
      await act(async () => {
        oldBalances.resolve(balances(oldAccounts, true))
      })
      await mountScan()
      await waitForScan()
      expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isError).toBe(false)
      expect(mocks.getXpub.mock.calls.filter(([, path]) => path.endsWith("/1'"))).toHaveLength(0)
      expect(mocks.getXpub).toHaveBeenCalledTimes(8)
    } finally {
      oldRead.resolve(xpub)
    }
  })
})

it('a device response arriving after cancellation does not trigger more reads or balance lookups', async () => {
  await withTestSetup(async () => {
    const oldRead = deferred<string>()
    mocks.getXpub.mockImplementationOnce(async () => oldRead.promise)
    await useLedgerStore.getState().init(async () => fakeTransport())
    await mountScan()
    await vi.waitFor(() => {
      expect(mocks.getXpub).toHaveBeenCalledOnce()
    })
    await reconnect()
    await act(async () => {
      oldRead.resolve(xpub)
    })
    expect(mocks.getXpub).toHaveBeenCalledOnce()
    expect(mocks.fetch).not.toHaveBeenCalled()
    await mountScan()
    await waitForScan()
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isError).toBe(false)
    expect(mocks.getXpub).toHaveBeenCalledTimes(5)
  })
})

it('discovery also stops on a changed connection even without an abort signal', async () => {
  await withTestSetup(async () => {
    const oldBalances = deferred<Balances>()
    mocks.fetch.mockImplementationOnce(async () => oldBalances.promise)
    await useLedgerStore.getState().init(async () => fakeTransport())
    const { connectionId, getBitcoinXpub } = useLedgerStore.getState()
    const discovery = probeLedger(
      { portalProve: { onchain: { bitcoinAccountBalances: { fetch: mocks.fetch } } } },
      {
        getBitcoinXpub,
        isCurrentConnection: () => useLedgerStore.getState().connectionId === connectionId,
      },
    )
    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledOnce()
    })
    await reconnect()
    oldBalances.resolve(balances(mocks.fetch.mock.calls[0]?.[0].accounts ?? [], true))
    const result = await discovery
    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toMatchObject({ name: 'AbortError' })
    expect(mocks.getXpub).toHaveBeenCalledTimes(4)
  })
})
