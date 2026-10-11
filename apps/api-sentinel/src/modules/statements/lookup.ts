import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import type { LookedUpTx, TransactionLoadError, TxSource } from './sources/types'
import type { SavedTx, TransactionCache } from './tx_cache'

/** Waits before each retry of a temporary failure. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

// Save only transactions with 6+ confirmations, so a reorg can't leave a wrong saved row. Newer ones are looked up each time.
const MIN_SAVED_CONFIRMATIONS = 6

export type Sleep = (ms: number) => Promise<void>

interface LookupOutcome {
  /** Set by whichever lookup fails first; the others stop taking new transactions. */
  failure: TransactionLoadError | null
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function canSave(tx: LookedUpTx, historyHeight: number, tipHeight: number): tx is SavedTx {
  return (
    tx.blockHeight !== null &&
    tx.blockHeight === historyHeight &&
    tx.blockTime !== null &&
    tx.blockTime > 0 &&
    tipHeight - tx.blockHeight + 1 >= MIN_SAVED_CONFIRMATIONS
  )
}

/**
 * Look up every transaction, using saved lookups first. Stops at the first lookup that can't
 * succeed, so a statement never goes on with missing transactions.
 */
export const lookupTransactions = asyncFn(
  async (deps: {
    /** Txids with the block height Electrum reported for each. */
    transactions: ReadonlyMap<string, number>
    source: TxSource
    tipHeight: number
    cache?: TransactionCache
    logger: Logger
    /** Waits between lookup retries; tests replace it to avoid real delays. */
    sleep?: Sleep
    onProgress?: (done: number, total: number) => void
  }): Promise<Result<Map<string, LookedUpTx>, TransactionLoadError>> => {
    const { transactions, source, tipHeight, cache, logger, sleep = defaultSleep, onProgress } = deps
    const total = transactions.size
    const found = new Map<string, LookedUpTx>()

    // A saved lookup from a block that has since been replaced is looked up again.
    const saved = cache ? await cache.find([...transactions.keys()]) : new Map<string, SavedTx>()
    for (const [txid, tx] of saved) {
      if (tx.blockHeight === transactions.get(txid)) {
        found.set(txid, tx)
      }
    }
    onProgress?.(found.size, total)

    const savedCount = found.size
    const queue = [...transactions.keys()].filter((txid) => !found.has(txid))
    const outcome: LookupOutcome = { failure: null }
    // A rate limit holds back every lookup, not just the one that hit it.
    let pausedUntil = 0

    const lookupWithRetries = async (txid: string): Promise<Result<LookedUpTx, TransactionLoadError>> => {
      for (let attempt = 0; ; attempt++) {
        const paused = pausedUntil - performance.now()
        if (attempt === 0 && paused > 0) {
          await sleep(paused)
        }
        const result = await source.lookup(txid, transactions.get(txid) ?? 0)
        if (result.isOk()) {
          return Ok(result.unwrap())
        }
        const { error, retry } = result.unwrapErr()
        const delay = RETRY_DELAYS_MS[attempt]
        if (retry === null || delay === undefined || outcome.failure !== null) {
          return Err(error)
        }
        const wait = Math.max(delay, retry.retryAfterMs ?? 0)
        if (retry.rateLimited) {
          pausedUntil = Math.max(pausedUntil, performance.now() + wait)
        }
        await sleep(wait)
      }
    }

    const worker = async (): Promise<void> => {
      for (let txid = queue.shift(); txid !== undefined && outcome.failure === null; txid = queue.shift()) {
        const result = await lookupWithRetries(txid)
        if (result.isErr()) {
          outcome.failure ??= result.unwrapErr()
          return
        }
        const tx = result.unwrap()
        found.set(txid, tx)
        if (cache && canSave(tx, transactions.get(txid) ?? 0, tipHeight)) {
          try {
            await cache.save(tx, source.kind)
          } catch (err) {
            // Saving only speeds up later statements, so a failed save doesn't stop this one.
            logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'Could not save a transaction lookup')
          }
        }
        onProgress?.(found.size, total)
      }
    }

    await Promise.all(Array.from({ length: Math.min(source.concurrency, queue.length) }, worker))

    if (outcome.failure !== null) {
      return Err(outcome.failure)
    }
    logger.info({ total, saved: savedCount }, 'Transactions looked up')
    return Ok(found)
  },
)
