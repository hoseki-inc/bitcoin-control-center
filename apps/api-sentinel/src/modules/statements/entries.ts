import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { isConfirmed } from '@hoseki/packages/bitcoin/onchain/types'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import type { AccountHistory } from './history'
import { type LookedUpTx, TransactionLoadError, type TxInput, type TxOutput } from './sources/types'

/** The output an input spends: from the source, or else from one of the wallet's own transactions. */
function spentOutput(input: TxInput, found: ReadonlyMap<string, LookedUpTx>): TxOutput | null {
  if (input.prevout !== null) {
    return input.prevout
  }
  if (input.spends === null) {
    return null
  }
  // Spending a wallet output means the transaction that created it is in the wallet's history,
  // whose txids are lowercase.
  return found.get(input.spends.txid.toLowerCase())?.outputs[input.spends.vout] ?? null
}

/** One entry per transaction and wallet address it involves, valued for that address. */
export function toTransactionEntries(
  history: AccountHistory,
  found: ReadonlyMap<string, LookedUpTx>,
  tipHeight: number,
): Result<TransactionEntry[], TransactionLoadError> {
  const entries: TransactionEntry[] = []
  for (const [txid, { addresses }] of history) {
    const tx = found.get(txid)
    if (tx === undefined) {
      return Err(new TransactionLoadError('unavailable', `Missing transaction ${txid}`))
    }
    const txidRes = Txid.fromString(tx.txid)
    if (txidRes.isErr()) {
      return Err(new TransactionLoadError('invalid', `Invalid txid ${txid}`))
    }

    const confirmed = tx.blockHeight !== null && isConfirmed({ tip: tipHeight, height: tx.blockHeight })
    const timestamp =
      tx.blockTime !== null && tx.blockTime !== 0 && !Number.isNaN(tx.blockTime)
        ? new Date(tx.blockTime * 1000)
        : new Date()

    for (const address of addresses) {
      const addressStr = address.toString()
      let value = 0n
      // Inputs: money going OUT from this address
      for (const input of tx.inputs) {
        const spent = spentOutput(input, found)
        if (spent?.address === addressStr) {
          value -= BigInt(spent.value)
        }
      }
      // Outputs: money coming IN to this address
      for (const output of tx.outputs) {
        if (output.address === addressStr) {
          value += BigInt(output.value)
        }
      }
      entries.push({ txid: txidRes.unwrap(), address, value, timestamp, confirmed, blockHeight: tx.blockHeight })
    }
  }
  return Ok(entries)
}
