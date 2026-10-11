import { isLocalOrPrivateHost } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { type LookedUpTx, type LookupFailure, TransactionLoadError, type TxSource, type TxSourceKind } from './types'

/**
 * A mempool instance's /api/tx/{txid} response shape (subset we care about).
 */
const MempoolTxSchema = z.object({
  txid: z.string(),
  vin: z.array(
    z.object({
      txid: z.string().optional(),
      vout: z.number().int().optional(),
      is_coinbase: z.boolean().optional(),
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

/** Max concurrent API calls to the mempool instance for tx lookups */
const TX_CONCURRENCY = 10

/** A stalled lookup fails like any other instead of leaving the statement pending. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Responses that mean "try again shortly" rather than "this transaction is unavailable". mempool
 * also answers 500 when its backend briefly fails, such as a busy node.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/**
 * The node's own mempool only when it's on this machine or a private network. Any other host,
 * mempool.space or not, counts as public, so the record never understates who saw the txids.
 */
function mempoolSourceKind(apiUrl: string): TxSourceKind {
  return URL.canParse(apiUrl) && isLocalOrPrivateHost(new URL(apiUrl).hostname) ? 'node_mempool' : 'public_mempool'
}

/**
 * Seconds from a Retry-After header, in milliseconds; HTTP-date values fall back to the default wait.
 * The lookup pool limits how long any server can hold lookups back.
 */
function getRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (header === null || !/^\d+$/.test(header.trim())) {
    return null
  }
  return Number(header.trim()) * 1000
}

function invalid(txid: string, cause?: unknown): LookupFailure {
  return {
    error: new TransactionLoadError(
      'invalid',
      `Invalid transaction data returned from the mempool server for ${txid}`,
      {
        cause,
      },
    ),
    retry: null,
  }
}

function networkFailure(txid: string, cause: unknown): LookupFailure {
  return {
    error: new TransactionLoadError('unreachable', `Failed to fetch transaction ${txid}`, { cause }),
    retry: { rateLimited: false, retryAfterMs: null },
  }
}

function toLookedUpTx(tx: MempoolTx): LookedUpTx {
  return {
    txid: tx.txid,
    blockHeight: tx.status.block_height ?? null,
    blockTime: tx.status.block_time ?? null,
    inputs: tx.vin.map((input) => ({
      spends:
        input.is_coinbase !== true && input.txid !== undefined && input.vout !== undefined
          ? { txid: input.txid, vout: input.vout }
          : null,
      prevout:
        input.prevout === null
          ? null
          : { address: input.prevout.scriptpubkey_address ?? null, value: input.prevout.value },
    })),
    outputs: tx.vout.map((output) => ({ address: output.scriptpubkey_address ?? null, value: output.value })),
  }
}

/**
 * Transaction details from a mempool instance's REST API, used instead of Electrum's
 * slow and unreliable `blockchain.transaction.get(verbose=true)` on Electrs servers.
 */
export class MempoolSource implements TxSource {
  public readonly kind: TxSourceKind
  public readonly concurrency = TX_CONCURRENCY
  private readonly baseUrl: string

  public constructor(apiUrl: string) {
    this.kind = mempoolSourceKind(apiUrl)
    this.baseUrl = apiUrl.replace(/\/$/, '')
  }

  public async lookup(txid: string, _height: number, signal: AbortSignal): Promise<Result<LookedUpTx, LookupFailure>> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/tx/${txid}`, {
        signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]),
      })
    } catch (cause) {
      return Err(networkFailure(txid, cause))
    }

    if (!response.ok) {
      // Release the connection; the error body is not used.
      // A connection that already dropped can't be cancelled; that changes nothing here.
      await response.body?.cancel().catch(() => undefined)
      const message = `Failed to fetch transaction ${txid}: HTTP ${response.status}`
      if (!RETRYABLE_STATUSES.has(response.status)) {
        return Err({ error: new TransactionLoadError('unavailable', message), retry: null })
      }
      // Any Retry-After asks every lookup to wait, even one in a form that isn't read.
      return Err({
        error: new TransactionLoadError('unreachable', message),
        retry: {
          rateLimited: response.status === 429 || response.headers.has('retry-after'),
          retryAfterMs: getRetryAfterMs(response),
        },
      })
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      // Malformed JSON is final; a body cut off by the timeout or a dropped connection is retried.
      return Err(cause instanceof SyntaxError ? invalid(txid, cause) : networkFailure(txid, cause))
    }
    const parsed = parseUnknown(MempoolTxSchema, body)
    // A response for another transaction would silently drop this one from the statement.
    if (parsed.isErr() || parsed.unwrap().txid !== txid) {
      return Err(invalid(txid))
    }
    return Ok(toLookedUpTx(parsed.unwrap()))
  }
}
