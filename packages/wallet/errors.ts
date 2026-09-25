import type { SupportedHardwareWallet } from './hardware-wallet'

export class HardwareDeviceError<Details = unknown> extends Error {
  public readonly wallet: SupportedHardwareWallet
  public readonly friendlyMessage: string
  public readonly details?: Details

  public constructor(message: string, wallet: SupportedHardwareWallet, friendlyMessage: string, details?: Details) {
    super(message)

    this.name = 'HardwareDeviceError'
    this.wallet = wallet
    this.friendlyMessage = friendlyMessage
    this.details = details
  }
}
