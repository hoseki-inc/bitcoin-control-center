import type { Features } from '@trezor/connect-web'
import type { HardwareWallet } from '../types'

export type SelectedTrezorAccount = {
  trezorFeatures?: Features
  wallet: HardwareWallet
}
