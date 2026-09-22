import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient, type ElectrumClientConfig } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
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
}

export const createAppContext = asyncFn(async (logger: Logger): Promise<Result<AppContext, Error>> => {
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
  const electrumProtocol = storedProtocol === 'tcp' || storedProtocol === 'ssl' ? storedProtocol : env.ELECTRUM_PROTOCOL
  const torEnabled = getSetting('tor_enabled') === 'true'

  // If Tor is enabled and SOCKS proxy env vars are set, include proxy config
  const proxy =
    torEnabled && env.SOCKS_PROXY_HOST ? { host: env.SOCKS_PROXY_HOST, port: Number(env.SOCKS_PROXY_PORT) } : undefined

  const electrumClient = new ElectrumClient({
    host: electrumHost,
    port: electrumPort,
    protocol: electrumProtocol,
    requestTimeout: 10_000,
    proxy,
  })

  logger.info(
    { host: electrumHost, port: electrumPort, protocol: electrumProtocol, tor: torEnabled },
    'Connecting to Electrum server',
  )
  const connectResult = await electrumClient.connect()
  if (connectResult.isErr()) {
    return Err(connectResult.unwrapErr())
  }
  logger.info({ version: connectResult.unwrap() }, 'Connected to Electrum server')

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

  const priceService = new PriceService({ logger })
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
    reconnectElectrum: async (config: ElectrumClientConfig): Promise<Result<void, Error>> => {
      logger.info(
        { host: config.host, port: config.port, protocol: config.protocol },
        'Reconnecting to Electrum server',
      )
      ctx.electrumClient.disconnect()
      const newClient = new ElectrumClient({ requestTimeout: 10_000, ...config })
      const result = await newClient.connect()
      if (result.isErr()) {
        logger.error({ error: result.unwrapErr().message }, 'Failed to reconnect to Electrum server')
        return Err(result.unwrapErr())
      }
      ctx.electrumClient = newClient
      ctx.electrumConfig = { host: config.host, port: config.port, protocol: config.protocol }
      ctx.onchainProvider = new ElectrumProvider(network, {
        logger: logger.child({ module: 'electrum-provider' }),
        electrum: newClient,
      })
      logger.info({ version: result.unwrap() }, 'Reconnected to Electrum server')
      return Ok(undefined)
    },
  }

  return Ok(ctx)
})
