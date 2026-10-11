import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
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

/** An account's confirmed transactions by txid, in the order Electrum listed them. */
export type AccountHistory = Map<string, HistoryTransaction>

/** Find an account's used addresses and their confirmed transactions through Electrum. */
export const collectAccountHistory = asyncFn(
  async (
    account: Account,
    onchainProvider: ElectrumProvider,
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

    const history: AccountHistory = new Map()
    for (const address of addresses) {
      // A statement missing an address's transactions would look complete, so any failure stops it.
      const scripthashRes = addressToScripthash(address)
      if (scripthashRes.isErr()) {
        const cause = scripthashRes.unwrapErr()
        return Err(new TransactionLoadError('history', cause.message, { cause }))
      }

      const historyRes = await onchainProvider.deps.electrum.getHistory(scripthashRes.unwrap())
      if (historyRes.isErr()) {
        const cause = historyRes.unwrapErr()
        return Err(
          new TransactionLoadError('history', `Could not fetch transaction history: ${cause.message}`, { cause }),
        )
      }

      for (const entry of historyRes.unwrap()) {
        // Electrum reports unconfirmed transactions at height 0 or -1. Statements end at least two days
        // ago and pending transactions are dated when fetched, so they can't fall inside a statement.
        // Skipping them means a transaction the server hasn't seen can't fail the statement.
        if (entry.height <= 0) {
          continue
        }
        const known = history.get(entry.tx_hash)
        if (known === undefined) {
          history.set(entry.tx_hash, { height: entry.height, addresses: [address] })
        } else if (!known.addresses.includes(address)) {
          known.addresses.push(address)
        }
      }
    }

    return Ok(history)
  },
)
