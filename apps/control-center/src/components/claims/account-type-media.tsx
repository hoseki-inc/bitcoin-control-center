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

/** A document, the Add Account picture for holdings entered by hand. */
export function ManualEntryIcon({ boxSize = 6 }: { boxSize?: number }): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" boxSize={boxSize} color="neutral.600">
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

/** Four tiles, the picture for ETF holdings, drawn like the manual entry document. */
export function EtfHoldingsIcon({ boxSize = 6 }: { boxSize?: number }): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" boxSize={boxSize} color="neutral.600">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </Icon>
  )
}
