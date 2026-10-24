import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient, type ElectrumClientConfig } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import type { Logger } from 'pino'
import { type SentinelDb, openDrizzleDatabase } from './db/drizzle'
import { settings } from './db/schema'
import { type Env, loadEnv } from './env'
import { initEncryption, loadCredentialEncryptionKey } from './lib/encrypted'
import { applyPlatformRequests } from './modules/auth/platform'
import { AuthService, type PinPlatform } from './modules/auth/service'
import {
  type ConnectionDetails,
  ConnectionProfileStore,
  type ProfileReference,
} from './modules/connection_profiles/store'
import { ControlCenterService } from './modules/control_center/service'
import { EtfService } from './modules/etf/service'
import { ExchangeService } from './modules/exchange/service'
import { ManualService } from './modules/manual/service'
import { DailyRatesService } from './modules/price/daily_rates'
import { PriceHistoryService } from './modules/price/history'
import { PriceService, readPriceSettings } from './modules/price/service'
import { StatementService } from './modules/statements/service'
import { ReleaseCheckService } from './modules/updates/service'

/**
 * Application context: singleton holding all shared services.
 * Created once on startup. Requests are checked against `auth` by the tRPC procedures.
 */
export interface AppContext {
  env: Env
  logger: Logger
  database: SentinelDb
  auth: AuthService
  electrumClient: ElectrumClient
  electrumConfig: { host: string; port: number; protocol: 'tcp' | 'ssl' }
  onchainProvider: ElectrumProvider
  exchangeService: ExchangeService
  manualService: ManualService
  etfService: EtfService
  controlCenterService: ControlCenterService
  priceService: PriceService
  priceHistoryService: PriceHistoryService
  statementService: StatementService
  releaseCheckService: ReleaseCheckService
  network: Network
  reconnectElectrum: (config: ElectrumClientConfig) => Promise<Result<void, Error>>
  /** Saved desktop connections; undefined unless the launcher enables them. */
  connectionProfiles: ConnectionProfileStore | undefined
  /** Connect to a saved profile, optionally with edited details, and make it the active connection. */
  connectProfile: (reference: ProfileReference, connection?: ConnectionDetails) => Promise<Result<void, Error>>
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
// Each request crosses several relays (six to an onion service), so allow more than a direct connection.
const TOR_REQUEST_TIMEOUT_MS = 30_000

export interface AppContextOptions {
  /** Overrides SENTINEL_PIN; the desktop app passes `desktop`. PINs are off unless a platform turns them on. */
  pin?: PinPlatform
  /** Enabled only by desktop launchers, including the desktop development preview. */
  connectionProfiles?: boolean
  /** Overrides SENTINEL_WAIT_FOR_ELECTRUM. Desktop must keep settings available even when its saved server is offline. */
  waitForElectrum?: boolean
  /** Enabled only by desktop launchers: Settings can choose Electrum for statement lookups. */
  statementSourceSetting?: boolean
  /** The running desktop release, such as `0.6.0:0`. Desktop release builds pass it to check for newer releases. */
  releaseVersion?: string
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

    const database = await openDrizzleDatabase(env.DATA_DIR, logger)

    // Keep the exchange credential key outside SQLite so DB backups do not carry
    // both encrypted credentials and the key needed to decrypt them.
    const credentialKey = await loadCredentialEncryptionKey({ dataDir: env.DATA_DIR, db: database, logger })
    initEncryption(credentialKey.key)

    const auth = new AuthService(database, logger, options.pin ?? env.SENTINEL_PIN ?? null)
    await applyPlatformRequests(env.DATA_DIR, auth, logger)

    const network = env.BITCOIN_NETWORK === 'mainnet' ? Network.Mainnet : Network.Testnet

    // Check SQLite for user-saved Electrum settings (from desktop Settings page).
    // These override the env var defaults so the config persists across restarts.
    const getSetting = async (key: string): Promise<string | undefined> => {
      const [row] = await database.select({ value: settings.value }).from(settings).where(eq(settings.key, key))
      return row?.value
    }

