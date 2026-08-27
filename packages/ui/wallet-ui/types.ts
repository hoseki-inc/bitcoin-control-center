import type Decimal from 'decimal.js'
import type { DerivationPath, SingleSigAccount } from '../../bitcoin'

export type HardwareWallet = {
  accountIndex: number
  rawInput: string
  account: SingleSigAccount
  derivationPath: DerivationPath | null
  btcBalance: Decimal
  usdBalance: Decimal | null
  displayName: string
  label: string
}
