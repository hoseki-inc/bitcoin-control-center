import type { Decimal } from 'decimal.js'
import { useBitcoinDisplay } from '../hooks/use-bitcoin-display'
import { formatBitcoin } from '../lib/bitcoin-display'

export function BitcoinAmount({ btc }: { btc: Decimal.Value }): JSX.Element {
  const { unit } = useBitcoinDisplay()
  return <>{formatBitcoin(btc, unit)}</>
}
