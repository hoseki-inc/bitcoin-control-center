import * as net from 'node:net'
import * as tls from 'node:tls'
import { parseUnknown } from '@hoseki/packages/result'
import { AsyncResult, Err, Ok, type Result } from '@hoseki/packages/result'
import { SocksClient } from 'socks'
import { type JsonRpcResponse, JsonRpcResponseSchema } from './schemas'

const MAX_ELECTRUM_RESPONSE_BYTES = 16 * 1024 * 1024

export interface SocksProxyConfig {
  host: string
  port: number
  type?: 4 | 5
}

export interface ElectrumTlsConfig {
  /**
   * Override TLS certificate verification.
   *
   * Defaults to verifying public SSL hosts and allowing self-signed certs only
   * for local/private hosts, where self-hosted Electrum servers are common.
   */
  rejectUnauthorized?: boolean
  /** Optional SNI/certificate hostname override. Defaults to host for public DNS names. */
  servername?: string
}

export interface ElectrumConnectionConfig {
  host: string
  port: number
  protocol: 'tcp' | 'ssl'
  /** Connection timeout in ms. Defaults to 10000. */
  connectTimeout?: number
  /** Request timeout in ms. Defaults to 30000. */
  requestTimeout?: number
  /** Optional SOCKS proxy for Tor connections. */
  proxy?: SocksProxyConfig
  /**
   * Resolve the SOCKS proxy when connecting, for a proxy that picks its port when
   * it starts. Takes precedence over `proxy`; null means the proxy is not ready.
   */
  resolveProxy?: () => SocksProxyConfig | null
  /** Optional TLS behavior for SSL Electrum connections. */
  tls?: ElectrumTlsConfig
}

export function shouldVerifyElectrumTlsCertificate(host: string, override?: boolean): boolean {
  if (override !== undefined) {
    return override
  }
  return !isLocalOrPrivateHost(host)
}

function isLocalOrPrivateHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
  if (normalized.length === 0) {
    return false
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'host.docker.internal' ||
    normalized.endsWith('.docker.internal') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home.arpa') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.embassy')
  ) {
    return true
  }

  if (!normalized.includes('.') && !normalized.includes(':')) {
    return true
  }

  if (net.isIP(normalized) === 4) {
    return isPrivateIpv4(normalized)
  }
  if (net.isIP(normalized) === 6) {
    return isPrivateIpv6(normalized)
  }

  return false
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map((part) => Number(part))
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }

  const a = octets[0] ?? -1
  const b = octets[1] ?? -1
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6(host: string): boolean {
  return (
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe8') ||
    host.startsWith('fe9') ||
    host.startsWith('fea') ||
    host.startsWith('feb')
  )
}

interface PendingRequest {
  resolve: (result: Result<unknown, Error>) => void
  timer: ReturnType<typeof setTimeout>
}

/** An error the server answered with, which still shows the server is reachable. */
export class ElectrumServerError extends Error {
  public override readonly name = 'ElectrumServerError'
}

/** A request the server didn't answer in time. */
export class ElectrumTimeoutError extends Error {
  public override readonly name = 'ElectrumTimeoutError'
  /**
   * Whether nothing at all arrived on the connection while waiting, so it has gone silent;
   * otherwise the server is busy but still answering other requests.
   */
  public readonly silent: boolean

  public constructor(message: string, silent: boolean) {
    super(message)
    this.silent = silent
  }
}

/**
 * Low-level Electrum JSON-RPC transport over TCP or SSL.
 *
 * Handles connection management, request/response correlation via JSON-RPC IDs,
 * and newline-delimited JSON framing.
 */
export class ElectrumTransport {
  private readonly config: Required<Omit<ElectrumConnectionConfig, 'proxy' | 'resolveProxy' | 'tls'>> & {
    proxy?: SocksProxyConfig
    resolveProxy?: () => SocksProxyConfig | null
    tls?: ElectrumTlsConfig
  }
  private socket: net.Socket | tls.TLSSocket | null = null
  private buffer = ''
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private connected = false
  // Counts connections, so a failure on an old connection never drops a newer one.
  private connectionCount = 0
  // Counts incoming data, so a timeout can tell a silent connection from a busy one.
  private receivedCount = 0
  private cancelConnect: (() => void) | null = null

  public constructor(config: ElectrumConnectionConfig) {
    this.config = {
      connectTimeout: 10_000,
      requestTimeout: 30_000,
      ...config,
    }
  }

  public isConnected(): boolean {
    return this.connected
  }

  /** Identifies the current connection; it changes every time a new one opens. */
  public get connectionNumber(): number {
    return this.connectionCount
  }