    const storedProtocol = await getSetting('electrum_protocol')
    let saved: ConnectionDetails = {
      host: (await getSetting('electrum_host')) ?? env.ELECTRUM_HOST,
      port: Number((await getSetting('electrum_port')) ?? env.ELECTRUM_PORT),
      protocol: storedProtocol === 'tcp' || storedProtocol === 'ssl' ? storedProtocol : env.ELECTRUM_PROTOCOL,
      torEnabled: (await getSetting('tor_enabled')) === 'true',
    }
    // Desktop starts with its active saved connection. The first launch saves the
    // current connection as that profile, keeping its server and Tor setting.
    const connectionProfiles = options.connectionProfiles === true ? new ConnectionProfileStore(database) : undefined
    if (connectionProfiles) {
      const initialized = await connectionProfiles.initialize(saved)
      const active = initialized.unwrapOr(undefined)
      if (active) {
        saved = active
      } else {
        // Never refuse to start over saved connections: use the last saved server,
        // and connecting to a saved connection sets a new active one.
        logger.error(
          { reason: initialized.isErr() ? initialized.unwrapErr().message : 'The active saved connection is missing' },
          'Saved connections are unavailable; using the last saved server',
        )
      }
    }
    const { host: electrumHost, port: electrumPort, protocol: electrumProtocol, torEnabled } = saved
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
      const requestTimeout = Math.max(config.requestTimeout ?? 0, TOR_REQUEST_TIMEOUT_MS)
      if (tor) {
        // Desktop manages Tor: wait for it, then use the port it chose.
        return Ok({
          ...config,
          proxy: undefined,
          resolveProxy: () => tor.getSocksProxy(),
          connectTimeout,
          requestTimeout,
          beforeConnect: async (): Promise<Result<void, Error>> => {
            const status = await tor.start()
            return status.state === 'ready' ? Ok(undefined) : Err(new Error(status.message ?? 'Tor is unavailable'))
          },
        })
      }
      if (env.SOCKS_PROXY_HOST == null || env.SOCKS_PROXY_HOST === '' || env.SOCKS_PROXY_PORT === undefined) {
        return Err(new Error('Tor is not available in this installation'))
      }
      return Ok({
        ...config,
        proxy: { host: env.SOCKS_PROXY_HOST, port: env.SOCKS_PROXY_PORT },
        connectTimeout,
        requestTimeout,
      })
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
      db: database,
      logger,
    })

    const manualService = new ManualService({
      db: database,
      logger,
    })

    const etfService = new EtfService({
      db: database,
      logger,
    })

    const priceService = new PriceService({
      logger,
      mempoolApiUrl: env.MEMPOOL_API_URL,
      settings: async () => readPriceSettings(getSetting),
    })
    const dailyRatesService = new DailyRatesService({
      db: database,
      logger,
      mempoolApiUrl: env.MEMPOOL_API_URL,
      allowPublicFallback: async () => (await readPriceSettings(getSetting)).fallbacks,
    })
    const priceHistoryService = new PriceHistoryService({ dailyRatesService, priceService })

    const controlCenterService = new ControlCenterService({
      db: database,
      logger,
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      priceService,
    })

    const statementService = new StatementService({
      db: database,
      onchainProvider,
      dailyRatesService,
      exchangeService,
      mempoolApiUrl: env.MEMPOOL_API_URL,
      logger,
      sourceSelectable: options.statementSourceSetting === true,
    })
    const releaseCheckService = new ReleaseCheckService({ logger, installedVersion: options.releaseVersion })

    const interrupted = await statementService.failInterrupted()
    if (interrupted > 0) {
      logger.warn({ count: interrupted }, 'Marked interrupted statements as failed')
    }

    let pendingClient: ElectrumClient | null = null
    let stopped = false
    const isStopped = (): boolean => stopped

    // No runtime state changes until the new connection is saved. A failed connection
    // or save leaves the previous client and saved settings intact.
    const replaceConnection = async (
      config: ElectrumClientConfig,
      save: () => Promise<Result<void, Error>>,
    ): Promise<Result<void, Error>> => {
      if (isStopped()) {
        return Err(new Error('The application is shutting down'))
      }
      if (pendingClient) {
        return Err(new Error('An Electrum connection change is already in progress'))
      }

      // Never log the server: a home node's address or onion address identifies the user.
      logger.info(
        { protocol: config.protocol, tor: config.proxy !== undefined || config.resolveProxy !== undefined },
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
        const persisted = await save()
        if (persisted.isErr()) {
          return Err(persisted.unwrapErr())
        }
        if (isStopped()) {
          return Err(new Error('The application is shutting down'))
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
    }

    const ctx: AppContext = {
      env,
      logger,
      database,
      auth,
      electrumClient,
      electrumConfig: { host: electrumHost, port: electrumPort, protocol: electrumProtocol },
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      controlCenterService,
      priceService,
      priceHistoryService,
      statementService,
      releaseCheckService,
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
      connectionProfiles,
      connectProfile: async (reference, connection): Promise<Result<void, Error>> => {
        if (!connectionProfiles) {
          return Err(new Error('Saved connections are only available in the desktop app'))
        }
        const profile = await connectionProfiles.get(reference)
        if (profile.isErr()) {
          return Err(profile.unwrapErr())
        }
        const details = connection ?? profile.unwrap()
        const config = prepareElectrumConfig(details, details.torEnabled)
        if (config.isErr()) {
          return Err(config.unwrapErr())
        }
        // Activation checks the revision again, so a profile edited or deleted
        // during the handshake is never activated or recreated.
        return replaceConnection(config.unwrap(), async () =>
          connectionProfiles.activate(reference, details, isStopped),
        )
      },
      reconnectElectrum: async (config: ElectrumClientConfig): Promise<Result<void, Error>> => {
        if (connectionProfiles) {
          return Err(new Error('Choose a saved connection to connect in the desktop app'))
        }
        return replaceConnection(config, async () => {
          try {
            await database.transaction(async (tx) => {
              for (const [key, value] of [
                ['electrum_host', config.host],
                ['electrum_port', String(config.port)],
                ['electrum_protocol', config.protocol],
                ['tor_enabled', String(config.proxy !== undefined || config.resolveProxy !== undefined)],
              ] as const) {
                await tx
                  .insert(settings)
                  .values({ key, value })
                  .onConflictDoUpdate({ target: settings.key, set: { value } })
              }
              if (isStopped()) {
                throw new Error('The application is shutting down')
              }
            })
            return Ok(undefined)
          } catch {
            return Err(new Error('Could not save Electrum settings; the previous connection has been kept'))
          }
        })
      },
      stopElectrum: (): void => {
        stopped = true
        pendingClient?.disconnect()
        ctx.electrumClient.disconnect()
      },
    }

    const connection = electrumClient.connect()
    const waitForElectrum = options.waitForElectrum ?? env.SENTINEL_WAIT_FOR_ELECTRUM
    if (!waitForElectrum) {
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
        database.$client.close()
        return Err(result.unwrapErr())
      }
    }

    return Ok(ctx)
  },
)
