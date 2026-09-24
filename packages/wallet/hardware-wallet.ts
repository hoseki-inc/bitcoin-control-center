export const supportedHardwareWallets = ['ledger', 'trezor', 'coldcard', 'keystone'] as const

export type SupportedHardwareWallet = (typeof supportedHardwareWallets)[number]

export type SupportedHardwareWalletDisplayName = Capitalize<SupportedHardwareWallet>

export const isSupportedHardwareWallet = (wallet: unknown): wallet is SupportedHardwareWallet => {
  return supportedHardwareWallets.some((candidate) => candidate === wallet)
}
