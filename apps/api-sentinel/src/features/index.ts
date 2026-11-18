import { etfRouter } from './etf'
import { manualRouter } from './manual'
import { onchainRouter } from './onchain'
import { portfolioRouter } from './portfolio'
import { priceRouter } from './price'
import { settingsRouter } from './settings'
import { statementsRouter } from './statements'

/** Every feature's tRPC router, mounted under `portalProve` by name. Add a line here for each new feature. */
export const featureRouters = {
  etf: etfRouter,
  manual: manualRouter,
  onchain: onchainRouter,
  portfolio: portfolioRouter,
  price: priceRouter,
  settings: settingsRouter,
  statements: statementsRouter,
}
