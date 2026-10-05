import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { isConfirmed } from '@hoseki/packages/bitcoin/onchain/types'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
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

/** A stalled lookup fails like any other instead of leaving the statement pending. */
const REQUEST_TIMEOUT_MS = 15_000

/** Waits before each retry of a rate-limited or temporarily unavailable lookup. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

/** Upper bound on a server's Retry-After, so one response can't stall a statement for long. */
const MAX_RETRY_AFTER_MS = 30_000

/** Responses that mean "try again shortly" rather than "this transaction is unavailable". */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

type Sleep = (ms: number) => Promise<void>

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Seconds from a Retry-After header, in milliseconds; HTTP-date values fall back to the default wait. */
function getRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null
  }
  return Math.min(Number(header.trim()) * 1000, MAX_RETRY_AFTER_MS)
}

/** Look up one transaction, retrying rate limits, temporary server errors and network failures. */
async function fetchMempoolTx(url: string, txid: string, sleep: Sleep, attempt = 0): Promise<Result<MempoolTx, Error>> {
  const retryDelay = RETRY_DELAYS_MS[attempt]

  const retryAfterNetworkFailure = async (cause: unknown): Promise<Result<MempoolTx, Error>> => {
    if (retryDelay === undefined) {
      return Err(new Error(`Failed to fetch transaction ${txid}`, { cause }))
    }
    await sleep(retryDelay)
    return fetchMempoolTx(url, txid, sleep, attempt + 1)
  }

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (cause) {
    return retryAfterNetworkFailure(cause)
  }

  if (!response.ok) {
    // Release the connection; the error body is not used.
    await response.body?.cancel()
    if (retryDelay === undefined || !RETRYABLE_STATUSES.has(response.status)) {
      return Err(new Error(`Failed to fetch transaction ${txid}: HTTP ${response.status}`))
    }
    await sleep(Math.max(retryDelay, getRetryAfterMs(response) ?? 0))
    return fetchMempoolTx(url, txid, sleep, attempt + 1)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    // Malformed JSON is final; a body cut off by the timeout or a dropped connection is retried.
    if (cause instanceof SyntaxError) {
      return Err(new Error(`Invalid transaction data returned from mempool.space for ${txid}`, { cause }))
    }
    return retryAfterNetworkFailure(cause)
  }
  return parseUnknown(MempoolTxSchema, body).mapErr(
    () => new Error(`Invalid transaction data returned from mempool.space for ${txid}`),
  )
}

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
    /** Waits between lookup retries; tests replace it to avoid real delays. */
    sleep?: Sleep
  }): Promise<Result<TransactionEntry[], Error>> => {
    const { account, onchainProvider, mempoolApiUrl, logger, sleep = defaultSleep } = deps
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
      // A statement missing an address's transactions would look complete, so any failure stops it.
      const scripthashRes = addressToScripthash(address)
      if (scripthashRes.isErr()) {
        return Err(scripthashRes.unwrapErr())
      }

      const historyRes = await onchainProvider.deps.electrum.getHistory(scripthashRes.unwrap())
      if (historyRes.isErr()) {
        return Err(new Error(`Could not fetch transaction history: ${historyRes.unwrapErr().message}`))
      }

      for (const entry of historyRes.unwrap()) {
        // Electrum reports unconfirmed transactions at height 0 or -1. Statements end at least two days
        // ago and pending transactions are dated when fetched, so they can't fall inside a statement.
        // Skipping them means a transaction the mempool server hasn't seen can't fail the statement.
        if (entry.height <= 0) {
          continue
        }
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
        batch.map(async (txid) => fetchMempoolTx(`${baseUrl}/api/tx/${txid}`, txid, sleep)),
      )

      for (const [j, result] of results.entries()) {
        // Even a transaction unknown to mempool.space must not silently disappear from a statement.
        if (result.status === 'rejected') {
          return Err(new Error(`Failed to fetch transaction ${batch[j]}`, { cause: result.reason }))
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
  const timestamp =
    tx.status.block_time !== undefined && tx.status.block_time !== 0 && !Number.isNaN(tx.status.block_time)
      ? new Date(tx.status.block_time * 1000)
      : new Date()

  return {
    txid,
    address,
    value,
    timestamp,
    confirmed,
    blockHeight,
  }
}
