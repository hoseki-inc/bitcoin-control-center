import type { ScriptTypeBalanceState } from '@hoseki/packages/ui/design-system'
import { expect, it, onTestFinished, vi } from 'vitest'
import {
  type ScanChunkInput,
  type ScanChunkResult,
  handOffAccountScan,
  readActiveAccountScan,
  resetXpubScanStore,
  subscribeAccountScan,
  subscribeExistingAccountScan,
} from './xpub-scan-store'

it('scans in waves of 10 up to the 20-address gap limit and checks one change wave when receive is empty', async () => {
  onTestFinished(() => {
    resetXpubScanStore()
  })
  const calls: ScanChunkInput[] = []
  const updates: ScriptTypeBalanceState[] = []

  const unsubscribe = subscribeAccountScan(
    'bitcoin_mainnet::pkh(empty)',
    async (input) => {
      calls.push(input)
      return { usedIndexes: [], balanceSats: '0' }
    },
    (state) => {
      updates.push(state)
    },
  )

  await vi.waitFor(() => {
    expect(updates.at(-1)).toEqual({ status: 'loaded', balanceSats: 0n })
  })
  unsubscribe()

  expect(calls.map((c) => [c.chain, c.startIndex, c.count])).toEqual([
    ['receive', 0, 10],
    ['receive', 10, 10],
    ['change', 0, 10],
  ])
})

it('discovers change-only funds and continues scanning change under the 20-address gap limit', async () => {
  onTestFinished(() => {
    resetXpubScanStore()
  })
  const calls: ScanChunkInput[] = []
  const updates: ScriptTypeBalanceState[] = []

  const unsubscribe = subscribeAccountScan(
    'bitcoin_mainnet::wpkh(change-only)',
    async (input) => {
      calls.push(input)
      if (input.chain === 'change' && input.startIndex === 0) {
        return { usedIndexes: [4], balanceSats: '35000000' }
      }
      if (input.chain === 'change' && input.startIndex === 10) {
        return { usedIndexes: [12], balanceSats: '15000000' }
      }
      return { usedIndexes: [], balanceSats: '0' }
    },
    (state) => {
      updates.push(state)
    },
  )

  await vi.waitFor(() => {
    expect(updates.at(-1)).toEqual({ status: 'loaded', balanceSats: 50_000_000n })
  })
  unsubscribe()

  expect(calls.map((c) => [c.chain, c.startIndex, c.count])).toEqual([
    ['receive', 0, 10],
    ['receive', 10, 10],
    ['change', 0, 10],
    ['change', 10, 10],
    ['change', 20, 10],
    ['change', 30, 3],
  ])
})

