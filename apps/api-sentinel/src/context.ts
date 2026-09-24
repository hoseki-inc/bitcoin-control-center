import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import type { Logger } from 'pino'
import { type SentinelDatabase, initDatabase } from './db'
import { type Env, loadEnv } from './env'
import { initEncryption, loadCredentialEncryptionKey } from './lib/encrypted'
import { ControlCenterService } from './modules/control_center/service'
import { ElectrumConnection, loadElectrumServer } from './modules/electrum/connection'
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
  electrum: ElectrumConnection
  onchainProvider: ElectrumProvider
  exchangeService: ExchangeService
  manualService: ManualService
  etfService: EtfService
  controlCenterService: ControlCenterService
  priceService: PriceService
  statementService: StatementService
  network: Network
}

export const createAppContext = asyncFn(async (logger: Logger): Promise<Result<AppContext, Error>> => {
  const env = loadEnv()

  const database = initDatabase(env.DATA_DIR, logger)

  // Keep the exchange credential key outside SQLite so DB backups do not carry
  // both encrypted credentials and the key needed to decrypt them.
  const credentialKey = loadCredentialEncryptionKey({ dataDir: env.DATA_DIR, db: database.db, logger })
  initEncryption(credentialKey.key)

  const network = env.BITCOIN_NETWORK === 'mainnet' ? Network.Mainnet : Network.Testnet

  // The server saved in Settings overrides the platform default. Sentinel starts even
  // when it cannot be reached, so the app always opens and the server can be changed.
  const electrum = new ElectrumConnection({
    logger: logger.child({ module: 'electrum' }),
    server: loadElectrumServer(database.db, {
      host: env.ELECTRUM_HOST,
      port: env.ELECTRUM_PORT,
      protocol: env.ELECTRUM_PROTOCOL,
    }),
    ...(env.SOCKS_PROXY_HOST !== undefined && env.SOCKS_PROXY_PORT !== undefined
      ? { socksProxy: { host: env.SOCKS_PROXY_HOST, port: env.SOCKS_PROXY_PORT } }
      : {}),
    // Services hold this provider, so it follows the connection to a new server.
    onClientChange: (client) => {
      onchainProvider.deps.electrum = client
    },
  })

  const onchainProvider = new ElectrumProvider(network, {
    logger: logger.child({ module: 'electrum-provider' }),
    electrum: electrum.client,
  })
  electrum.start()

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
    electrum,
    onchainProvider,
    exchangeService,
    manualService,
    etfService,
    controlCenterService,
    priceService,
    statementService,
    network,
  }

  return Ok(ctx)
})
