import type { ClaimId } from '@hoseki/packages/schemas'
import type { BitcoinInput } from '@hoseki/packages/ui/utils'

export type ClaimingState = {
  claimId: ClaimId
  bitcoinInput: BitcoinInput
}
