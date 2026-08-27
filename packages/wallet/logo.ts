import { HOSEKI_ASSETS_CDN_URL } from '../constants'
import type { SupportedHardwareWallet } from './hardware-wallet'

export function getSupportedHardwareWalletLogoPath(wallet: SupportedHardwareWallet | null): string {
  switch (wallet) {
    case 'ledger':
      return `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/mini/ledger-mini.svg`
    case 'trezor':
      return `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/mini/trezor-mini.svg`
    case 'coldcard':
      return `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/mini/coldcard-mini.svg`
    case 'keystone':
      return '/images/hardware-wallets/keystone-logo-mini.svg'
    case null:
      return `${HOSEKI_ASSETS_CDN_URL}/bitcoin-medium.svg`
  }
}