it('hands off an in-flight scan across route unmount without restarting from index 0 and cancels unchosen scans', async () => {
  onTestFinished(() => {
    resetXpubScanStore()
  })
  const calls: ScanChunkInput[] = []
  let resolveSecondChunk: ((result: ScanChunkResult) => void) | undefined

  const fetchChunk = async (input: ScanChunkInput): Promise<ScanChunkResult> => {
    calls.push(input)
    if (input.chain === 'receive' && input.startIndex === 0) {
      return { usedIndexes: [0], balanceSats: '25000000' }
    }
    if (input.chain === 'receive' && input.startIndex === 10) {
      return new Promise<ScanChunkResult>((resolve) => {
        resolveSecondChunk = resolve
      })
    }
    if (input.chain === 'change' && input.startIndex === 0) {
      return { usedIndexes: [0], balanceSats: '50000000' }
    }
    return { usedIndexes: [], balanceSats: '0' }
  }

  const firstPageUpdates: ScriptTypeBalanceState[] = []
  const unsubChosen = subscribeAccountScan('bitcoin_mainnet::wpkh(chosen)', fetchChunk, (state) => {
    firstPageUpdates.push(state)
  })

  let unchosenCalls = 0
  let resolveUnchosen: ((result: ScanChunkResult) => void) | undefined
  const unsubOther = subscribeAccountScan(
    'bitcoin_mainnet::pkh(other)',
    async () => {
      unchosenCalls += 1
      return new Promise<ScanChunkResult>((resolve) => {
        resolveUnchosen = resolve
      })
    },
    () => undefined,
  )

  await vi.waitFor(() => {
    expect(firstPageUpdates.at(-1)).toEqual({ status: 'loading', balanceSats: 25_000_000n })
    expect(resolveSecondChunk).toBeDefined()
    expect(resolveUnchosen).toBeDefined()
  })

  handOffAccountScan('bitcoin_mainnet::wpkh(chosen)')
  unsubChosen()
  unsubOther()

  resolveUnchosen?.({ usedIndexes: [], balanceSats: '0' })
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  expect(unchosenCalls).toBe(1)

  const secondPageUpdates: ScriptTypeBalanceState[] = []
  const unsubNext = subscribeExistingAccountScan('bitcoin_mainnet::wpkh(chosen)', (state) => {
    secondPageUpdates.push(state)
  })
  expect(unsubNext).not.toBeNull()
  expect(secondPageUpdates[0]).toEqual({ status: 'loading', balanceSats: 25_000_000n })

  resolveSecondChunk?.({ usedIndexes: [10], balanceSats: '25000000' })
  await vi.waitFor(() => {
    expect(secondPageUpdates.at(-1)).toEqual({ status: 'loaded', balanceSats: 100_000_000n })
  })
  unsubNext?.()

  expect(calls.filter((c) => c.chain === 'receive' && c.startIndex === 0)).toHaveLength(1)
})

it('evicts settled entries after TTL once unsubscribed and clears eviction timers on reset', async () => {
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.restoreAllMocks()
    resetXpubScanStore()
    vi.useRealTimers()
  })

  const loadedKey = 'bitcoin_mainnet::wpkh(settled)'
  const loadedUpdates: ScriptTypeBalanceState[] = []
  const unsubLoaded = subscribeAccountScan(
    loadedKey,
    async () => ({ usedIndexes: [], balanceSats: '0' }),
    (state) => {
      loadedUpdates.push(state)
    },
  )

  await vi.waitFor(() => {
    expect(loadedUpdates.at(-1)).toEqual({ status: 'loaded', balanceSats: 0n })
  })
  const settledAt = Date.now()
  unsubLoaded()
  await vi.advanceTimersByTimeAsync(0)

  expect(readActiveAccountScan(loadedKey)).toEqual({ status: 'loaded', balanceSats: 0n })
  expect(vi.getTimerCount()).toBe(1)

  await vi.advanceTimersByTimeAsync(60_000)
  expect(vi.getTimerCount()).toBe(0)
  vi.setSystemTime(settledAt + 1_000)
  expect(readActiveAccountScan(loadedKey)).toBeUndefined()
  expect(subscribeExistingAccountScan(loadedKey, () => undefined)).toBeNull()

  const errorKey = 'bitcoin_mainnet::wpkh(errored)'
  const errorUpdates: ScriptTypeBalanceState[] = []
  const unsubError = subscribeAccountScan(
    errorKey,
    async () => {
      throw new Error('Electrum offline')
    },
    (state) => {
      errorUpdates.push(state)
    },
  )
  await vi.waitFor(() => {
    expect(errorUpdates.at(-1)).toEqual({ status: 'error' })
  })
  unsubError()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)

  const deleteSpy = vi.spyOn(Map.prototype, 'delete')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(vi.getTimerCount()).toBe(0)
  expect(deleteSpy).toHaveBeenCalledWith(errorKey)

  const unsubErrorPending = subscribeAccountScan(
    'bitcoin_mainnet::wpkh(errored-reset)',
    async () => {
      throw new Error('Electrum offline')
    },
    () => undefined,
  )
  await vi.advanceTimersByTimeAsync(0)
  unsubErrorPending()
  await vi.advanceTimersByTimeAsync(0)
  expect(vi.getTimerCount()).toBe(1)

  resetXpubScanStore()
  expect(vi.getTimerCount()).toBe(0)
})
