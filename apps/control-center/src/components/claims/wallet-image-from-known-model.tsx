import {
  ColdcardModels,
  FloatingBitkeyImage,
  FloatingKeystoneImage,
  WalletFloatingImage,
  type WalletImage,
  getLedgerImageByModelName,
  getTrezorImageByModelName,
  isColdcardModel,
  isLedgerModel,
  isTrezorModel,
} from '@hoseki/packages/ui/wallet-ui'

export function WalletImageFromKnownModel({
  wallet,
  model,
}: {
  wallet: string | null
  model: string
}): JSX.Element | null {
  switch (wallet) {
    case 'keystone':
      return <FloatingKeystoneImage />
    case 'bitkey':
      return <FloatingBitkeyImage />
    case null:
    default: {
      const image = getWalletImage(wallet, model)
      return image && <WalletFloatingImage {...image} />
    }
  }
}

/** The photo of a known signing device, or null for one Control Center has no picture of. */
export function getWalletImage(wallet: string | null, model: string): WalletImage | null {
  switch (wallet) {
    case 'coldcard': {
      const { imageSrc, imageAlt } = ColdcardModels[isColdcardModel(model) ? model : 'MK4']
      return { href: imageSrc, alt: imageAlt }
    }
    case 'ledger':
      return getLedgerImageByModelName(isLedgerModel(model) ? model : 'Nano S Plus')
    case 'trezor':
      return getTrezorImageByModelName(isTrezorModel(model) ? model : 'One')
    case 'keystone':
      // Cropped to the device, unlike the PNG, which pads it on every side.
      return { href: '/images/hardware-wallets/keystone-device.svg', alt: 'Keystone' }
    case 'bitkey':
      return { href: '/images/hardware-wallets/bitkey-device.png', alt: 'Bitkey' }
    case null:
    default:
      return null
  }
}

const walletNames = new Map([
  ['bitkey', 'Bitkey'],
  ['coldcard', 'Coldcard'],
  ['keystone', 'Keystone'],
  ['ledger', 'Ledger'],
  ['trezor', 'Trezor'],
])

/** The device's brand, as titles name it ("Ledger Verified!"), or null for an unknown one. */
export function getWalletName(wallet: string | null): string | null {
  return wallet === null ? null : (walletNames.get(wallet) ?? null)
}
