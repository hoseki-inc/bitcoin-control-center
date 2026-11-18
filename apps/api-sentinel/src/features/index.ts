import { etfRouter } from './etf'
import { priceRouter } from './price'

/** Every feature's tRPC router, mounted under `portalProve` by name. Add a line here for each new feature. */
export const featureRouters = {
  etf: etfRouter,
  price: priceRouter,
}
