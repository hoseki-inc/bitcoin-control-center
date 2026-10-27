import { Stack, Text } from '@chakra-ui/react'
import { FloatingBitkeyImage } from '@hoseki/packages/ui/wallet-ui'
import { bitkeyKeyRoles } from '@hoseki/packages/wallet'
import type { ClaimDto } from '../../../trpc/server-types'
import { MultisigClaimProperties } from '../claim-details/multisig-claim-properties'
import { BitkeyKeyList, type BitkeyKeyRow, BitkeyRecoveryNote, BitkeyUnverifiedNote } from './bitkey-notes'

export function BitkeyClaimProperties({ claim }: { claim: ClaimDto }): JSX.Element {
  return (
    <Stack spacing={4} mb={8}>
      {/* Like the other wallets' account pages, which show their device above the details. */}
      <FloatingBitkeyImage />
      <MultisigClaimProperties claim={claim} mb={0} />
      <BitkeyUnverifiedNote isBrief />
      <Text as="h2" textStyle="text/md" fontWeight="medium" pt={4}>
        Keys
      </Text>
      <BitkeyKeyList keys={getBitkeyKeyRows(claim)} />
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
    return [{ role, xpub: keystore.xpub.toString(), derivationPath: keystore.derivationPath }]
  })
}
