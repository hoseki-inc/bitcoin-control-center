import { useDisclosure } from '@chakra-ui/react'
import { TopBar, type TopBarProps } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { Link } from 'react-router'
import type { ClaimDto } from '../../trpc/server-types'
import { DeleteClaimModal } from './claim-details/delete-claim-modal'

export function ClaimTopBar({ claim, ...props }: { claim: ClaimDto } & Omit<TopBarProps, 'children'>): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const action = 'archive'

  return (
    <>
      <TopBar {...props}>
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
        <TopBar.Item as="button" onClick={onOpen}>
          Archive Account
        </TopBar.Item>
      </TopBar>
      <DeleteClaimModal action={action} isOpen={isOpen} onClose={onClose} claim={claim} />
    </>
  )
}
