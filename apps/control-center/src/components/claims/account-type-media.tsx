import { Icon, type IconProps } from '@chakra-ui/react'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'

// The same key as `keyIcon` in keystores-status-indicator, built here so the introduction can show
// these tiles without loading the wallet libraries that module imports.
const keyIcon = <Icon as={RoundKeyIcon} fill="neutral.400" color2="shades.0" stroke="none" boxSize="90%" />
const multisigKeystore = { icon: keyIcon, alt: 'Multisig keystore' }

/** Three overlapping keys, the Add Account picture for a multisig wallet. */
export const MultisigImage = (
  <KeystoreAvatar.Group>
    <KeystoreAvatar {...multisigKeystore} />
    <KeystoreAvatar {...multisigKeystore} />
    <KeystoreAvatar {...multisigKeystore} />
  </KeystoreAvatar.Group>
)

/** A document, the Add Account picture for holdings entered by hand. */
export function ManualEntryIcon(props: IconProps): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={6} h={6} color="neutral.600" {...props}>
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="14 2 14 8 20 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline
        points="10 9 9 9 8 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Icon>
  )
}
