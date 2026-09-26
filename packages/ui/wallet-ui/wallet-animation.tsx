import { Box, type BoxProps, chakra, keyframes } from '@chakra-ui/react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import coldcardWhatYouNeed_M3 from './assets/lottie-animations/coldcard/M3/01.json'
import coldcardExportWallet_M3 from './assets/lottie-animations/coldcard/M3/02.json'
import coldcardMicroSdIntoLaptop_M3 from './assets/lottie-animations/coldcard/M3/03.json'
import coldcardSignMessage_M3 from './assets/lottie-animations/coldcard/M3/04.json'
import coldcardDownloadTextFile_M3 from './assets/lottie-animations/coldcard/M3/05.json'
import coldcardSignTextFile_M3 from './assets/lottie-animations/coldcard/M3/06.json'
import coldcardWhatYouNeed_M4 from './assets/lottie-animations/coldcard/M4/01.json'
import coldcardExportWallet_M4 from './assets/lottie-animations/coldcard/M4/02.json'
import coldcardMicroSdIntoLaptop_M4 from './assets/lottie-animations/coldcard/M4/03.json'
import coldcardSignMessage_M4 from './assets/lottie-animations/coldcard/M4/04.json'
import coldcardDownloadTextFile_M4 from './assets/lottie-animations/coldcard/M4/05.json'
import coldcardSignTextFile_M4 from './assets/lottie-animations/coldcard/M4/06.json'
import coldcardWhatYouNeed_Q from './assets/lottie-animations/coldcard/Q/01.json'
import coldcardExportWallet_Q from './assets/lottie-animations/coldcard/Q/02.json'
import coldcardMicroSdIntoLaptop_Q from './assets/lottie-animations/coldcard/Q/03.json'
import coldcardSignMessage_Q from './assets/lottie-animations/coldcard/Q/04.json'
import coldcardDownloadTextFile_Q from './assets/lottie-animations/coldcard/Q/05.json'
import coldcardSignTextFile_Q from './assets/lottie-animations/coldcard/Q/06.json'
import genericProveControl from './assets/lottie-animations/generic-prove-control.json'
import keystoneAnimation from './assets/lottie-animations/keystone/01.json'
import keystoneQrAnimation from './assets/lottie-animations/keystone/02.json'
import ledgerPlugIn from './assets/lottie-animations/ledger-plug-in.json'
import ledgerUniqueMessage from './assets/lottie-animations/ledger-unique-message.json'
import trezorPlugIn from './assets/lottie-animations/trezor-plug-in.json'
import trezorUniqueMessage from './assets/lottie-animations/trezor-unique-message.json'
import type { ColdcardModel } from './coldcard/coldcard-utils'

const animations = {
  // Trezor animations
  trezorPlugIn,
  trezorUniqueMessage,

  // Ledger animations
  ledgerPlugIn,
  ledgerUniqueMessage,

  // Generic animations
  genericProveControl,

  // Keystone animations
  keystoneAnimation,
  keystoneQrAnimation,
}

const coldcardAnimationsPerModel = {
  // Coldcard MK3
  coldcardWhatYouNeed_M3,
  coldcardExportWallet_M3,
  coldcardMicroSdIntoLaptop_M3,
  coldcardSignMessage_M3,
  coldcardDownloadTextFile_M3,
  coldcardSignTextFile_M3,

  // Coldcard MK4
  coldcardWhatYouNeed_M4,
  coldcardExportWallet_M4,
  coldcardMicroSdIntoLaptop_M4,
  coldcardSignMessage_M4,
  coldcardDownloadTextFile_M4,
  coldcardSignTextFile_M4,

  // Coldcard Q
  coldcardWhatYouNeed_Q,
  coldcardExportWallet_Q,
  coldcardMicroSdIntoLaptop_Q,
  coldcardSignMessage_Q,
  coldcardDownloadTextFile_Q,
  coldcardSignTextFile_Q,
}

type coldcardAnimationsGeneric =
  | 'coldcardWhatYouNeed'
  | 'coldcardExportWallet'
  | 'coldcardMicroSdIntoLaptop'
  | 'coldcardSignMessage'
  | 'coldcardDownloadTextFile'
  | 'coldcardSignTextFile'

const allAnimations = {
  ...animations,
  ...coldcardAnimationsPerModel,
}

export function getColdcardAnimation(model: ColdcardModel, animation: coldcardAnimationsGeneric): WalletAnimationType {
  switch (model) {
    case 'MK2/MK3':
      switch (animation) {
        case 'coldcardWhatYouNeed':
          return 'coldcardWhatYouNeed_M3'
        case 'coldcardExportWallet':
          return 'coldcardExportWallet_M3'
        case 'coldcardMicroSdIntoLaptop':
          return 'coldcardMicroSdIntoLaptop_M3'
        case 'coldcardSignMessage':
          return 'coldcardSignMessage_M3'
        case 'coldcardDownloadTextFile':
          return 'coldcardDownloadTextFile_M3'
        case 'coldcardSignTextFile':
          return 'coldcardSignTextFile_M3'
        default:
          throw new Error(`Invalid animation "${String(animation)}" for model "${model}"`)
      }
    case 'MK4':
      switch (animation) {
        case 'coldcardWhatYouNeed':
          return 'coldcardWhatYouNeed_M4'
        case 'coldcardExportWallet':
          return 'coldcardExportWallet_M4'
        case 'coldcardMicroSdIntoLaptop':
          return 'coldcardMicroSdIntoLaptop_M4'
        case 'coldcardSignMessage':
          return 'coldcardSignMessage_M4'
        case 'coldcardDownloadTextFile':
          return 'coldcardDownloadTextFile_M4'
        case 'coldcardSignTextFile':
          return 'coldcardSignTextFile_M4'
        default:
          throw new Error(`Invalid animation "${String(animation)}" for model "${model}"`)
      }
    case 'Q':
      switch (animation) {
        case 'coldcardWhatYouNeed':
          return 'coldcardWhatYouNeed_Q'
        case 'coldcardExportWallet':
          return 'coldcardExportWallet_Q'
        case 'coldcardMicroSdIntoLaptop':
          return 'coldcardMicroSdIntoLaptop_Q'
        case 'coldcardSignMessage':
          return 'coldcardSignMessage_Q'
        case 'coldcardDownloadTextFile':
          return 'coldcardDownloadTextFile_Q'
        case 'coldcardSignTextFile':
          return 'coldcardSignTextFile_Q'
        default:
          throw new Error(`Invalid animation "${String(animation)}" for model "${model}"`)
      }
    default:
      throw new Error(`Invalid animation "${animation}" for model "${String(model)}"`)
  }
}

export type WalletAnimationType = keyof typeof allAnimations

export function WalletAnimation({ animation }: { animation: WalletAnimationType }): JSX.Element {
  return (
    <Lottie
      animationData={allAnimations[animation]}
      loop={true}
      autoplay={true}
      style={{
        width: '320px',
        height: '240px',
        margin: '0 auto -20px auto',
      }}
    />
  )
}

const walletFloat = keyframes`0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); }`

export interface WalletImage {
  href: string
  alt: string
}

export function WalletFloatingImage({ href, alt, ...rest }: WalletImage & BoxProps): JSX.Element {
  return (
    <Box mx="auto" pt={10} pb={6} {...rest}>
      <chakra.img
        src={href}
        alt={alt}
        h="200px"
        display="block"
        animation={`${walletFloat} 4s cubic-bezier(0.77, 0, 0.175, 1) infinite`}
        sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
        filter="drop-shadow(-8px 10px 15px rgba(0, 0, 0, 0.5))"
      />
    </Box>
  )
}
