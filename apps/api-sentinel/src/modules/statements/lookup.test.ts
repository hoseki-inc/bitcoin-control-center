import { Err, Ok, type Result } from '@hoseki/packages/result'
import pino, { type Logger } from 'pino'
import { expect, it, vi } from 'vitest'
import { type Sleep, lookupTransactions } from './lookup'
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

function rateLimited(retryAfterMs: number | null): Result<LookedUpTx, LookupFailure> {
  return Err({
    error: new TransactionLoadError('unreachable', 'HTTP 429'),
    retry: { kind: 'rateLimit', retryAfterMs },
  })
}

interface FastClock {
  now: () => number
  sleep: Sleep
}

/**
 * A clock that reads as if the process had run for a long time, and runs 1,000 times faster than
 * real time, with a sleep that waits on it. Tests only check that lookups wait at least long
 * enough, which a slow machine can't break.
 */
function fastClock(): FastClock {
  const started = performance.now()
  const now = (): number => 5_000_000 + (performance.now() - started) * 1_000
  const sleep: Sleep = async (ms) => {
    const until = now() + ms
    while (now() < until) {
      await delay(1)
    }
  }
  return { now, sleep }
}

interface SendTimes {
  /** Records a lookup going out now, and returns which attempt it is. */
  record: (txid: string) => number
  sentAt: (txid: string) => number[]
}

/** When each lookup went out, by the given clock. */
function sendTimes(now: () => number): SendTimes {
  const times = new Map<string, number[]>()
  return {
    record: (txid) => {
      const sent = [...(times.get(txid) ?? []), now()]
      times.set(txid, sent)
      return sent.length
    },
    sentAt: (txid) => times.get(txid) ?? [],
  }
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
  const failing = source(async (txid) => {
    if (txid === ids[0]) {
      return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
    }
    await delay(5)
    return Ok(confirmedTx(txid))
  })

  const result = await lookupTransactions({ transactions: atHeight(ids), source: failing, logger })

  expect(result.expectErr('a missing transaction must stop the lookups').kind).toBe('unavailable')
  // Only the first ten were already in flight; none starts after the failure.
  expect(failing.lookup.mock.calls.length).toBeLessThanOrEqual(10)
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
  expect(throwing.lookup.mock.calls.length).toBeLessThan(ids.length)
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

it('waits out a rate limit by the clock, however long the process has run', async () => {
  const [limited = '', slow = '', later = ''] = txids(3)
  const clock = fastClock()
  const { record, sentAt } = sendTimes(clock.now)
  let limitedAt = 0
  let markLimited = (): void => {}
  const wasLimited = new Promise<void>((resolve) => {
    markLimited = resolve
  })
  const lookups = source(async (txid) => {
    const attempt = record(txid)
    if (txid === limited && attempt === 1) {
      limitedAt = clock.now()
      markLimited()
      return rateLimited(5_000)
    }
    if (txid === slow) {
      // Finishes once the rate limit is in place, so this worker's next lookup meets the pause.
      await wasLimited
      await delay(1)
    }
    return Ok(confirmedTx(txid))
  }, 2)

  const result = await lookupTransactions({
    transactions: atHeight([limited, slow, later]),
    source: lookups,
    logger,
    ...clock,
  })

  expect(result.unwrap().size).toBe(3)
  // Neither the retry nor the other worker's next lookup goes out during the 5 s pause.
  expect(sentAt(limited)[1]).toBeGreaterThanOrEqual(limitedAt + 5_000)
  expect(sentAt(later)[0]).toBeGreaterThanOrEqual(limitedAt + 5_000)
})

it('makes a retry wait out a longer rate limit set by another lookup', async () => {
  const [busy = '', limited = ''] = txids(2)
  const clock = fastClock()
  const { record, sentAt } = sendTimes(clock.now)
  let limitedAt = 0
  let markBusy = (): void => {}
  const wasBusy = new Promise<void>((resolve) => {
    markBusy = resolve
  })
  const lookups = source(async (txid) => {
    if (record(txid) > 1) {
      return Ok(confirmedTx(txid))
    }
    if (txid === busy) {
      markBusy()
      return Err({
        error: new TransactionLoadError('unreachable', 'HTTP 503'),
        retry: { kind: 'temporary', retryAfterMs: null },
      })
    }
    // Rate limited while the busy lookup waits for its own 1 s retry.
    await wasBusy
    limitedAt = clock.now()
    return rateLimited(30_000)
  }, 2)

  const result = await lookupTransactions({
    transactions: atHeight([busy, limited]),
    source: lookups,
    logger,
    ...clock,
  })

  expect(result.unwrap().size).toBe(2)
  // The busy lookup's retry waited out the 30 s pause instead of going out after 1 s.
  expect(sentAt(busy)).toHaveLength(2)
  expect(sentAt(busy)[1]).toBeGreaterThanOrEqual(limitedAt + 30_000)
})

it('keeps a longer pause when a shorter rate limit follows', async () => {
  const [long = '', short = '', slow = '', later = ''] = txids(4)
  const clock = fastClock()
  const { record, sentAt } = sendTimes(clock.now)
  let longAt = 0
  let markLong = (): void => {}
  const longLimited = new Promise<void>((resolve) => {
    markLong = resolve
  })
  let markShort = (): void => {}
  const shortLimited = new Promise<void>((resolve) => {
    markShort = resolve
  })
  const lookups = source(async (txid) => {
    if (record(txid) > 1) {
      return Ok(confirmedTx(txid))
    }
    if (txid === long) {
      longAt = clock.now()
      markLong()
      return rateLimited(30_000)
    }
    if (txid === short) {
      // A request already in flight that meets a 1 s rate limit after the 30 s one.
      await longLimited
      await delay(1)
      markShort()
      return rateLimited(null)
    }
    if (txid === slow) {
      await shortLimited
      await delay(1)
    }
    return Ok(confirmedTx(txid))
  }, 3)

  const result = await lookupTransactions({
    transactions: atHeight([long, short, slow, later]),
    source: lookups,
    logger,
    ...clock,
  })

  expect(result.unwrap().size).toBe(4)
  expect(sentAt(short)[1]).toBeGreaterThanOrEqual(longAt + 30_000)
  expect(sentAt(later)[0]).toBeGreaterThanOrEqual(longAt + 30_000)
})

it('makes every lookup wait while a dropped connection comes back', async () => {
  const [dropped = '', slow = '', later = ''] = txids(3)
  const clock = fastClock()
  const { record, sentAt } = sendTimes(clock.now)
  let droppedAt = 0
  let markDropped = (): void => {}
  const wasDropped = new Promise<void>((resolve) => {
    markDropped = resolve
  })
  const lookups = source(async (txid) => {
    const attempt = record(txid)
    if (txid === dropped && attempt === 1) {
      droppedAt = clock.now()
      markDropped()
      return Err({
        error: new TransactionLoadError('unreachable', 'Connection closed'),
        retry: { kind: 'connection', retryAfterMs: null },
      })
    }
    if (txid === slow) {
      await wasDropped
      await delay(1)
    }
    return Ok(confirmedTx(txid))
  }, 2)

  const result = await lookupTransactions({
    transactions: atHeight([dropped, slow, later]),
    source: { ...lookups, retryDelaysMs: [10_000] },
    logger,
    ...clock,
  })

  expect(result.unwrap().size).toBe(3)
  // The other worker's next lookup waits out the 10 s retry too, instead of using the dropped connection.
  expect(sentAt(dropped)[1]).toBeGreaterThanOrEqual(droppedAt + 10_000)
  expect(sentAt(later)[0]).toBeGreaterThanOrEqual(droppedAt + 10_000)
})

it('waits as long as the source asks before each retry', async () => {
  const [txid = ''] = txids(1)
  const lookups = {
    ...source(async () =>
      Err({
        error: new TransactionLoadError('unreachable', 'Connection closed'),
        retry: { kind: 'connection', retryAfterMs: null },
      }),
    ),
    retryDelaysMs: [2_000, 5_000, 10_000],
  }
  const sleep = vi.fn(async (_ms: number) => {})

  const result = await lookupTransactions({ transactions: atHeight([txid]), source: lookups, logger, sleep })

  expect(result.expectErr('a connection that never comes back must stop the statement').kind).toBe('unreachable')
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 5_000, 10_000])
})

