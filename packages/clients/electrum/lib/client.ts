import { parseUnknown } from '@hoseki/packages/result'
import { AsyncResult, Err, Ok, type Result, tryBlockAsync } from '@patina/core'
// Re-import z for the raw string overload
import { z } from 'zod'
import { type ElectrumConnectionConfig, ElectrumTransport } from './protocol'
import {
  BlockHeaderHexSchema,
  type ElectrumVerboseTransaction,
  ElectrumVerboseTransactionSchema,
  type HeaderNotification,
  HeaderNotificationSchema,
  type ScripthashBalance,
  ScripthashBalanceSchema,
  type ScripthashHistory,
  ScripthashHistorySchema,
  type ScripthashUnspent,
  ScripthashUnspentSchema,
  type ServerVersion,
  ServerVersionSchema,
} from './schemas'

export interface ElectrumClientConfig extends ElectrumConnectionConfig {
  /** Wait for a managed proxy before opening any socket, including reconnects. */
  beforeConnect?: () => Promise<Result<void, Error>>
  /** Client name sent during version negotiation. Defaults to 'hoseki'. */
  clientName?: string
  /** Protocol version to negotiate. Defaults to '1.4'. */
  protocolVersion?: string
}

/**
 * Typed Electrum protocol client.
 *
 * Provides high-level methods for interacting with an Electrs/Fulcrum server
 * via the Electrum protocol (JSON-RPC over TCP/SSL).
 */
export class ElectrumClient {
  private readonly transport: ElectrumTransport
  private readonly clientName: string
  private readonly protocolVersion: string
  private negotiated = false
  private connectInFlight: AsyncResult<ServerVersion, Error> | null = null
  private generation = 0
  private readonly beforeConnect: ElectrumClientConfig['beforeConnect']

  public constructor(config: ElectrumClientConfig) {
    this.transport = new ElectrumTransport(config)
    this.beforeConnect = config.beforeConnect
    this.clientName = config.clientName ?? 'hoseki'
    this.protocolVersion = config.protocolVersion ?? '1.4'
  }

  // ─── Connection ──────────────────────────────────────────────────────────

  /**
   * Connect to the Electrum server and negotiate protocol version.
   *
   * Concurrent callers share a single in-flight connect — without this, a batch
   * of parallel requests after a dropped connection would each kick off (or skip)
   * a reconnect and most would fail with "Not connected".
   */
  public connect(): AsyncResult<ServerVersion, Error> {
    if (this.connectInFlight) return this.connectInFlight
    const self = this
    const generation = this.generation
    const inner = tryBlockAsync(async function* () {
      if (self.beforeConnect) yield* (await self.beforeConnect()).try()
      if (generation !== self.generation) return Err(new Error('Connection closed'))
      yield* self.transport.connect().try()
      const version = yield* self.serverVersion().try()
      self.negotiated = true
      return Ok(version)
    })
    const tracked = new AsyncResult(
      inner.finally(() => {
        self.connectInFlight = null
      }),
    )
    this.connectInFlight = tracked
    return tracked
  }

  /**
   * Disconnect from the Electrum server.
   */
  public disconnect(): void {
    this.generation += 1
    this.transport.disconnect()
    this.negotiated = false
  }

  public isConnected(): boolean {
    return this.transport.isConnected() && this.negotiated
  }

  // ─── Server Methods ──────────────────────────────────────────────────────

  /**
   * Negotiate protocol version with the server.
   */
  public serverVersion(): AsyncResult<ServerVersion, Error> {
    return this.call('server.version', [this.clientName, this.protocolVersion], ServerVersionSchema)
  }

  // ─── Blockchain Methods ──────────────────────────────────────────────────

  /**
   * Subscribe to block header notifications.
   * Returns the current tip on first call.
   */
  public headersSubscribe(): AsyncResult<HeaderNotification, Error> {
    return this.call('blockchain.headers.subscribe', [], HeaderNotificationSchema)
  }

  /**
   * Get a block header by height.
   */
  public getBlockHeader(height: number): AsyncResult<string, Error> {
    return this.call('blockchain.block.header', [height], BlockHeaderHexSchema)
  }

  /**
   * Get the confirmed and unconfirmed balance for a scripthash.
   * Balance values are in satoshis.
   */
  public getBalance(scripthash: string): AsyncResult<ScripthashBalance, Error> {
    return this.call('blockchain.scripthash.get_balance', [scripthash], ScripthashBalanceSchema)
  }

  /**
   * Get the transaction history for a scripthash.
   * Returns an array of {tx_hash, height} entries.
   * Height 0 or -1 indicates unconfirmed transactions.
   */
  public getHistory(scripthash: string): AsyncResult<ScripthashHistory, Error> {
    return this.call('blockchain.scripthash.get_history', [scripthash], ScripthashHistorySchema)
  }

  /**
   * Get unspent transaction outputs for a scripthash.
   */
  public listUnspent(scripthash: string): AsyncResult<ScripthashUnspent, Error> {
    return this.call('blockchain.scripthash.listunspent', [scripthash], ScripthashUnspentSchema)
  }

  /**
   * Get a raw or verbose transaction by txid.
   *
   * @param txHash - The transaction hash
   * @param verbose - If true, returns a decoded transaction object. If false, returns raw hex.
   */
  public getTransaction(txHash: string, verbose: true): AsyncResult<ElectrumVerboseTransaction, Error>
  public getTransaction(txHash: string, verbose?: false): AsyncResult<string, Error>
  public getTransaction(txHash: string, verbose = false): AsyncResult<ElectrumVerboseTransaction | string, Error> {
    if (verbose) {
      return this.call('blockchain.transaction.get', [txHash, true], ElectrumVerboseTransactionSchema)
    }
    return this.call('blockchain.transaction.get', [txHash, false], z.string())
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private call<T>(method: string, params: unknown[], schema: z.ZodType<T>): AsyncResult<T, Error> {
    const self = this
    return tryBlockAsync(async function* () {
      // Reconnect if the underlying socket is down. connect() dedupes concurrent
      // reconnects via connectInFlight. Checking transport state (rather than
      // isConnected(), which also requires negotiated=true) lets the recursive
      // serverVersion() call from inside connect() proceed without deadlocking.
      if (!self.transport.isConnected()) {
        yield* self.connect().try()
      }
      const raw = yield* self.transport.request(method, params).try()
      const parsed = yield* parseUnknown(schema, raw)
        .mapErr((err) => new Error(`Failed to parse response for ${method}: ${err.message}`, { cause: err }))
        .try()
      return Ok(parsed)
    })
  }
}
