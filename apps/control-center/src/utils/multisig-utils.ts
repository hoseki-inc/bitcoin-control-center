import { Account, type CheckedAccountDescriptor, MultiSigAccount } from '@hoseki/packages/bitcoin'
import { type ClaimDto } from '../trpc/server-types'

export function getThreshold(checkedAccountDescriptor: CheckedAccountDescriptor): number {
  const account = Account.fromCheckedDescriptor(checkedAccountDescriptor)
  const threshold = account instanceof MultiSigAccount ? account.threshold : 1
  return threshold
}

export function getNumberOfSignedMessages(claim: ClaimDto): number {
  return claim.latestChallenge?.messages.filter((m) => m.signed).length ?? 0
}

export function getNumberOfMissingSignatures(claim: ClaimDto): number {
  return getThreshold(claim.account) - getNumberOfSignedMessages(claim)
}