it('keeps backing off from a rate limit for up to five minutes, then stops', async () => {
  const [txid = ''] = txids(1)
  const lookups = source(async () => rateLimited(null))
  const sleep = vi.fn(async (_ms: number) => {})

  const result = await lookupTransactions({ transactions: atHeight([txid]), source: lookups, logger, sleep })

  expect(result.expectErr('a rate limit that never lifts must stop the statement').kind).toBe('unreachable')
  // Doubling from 1 s up to the 30 s cap, for no more than five minutes in all.
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
    1_000,
    2_000,
    4_000,
    8_000,
    16_000,
    ...Array.from({ length: 8 }, () => 30_000),
  ])
})

it('retries any other temporary failure three times', async () => {
  const [txid = ''] = txids(1)
  const lookups = source(async () =>
    Err({
      error: new TransactionLoadError('unreachable', 'HTTP 503'),
      retry: { kind: 'temporary', retryAfterMs: null },
    }),
  )
  const sleep = vi.fn(async (_ms: number) => {})

  const result = await lookupTransactions({ transactions: atHeight([txid]), source: lookups, logger, sleep })

  expect(result.expectErr('a server that stays down must stop the statement').kind).toBe('unreachable')
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000, 4_000])
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
      retry: { kind: 'temporary', retryAfterMs: null },
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
  { retryAfterMs: Number.POSITIVE_INFINITY, wait: 30_000 },
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

