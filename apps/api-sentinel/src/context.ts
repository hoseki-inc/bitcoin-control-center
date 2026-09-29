import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient, type ElectrumClientConfig } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { type SentinelDatabase, initDatabase } from './db'
import { type Env, loadEnv } from './env'
import { initEncryption, loadCredentialEncryptionKey } from './lib/encrypted'
import { ControlCenterService } from './modules/control_center/service'
import { EtfService } from './modules/etf/service'
import { ExchangeService } from './modules/exchange/service'
import { ManualService } from './modules/manual/service'
import { DailyRatesService } from './modules/price/daily_rates'
import { PriceService } from './modules/price/service'
import { StatementService } from './modules/statements/service'

/**
 * Application context: singleton holding all shared services.
 * Created once on startup. No auth, no per-request scoping - single user.
 */
export interface AppContext {
  env: Env
  logger: Logger
  database: SentinelDatabase
  electrumClient: ElectrumClient
  electrumConfig: { host: string; port: number; protocol: 'tcp' | 'ssl' }
  onchainProvider: ElectrumProvider
  exchangeService: ExchangeService
  manualService: ManualService
  etfService: EtfService
  controlCenterService: ControlCenterService
  priceService: PriceService
  statementService: StatementService
  network: Network
  reconnectElectrum: (config: ElectrumClientConfig) => Promise<Result<void, Error>>
  /** Stop Electrum for shutdown; the context does not reconnect afterwards. */
  stopElectrum: () => void
  prepareElectrumConfig: (config: ElectrumClientConfig, torEnabled: boolean) => Result<ElectrumClientConfig, Error>
  getTorStatus: () => TorStatus
  /** Start managed Tor without waiting for bootstrap, so settings can show its progress. */
  startTor: () => TorStatus
}

export interface TorStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed' | 'unavailable'
  message?: string
  /** Tor's bootstrap percentage while starting. It marks phases, not elapsed time. */
  progress?: number
  /** Counts start attempts, so settings can tell a new failure from an earlier one. */
  attempt?: number
}

// A fresh Tor process may need well over the direct-connection limit to build its
// first circuit, and longer still to reach an onion service.
const TOR_CONNECT_TIMEOUT_MS = 60_000

export interface AppContextOptions {
  /** Desktop must keep settings available even when its saved server is offline. */
  waitForElectrum?: boolean
  /** Distribution-owned Tor process; Sentinel owns connection policy. */
  tor?: {
    start: () => Promise<{ state: string; message?: string }>
    getStatus: () => {
      state: 'stopped' | 'starting' | 'ready' | 'failed'
      message?: string
      progress?: number
      attempt?: number
    }
    /** Tor picks its port when it starts, so resolve the proxy for each connection. */
    getSocksProxy: () => { host: string; port: number } | null
  }
}

