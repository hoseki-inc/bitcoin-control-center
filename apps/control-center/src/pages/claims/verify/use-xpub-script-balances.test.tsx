// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result'
import { type ScriptTypeBalanceState, getUniqueFundedScriptType } from '@hoseki/packages/ui/design-system'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { StrictMode, act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { useHandedOffAccountScan, useXpubScriptBalances } from './use-xpub-script-balances'
import {
  type ScanChunkInput,
  type ScanChunkResult,
  handOffAccountScan,
  resetXpubScanStore,
  subscribeAccountScan,
} from './xpub-scan-store'

const bip32Vector1Xpub =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'

const scanChunkInputSchema = z.object({
  account: z.string(),
  chain: z.enum(['receive', 'change']),
  startIndex: z.number(),
  count: z.number(),
})

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

function setupDom() {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
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
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  return { container, root }
}

function HandedOffScanProbe({
  accountKey,
  onState,
}: {
  accountKey: string | null
  onState: (state: ScriptTypeBalanceState | undefined) => void
}): JSX.Element {
  const state = useHandedOffAccountScan(accountKey)
  onState(state)
  return (
    <div data-testid="handed-off">
      {state === undefined
        ? 'fallback'
        : state.status === 'error'
          ? 'error'
          : `${state.status}:${(state.balanceSats ?? 0n).toString()}`}
    </div>
  )
}

it('preserves an in-flight handed-off scan across React StrictMode remount and renders the final balance', async () => {
  const { container, root } = setupDom()
  const accountKey = `bitcoin_mainnet::wpkh(${bip32Vector1Xpub}/<0;1>/*)#3zpr76xn`
  let resolveSecondWave: ((result: ScanChunkResult) => void) | undefined

  const unsubFirstPage = subscribeAccountScan(
    accountKey,
    async (input: ScanChunkInput) => {
      if (input.chain === 'receive' && input.startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '25000000' }
      }
      if (input.chain === 'receive' && input.startIndex === 10) {
        return new Promise<ScanChunkResult>((resolve) => {
          resolveSecondWave = resolve
        })
      }
      if (input.chain === 'change' && input.startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '50000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
    () => undefined,
  )

  await vi.waitFor(() => {
    expect(resolveSecondWave).toBeDefined()
  })

  handOffAccountScan(accountKey)
  unsubFirstPage()

  const seen: Array<ScriptTypeBalanceState | undefined> = []
  await act(async () => {
    root.render(
      <StrictMode>
        <HandedOffScanProbe
          accountKey={accountKey}
          onState={(state) => {
            seen.push(state)
          }}
        />
      </StrictMode>,
    )
  })

  expect(container.textContent).toBe('loading:25000000')

  await act(async () => {
    resolveSecondWave?.({ usedIndexes: [10], balanceSats: '25000000' })
  })

  await vi.waitFor(() => {
    expect(container.textContent).toBe('loaded:100000000')
  })
  expect(seen.at(-1)).toEqual({ status: 'loaded', balanceSats: 100_000_000n })
})

it('clears handed-off scan state to undefined when subscription misses after initial render', async () => {
  const { container, root } = setupDom()
  const accountKey = `bitcoin_mainnet::wpkh(${bip32Vector1Xpub}/<0;1>/*)#3zpr76xn`

  const unsubFirstPage = subscribeAccountScan(
    accountKey,
    async () => new Promise<ScanChunkResult>(() => undefined),
    () => undefined,
  )
  handOffAccountScan(accountKey)
  unsubFirstPage()

  function WipeBeforeEffect(): null {
    useLayoutEffect(() => {
      resetXpubScanStore()
    }, [])
    return null
  }

  const seen: Array<ScriptTypeBalanceState | undefined> = []
  await act(async () => {
    root.render(
      <>
        <WipeBeforeEffect />
        <HandedOffScanProbe
          accountKey={accountKey}
          onState={(state) => {
            seen.push(state)
          }}
        />
      </>,
    )
  })

  expect(seen[0]).toEqual({ status: 'loading' })
  expect(container.textContent).toBe('fallback')
  expect(seen.at(-1)).toBeUndefined()
})

it('does not lock in stale auto-selection when clearing and re-pasting the same xpub after TTL expiry', async () => {
  vi.useFakeTimers()
  const { root } = setupDom()
  const client = new QueryClient({ logger: { log: console.log, warn: console.warn, error: () => undefined } })
  onTestFinished(() => {
    client.clear()
    vi.useRealTimers()
  })

  let phase: 'first' | 'second' = 'first'
  const deferredSecondWaveResolvers: Array<(result: ScanChunkResult) => void> = []
  const rpc = createTestTrpcClient(async (operation) => {
    if (operation.path !== 'portalProve.onchain.scanAccountChunk') {
      return null
    }
    const parsed = parseUnknown(scanChunkInputSchema, operation.input).expect('valid scanAccountChunk input')
    if (phase === 'first') {
      if (parsed.account.includes(':wpkh(') && parsed.chain === 'receive' && parsed.startIndex === 0) {
        return { usedIndexes: [0], balanceSats: '100000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    }
    return new Promise<ScanChunkResult>((resolve) => {
      deferredSecondWaveResolvers.push(resolve)
    })
  })

  const suggestions: Array<string | null> = []
  let latestSuggested: string | null = null
  let latestIsScanning = false
  function BalanceProbe({ raw }: { raw: string }): JSX.Element {
    const { balances, isScanning } = useXpubScriptBalances(raw)
    latestSuggested = getUniqueFundedScriptType(balances)
    suggestions.push(latestSuggested)
    latestIsScanning = isScanning
    return <div>{latestSuggested ?? 'none'}</div>
  }

  const renderRaw = async (raw: string): Promise<void> => {
    await act(async () => {
      root.render(
        <TestTrpcProvider client={client} rpc={rpc}>
          <BalanceProbe raw={raw} />
        </TestTrpcProvider>,
      )
    })
  }

  await renderRaw(bip32Vector1Xpub)
  await vi.waitFor(() => {
    expect(latestSuggested).toBe('p2wpkh')
    expect(latestIsScanning).toBe(false)
  })

  await renderRaw('')
  expect(latestSuggested).toBeNull()

  await vi.advanceTimersByTimeAsync(60_000)
  client.clear()
  phase = 'second'
  suggestions.length = 0

  await renderRaw(bip32Vector1Xpub)
  expect(suggestions).not.toContain('p2wpkh')
  expect(latestSuggested).toBeNull()
  expect(latestIsScanning).toBe(true)

  while (deferredSecondWaveResolvers.length > 0) {
    const batch = deferredSecondWaveResolvers.splice(0)
    await act(async () => {
      for (const resolve of batch) {
        resolve({ usedIndexes: [], balanceSats: '0' })
      }
      await Promise.resolve()
    })
  }

  await vi.waitFor(() => {
    expect(latestIsScanning).toBe(false)
  })
  expect(suggestions).not.toContain('p2wpkh')
  expect(latestSuggested).toBeNull()
})
