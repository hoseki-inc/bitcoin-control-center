import { Err, Ok, type Result } from '@hoseki/packages/result'
import pino from 'pino'
import { expect, it, vi } from 'vitest'
import { lookupTransactions } from './lookup'
import { type LookedUpTx, type LookupFailure, TransactionLoadError, type TxSource } from './sources/types'

const logger = pino({ level: 'silent' })
const height = 800_000

type Lookup = (txid: string, height: number, signal: AbortSignal) => Promise<Result<LookedUpTx, LookupFailure>>

function txids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => (index + 1).toString(16).padStart(64, '0'))
}

function confirmedTx(txid: string): LookedUpTx {
  return { txid, blockHeight: height, blockTime: 1_704_153_600, inputs: [], outputs: [{ address: null, value: 1 }] }
}

function source(lookup: Lookup, concurrency = 10): TxSource & { lookup: ReturnType<typeof vi.fn<Lookup>> } {
  return { kind: 'public_mempool', concurrency, lookup: vi.fn(lookup) }
}

function atHeight(ids: string[]): Map<string, number> {
  return new Map(ids.map((id) => [id, height]))
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function rateLimited(retryAfterMs: number): Result<LookedUpTx, LookupFailure> {
  return Err({
    error: new TransactionLoadError('unreachable', 'HTTP 429'),
    retry: { rateLimited: true, retryAfterMs },
  })
}

it('reports progress as each lookup finishes', async () => {
  const onProgress = vi.fn<(done: number, total: number) => void>()

  await lookupTransactions({
    transactions: atHeight(txids(2)),
    source: source(async (txid) => Ok(confirmedTx(txid)), 1),
    logger,
    onProgress,
  })

  expect(onProgress.mock.calls).toEqual([
    [0, 2],
    [1, 2],
    [2, 2],
  ])
})

it('never has more lookups in flight than the source allows', async () => {
  let inFlight = 0
  let most = 0
  const slow = source(async (txid) => {
    inFlight += 1
    most = Math.max(most, inFlight)
    await delay(1)
    inFlight -= 1
    return Ok(confirmedTx(txid))
  }, 3)

  const result = await lookupTransactions({ transactions: atHeight(txids(20)), source: slow, logger })

  expect(result.unwrap().size).toBe(20)
  expect(most).toBe(3)
})

it.each([0, Number.NaN, 2.5])('looks up one at a time when a source gives concurrency %s', async (concurrency) => {
  let inFlight = 0
  let most = 0
  const lookups = source(async (txid) => {
    inFlight += 1
    most = Math.max(most, inFlight)
    await delay(1)
    inFlight -= 1
    return Ok(confirmedTx(txid))
  }, concurrency)

  const result = await lookupTransactions({ transactions: atHeight(txids(3)), source: lookups, logger })

  expect(result.unwrap().size).toBe(3)
  expect(most).toBe(1)
})

it('stops starting lookups once one fails for good', async () => {
  const ids = txids(30)
  const failing = source(async (txid) =>
    txid === ids[0]
      ? Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
      : Ok(confirmedTx(txid)),
  )

  const result = await lookupTransactions({ transactions: atHeight(ids), source: failing, logger })

  expect(result.expectErr('a missing transaction must stop the lookups').kind).toBe('unavailable')
  // Only the first round of 10 started; the other 20 never did.
  expect(failing.lookup).toHaveBeenCalledTimes(10)
})

it('stops every lookup when one throws', async () => {
  const ids = txids(30)
  const throwing = source(async (txid) => {
    if (txid === ids[0]) {
      throw new TypeError('terminated')
    }
    return Ok(confirmedTx(txid))
  })

  const result = await lookupTransactions({ transactions: atHeight(ids), source: throwing, logger })
  await delay(5)

  expect(result.expectErr('a thrown lookup must stop the statement').kind).toBe('unreachable')
  expect(throwing.lookup).toHaveBeenCalledTimes(10)
})

it('rejects an answer for a different transaction', async () => {
  const [txid = ''] = txids(1)
  const other = source(async () => Ok(confirmedTx('f'.repeat(64))))

  const result = await lookupTransactions({ transactions: atHeight([txid]), source: other, logger })

  expect(result.expectErr('another transaction must not stand in for this one').kind).toBe('invalid')
})

it('makes another lookup wait out a rate limit', async () => {
  const [limited = '', slow = '', later = ''] = txids(3)
  const events: string[] = []
  let limitedOnce = false
  const lookups = source(async (txid) => {
    events.push(`lookup ${txid === later ? 'later' : txid === slow ? 'slow' : 'limited'}`)
    if (txid === limited && !limitedOnce) {
      limitedOnce = true
      return rateLimited(5_000)
    }
    // The limited lookup's retry and the slow lookup both finish after the rate limit, so the
    // slow lookup's worker is the one that takes the next transaction.
    await delay(txid === limited ? 20 : 5)
    return Ok(confirmedTx(txid))
  }, 2)
  const sleep = vi.fn(async (ms: number) => {
    events.push(`sleep ${ms}`)
    await delay(1)
  })

  const result = await lookupTransactions({
    transactions: atHeight([limited, slow, later]),
    source: lookups,
    logger,
    sleep,
    now: () => 0,
  })

  expect(result.unwrap().size).toBe(3)
  expect(events).toEqual([
    'lookup limited',
    'lookup slow',
    'sleep 5000',
    'lookup limited',
    // The other worker waited out the same pause before its next lookup.
    'sleep 5000',
    'lookup later',
  ])
})

it('makes a retry wait out a longer rate limit set by another lookup', async () => {
  const [busy = '', limited = ''] = txids(2)
  const attempts = new Map<string, number>()
  const lookups = source(async (txid) => {
    const attempt = (attempts.get(txid) ?? 0) + 1
    attempts.set(txid, attempt)
    if (attempt > 1) {
      return Ok(confirmedTx(txid))
    }
    if (txid === busy) {
      return Err({
        error: new TransactionLoadError('unreachable', 'HTTP 503'),
        retry: { rateLimited: false, retryAfterMs: null },
      })
    }
    // Rate limited while the busy lookup is waiting for its own retry.
    await delay(2)
    return rateLimited(30_000)
  }, 2)
  const sleep = vi.fn(async (_ms: number) => {
    await delay(10)
  })

  const result = await lookupTransactions({
    transactions: atHeight([busy, limited]),
    source: lookups,
    logger,
    sleep,
    now: () => 0,
  })

  expect(result.unwrap().size).toBe(2)
  // The busy lookup's 1 s retry wait was extended to the 30 s pause instead of retrying into it.
  expect(sleep.mock.calls.map(([ms]) => ms).sort((a, b) => a - b)).toEqual([1_000, 29_000, 30_000])
  expect(attempts.get(busy)).toBe(2)
})

it('stops waiting out a rate limit once another lookup fails', async () => {
  const [limited = '', missing = ''] = txids(2)
  const lookups = source(async (txid) => {
    if (txid === missing) {
      await delay(5)
      return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
    }
    return rateLimited(30_000)
  }, 2)
  // A wait that never ends on its own, so only the failure can end it.
  const sleep = vi.fn(async (_ms: number) => new Promise<void>(() => {}))

  const result = await lookupTransactions({
    transactions: atHeight([limited, missing]),
    source: lookups,
    logger,
    sleep,
    now: () => 0,
  })

  expect(result.expectErr('a missing transaction must stop the statement').kind).toBe('unavailable')
  expect(lookups.lookup.mock.calls.filter(([txid]) => txid === limited)).toHaveLength(1)
})

it('cancels lookups still in flight once one fails', async () => {
  const [missing = '', slow = ''] = txids(2)
  let slowSignal: AbortSignal | undefined
  const lookups = source(async (txid, _height, signal) => {
    if (txid === missing) {
      await delay(5)
      return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
    }
    slowSignal = signal
    // A request that would take a minute unless cancelled.
    await Promise.race([
      delay(60_000),
      new Promise((resolve) => {
        signal.addEventListener('abort', resolve)
      }),
    ])
    return Err({
      error: new TransactionLoadError('unreachable', 'Aborted'),
      retry: { rateLimited: false, retryAfterMs: null },
    })
  }, 2)
  const started = performance.now()

  const result = await lookupTransactions({ transactions: atHeight([missing, slow]), source: lookups, logger })

  expect(result.expectErr('a missing transaction must stop the statement').kind).toBe('unavailable')
  expect(slowSignal?.aborted).toBe(true)
  expect(performance.now() - started).toBeLessThan(1_000)
})

it('stops every lookup when anything else in a worker throws', async () => {
  const ids = txids(20)
  const lookups = source(async (txid) => Ok(confirmedTx(txid)), 2)

  const result = await lookupTransactions({
    transactions: atHeight(ids),
    source: lookups,
    logger,
    onProgress: (done) => {
      if (done === 1) {
        throw new Error('Unexpected')
      }
    },
  })
  await delay(5)

  expect(result.expectErr('an unexpected error must stop the statement').kind).toBe('unreachable')
  expect(lookups.lookup.mock.calls.length).toBeLessThan(ids.length)
})

it.each([
  { retryAfterMs: 600_000, wait: 30_000 },
  { retryAfterMs: Number.NaN, wait: 1_000 },
  { retryAfterMs: -5, wait: 1_000 },
])('limits a requested wait of $retryAfterMs ms to $wait ms', async ({ retryAfterMs, wait }) => {
  const [txid = ''] = txids(1)
  let limitedOnce = false
  const lookups = source(async (id) => {
    if (!limitedOnce) {
      limitedOnce = true
      return rateLimited(retryAfterMs)
    }
    return Ok(confirmedTx(id))
  })
  const sleep = vi.fn(async (_ms: number) => {})

  const result = await lookupTransactions({
    transactions: atHeight([txid]),
    source: lookups,
    logger,
    sleep,
    now: () => 0,
  })

  expect(result.isOk()).toBe(true)
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([wait])
})

it.each(Array.from({ length: 12 }, (_, ticks) => ticks))(
  'never sends a retry into a pause another lookup set just before it (%i ticks apart)',
  async (ticks) => {
    const [busy = '', limited = ''] = txids(2)
    const events: string[] = []
    let releaseRetry = (): void => {}
    const retryReleased = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    const attempts = new Map<string, number>()
    const lookups = source(async (txid) => {
      const attempt = (attempts.get(txid) ?? 0) + 1
      attempts.set(txid, attempt)
      events.push(`lookup ${txid === busy ? 'busy' : 'limited'} ${attempt}`)
      if (attempt > 1) {
        return Ok(confirmedTx(txid))
      }
      if (txid === busy) {
        return Err({
          error: new TransactionLoadError('unreachable', 'HTTP 503'),
          retry: { rateLimited: false, retryAfterMs: null },
        })
      }
      // The rate limit lands a few ticks after the busy lookup's retry wait ends.
      await retryReleased
      for (let tick = 0; tick < ticks; tick++) {
        await Promise.resolve()
      }
      return rateLimited(30_000)
    }, 2)
    const sleep = vi.fn(async (ms: number) => {
      events.push(`sleep ${ms}`)
      if (ms === 1_000) {
        releaseRetry()
      }
    })

    const result = await lookupTransactions({
      transactions: atHeight([busy, limited]),
      source: lookups,
      logger,
      sleep,
      now: () => 0,
    })

    expect(result.unwrap().size).toBe(2)
    const paused = events.indexOf('sleep 30000')
    const retried = events.indexOf('lookup busy 2')
    if (paused < retried) {
      // The pause was set before the retry went out, so the retry must have waited it out.
      expect(events.slice(paused, retried)).toContain('sleep 29000')
    }
  },
)
