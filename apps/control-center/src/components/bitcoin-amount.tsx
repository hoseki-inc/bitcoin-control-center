import type { Decimal } from 'decimal.js'
import { useBitcoinDisplay } from '../hooks/use-bitcoin-display'
import { formatBitcoin } from '../lib/bitcoin-display'
import { SensitiveValue } from './sensitive-value'

export function BitcoinAmount({ btc }: { btc: Decimal.Value }): JSX.Element {
  const { unit } = useBitcoinDisplay()
  return <SensitiveValue>{formatBitcoin(btc, unit)}</SensitiveValue>
}
