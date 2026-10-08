// @vitest-environment node
import { getBuiltinModule } from 'node:process'
import { bip32 } from '@hoseki/packages/bitcoin'
import { AsyncErr, AsyncOk } from '@hoseki/packages/result'
import type { LedgerScanUI } from '@hoseki/packages/ui/wallet-ui'
import { type LedgerBitcoinApp, createLedgerStore } from '@hoseki/packages/ui/wallet-ui/ledger/device-store'
import Transport from '@ledgerhq/hw-transport'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import pino from 'pino'
import { type ComponentProps, Fragment, StrictMode, act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { RouterOutput } from '../../../trpc'
import { LedgerAccountScan as LedgerScan } from './ledger-scan'
import { probeLedger } from './probe-ledger'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

type Balances = RouterOutput['portalProve']['onchain']['bitcoinAccountBalances']
type ScanProps = ComponentProps<typeof LedgerScanUI>

const mocks = await vi.hoisted(async () => {
  // Preserve Node's byte-array globals for the Bitcoin SDK.
  const { JSDOM } = await import('jsdom')
  const { installAnimationPlaceholder } = await import('@hoseki/packages/testing/animation-dom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  installAnimationPlaceholder(window.HTMLCanvasElement)
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
const useLedgerStore = createLedgerStore(pino({ level: 'silent' }), (transport) => {
  const app: LedgerBitcoinApp = {
    getWalletXpub: async ({ path }) => mocks.getXpub(transport, path),
    signMessage: async () => {
      throw new Error('Signing is not part of account discovery')
    },
  }
  transport.decorateAppAPIMethods(app, ['getWalletXpub'], 'BTC')
  return app
})
const balanceApi = { portalProve: { onchain: { bitcoinAccountBalances: { fetch: mocks.fetch } } } }
function ScanView(props: ScanProps): JSX.Element {
  mocks.scan(props)
  return createElement(Fragment)
}

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

function deferred<T>(): Deferred<T> {
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
          ledgerStore: useLedgerStore,
          balanceApi,
          ScanView,
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
              ledgerStore: useLedgerStore,
              balanceApi,
              ScanView,
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
    expect(result.expectErr('Expected failed result')).toMatchObject({ name: 'AbortError' })
    expect(mocks.getXpub).toHaveBeenCalledTimes(4)
  })
})

it.each([
  { name: 'xpub', data: { xpub: 'invalid', path: "m/84'/0'/0'" }, message: 'Failed to parse xpub:' },
  { name: 'derivation path', data: { xpub, path: 'invalid' }, message: 'Failed to parse derivation path:' },
])('discovery propagates an invalid $name without requesting balances', async ({ data, message }) => {
  await withTestSetup(async () => {
    const getBitcoinXpub = vi.fn(() => AsyncOk(data))
    const error = await probeLedger(balanceApi, { getBitcoinXpub, isCurrentConnection: () => true }).expectErr(
      'Expected parsing failure',
    )

    expect(error.message).toContain(message)
    expect(error.cause).toBeInstanceOf(Error)
    expect(getBitcoinXpub).toHaveBeenCalledOnce()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

it('discovery propagates the original device error without requesting balances', async () => {
  await withTestSetup(async () => {
    const error = new Error('Synthetic device failure')
    const getBitcoinXpub = vi.fn(() => AsyncErr(error))

    await expect(
      probeLedger(balanceApi, { getBitcoinXpub, isCurrentConnection: () => true }).expectErr('Expected device failure'),
    ).resolves.toBe(error)
    expect(getBitcoinXpub).toHaveBeenCalledOnce()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

it('the scan displays the original balance lookup error', async () => {
  await withTestSetup(async () => {
    const failure = new Error('Could not fetch transaction history: Connection closed')
    mocks.fetch.mockRejectedValue(failure)
    await useLedgerStore.getState().init(async () => fakeTransport())
    await mountScan()
    await waitForScan()

    expect(mocks.scan.mock.lastCall?.[0].walletsQuery).toMatchObject({
      isLoading: false,
      isError: true,
      error: failure,
    })
    expect(mocks.scan.mock.lastCall?.[0].walletsQuery.error).toBe(failure)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.getXpub).toHaveBeenCalledTimes(4)
  })
})

it('discovery gives cancellation priority over a balance lookup error', async () => {
  await withTestSetup(async () => {
    const controller = new AbortController()
    mocks.fetch.mockImplementation(async () => {
      controller.abort()
      throw new Error('Balance lookup failed after cancellation')
    })
    await useLedgerStore.getState().init(async () => fakeTransport())
    const error = await probeLedger(balanceApi, {
      getBitcoinXpub: useLedgerStore.getState().getBitcoinXpub,
      signal: controller.signal,
      isCurrentConnection: () => true,
    }).expectErr('Expected cancellation')

    expect(error.name).toBe('AbortError')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.getXpub).toHaveBeenCalledTimes(4)
  })
})

it('discovery gives cancellation priority over a device error', async () => {
  await withTestSetup(async () => {
    const controller = new AbortController()
    const getBitcoinXpub = vi.fn(() => {
      controller.abort()
      return AsyncErr(new Error('Synthetic device failure'))
    })
    const error = await probeLedger(balanceApi, {
      getBitcoinXpub,
      signal: controller.signal,
      isCurrentConnection: () => true,
    }).expectErr('Expected cancellation')

    expect(error.name).toBe('AbortError')
    expect(getBitcoinXpub).toHaveBeenCalledOnce()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

it.each(['abort', 'disconnect'])('discovery starts no more requests after %s at any continuation', async (reason) => {
  await withTestSetup(async () => {
    const violations: { boundary: number; request: string }[] = []
    // Sweep the continuations through device reads, parsing, and the balance lookup.
    // This covers cancellation between synchronous Results delegated by an async generator.
    for (let boundary = 0; boundary < 120; boundary++) {
      const controller = new AbortController()
      let connected = true
      const isCancelled = (): boolean => controller.signal.aborted || !connected
      mocks.fetch.mockImplementation(async ({ accounts }) => {
        if (isCancelled()) {
          violations.push({ boundary, request: 'balances' })
        }
        return balances(accounts)
      })
      const pending = probeLedger(balanceApi, {
        getBitcoinXpub: () => {
          if (isCancelled()) {
            violations.push({ boundary, request: 'xpub' })
          }
          return AsyncOk({ xpub, path: "m/84'/0'/0'" })
        },
        signal: controller.signal,
        isCurrentConnection: () => connected,
      })
      for (let tick = 0; tick < boundary; tick++) {
        await Promise.resolve()
      }
      if (reason === 'abort') {
        controller.abort()
      } else {
        connected = false
      }
      await pending
    }
    expect(violations).toEqual([])
  })
})

it('an xpub read never starts after its transport has been closed', async () => {
  await withTestSetup(async () => {
    const transport = fakeTransport()
    let closed = false
    let readAfterClose = false
    mocks.getXpub.mockImplementation(async () => {
      readAfterClose ||= closed
      return xpub
    })
    await useLedgerStore.getState().init(async () => transport)
    const pending = useLedgerStore.getState().getBitcoinXpub('p2wpkh', 0)
    await useLedgerStore.getState().reset(async () => {
      closed = true
    })
    expect((await pending).expect('Expected the already-started read to complete')).toEqual({
      xpub,
      path: "m/84'/0'/0'",
    })
    expect(mocks.getXpub).toHaveBeenCalledOnce()
    expect(readAfterClose).toBe(false)
  })
})
