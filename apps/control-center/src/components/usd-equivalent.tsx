import Decimal from 'decimal.js'
import { isUsableBtcPrice } from '../lib/bitcoin-display'

export function UsdEquivalent({ btc, btcPrice }: { btc: Decimal.Value; btcPrice: number | null }): JSX.Element {
  if (!isUsableBtcPrice(btcPrice)) {
    return <>USD unavailable</>
  }

  const value = new Decimal(btc).times(btcPrice).toNumber()
  return <>{value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} USD</>
}
