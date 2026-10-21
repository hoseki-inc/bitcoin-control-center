import { parseUnknown } from '@hoseki/packages/result'
import { AsyncResult, Err, Ok, type Result, tryBlockAsync } from '@hoseki/packages/result'
// Re-import z for the raw string overload
import { z } from 'zod'
import { type ElectrumConnectionConfig, ElectrumServerError, ElectrumTimeoutError, ElectrumTransport } from './protocol'
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
  /** Runs before each request is sent, such as a development-only latency simulation. An error fails the request. */
  beforeRequest?: (method: string) => Promise<Result<void, Error>>
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
  // A monotonic clock, so moving the system clock back can't stop the checks.
  private lastCheck = Number.NEGATIVE_INFINITY
  private checkInFlight = false
  private connectInFlight: AsyncResult<ServerVersion, Error> | null = null
  private generation = 0
  private readonly beforeConnect: ElectrumClientConfig['beforeConnect']
  private readonly beforeRequest: ElectrumClientConfig['beforeRequest']

  public constructor(config: ElectrumClientConfig) {
    this.transport = new ElectrumTransport(config)
    this.beforeConnect = config.beforeConnect
    this.beforeRequest = config.beforeRequest
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
        const handshake = await this.serverVersion()
        if (handshake.isErr()) {
          // The server refused the handshake or never answered it. Close the half-open connection,
          // and report a failed connection rather than a server answer, so a status check never
          // counts a refused handshake as the server being reachable.
          this.dropConnection()
          return Err(new Error(`Electrum handshake failed: ${handshake.unwrapErr().message}`))
        }
        this.negotiated = true
        return Ok(handshake.unwrap())
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
    this.lastCheck = Number.NEGATIVE_INFINITY
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
    if (this.checkInFlight || performance.now() - this.lastCheck < minIntervalMs) {
      return
    }
    const generation = this.generation
    this.checkInFlight = true
    void this.ping(generation)
      // An unexpected failure counts as unreachable, and never stops later checks.
      .catch(() => false)
      .then((reachable) => {
        this.checkInFlight = false
        // Timed from the end, so a slow attempt (such as Tor starting) isn't followed straight away by another.
        this.lastCheck = performance.now()
        // A disconnect since the ping started owns the status now.
        if (generation === this.generation) {
          this.reachable = reachable
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

  /**
   * Any answer, even an error, shows the server is there, and so does a ping that timed out while
   * other answers kept arriving on its connection (a busy server). A connection that was already
   * open may have gone silent (after sleep or a network change), so a failure on it gets one retry
   * on a fresh connection; call() has already dropped the silent one.
   */
  private async ping(generation: number): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      const result = await this.call('server.ping', [], z.unknown())
      if (result.isOk()) {
        return true
      }
      const error = result.unwrapErr()
      return error instanceof ElectrumServerError || (error instanceof ElectrumTimeoutError && !error.silent)
    }
    const wasOpen = this.transport.isConnected()
    if (await attempt()) {
      return true
    }
    // Retry only when the first attempt dropped a connection that had gone silent.
    if (!wasOpen || this.transport.isConnected() || generation !== this.generation) {
      return false
    }
    return attempt()
  }

  /** Drops the transport so the next request opens a fresh connection. */
  private dropConnection(): void {
    this.transport.disconnect()
    this.negotiated = false
  }

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
        if (this.beforeRequest) {
          yield* (await this.beforeRequest(method)).try()
        }
        const connection = this.transport.connectionNumber
        const requested = await this.transport.request(method, params)
        if (requested.isErr()) {
          const error = requested.unwrapErr()
          // Drop a connection only when it has gone silent (often after sleep or a network change,
          // when it never closes by itself), so the next request reconnects:
          // - a timeout counts only if nothing at all arrived since this request was sent; a busy
          //   server that is still answering other requests keeps its connection and their requests;
          // - a socket or write error counts straight away;
          // - a server's error answer, or a connection that already closed, leaves things alone, so
          //   a late failure can't cancel a fresh connection another request has started opening.
          const silent = error instanceof ElectrumTimeoutError ? error.silent : !(error instanceof ElectrumServerError)
          if (silent && this.transport.isConnected() && this.transport.connectionNumber === connection) {
            this.dropConnection()
          }
          return Err(error)
        }
        const raw = requested.unwrap()
        const parsed = yield* parseUnknown(schema, raw)
          .mapErr((err) => new Error(`Failed to parse response for ${method}: ${err.message}`, { cause: err }))
          .try()
        return Ok(parsed)
      }.bind(this),
    )
  }
}
