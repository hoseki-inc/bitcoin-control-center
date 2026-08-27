import type { SupportedHardwareWallet } from './hardware-wallet'

export class HardwareDeviceError extends Error {
  public readonly wallet: SupportedHardwareWallet
  public readonly friendlyMessage: string
  public readonly details?: unknown

  constructor(message: string, wallet: SupportedHardwareWallet, friendlyMessage: string, details?: unknown) {
    super(message)

    this.name = 'HardwareDeviceError'
    this.wallet = wallet
    this.friendlyMessage = friendlyMessage
    this.details = details
  }
}
