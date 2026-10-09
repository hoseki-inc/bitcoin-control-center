// @vitest-environment node
import type { ClaimId } from '@hoseki/packages/schemas'
import { type Logger, QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { Decimal } from 'decimal.js'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../testing/trpc'
import { type UseGetBalancesPerClaimIdOutput, useGetBalancesPerClaimIds } from './balances'

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

const claimId: ClaimId = 're_clmx_wallet'
const loaded = async (): Promise<Map<ClaimId, Decimal>> => new Map([[claimId, new Decimal(100_000_000)]])
const unreachable = async (): Promise<Map<ClaimId, Decimal>> => {
  throw new Error('Electrum server unreachable')
}
let answerBalances = loaded
let balanceRequests = 0
const rpc = createTestTrpcClient(async ({ path }: Operation) => {
  if (path === 'portalProve.retrieveBitcoinPrice') {
    return { value: new Decimal(50_000) }
  }
  if (path !== 'portalProve.onchain.claimBalances') {
    throw new Error(`Unexpected request: ${path}`)
  }
  balanceRequests += 1
  return answerBalances()
})

let latest: UseGetBalancesPerClaimIdOutput | undefined
let root: Root
let container: HTMLDivElement

function BalancesProbe({ retryFailedEveryMs }: { retryFailedEveryMs: number | undefined }): null {
  latest = useGetBalancesPerClaimIds({ claimIds: [claimId], enabled: true, retryFailedEveryMs })
  return null
}

function current(): UseGetBalancesPerClaimIdOutput {
  assert(latest !== undefined, 'Expected the hook to render')
  return latest
}

/** Let the tRPC link settle inside act so React applies the resulting query update. */
async function waitForBalances(check: (balances: UseGetBalancesPerClaimIdOutput) => void): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      check(current())
    })
  })
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

/** Holds the next balance request open until the returned function answers it. */
function holdBalances(): () => void {
  let answer = (): void => undefined
  answerBalances = async () => {
    await new Promise<void>((resolve) => {
      answer = resolve
    })
    return loaded()
  }
  return () => {
    answer()
  }
}

// Failed balance requests are expected here; keep their stack traces out of the test output.
function quietLogger(): Logger {
  return { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() }
}

async function withTestSetup(
  retryFailedEveryMs: number | undefined,
  run: (queryClient: QueryClient) => Promise<void>,
  // The app keeps React Query's default retries; tests without an interval skip them.
  queryClient = new QueryClient({ logger: quietLogger(), defaultOptions: { queries: { retry: false } } }),
): Promise<void> {
  const dom = browser.acquire()
  // Jump over the retry interval instead of waiting for it.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      queryClient.clear()
      answerBalances = loaded
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })
  latest = undefined
  balanceRequests = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(
        TestTrpcProvider,
        { client: queryClient, rpc },
        createElement(BalancesProbe, { retryFailedEveryMs }),
      ),
    )
  })
  await run(queryClient)
}

it('reports a failed refresh while keeping the balances loaded before it', async () => {
  await withTestSetup(undefined, async (queryClient) => {
    await waitForBalances((balances) => {
      expect(balances.data.get(claimId)?.current.toString()).toBe('100000000')
    })
    expect(current().balancesFailed).toBe(false)
    answerBalances = unreachable
    await act(async () => {
      await queryClient.refetchQueries()
    })
    await waitForBalances((balances) => {
      expect(balances.balancesFailed).toBe(true)
    })
    const balance = current().data.get(claimId)
    expect(balance?.current.toString()).toBe('100000000')
    expect(balance?.usd?.toString()).toBe('50000')
  })
})

it('fetches failed balances again on the retry interval, and only then, until they load', async () => {
  answerBalances = unreachable
  await withTestSetup(
    10_000,
    async () => {
      await waitForBalances((balances) => {
        expect(balances.balancesFailed).toBe(true)
      })
      expect(balanceRequests).toBe(1)
      const answer = holdBalances()
      await advance(10_000)
      expect(balanceRequests).toBe(2)
      // A retry of balances that never loaded reports loading again; the failure stands until it answers.
      expect(current().isLoading).toBe(true)
      expect(current().balancesFailed).toBe(true)
      await act(async () => {
        answer()
      })
      await waitForBalances((balances) => {
        expect(balances.balancesFailed).toBe(false)
      })
      expect(current().data.get(claimId)?.current.toString()).toBe('100000000')
      await advance(30_000)
      expect(balanceRequests).toBe(2)
    },
    new QueryClient({ logger: quietLogger() }),
  )
})

it('leaves failed balances to the usual retries without a retry interval', async () => {
  answerBalances = unreachable
  await withTestSetup(
    undefined,
    async () => {
      // React Query's default: three retries, 1, 2 and 4 seconds apart.
      await advance(10_000)
      expect(balanceRequests).toBe(4)
      expect(current().balancesFailed).toBe(true)
      await advance(60_000)
      expect(balanceRequests).toBe(4)
    },
    new QueryClient({ logger: quietLogger() }),
  )
})
