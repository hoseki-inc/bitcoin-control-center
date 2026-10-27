import { Button, HStack, Stack, Text } from '@chakra-ui/react'
import { bitkeyKeyRoles } from '@hoseki/packages/wallet'
import { useState } from 'react'
import type { ClaimDto } from '../../../trpc/server-types'
import { MultisigClaimProperties } from '../claim-details/multisig-claim-properties'
import { BitkeyKeyList, type BitkeyKeyRow, BitkeyRecoveryNote, BitkeyUnverifiedNote } from './bitkey-notes'

export function BitkeyClaimProperties({ claim }: { claim: ClaimDto }): JSX.Element {
  const [showPublicKeys, setShowPublicKeys] = useState(false)

  return (
    <Stack spacing={4} mb={8}>
      <MultisigClaimProperties claim={claim} mb={0} />
      <BitkeyUnverifiedNote />
      <HStack justify="space-between" pt={4}>
        <Text as="h2" textStyle="text/md" fontWeight="medium">
          Keys
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setShowPublicKeys((shown) => !shown)
          }}
        >
          {showPublicKeys ? 'Hide public keys' : 'Show public keys'}
        </Button>
      </HStack>
      <BitkeyKeyList keys={getBitkeyKeyRows(claim)} showPublicKeys={showPublicKeys} />
      <BitkeyRecoveryNote />
    </Stack>
  )
}

/** Sentinel stores each Bitkey key's role as its model. */
function getBitkeyKeyRows(claim: ClaimDto): BitkeyKeyRow[] {
  return bitkeyKeyRoles.flatMap((role) => {
    const keystore = claim.keystores.find((candidate) => candidate.model === role)
    if (!keystore) {
      return []
    }
    return [{ role, xpub: keystore.xpub.toString() }]
  })
}