it('never sends a retry into a pause another lookup set just before it', async () => {
  // The rate limit lands 0–11 ticks after the busy lookup's retry wait ends. Which comes first is
  // recorded for each, so the sweep is known to cover both orders.
  const orders = new Set<string>()
  for (let ticks = 0; ticks < 12; ticks++) {
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
          retry: { kind: 'temporary', retryAfterMs: null },
        })
      }
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
    orders.add(paused < retried ? 'pause first' : 'retry first')
    if (paused < retried) {
      // The pause was set before the retry went out, so the retry must have waited it out.
      expect(events.slice(paused, retried)).toContain('sleep 29000')
    }
  }
  expect(orders).toEqual(new Set(['pause first', 'retry first']))
})

it('reports no progress once a lookup has failed', async () => {
  // The other lookup finishes 0–11 ticks after the failing one, so in some runs its answer arrives
  // just after the failure is recorded.
  for (let ticks = 0; ticks < 12; ticks++) {
    const [missing = '', other = ''] = txids(2)
    const onProgress = vi.fn<(done: number, total: number) => void>()
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const lookups = source(async (txid) => {
      await released
      if (txid === missing) {
        return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
      }
      for (let tick = 0; tick < ticks; tick++) {
        await Promise.resolve()
      }
      return Ok(confirmedTx(txid))
    }, 2)

    const run = lookupTransactions({ transactions: atHeight([missing, other]), source: lookups, logger, onProgress })
    release()
    await run

    expect(onProgress.mock.calls).toEqual([[0, 2]])
  }
})

it('ends a real wait as soon as another lookup fails', async () => {
  const [limited = '', missing = ''] = txids(2)
  const lookups = source(async (txid) => {
    if (txid === missing) {
      await delay(20)
      return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
    }
    return rateLimited(30_000)
  }, 2)
  const started = performance.now()

  // The default sleep, which would otherwise wait the full 30 s.
  const result = await lookupTransactions({ transactions: atHeight([limited, missing]), source: lookups, logger })

  expect(result.expectErr('a missing transaction must stop the statement').kind).toBe('unavailable')
  expect(performance.now() - started).toBeLessThan(1_000)
})

it('does not wait for a request that ignores the stop', async () => {
  const [missing = '', stubborn = ''] = txids(2)
  const lookups = source(async (txid) => {
    if (txid === missing) {
      await delay(5)
      return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
    }
    // Like an Electrum request, which can't be cancelled, this one runs to the end.
    await delay(2_000)
    return Ok(confirmedTx(txid))
  }, 2)
  const started = performance.now()

  const result = await lookupTransactions({ transactions: atHeight([missing, stubborn]), source: lookups, logger })

  expect(result.expectErr('a missing transaction must stop the statement').kind).toBe('unavailable')
  expect(performance.now() - started).toBeLessThan(1_000)
})

interface CapturedLog {
  log: Logger
  lines: string[]
}

function capturedLogger(): CapturedLog {
  const lines: string[] = []
  const log = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        lines.push(line)
      },
    },
  )
  return { log, lines }
}

it('does not log a request the source drops once another lookup has failed', async () => {
  // The dropped request fails 0–11 ticks after the failing lookup answers, so the sweep covers
  // requests dropped both before and after the failure stops the run.
  const orders = new Set<string>()
  for (let ticks = 0; ticks < 12; ticks++) {
    const { log, lines } = capturedLogger()
    const [missing = '', dropped = ''] = txids(2)
    const stoppedWhenDropped: boolean[] = []
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const lookups = source(async (txid, _height, signal) => {
      await released
      if (txid === missing) {
        return Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
      }
      for (let tick = 0; tick < ticks; tick++) {
        await Promise.resolve()
      }
      // Like an Electrum client failing the requests it still had when its connection closed.
      stoppedWhenDropped.push(signal.aborted)
      throw new Error('Connection closed')
    }, 2)

    const run = lookupTransactions({ transactions: atHeight([missing, dropped]), source: lookups, logger: log })
    release()
    await run

    const afterStop = stoppedWhenDropped[0] === true
    orders.add(afterStop ? 'after the stop' : 'before the stop')
    if (afterStop) {
      expect(lines.join('')).not.toContain('Unexpected error')
    }
  }
  expect(orders).toEqual(new Set(['before the stop', 'after the stop']))
})

it('logs where an unexpected error came from, without its message', async () => {
  const { log, lines } = capturedLogger()
  const [txid = ''] = txids(1)
  const lookups = source(async () => {
    throw new TypeError(`Cannot read the outputs of ${txid}`)
  })

  const result = await lookupTransactions({ transactions: atHeight([txid]), source: lookups, logger: log })

  expect(result.expectErr('a bug must stop the statement').kind).toBe('unreachable')
  const logged = lines.join('')
  expect(logged).toContain('"error":"TypeError"')
  expect(logged).toContain('lookup.test.ts')
  expect(logged).not.toContain(txid)
})
