import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { WalletFloatingImage } from '../wallet-animation'
import type { LedgerModel } from './ledger-utils'

export function FloatingLedgerImage({ modelName }: { modelName: LedgerModel }): JSX.Element {
  const ledgerImage = getLedgerImageByModelName(modelName)
  return <WalletFloatingImage {...ledgerImage} />
}

export function getLedgerImageByModelName(modelName: LedgerModel): { href: string; alt: string } {
  switch (modelName) {
    case 'Nano X':
      return {
        href: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/ledger-nano-x.png`,
        alt: 'Ledger Nano X',
      }
    case 'Flex':
      return {
        href: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/ledger-flex.png`,
        alt: 'Ledger Flex',
      }
    case 'Stax':
      return {
        href: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/ledger-stax.png`,
        alt: 'Ledger Stax',
      }
    case 'Nano S':
    case 'Nano S Plus':
    default:
      return {
        href: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/ledger-nano-s-plus.png`,
        alt: 'Ledger Nano S Plus',
      }
  }
}
