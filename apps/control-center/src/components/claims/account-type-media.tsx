import { Icon } from '@chakra-ui/react'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'

// The same key as `keyIcon` in keystores-status-indicator, built here so the introduction can show
// these tiles without loading the wallet libraries that module imports.
const keyIcon = <Icon as={RoundKeyIcon} fill="neutral.400" color2="shades.0" stroke="none" boxSize="90%" />
const multisigKeystore = { icon: keyIcon, alt: 'Multisig keystore' }

/** Three overlapping keys, the picture for a multisig wallet. */
export function MultisigKeys({ size = '36px' }: { size?: string }): JSX.Element {
  return (
    <KeystoreAvatar.Group>
      <KeystoreAvatar {...multisigKeystore} size={size} />
      <KeystoreAvatar {...multisigKeystore} size={size} />
      <KeystoreAvatar {...multisigKeystore} size={size} />
    </KeystoreAvatar.Group>
  )
}

/** The Add Account picture for a multisig wallet. */
export const MultisigImage = <MultisigKeys />

/**
 * The Bitcoin logo, the picture for bitcoin with no device or app to show: holdings entered by hand, ETF holdings,
 * and a wallet verified by signing a message by hand. The same coin as `bitcoin-medium.svg`, which account lists show
 * for a wallet with no known device, drawn here so it doesn't wait on the assets CDN.
 */
export function BitcoinLogo({ boxSize = 6 }: { boxSize?: number }): JSX.Element {
  return (
    <Icon viewBox="0 0 36 36" boxSize={boxSize}>
      <path
        d="M35.4594 22.4093C33.0553 32.0523 23.2886 37.9208 13.6445 35.5161C4.0044 33.112 -1.86416 23.3448 0.541087 13.7024C2.94409 4.05834 12.7108 -1.81079 22.352 0.593335C31.9955 2.99746 37.8635 12.7658 35.4594 22.4093Z"
        fill="#F7931A"
      />
      <path
        d="M25.9361 15.4899C26.2944 13.0947 24.4708 11.8072 21.9772 10.9482L22.7861 7.70373L20.8112 7.21155L20.0237 10.3705C19.5045 10.2412 18.9712 10.1191 18.4414 9.99817L19.2345 6.81836L17.2607 6.32617L16.4512 9.56955C16.0215 9.47167 15.5996 9.37492 15.1901 9.27311L15.1924 9.26298L12.4687 8.58292L11.9434 10.6923C11.9434 10.6923 13.4087 11.0281 13.3777 11.0489C14.1776 11.2486 14.3222 11.7779 14.298 12.1975L13.3766 15.8937C13.4317 15.9078 13.5032 15.928 13.5819 15.9595C13.5161 15.9432 13.4458 15.9252 13.3732 15.9078L12.0817 21.0856C11.9839 21.3286 11.7358 21.6931 11.1767 21.5547C11.1964 21.5834 9.74118 21.1964 9.74118 21.1964L8.76074 23.4571L11.3308 24.0978C11.8089 24.2176 12.2775 24.343 12.7387 24.4612L11.9214 27.7428L13.8941 28.235L14.7036 24.9882C15.2424 25.1345 15.7656 25.2695 16.2774 25.3966L15.4708 28.6282L17.4457 29.1204L18.2631 25.8449C21.6307 26.4822 24.1631 26.2252 25.2291 23.1792C26.088 20.7267 25.1863 19.312 23.4144 18.3895C24.7048 18.092 25.6768 17.2432 25.9361 15.4899ZM21.4237 21.8174C20.8134 24.2699 16.6841 22.9441 15.3454 22.6117L16.4299 18.2641C17.7686 18.5982 22.0616 19.2597 21.4237 21.8174ZM22.0346 15.4544C21.4777 17.6853 18.0409 16.5519 16.926 16.274L17.9092 12.3309C19.0241 12.6087 22.6146 13.1274 22.0346 15.4544Z"
        fill="white"
      />
    </Icon>
  )
}
