import type { Account } from '@hoseki/packages/bitcoin/account'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { toTransactionEntries } from './entries'
import { type AccountHistory, collectAccountHistory } from './history'
import { type Sleep, lookupTransactions } from './lookup'
import { ElectrumSource } from './sources/electrum'
import { type LookedUpTx, TransactionLoadError } from './sources/types'

/**
 * Load confirmed transaction entries for an account above `afterHeight` up to `tipHeight`.
 *
 * Uses a two-pass Electrum strategy:
 * 1. Fetch all in-range transactions concurrently (with deduplicated block headers).
 * 2. Fetch only pre-window wallet-owned parent transactions referenced by in-range inputs,
 *    skipping external third-party senders and skipping block headers for those parents.
 */
export const loadAccountEntries = asyncFn(
  async (deps: {
    account: Account
    onchainProvider: ElectrumProvider
    /** Only emit entries for transactions confirmed strictly above this height; 0 reads all confirmed history. */
    afterHeight: number
    /** Anchored chain tip height; excludes txs above tipHeight and sets `confirmed`. */
    tipHeight: number
    logger: Logger
    sleep?: Sleep
  }): Promise<Result<TransactionEntry[], TransactionLoadError>> => {
    const historyResult = await collectAccountHistory(deps.account, deps.onchainProvider)
    if (historyResult.isErr()) {
      return Err(historyResult.unwrapErr())
    }
    const fullHistory = historyResult.unwrap()

    const inRange: AccountHistory = new Map()
    const inRangeHeights = new Map<string, number>()
    for (const [txid, entry] of fullHistory) {
      if (entry.height > deps.afterHeight && entry.height <= deps.tipHeight) {
        inRange.set(txid, entry)
        inRangeHeights.set(txid, entry.height)
      }
    }

    if (inRange.size === 0) {
      return Ok([])
    }

    const pass1Result = await lookupTransactions({
      transactions: inRangeHeights,
      source: new ElectrumSource(deps.onchainProvider),
      logger: deps.logger,
      sleep: deps.sleep,
    })
    if (pass1Result.isErr()) {
      return Err(pass1Result.unwrapErr())
    }
    const found = pass1Result.unwrap()

    const parentHeights = new Map<string, number>()
    for (const tx of found.values()) {
      for (const input of tx.inputs) {
        if (input.spends === null) {
          continue
        }
        const prevTxid = input.spends.txid.toLowerCase()
        if (found.has(prevTxid)) {
          continue
        }
        const parentHistory = fullHistory.get(prevTxid)
        if (parentHistory === undefined) {
          // External third-party sender — never belongs to this wallet.
          continue
        }
        if (tx.blockHeight !== null && parentHistory.height > tx.blockHeight) {
          return Err(new TransactionLoadError('invalid', 'Transaction spends a parent confirmed at a higher block'))
        }
        parentHeights.set(prevTxid, parentHistory.height)
      }
    }

    const combined = new Map<string, LookedUpTx>(found)
    if (parentHeights.size > 0) {
      const pass2Result = await lookupTransactions({
        transactions: parentHeights,
        source: new ElectrumSource(deps.onchainProvider, { blockTimes: 'skip' }),
        logger: deps.logger,
        sleep: deps.sleep,
      })
      if (pass2Result.isErr()) {
        return Err(pass2Result.unwrapErr())
      }
      for (const [txid, tx] of pass2Result.unwrap()) {
        combined.set(txid, tx)
      }
    }

    // Fail closed if any input referencing a wallet transaction cannot resolve its spent output.
    for (const tx of found.values()) {
      for (const input of tx.inputs) {
        if (input.spends === null) {
          continue
        }
        const prevTxid = input.spends.txid.toLowerCase()
        if (!fullHistory.has(prevTxid)) {
          continue
        }
        const parentTx = combined.get(prevTxid)
        if (parentTx?.outputs[input.spends.vout] === undefined) {
          return Err(new TransactionLoadError('invalid', 'Missing spent wallet output'))
        }
      }
    }

    return toTransactionEntries(inRange, combined, deps.tipHeight)
  },
)
