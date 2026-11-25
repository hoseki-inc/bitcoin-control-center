import type { SupportedHardwareWallet } from './hardware-wallet'

export function getSupportedHardwareWalletLogoPath(wallet: SupportedHardwareWallet | null): string {
  switch (wallet) {
    case 'ledger':
      return '/images/hardware-wallets/mini/ledger-mini.svg'
    case 'trezor':
      return '/images/hardware-wallets/mini/trezor-mini.svg'
    case 'coldcard':
      return '/images/hardware-wallets/mini/coldcard-mini.svg'
    case 'keystone':
      return '/images/hardware-wallets/keystone-logo-mini.svg'
    case 'bitkey':
      return '/images/hardware-wallets/bitkey-logo-mini.svg'
    case null:
      return '/images/bitcoin-medium.svg'
  }
}
