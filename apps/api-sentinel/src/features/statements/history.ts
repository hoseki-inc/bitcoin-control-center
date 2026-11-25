import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import { type ElectrumProvider, mapWithLimit } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { TransactionLoadError } from './sources/types'

interface HistoryTransaction {
  /** The block height Electrum reported. */
  height: number
  /** The account's addresses whose history includes the transaction, in discovery order. */
  addresses: Address[]
}

const TXID_PATTERN = /^[0-9a-f]{64}$/i
const HISTORY_CONCURRENCY = 10

/** An account's confirmed transactions by txid, in the order Electrum listed them. */
export type AccountHistory = Map<string, HistoryTransaction>

/** Find an account's used addresses and their confirmed transactions through Electrum. */
export const collectAccountHistory = asyncFn(
  async (
    account: Account,
    onchainProvider: ElectrumProvider,
    /** How much of this account is done, 0–1: half for finding its addresses, half for their history. */
    onProgress?: (fraction: number) => void,
  ): Promise<Result<AccountHistory, TransactionLoadError>> => {
    const network = onchainProvider.network

    const discoveryResult = await onchainProvider.discoverAccount(account)
    if (discoveryResult.isErr()) {
      const cause = discoveryResult.unwrapErr()
      return Err(new TransactionLoadError('history', cause.message, { cause }))
    }
    const { lastUsedReceiveIndex, lastUsedChangeIndex } = discoveryResult.unwrap()

    const addresses: Address[] = [
      ...account.receiveAddresses(0, lastUsedReceiveIndex + 1, network),
      ...account.changeAddresses(0, lastUsedChangeIndex + 1, network),
    ]

    onProgress?.(0.5)

    const addressEntries: Array<{ address: Address; scripthash: string }> = []
    for (const address of addresses) {
      // A statement missing an address's transactions would look complete, so any failure stops it.
      const scripthashRes = addressToScripthash(address)
      if (scripthashRes.isErr()) {
        const cause = scripthashRes.unwrapErr()
        return Err(new TransactionLoadError('history', cause.message, { cause }))
      }
      addressEntries.push({ address, scripthash: scripthashRes.unwrap() })
    }

    let done = 0
    const fetchedResult = await mapWithLimit(addressEntries, HISTORY_CONCURRENCY, async ({ scripthash }) => {
      const historyRes = await onchainProvider.deps.electrum.getHistory(scripthash)
      if (historyRes.isErr()) {
        const cause = historyRes.unwrapErr()
        return Err(
          new TransactionLoadError('history', `Could not fetch transaction history: ${cause.message}`, { cause }),
        )
      }
      done += 1
      onProgress?.(0.5 + (0.5 * done) / addressEntries.length)
      return Ok(historyRes.unwrap())
    })
    if (fetchedResult.isErr()) {
      return Err(fetchedResult.unwrapErr())
    }

    // Fold results in original discovery order so concurrent completion never scrambles history order.
    const history: AccountHistory = new Map()
    const fetchedHistories = fetchedResult.unwrap()
    for (const [index, { address }] of addressEntries.entries()) {
      for (const entry of fetchedHistories[index] ?? []) {
        // A txid goes into lookup URLs, so anything but 64 hex digits from the server stops the statement.
        if (!TXID_PATTERN.test(entry.tx_hash)) {
          return Err(new TransactionLoadError('history', 'Electrum returned an invalid txid'))
        }
        const txid = entry.tx_hash.toLowerCase()
        // Electrum reports unconfirmed transactions at height 0 or -1. Statements end at least two days
        // ago and pending transactions are dated when fetched, so they can't fall inside a statement.
        // Skipping them means a transaction the server hasn't seen can't fail the statement.
        if (entry.height <= 0) {
          continue
        }
        const known = history.get(txid)
        if (known === undefined) {
          history.set(txid, { height: entry.height, addresses: [address] })
        } else if (!known.addresses.includes(address)) {
          known.addresses.push(address)
        }
      }
    }

    return Ok(history)
  },
)
