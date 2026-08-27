import type { AccountInfo, Features } from '@trezor/connect-web'
import type { HardwareWallet } from '../types'

export type SelectedTrezorAccount = {
  trezorFeatures: Features
  trezorAccountInfo: AccountInfo
  wallet: HardwareWallet
}
