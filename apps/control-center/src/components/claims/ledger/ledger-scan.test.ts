// @vitest-environment node
import type * as NodeBufferModule from 'node:buffer'
import { createRequire } from 'node:module'
import { bip32 } from '@hoseki/packages/bitcoin'
import type { LedgerScanUI } from '@hoseki/packages/ui/wallet-ui'
import Transport from '@ledgerhq/hw-transport'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { type ComponentProps, StrictMode, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLedgerStore } from '../../../hooks/use-ledger-store'
import type { RouterOutput } from '../../../trpc'
import { LedgerScan } from './ledger-scan'
import { probeLedger } from './probe-ledger'

type Balances = RouterOutput['portalProve']['onchain']['bitcoinAccountBalances']
type ScanProps = ComponentProps<typeof LedgerScanUI>

const mocks = await vi.hoisted(async () => {
  // Preserve Node's byte-array globals for the Bitcoin SDK.
  const { createRequire: createMockRequire } = await import('node:module')
  const { JSDOM } = createMockRequire(import.meta.url)('jsdom') as {
    JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis }
  }
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
vi.mock('@ledgerhq/hw-app-btc', () => ({
  default: class LedgerBtcApp {
    private transport: Transport
    public constructor({ transport }: { transport: Transport }) {
      this.transport = transport
      transport.decorateAppAPIMethods(this, ['getWalletXpub'], 'BTC')
    }
    public getWalletXpub(input: { path: string }): Promise<string> {
      return mocks.getXpub(this.transport, input.path)
    }
  },
}))
vi.mock('@hoseki/packages/ui/wallet-ui', async () => ({
  createLedgerStore: (await import('@hoseki/packages/ui/wallet-ui/ledger/device-store')).createLedgerStore,
  LedgerScanUI: (props: ScanProps): null => {
    mocks.scan(props)
    return null
  },
}))
vi.mock('../../../logger', () => ({
  browserLogger: { debug: vi.fn(), error: vi.fn() },
  captureHardwareWalletError: vi.fn(),
}))
vi.mock('../../../trpc', () => ({
  trpc: { useUtils: () => ({ portalProve: { onchain: { bitcoinAccountBalances: { fetch: mocks.fetch } } } }) },
}))

const { Buffer: NativeBuffer } = createRequire(import.meta.url)('node:buffer') as typeof NodeBufferModule
const xpub = bip32.fromSeed(NativeBuffer.alloc(32, 1)).neutered().toBase58()
let root: Root
let host: HTMLDivElement
let client: QueryClient

function fakeTransport(): Transport {
  return Object.assign(new Transport(), {
    setScrambleKey: vi.fn(),
    close: vi.fn(async () => undefined),
    deviceModel: { productName: 'Ledger Flex', id: 'flex' },
  }) as unknown as Transport
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getXpub.mockResolvedValue(xpub)
  mocks.fetch.mockImplementation(async ({ accounts }) => balances(accounts))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  await useLedgerStore.getState().reset()
  host.remove()
})

async function mountScan(): Promise<void> {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LedgerScan, {
          isLoadingOnContinue: false,
          onContinue: vi.fn(),
          onBack: vi.fn(),
          onCancel: vi.fn(),
        }),
      ),
    ),
  )
}

async function reconnect(): Promise<void> {
  await act(async () => root.render(null))
  await client.cancelQueries({ queryKey: ['ledger-wallets'] })
  client.removeQueries({ queryKey: ['ledger-wallets'] })
  await useLedgerStore.getState().reset((device) => device.close())
  await useLedgerStore.getState().init(async () => fakeTransport())
}

async function waitForScan(): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isLoading).toBe(false)
  })
}

it('Strict Mode restarts a scan without locking the Ledger with the cancelled invocation', async () => {
  const firstRead = deferred<string>()
  mocks.getXpub.mockImplementationOnce(() => firstRead.promise)
  await useLedgerStore.getState().init(async () => fakeTransport())
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          QueryClientProvider,
          { client },
          createElement(LedgerScan, {
            isLoadingOnContinue: false,
            onContinue: vi.fn(),
            onBack: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      ),
    ),
  )
  await act(async () => firstRead.resolve(xpub))
  await waitForScan()
  expect(mocks.scan.mock.lastCall?.[0].walletsQuery).toMatchObject({
    isLoading: false,
    isError: false,
    error: null,
  })
  expect(mocks.getXpub).toHaveBeenCalledTimes(4)
  expect(mocks.fetch).toHaveBeenCalledOnce()
})

it('a cancelled scan cannot use or lock the next Ledger when its balance response arrives late', async () => {
  const oldBalances = deferred<Balances>()
  const oldRead = deferred<string>()
  mocks.fetch.mockImplementationOnce(() => oldBalances.promise)
  mocks.getXpub.mockImplementation(async (_transport, path) => (path.endsWith("/1'") ? oldRead.promise : xpub))
  await useLedgerStore.getState().init(async () => fakeTransport())
  await mountScan()
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
  const oldAccounts = mocks.fetch.mock.calls[0]?.[0].accounts ?? []
  await reconnect()
  try {
    await act(async () => oldBalances.resolve(balances(oldAccounts, true)))
    await mountScan()
    await waitForScan()
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isError).toBe(false)
    expect(mocks.getXpub.mock.calls.filter(([, path]) => path.endsWith("/1'"))).toHaveLength(0)
    expect(mocks.getXpub).toHaveBeenCalledTimes(8)
  } finally {
    oldRead.resolve(xpub)
  }
})

it('a device response arriving after cancellation does not trigger more reads or balance lookups', async () => {
  const oldRead = deferred<string>()
  mocks.getXpub.mockImplementationOnce(() => oldRead.promise)
  await useLedgerStore.getState().init(async () => fakeTransport())
  await mountScan()
  await vi.waitFor(() => expect(mocks.getXpub).toHaveBeenCalledOnce())
  await reconnect()
  await act(async () => oldRead.resolve(xpub))
  expect(mocks.getXpub).toHaveBeenCalledOnce()
  expect(mocks.fetch).not.toHaveBeenCalled()
  await mountScan()
  await waitForScan()
  expect(mocks.scan.mock.lastCall?.[0].walletsQuery.isError).toBe(false)
  expect(mocks.getXpub).toHaveBeenCalledTimes(5)
})

it('discovery also stops on a changed connection even without an abort signal', async () => {
  const oldBalances = deferred<Balances>()
  mocks.fetch.mockImplementationOnce(() => oldBalances.promise)
  await useLedgerStore.getState().init(async () => fakeTransport())
  const { connectionId, getBitcoinXpub } = useLedgerStore.getState()
  const discovery = probeLedger(
    { portalProve: { onchain: { bitcoinAccountBalances: { fetch: mocks.fetch } } } } as unknown as Parameters<
      typeof probeLedger
    >[0],
    {
      getBitcoinXpub,
      isCurrentConnection: () => useLedgerStore.getState().connectionId === connectionId,
    },
  )
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce())
  await reconnect()
  oldBalances.resolve(balances(mocks.fetch.mock.calls[0]?.[0].accounts ?? [], true))
  const result = await discovery
  expect(result.isErr()).toBe(true)
  expect(result.unwrapErr()).toMatchObject({ name: 'AbortError' })
  expect(mocks.getXpub).toHaveBeenCalledTimes(4)
})
