import type { Result } from '@hoseki/packages/result'

/** An output a transaction pays. Scripts without an address, such as OP_RETURN, have a null address. */
export interface TxOutput {
  address: string | null
  value: number
}

export interface TxInput {
  /** The output this input spends; null for coinbase inputs or when the source doesn't say. */
  spends: { txid: string; vout: number } | null
  /** The spent output when the source supplies it. Otherwise it's read from the wallet's own transactions. */
  prevout: TxOutput | null
}

/** A transaction's details as a source reported them. */
export interface LookedUpTx {
  txid: string
  blockHeight: number | null
  /** Block time in seconds. */
  blockTime: number | null
  inputs: TxInput[]
  outputs: TxOutput[]
}

/** Where transaction details come from. Recorded on statements for auditing. */
export type TxSourceKind = 'electrum' | 'node_mempool' | 'public_mempool'

type TransactionLoadErrorKind = 'history' | 'unavailable' | 'invalid' | 'unreachable'

/**
 * A statement couldn't load all of its transactions. The message can name a txid or a server,
 * so it is never logged or shown; log the kind and show a fixed message instead.
 */
export class TransactionLoadError extends Error {
  public override readonly name = 'TransactionLoadError'
  public readonly kind: TransactionLoadErrorKind

  public constructor(kind: TransactionLoadErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.kind = kind
  }
}

/**
 * How a failed attempt is retried:
 * - `temporary`: this lookup tries again a few times.
 * - `connection`: the connection every lookup shares dropped, so every lookup waits before its
 *   next request while it comes back.
 * - `rateLimit`: the server asked for fewer requests. Every lookup waits, and this one keeps
 *   backing off for longer.
 */
export type RetryKind = 'temporary' | 'connection' | 'rateLimit'

/** Why one lookup attempt failed. A null `retry` means trying again won't help. */
export interface LookupFailure {
  error: TransactionLoadError
  retry: null | {
    kind: RetryKind
    retryAfterMs: number | null
  }
}

export interface TxSource {
  readonly kind: TxSourceKind
  /** Most lookups in flight at once for one statement. */
  readonly concurrency: number
  /** Waits before each retry of a temporary or connection failure; the pool's defaults otherwise. */
  readonly retryDelaysMs?: readonly number[]
  /**
   * One attempt; the caller owns retries. `height` is where Electrum's history placed the
   * transaction. `signal` aborts when another lookup has failed, so the request can stop early.
   */
  lookup(txid: string, height: number, signal: AbortSignal): Promise<Result<LookedUpTx, LookupFailure>>
}
