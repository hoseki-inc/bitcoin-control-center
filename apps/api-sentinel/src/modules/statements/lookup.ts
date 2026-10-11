import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { type LookedUpTx, TransactionLoadError, type TxSource } from './sources/types'

/** Waits before each retry of a temporary failure. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

export type Sleep = (ms: number) => Promise<void>

interface LookupRun {
  /** Set by whichever lookup fails first; the others stop. */
  failure: TransactionLoadError | null
  /** A rate limit holds back every lookup, not just the one that hit it. */
  pausedUntil: number
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
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
    /** Waits between lookup retries; tests replace it to avoid real delays. */
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
    let stop = (): void => {}
    const stopped = new Promise<void>((resolve) => {
      stop = resolve
    })
    const fail = (error: TransactionLoadError): void => {
      run.failure ??= error
      stop()
    }
    // Waits end early once another lookup fails.
    const wait = async (ms: number): Promise<void> => {
      await Promise.race([sleep(ms), stopped])
    }

    const worker = async (): Promise<void> => {
      // How long this worker has already waited, so it doesn't wait out the same pause twice.
      let waitedUntil = 0
      const waitForPause = async (): Promise<void> => {
        while (run.failure === null && run.pausedUntil > Math.max(now(), waitedUntil)) {
          const ms = run.pausedUntil - Math.max(now(), waitedUntil)
          waitedUntil = run.pausedUntil
          await wait(ms)
        }
      }

      const lookupWithRetries = async (txid: string): Promise<Result<LookedUpTx, TransactionLoadError>> => {
        for (let attempt = 0; ; attempt++) {
          await waitForPause()
          if (run.failure !== null) {
            return Err(run.failure)
          }
          let result: Awaited<ReturnType<TxSource['lookup']>>
          try {
            result = await source.lookup(txid, transactions.get(txid) ?? 0)
          } catch (cause) {
            return Err(new TransactionLoadError('unreachable', `Failed to fetch transaction ${txid}`, { cause }))
          }
          if (result.isOk()) {
            return Ok(result.unwrap())
          }
          const { error, retry } = result.unwrapErr()
          const delay = RETRY_DELAYS_MS[attempt]
          if (retry === null || delay === undefined) {
            return Err(error)
          }
          const ms = Math.max(delay, retry.retryAfterMs ?? 0)
          const until = now() + ms
          if (retry.rateLimited) {
            run.pausedUntil = Math.max(run.pausedUntil, until)
          }
          waitedUntil = Math.max(waitedUntil, until)
          await wait(ms)
        }
      }

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
        onProgress?.(found.size, total)
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
