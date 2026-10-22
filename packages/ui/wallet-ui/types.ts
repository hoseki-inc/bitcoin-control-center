import type Decimal from 'decimal.js'
import type { DerivationPath, SingleSigAccount } from '../../bitcoin'

export type HardwareWallet = {
  accountIndex: number
  rawInput: string
  account: SingleSigAccount
  derivationPath: DerivationPath | null
  // Trezor Suite doesn't return a balance, so a Trezor account shows it as loading until it's fetched
  btcBalance: Decimal | 'loading' | 'unavailable'
  usdBalance: Decimal | null
  displayName: string
  label: string
}
