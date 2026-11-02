import { Icon } from '@chakra-ui/react'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'
import { NotebookPen, Signature } from 'lucide-react'

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

/** A pencil on a notepad, the Add Account picture for holdings entered by hand. */
export function ManualEntryIcon({ boxSize = 6 }: { boxSize?: number }): JSX.Element {
  return <Icon as={NotebookPen} boxSize={boxSize} color="neutral.600" strokeWidth={1.5} />
}

/** A signature, the Add Account picture for any wallet that can sign a message. */
export function ManualSignIcon(): JSX.Element {
  return <Icon as={Signature} w={6} h={6} color="neutral.600" strokeWidth={1.5} />
}

/** Four tiles, the picture for ETF holdings. */
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
