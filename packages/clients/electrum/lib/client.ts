import { parseUnknown } from '@hoseki/packages/result'
import { AsyncResult, Err, Ok, type Result, tryBlockAsync } from '@hoseki/packages/result'
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
  // Whether the last attempt to reach the server worked. Servers close idle sockets
  // and the next request reconnects, so a closed socket alone isn't a failure.
  private reachable = false
  // Set once any attempt has finished, so later background retries don't read as a first connection.
  private settled = false
  private lastCheck = 0
  private checkInFlight = false
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
    if (this.connectInFlight) {
      return this.connectInFlight
    }
    const generation = this.generation
    const inner = tryBlockAsync(
      async function* (this: ElectrumClient) {
        if (this.beforeConnect) {
          yield* (await this.beforeConnect()).try()
        }
        if (generation !== this.generation) {
          return Err(new Error('Connection closed'))
        }
        yield* this.transport.connect().try()
        const version = yield* this.serverVersion().try()
        this.negotiated = true
        return Ok(version)
      }.bind(this),
    )
    const recorded = inner.then<Result<ServerVersion, Error>, never>((result) => {
      // A later connect or disconnect owns the status once the generation changes.
      if (generation === this.generation) {
        this.reachable = result.isOk()
        this.settled = true
      }
      return result
    })
    const tracked = new AsyncResult(
      Promise.resolve(recorded).finally(() => {
        this.connectInFlight = null
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
    this.reachable = false
    this.lastCheck = 0
  }

  /** Whether a socket is open now. Idle sockets close, so this isn't server health. */
  public isConnected(): boolean {
    return this.transport.isConnected() && this.negotiated
  }

  /**
   * Whether the first connection attempt is still running, such as after launch.
   * Background retries during an outage don't count, so the outage still shows.
   */
  public isConnecting(): boolean {
    return this.connectInFlight !== null && !this.settled
  }

  /** Whether the server answered the last connection attempt, open socket or not. */
  public isReachable(): boolean {
    return this.reachable
  }

  /**
   * Ping the server in the background unless a check ran recently, so a status
   * display notices an outage without holding a socket open when nobody is looking.
   */
  public checkReachable(minIntervalMs: number): void {
    if (this.checkInFlight || Date.now() - this.lastCheck < minIntervalMs) {
      return
    }
    const generation = this.generation
    this.checkInFlight = true
    // The protocol answers null, but any answer shows the server is there.
    void this.call('server.ping', [], z.unknown()).then((result) => {
      this.checkInFlight = false
      // Timed from the end, so a slow attempt (such as Tor starting) isn't followed straight away by another.
      this.lastCheck = Date.now()
      // A disconnect since the ping started owns the status now.
      if (generation === this.generation) {
        this.reachable = result.isOk()
      }
    })
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
    return tryBlockAsync(
      async function* (this: ElectrumClient) {
        // Reconnect if the underlying socket is down. connect() dedupes concurrent
        // reconnects via connectInFlight. Checking transport state (rather than
        // isConnected(), which also requires negotiated=true) lets the recursive
        // serverVersion() call from inside connect() proceed without deadlocking.
        if (!this.transport.isConnected()) {
          yield* this.connect().try()
        }
        const raw = yield* this.transport.request(method, params).try()
        const parsed = yield* parseUnknown(schema, raw)
          .mapErr((err) => new Error(`Failed to parse response for ${method}: ${err.message}`, { cause: err }))
          .try()
        return Ok(parsed)
      }.bind(this),
    )
  }
}
