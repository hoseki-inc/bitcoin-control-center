import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { isConfirmed } from '@hoseki/packages/bitcoin/onchain/types'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import type { Logger } from 'pino'
import { z } from 'zod'

/**
 * mempool.space /api/tx/{txid} response shape (subset we care about).
 */
const MempoolTxSchema = z.object({
  txid: z.string(),
  vin: z.array(
    z.object({
      prevout: z.object({ scriptpubkey_address: z.string().optional(), value: z.number().int() }).nullable(),
    }),
  ),
  vout: z.array(z.object({ scriptpubkey_address: z.string().optional(), value: z.number().int() })),
  status: z.object({
    confirmed: z.boolean(),
    block_height: z.number().optional(),
    block_time: z.number().optional(),
  }),
})
type MempoolTx = z.infer<typeof MempoolTxSchema>

/** Max concurrent API calls to mempool.space for tx lookups */
const TX_CONCURRENCY = 10

/**
 * Fetch transaction entries for an account using mempool.space instead of
 * Electrum's verbose transaction endpoint.
 *
 * Uses Electrum for lightweight operations (discovery + history) and
 * mempool.space for transaction details. This avoids the slow/unreliable
 * `blockchain.transaction.get(verbose=true)` on Electrs servers.
 */
export const fetchTransactionEntries = asyncFn(
  async (deps: {
    account: Account
    onchainProvider: ElectrumProvider
    mempoolApiUrl: string
    logger: Logger
  }): Promise<Result<TransactionEntry[], Error>> => {
    const { account, onchainProvider, mempoolApiUrl, logger } = deps
    const network = onchainProvider.network

    // 1. Discover account (find used address indices via Electrum history checks)
    const discoveryResult = await onchainProvider.discoverAccount(account)
    if (discoveryResult.isErr()) {
      return Err(discoveryResult.unwrapErr())
    }
    const { lastUsedReceiveIndex, lastUsedChangeIndex } = discoveryResult.unwrap()

    // 2. Generate all used addresses
    const addresses: Address[] = [
      ...account.receiveAddresses(0, lastUsedReceiveIndex + 1, network),
      ...account.changeAddresses(0, lastUsedChangeIndex + 1, network),
    ]

    if (addresses.length === 0) {
      return Ok([])
    }

    // 3. Get transaction history for all addresses via Electrum (lightweight)
    const txHashToAddresses = new Map<string, Set<Address>>()

    for (const address of addresses) {
      const scripthashRes = addressToScripthash(address)
      if (scripthashRes.isErr()) {
        logger.warn({ address, err: scripthashRes.unwrapErr() }, 'Failed to compute scripthash, skipping')
        continue
      }

      const historyRes = await onchainProvider.deps.electrum.getHistory(scripthashRes.unwrap())
      if (historyRes.isErr()) {
        logger.warn({ address, err: historyRes.unwrapErr() }, 'Failed to fetch history, skipping address')
        continue
      }

      for (const entry of historyRes.unwrap()) {
        const addrSet = txHashToAddresses.get(entry.tx_hash) ?? new Set()
        addrSet.add(address)
        txHashToAddresses.set(entry.tx_hash, addrSet)
      }
    }

    const uniqueTxIds = Array.from(txHashToAddresses.keys())
    logger.info(
      { addressCount: addresses.length, uniqueTxCount: uniqueTxIds.length },
      'Fetching tx details from mempool.space',
    )

    // 4. Get current tip for confirmation status
    const tipRes = await onchainProvider.getBlocksTip()
    if (tipRes.isErr()) {
      return Err(tipRes.unwrapErr())
    }
    const tip = tipRes.unwrap()

    // 5. Fetch transaction details from mempool.space in batches
    const allEntries: TransactionEntry[] = []
    const baseUrl = mempoolApiUrl.replace(/\/$/, '')

    for (let i = 0; i < uniqueTxIds.length; i += TX_CONCURRENCY) {
      const batch = uniqueTxIds.slice(i, i + TX_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (txid) => {
          const response = await fetch(`${baseUrl}/api/tx/${txid}`)
          if (!response.ok) {
            return null
          }
          return parseUnknown(MempoolTxSchema, await response.json()).mapErr(
            () => new Error(`Invalid transaction data returned from mempool.space for ${txid}`),
          )
        }),
      )

      for (const [j, result] of results.entries()) {
        if (result.status !== 'fulfilled' || !result.value) {
          const txid = batch[j]
          logger.warn({ txid }, 'Failed to fetch tx from mempool.space, skipping')
          continue
        }

        if (result.value.isErr()) {
          return Err(result.value.unwrapErr())
        }
        const mempoolTx = result.value.unwrap()
        const relatedAddresses = txHashToAddresses.get(mempoolTx.txid) ?? new Set()

        // Parse into TransactionEntry for each related address
        for (const address of relatedAddresses) {
          const entry = parseMempoolTxEntry(mempoolTx, address, tip.height)
          if (entry) {
            allEntries.push(entry)
          }
        }
      }
    }

    logger.info({ entries: allEntries.length }, 'Transaction entries fetched via mempool.space')
    return Ok(allEntries)
  },
)

/**
 * Parse a mempool.space transaction into a TransactionEntry for a specific address.
 */
function parseMempoolTxEntry(tx: MempoolTx, address: Address, tipHeight: number): TransactionEntry | null {
  const txidRes = Txid.fromString(tx.txid)
  if (txidRes.isErr()) {
    return null
  }
  const txid = txidRes.unwrap()
  const addressStr = address.toString()

  let value = 0n

  // Process inputs — money going OUT from this address
  for (const vin of tx.vin) {
    if (vin.prevout?.scriptpubkey_address === addressStr) {
      value -= BigInt(vin.prevout.value)
    }
  }

  // Process outputs — money coming IN to this address
  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address === addressStr) {
      value += BigInt(vout.value)
    }
  }

  const blockHeight = tx.status.block_height ?? null
  const confirmed = blockHeight !== null && isConfirmed({ tip: tipHeight, height: blockHeight })
  const timestamp = tx.status.block_time ? new Date(tx.status.block_time * 1000) : new Date()

  return {
    txid,
    address,
    value,
    timestamp,
    confirmed,
    blockHeight,
  }
}
