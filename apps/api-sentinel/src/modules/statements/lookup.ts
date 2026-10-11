import { setTimeout as delay } from 'node:timers/promises'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { loggableError } from '../../lib/loggable-error'
import { type LookedUpTx, TransactionLoadError, type TxSource } from './sources/types'

/** Waits before each retry of a temporary failure. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

/** Longest a server can hold back lookups, so one answer can't stall a statement for long. */
const MAX_PAUSE_MS = 30_000

/**
 * How long one lookup keeps backing off while a server rate limits it. A busy public server can
 * limit requests for minutes, and a slow statement is better than a failed one.
 */
const RATE_LIMIT_BUDGET_MS = 5 * 60_000

/** Waits `ms`, or until `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

interface LookupRun {
  /** Set by whichever lookup fails first; the others stop. */
  failure: TransactionLoadError | null
  /** A rate limit holds back every lookup, not just the one that hit it. */
  pausedUntil: number
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  // An aborted wait just ends early; the caller checks why.
  await delay(ms, undefined, { signal }).catch(() => undefined)
}

/** A server's requested wait, limited to a sensible range. */
function retryAfter(ms: number | null): number {
  return ms === null || Number.isNaN(ms) ? 0 : Math.min(Math.max(ms, 0), MAX_PAUSE_MS)
}

/** The wait after a lookup's next rate limit: doubling from 1 s, up to the cap. */
function rateLimitBackoff(rateLimits: number): number {
  return Math.min(1_000 * 2 ** rateLimits, MAX_PAUSE_MS)
}

/**
 * Look up every transaction. Stops at the first lookup that can't succeed, so a statement never
 * goes on with missing transactions.
 */
export const lookupTransactions = asyncFn(
  async (deps: {
    /** Txids with the block height Electrum reported for each. */
    transactions: ReadonlyMap<string, number>
    source: TxSource
    logger: Logger
    /** Waits out retries and rate limits; tests replace it to avoid real delays. */
    sleep?: Sleep
    /** Milliseconds on a monotonic clock; tests replace it alongside `sleep`. */
    now?: () => number
    onProgress?: (done: number, total: number) => void
  }): Promise<Result<Map<string, LookedUpTx>, TransactionLoadError>> => {
    const { transactions, source, logger, onProgress } = deps
    const { sleep = defaultSleep, now = () => performance.now() } = deps
    const total = transactions.size
    const found = new Map<string, LookedUpTx>()

    onProgress?.(0, total)

    const queue = [...transactions.keys()]
    const run: LookupRun = { failure: null, pausedUntil: 0 }
    // Aborted by the first failure. That ends every wait and cancels requests in flight; requests a
    // source can't cancel are abandoned instead.
    const stop = new AbortController()
    const stopped = new Promise<void>((resolve) => {
      stop.signal.addEventListener('abort', () => {
        resolve()
      })
    })
    const abandoned = stopped.then((): null => null)
    const fail = (error: TransactionLoadError): void => {
      run.failure ??= error
      stop.abort()
    }
    // Read through a function: another lookup can record a failure while this one awaits.
    const failure = (): TransactionLoadError | null => run.failure
    const wait = async (ms: number): Promise<void> => {
      await Promise.race([sleep(ms, stop.signal), stopped])
    }

    const worker = async (): Promise<void> => {
      // The time this worker has already waited until, so it doesn't wait out the same pause twice.
      let waitedUntil = 0
      const pauseLeft = (): number => run.pausedUntil - Math.max(now(), waitedUntil)

      const lookupWithRetries = async (txid: string): Promise<Result<LookedUpTx, TransactionLoadError>> => {
        // Other temporary failures get a few quick retries; rate limits keep backing off for longer.
        let retries = 0
        let rateLimits = 0
        let rateLimitedMs = 0
        for (;;) {
          for (let ms = pauseLeft(); ms > 0 && run.failure === null; ms = pauseLeft()) {
            waitedUntil = run.pausedUntil
            await wait(ms)
          }
          if (run.failure !== null) {
            return Err(run.failure)
          }
          // Nothing is awaited between the checks above and the request, so a pause or failure
          // another lookup records can't slip in between.
          let result: Awaited<ReturnType<TxSource['lookup']>> | null
          try {
            const pending = source.lookup(txid, transactions.get(txid) ?? 0, stop.signal)
            // A source that can't cancel a request, such as an Electrum client, mustn't hold up a
            // failed run; its late answer or error is ignored.
            pending.catch(() => undefined)
            result = await Promise.race([pending, abandoned])
          } catch (cause) {
            // Once another lookup has failed, a source may reject what it was still doing.
            const earlier = failure()
            if (earlier !== null) {
              return Err(earlier)
            }
            logger.error(
              cause instanceof Error ? loggableError(cause) : { error: 'unknown' },
              'Unexpected error looking up a transaction',
            )
            return Err(new TransactionLoadError('unreachable', `Failed to fetch transaction ${txid}`, { cause }))
          }
          if (result === null) {
            return Err(failure() ?? new TransactionLoadError('unreachable', 'Lookups stopped'))
          }
          if (result.isOk()) {
            return Ok(result.unwrap())
          }
          const { error, retry } = result.unwrapErr()
          if (failure() !== null || retry === null) {
            return Err(failure() ?? error)
          }
          let ms: number
          if (retry.rateLimited) {
            ms = Math.max(rateLimitBackoff(rateLimits), retryAfter(retry.retryAfterMs))
            if (rateLimitedMs + ms > RATE_LIMIT_BUDGET_MS) {
              return Err(error)
            }
            rateLimits += 1
            rateLimitedMs += ms
          } else {
            const retryDelay = RETRY_DELAYS_MS[retries]
            if (retryDelay === undefined) {
              return Err(error)
            }
            retries += 1
            ms = Math.max(retryDelay, retryAfter(retry.retryAfterMs))
          }
          const until = now() + ms
          if (retry.rateLimited) {
            run.pausedUntil = Math.max(run.pausedUntil, until)
          }
          waitedUntil = Math.max(waitedUntil, until)
          await wait(ms)
        }
      }

      try {
        for (let txid = queue.shift(); txid !== undefined && run.failure === null; txid = queue.shift()) {
          const result = await lookupWithRetries(txid)
          if (result.isErr()) {
            fail(result.unwrapErr())
            return
          }
          const tx = result.unwrap()
          // Every source must answer for the transaction it was asked about.
          if (tx.txid !== txid) {
            fail(new TransactionLoadError('invalid', `Transaction data does not match ${txid}`))
            return
          }
          found.set(txid, tx)
          if (failure() === null) {
            onProgress?.(found.size, total)
          }
        }
      } catch (cause) {
        // Anything unexpected still stops every lookup, rather than leaving the others running.
        logger.error(
          cause instanceof Error ? loggableError(cause) : { error: 'unknown' },
          'Unexpected error looking up transactions',
        )
        fail(new TransactionLoadError('unreachable', 'Transaction lookup failed', { cause }))
      }
    }

    const limit = Number.isInteger(source.concurrency) && source.concurrency > 0 ? source.concurrency : 1
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker))

    if (run.failure !== null) {
      return Err(run.failure)
    }
    if (found.size !== total) {
      return Err(new TransactionLoadError('unavailable', 'Some transactions were not looked up'))
    }
    logger.info({ total }, 'Transactions looked up')
    return Ok(found)
  },
)
