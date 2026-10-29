import { Icon } from '@chakra-ui/react'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { RoundKeyIcon } from '@hoseki/packages/ui/prove-verify-ui/icons'
import { NotebookPen, Signature } from 'lucide-react'

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

/** A pencil on a notepad, the Add Account picture for holdings entered by hand. */
export function ManualEntryIcon(): JSX.Element {
  return <Icon as={NotebookPen} w={6} h={6} color="neutral.600" strokeWidth={1.5} />
}

/** A signature, the Add Account picture for any wallet that can sign a message. */
export function ManualSignIcon(): JSX.Element {
  return <Icon as={Signature} w={6} h={6} color="neutral.600" strokeWidth={1.5} />
}