  public connect(): AsyncResult<void, Error> {
    if (this.connected && this.socket) {
      return new AsyncResult(Promise.resolve(Ok(undefined)))
    }

    return new AsyncResult(
      new Promise<Result<void, Error>>((resolve) => {
        let settled = false
        const finish = (result: Result<void, Error>): void => {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          this.cancelConnect = null
          resolve(result)
        }
        const timer = setTimeout(() => {
          finish(Err(new Error(`Connection timeout after ${this.config.connectTimeout}ms`)))
          this.cleanup()
        }, this.config.connectTimeout)
        this.cancelConnect = () => {
          finish(Err(new Error('Connection closed')))
        }

        const setupSocket = (socket: net.Socket | tls.TLSSocket): void => {
          socket.setEncoding('utf8')
          socket.on('data', (data: string) => {
            this.onData(data)
          })
          socket.on('error', (err: Error) => {
            this.onError(err)
            if (!this.connected) {
              finish(Err(err))
              this.cleanup()
            }
          })
          socket.on('close', () => {
            this.onClose()
          })
          this.socket = socket
        }

        const onConnected = (): void => {
          if (settled) {
            return
          }
          this.connected = true
          this.connectionCount += 1
          finish(Ok(undefined))
        }

        try {
          const proxy = this.config.resolveProxy ? this.config.resolveProxy() : this.config.proxy
          if (this.config.resolveProxy && !proxy) {
            // Never fall back to a direct connection when a proxy was requested.
            finish(Err(new Error('The Tor proxy is not ready')))
            return
          }
          if (proxy) {
            // Connect through SOCKS proxy (for Tor)
            this.connectViaProxy(proxy)
              .then((proxySocket) => {
                // A SOCKS handshake can finish after cancellation or timeout.
                // Never attach its late socket to a disconnected client.
                if (settled) {
                  proxySocket.destroy()
                  return
                }
                if (this.config.protocol === 'ssl') {
                  // Upgrade the proxied TCP socket to TLS
                  const tlsSocket = tls.connect(
                    {
                      socket: proxySocket,
                      ...this.getTlsOptions(),
                    },
                    onConnected,
                  )
                  setupSocket(tlsSocket)
                } else {
                  setupSocket(proxySocket)
                  onConnected()
                }
              })
              .catch((cause: unknown) => {
                finish(Err(cause instanceof Error ? cause : new Error(String(cause))))
              })
          } else {
            // Direct connection (no proxy)
            const socket =
              this.config.protocol === 'ssl'
                ? tls.connect(
                    {
                      host: this.config.host,
                      port: this.config.port,
                      ...this.getTlsOptions(),
                    },
                    onConnected,
                  )
                : net.connect(
                    {
                      host: this.config.host,
                      port: this.config.port,
                    },
                    onConnected,
                  )

            setupSocket(socket)
          }
        } catch (err) {
          finish(Err(err instanceof Error ? err : new Error(String(err))))
        }
      }),
    )
  }

  private getTlsOptions(): Pick<tls.ConnectionOptions, 'rejectUnauthorized' | 'servername'> {
    const rejectUnauthorized = shouldVerifyElectrumTlsCertificate(this.config.host, this.config.tls?.rejectUnauthorized)
    const defaultServername = rejectUnauthorized && net.isIP(this.config.host) === 0 ? this.config.host : undefined

    return {
      rejectUnauthorized,
      servername: this.config.tls?.servername ?? defaultServername,
    }
  }

  public disconnect(): Result<void, Error> {
    this.cleanup()
    return Ok(undefined)
  }

  /**
   * Send a JSON-RPC request and wait for the corresponding response.
   */
  public request(method: string, params: unknown[] = []): AsyncResult<unknown, Error> {
    const socket = this.socket
    if (!this.connected || !socket) {
      return new AsyncResult(Promise.resolve(Err(new Error('Not connected'))))
    }

    const id = this.nextId++
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id,
    })

    const receivedAtSend = this.receivedCount
    return new AsyncResult(
      new Promise<Result<unknown, Error>>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          resolve(
            Err(
              new ElectrumTimeoutError(
                `Request timeout after ${this.config.requestTimeout}ms for ${method}`,
                this.receivedCount === receivedAtSend,
              ),
            ),
          )
        }, this.config.requestTimeout)

        this.pending.set(id, { resolve, timer })

        socket.write(payload + '\n', (err?: Error | null) => {
          if (err) {
            clearTimeout(timer)
            this.pending.delete(id)
            resolve(Err(err))
          }
        })
      }),
    )
  }

  private async connectViaProxy(proxy: SocksProxyConfig): Promise<net.Socket> {
    const { socket } = await SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: proxy.type ?? 5,
      },
      command: 'connect',
      // The library's own 30-second default would otherwise cut the handshake
      // short; Tor needs longer to build a first circuit or reach an onion service.
      timeout: this.config.connectTimeout,
      destination: {
        host: this.config.host,
        port: this.config.port,
      },
    })
    return socket
  }

  private onData(data: string): void {
    this.receivedCount += 1
    this.buffer += data
    if (this.buffer.length > MAX_ELECTRUM_RESPONSE_BYTES) {
      const err = new Error(`Electrum response exceeded ${MAX_ELECTRUM_RESPONSE_BYTES} bytes`)
      this.onError(err)
      this.cleanup()
      return
    }

    // Electrum uses newline-delimited JSON
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (line.length === 0) {
        continue
      }

      const parseResult = (() => {
        try {
          const json: unknown = JSON.parse(line)
          return parseUnknown(JsonRpcResponseSchema, json)
        } catch {
          return Err(new Error(`Invalid JSON from server: ${line.slice(0, 200)}`))
        }
      })()

      if (parseResult.isErr()) {
        // Could be a subscription notification without an id - ignore for now
        continue
      }

      const response: JsonRpcResponse = parseResult.unwrap()
      if (response.id == null) {
        // Subscription notification - not correlated to a pending request
        continue
      }

      const pendingReq = this.pending.get(response.id)
      if (!pendingReq) {
        continue
      }

      clearTimeout(pendingReq.timer)
      this.pending.delete(response.id)

      if (response.error) {
        pendingReq.resolve(
          Err(new ElectrumServerError(`Electrum error [${response.error.code}]: ${response.error.message}`)),
        )
      } else {
        pendingReq.resolve(Ok(response.result))
      }
    }
  }

  private onError(err: Error): void {
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve(Err(err))
      this.pending.delete(id)
    }
  }

  private onClose(): void {
    this.cancelConnect?.()
    this.connected = false
    this.socket = null
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve(Err(new Error('Connection closed')))
      this.pending.delete(id)
    }
    this.pending.clear()
  }

  private cleanup(): void {
    this.cancelConnect?.()
    this.connected = false
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve(Err(new Error('Connection closed')))
    }
    this.pending.clear()
    this.buffer = ''
  }
}
