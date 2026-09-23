import {
  ColdcardModels,
  FloatingKeystoneImage,
  WalletFloatingImage,
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
    case 'coldcard': {
      const coldcardModel = ColdcardModels[isColdcardModel(model) ? model : 'MK4']
      const { imageSrc, imageAlt } = coldcardModel
      return <WalletFloatingImage href={imageSrc} alt={imageAlt} />
    }
    case 'ledger': {
      return <WalletFloatingImage {...getLedgerImageByModelName(isLedgerModel(model) ? model : 'Nano S Plus')} />
    }
    case 'trezor':
      return <WalletFloatingImage {...getTrezorImageByModelName(isTrezorModel(model) ? model : 'One')} />
    case 'keystone':
      return <FloatingKeystoneImage />
    case null:
    default:
      return null
  }
}
