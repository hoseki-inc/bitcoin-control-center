import { Err, Ok, type Result } from '@hoseki/packages/result'
import { describe, expect, it } from 'vitest'
import { ExchangeHistoryCache, type ExchangeHistoryFetchOutput, type ExchangeHistoryKey } from './history-cache'

function makeDeferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ExchangeHistoryCache', () => {
  it('prevents an in-flight fetch evicted by invalidate() from repopulating or overwriting a newer fetch and deletes removed slots', async () => {
    let now = 1_000_000
    const cache = new ExchangeHistoryCache(() => now)
    const key: ExchangeHistoryKey = {
      encryptedCredentials: 'creds-1',
      externalAccountId: 'ext-1',
      credentialsConnectedAt: '2026-01-01T00:00:00.000Z',
    }

    const staleFetch = makeDeferred<Result<ExchangeHistoryFetchOutput, Error>>()
    const freshEntry = { timestamp: new Date('2026-02-01T00:00:00.000Z'), value: 200_000n }
    const staleEntry = { timestamp: new Date('2026-01-01T00:00:00.000Z'), value: 100_000n }

    const firstCall = cache.get('acc-1', key, async () => staleFetch.promise)

    // Evict while the first fetch is still in flight.
    cache.invalidate('acc-1')
    expect(cache['slots'].has('acc-1')).toBe(false)

    // A second fetch populates the fresh slot before the evicted fetch finishes.
    let calls = 0
    const secondResult = await cache.get('acc-1', key, async () => {
      calls += 1
      return Ok({ entries: [freshEntry] })
    })
    expect(secondResult.unwrap()).toEqual([freshEntry])
    expect(calls).toBe(1)

    // The evicted fetch settles late — it must not overwrite the fresh cache entry.
    staleFetch.resolve(Ok({ entries: [staleEntry] }))
    expect((await firstCall).unwrap()).toEqual([staleEntry])

    now += 1_000
    const cachedResult = await cache.get('acc-1', key, async () => {
      calls += 1
      return Ok({ entries: [] })
    })
    expect(cachedResult.unwrap()).toEqual([freshEntry])
    expect(calls).toBe(1)

    // Removing the account deletes its slot from the map.
    cache.invalidate('acc-1')
    expect(cache['slots'].has('acc-1')).toBe(false)
  })

  it('prevents a superseded in-flight fetch for a different key from clearing the newer key cache on failure', async () => {
    let now = 2_000_000
    const cache = new ExchangeHistoryCache(() => now)
    const legacyKey: ExchangeHistoryKey = {
      encryptedCredentials: 'creds-1',
      externalAccountId: null,
      credentialsConnectedAt: '2026-01-01T00:00:00.000Z',
    }
    const backfilledKey: ExchangeHistoryKey = {
      encryptedCredentials: 'creds-1',
      externalAccountId: 'uuid-1',
      credentialsConnectedAt: '2026-01-01T00:00:00.000Z',
    }

    const legacyFetch = makeDeferred<Result<ExchangeHistoryFetchOutput, Error>>()
    const backfilledEntry = { timestamp: new Date('2026-03-01T00:00:00.000Z'), value: 300_000n }

    const legacyCall = cache.get('acc-2', legacyKey, async () => legacyFetch.promise)

    // A concurrent read arrives with the backfilled key and completes first.
    let newerCalls = 0
    const newerResult = await cache.get('acc-2', backfilledKey, async () => {
      newerCalls += 1
      return Ok({ entries: [backfilledEntry] })
    })
    expect(newerResult.unwrap()).toEqual([backfilledEntry])
    expect(newerCalls).toBe(1)

    // The superseded legacy fetch then fails — it must not clobber the newer key's cached entries.
    legacyFetch.resolve(Err(new Error('legacy fetch failed')))
    expect((await legacyCall).isErr()).toBe(true)

    now += 1_000
    const afterResult = await cache.get('acc-2', backfilledKey, async () => {
      newerCalls += 1
      return Ok({ entries: [] })
    })
    expect(afterResult.unwrap()).toEqual([backfilledEntry])
    expect(newerCalls).toBe(1)
  })
})