export const createAppContext = asyncFn(
  async (logger: Logger, options: AppContextOptions = {}): Promise<Result<AppContext, Error>> => {
    const env = loadEnv()

    const database = initDatabase(env.DATA_DIR, logger)

    // Keep the exchange credential key outside SQLite so DB backups do not carry
    // both encrypted credentials and the key needed to decrypt them.
    const credentialKey = loadCredentialEncryptionKey({ dataDir: env.DATA_DIR, db: database.db, logger })
    initEncryption(credentialKey.key)

    const network = env.BITCOIN_NETWORK === 'mainnet' ? Network.Mainnet : Network.Testnet

    // Check SQLite for user-saved Electrum settings (from desktop Settings page).
    // These override the env var defaults so the config persists across restarts.
    const getSetting = (key: string): string | undefined =>
      database.db.prepare<unknown[], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)?.value

    const electrumHost = getSetting('electrum_host') ?? env.ELECTRUM_HOST
    const electrumPort = Number(getSetting('electrum_port') ?? env.ELECTRUM_PORT)
    const storedProtocol = getSetting('electrum_protocol')
    const electrumProtocol =
      storedProtocol === 'tcp' || storedProtocol === 'ssl' ? storedProtocol : env.ELECTRUM_PROTOCOL
    const torEnabled = getSetting('tor_enabled') === 'true'
    const tor = options.tor

    const prepareElectrumConfig = (
      config: ElectrumClientConfig,
      useTor: boolean,
    ): Result<ElectrumClientConfig, Error> => {
      if (!useTor) {
        if (config.host.toLowerCase().endsWith('.onion')) {
          return Err(new Error('Onion addresses require Tor'))
        }
        return Ok(config)
      }
      const connectTimeout = Math.max(config.connectTimeout ?? 0, TOR_CONNECT_TIMEOUT_MS)
      if (tor) {
        // Desktop manages Tor: wait for it, then use the port it chose.
        return Ok({
          ...config,
          proxy: undefined,
          resolveProxy: () => tor.getSocksProxy(),
          connectTimeout,
          beforeConnect: async (): Promise<Result<void, Error>> => {
            const status = await tor.start()
            return status.state === 'ready' ? Ok(undefined) : Err(new Error(status.message ?? 'Tor is unavailable'))
          },
        })
      }
      if (env.SOCKS_PROXY_HOST == null || env.SOCKS_PROXY_HOST === '' || env.SOCKS_PROXY_PORT === undefined) {
        return Err(new Error('Tor is not available in this installation'))
      }
      return Ok({ ...config, proxy: { host: env.SOCKS_PROXY_HOST, port: env.SOCKS_PROXY_PORT }, connectTimeout })
    }
    const initialConfig = {
      host: electrumHost,
      port: electrumPort,
      protocol: electrumProtocol,
      requestTimeout: 10_000,
    }
    const prepared = prepareElectrumConfig(initialConfig, torEnabled)
    // Keep a failed saved Tor configuration offline, including lazy reconnects.
    const electrumClient = new ElectrumClient(
      prepared.isOk()
        ? prepared.unwrap()
        : {
            ...initialConfig,
            beforeConnect: async () => Err(prepared.unwrapErr()),
          },
    )

    // All services retain this provider. Replace its client after a successful
    // connection change, rather than leaving constructor-injected providers stale.
    const onchainProvider = new ElectrumProvider(network, {
      logger: logger.child({ module: 'electrum-provider' }),
      electrum: electrumClient,
    })

    const exchangeService = new ExchangeService({
      db: database.db,
      logger,
    })

    const manualService = new ManualService({
      db: database.db,
      logger,
    })

    const etfService = new EtfService({
      db: database.db,
      logger,
    })

    const priceService = new PriceService({ logger, mempoolApiUrl: env.MEMPOOL_API_URL })
    const dailyRatesService = new DailyRatesService({ logger, mempoolApiUrl: env.MEMPOOL_API_URL })

    const controlCenterService = new ControlCenterService({
      db: database.db,
      logger,
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      priceService,
    })

    const statementService = new StatementService({
      db: database.db,
      onchainProvider,
      dailyRatesService,
      exchangeService,
      mempoolApiUrl: env.MEMPOOL_API_URL,
      logger,
    })

    let pendingClient: ElectrumClient | null = null
    let stopped = false
    const isStopped = (): boolean => stopped

    const ctx: AppContext = {
      env,
      logger,
      database,
      electrumClient,
      electrumConfig: { host: electrumHost, port: electrumPort, protocol: electrumProtocol },
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      controlCenterService,
      priceService,
      statementService,
      network,
      prepareElectrumConfig,
      getTorStatus: () => options.tor?.getStatus() ?? { state: 'unavailable' },
      startTor: (): TorStatus => {
        if (!tor || isStopped()) {
          return tor?.getStatus() ?? { state: 'unavailable' }
        }
        // Failures are reported through status, which settings polls.
        void tor.start().catch(() => undefined)
        return tor.getStatus()
      },
      reconnectElectrum: async (config: ElectrumClientConfig): Promise<Result<void, Error>> => {
        if (isStopped()) {
          return Err(new Error('The application is shutting down'))
        }
        if (pendingClient) {
          return Err(new Error('An Electrum connection change is already in progress'))
        }

        logger.info(
          { host: config.host, port: config.port, protocol: config.protocol },
          'Reconnecting to Electrum server',
        )
        const newClient = new ElectrumClient({ requestTimeout: 10_000, ...config })
        pendingClient = newClient
        try {
          const result = await newClient.connect()
          if (isStopped()) {
            return Err(new Error('The application is shutting down'))
          }
          if (result.isErr()) {
            return Err(result.unwrapErr())
          }

          // No runtime state changes until every setting has been saved. A failed
          // connection or transaction leaves the previous client and settings intact.
          try {
            database.db.transaction(() => {
              const save = database.db.prepare(
                'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
              )
              save.run('electrum_host', config.host)
              save.run('electrum_port', String(config.port))
              save.run('electrum_protocol', config.protocol)
              save.run('tor_enabled', String(config.proxy !== undefined || config.resolveProxy !== undefined))
            })()
          } catch {
            return Err(new Error('Could not save Electrum settings; the previous connection has been kept'))
          }

          const previousClient = ctx.electrumClient
          ctx.electrumClient = newClient
          ctx.electrumConfig = { host: config.host, port: config.port, protocol: config.protocol }
          onchainProvider.deps.electrum = newClient
          previousClient.disconnect()
          logger.info('Electrum connection and settings updated')
          return Ok(undefined)
        } finally {
          if (ctx.electrumClient !== newClient) {
            newClient.disconnect()
          }
          pendingClient = null
        }
      },
      stopElectrum: (): void => {
        stopped = true
        pendingClient?.disconnect()
        ctx.electrumClient.disconnect()
      },
    }

    const connection = electrumClient.connect()
    if (options.waitForElectrum === false) {
      void connection.then((result) => {
        if (!isStopped() && ctx.electrumClient === electrumClient && result.isErr()) {
          electrumClient.disconnect()
          logger.warn('Electrum is unavailable; local settings remain accessible and blockchain requests can retry')
        }
      })
    } else {
      const result = await connection
      if (result.isErr()) {
        ctx.stopElectrum()
        database.close()
        return Err(result.unwrapErr())
      }
    }

    return Ok(ctx)
  },
)
