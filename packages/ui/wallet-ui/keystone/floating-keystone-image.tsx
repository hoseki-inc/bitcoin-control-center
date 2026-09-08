import { WalletFloatingImage } from '../wallet-animation'

export function FloatingKeystoneImage(): JSX.Element {
  return (
    <WalletFloatingImage
      href="/images/hardware-wallets/keystone-device.png"
      alt="Keystone"
      sx={{ '& img': { height: '300px' } }}
    />
  )
}
