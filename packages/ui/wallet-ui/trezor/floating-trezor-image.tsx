import { WalletFloatingImage, type WalletImage } from '../wallet-animation'
import type { TrezorModel } from './trezor-utils'

export function FloatingTrezorImage({ modelName }: { modelName: TrezorModel }): JSX.Element {
  const trezorImage = getTrezorImageByModelName(modelName)
  return <WalletFloatingImage {...trezorImage} />
}

export function getTrezorImageByModelName(modelName: TrezorModel): WalletImage {
  switch (modelName) {
    case 'T':
      return {
        href: '/images/hardware-wallets/web-res/trezor-model-t.png',
        alt: 'Trezor Model T',
      }
    case 'Safe 3 (Bitcoin-only)':
      return {
        href: '/images/hardware-wallets/web-res/trezor-safe-3-bitcoin-only.avif',
        alt: 'Trezor Safe 3 (Bitcoin-only)',
      }
    case 'Safe 3':
      return {
        href: '/images/hardware-wallets/web-res/trezor-safe-3.png',
        alt: 'Trezor Safe 3',
      }
    case 'Safe 5':
      return {
        href: '/images/hardware-wallets/web-res/trezor-safe-5.png',
        alt: 'Trezor Safe 5',
      }
    case 'One':
    default:
      return {
        href: '/images/hardware-wallets/web-res/trezor-one.png',
        alt: 'Trezor 1',
      }
  }
}
