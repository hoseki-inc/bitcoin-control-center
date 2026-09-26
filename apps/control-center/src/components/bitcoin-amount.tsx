import type { Decimal } from 'decimal.js'
import { formatBitcoin } from '../lib/bitcoin-display'

export function BitcoinAmount({ btc }: { btc: Decimal.Value }): JSX.Element {
  return <>{formatBitcoin(btc)}</>
}
