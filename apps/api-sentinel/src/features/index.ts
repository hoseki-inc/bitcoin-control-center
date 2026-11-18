import { etfRouter } from './etf'
import { onchainRouter } from './onchain'
import { priceRouter } from './price'
import { settingsRouter } from './settings'

/** Every feature's tRPC router, mounted under `portalProve` by name. Add a line here for each new feature. */
export const featureRouters = {
  etf: etfRouter,
  onchain: onchainRouter,
  price: priceRouter,
  settings: settingsRouter,
}
