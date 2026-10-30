import type { BalanceValue, BalanceWithStatus } from '@hoseki/packages/lib/balance'
import type { ClaimStatus } from '@hoseki/packages/schemas/prove'
import type { ClaimCardProps } from '@hoseki/packages/ui/prove-verify-ui'
import type { ClaimDto } from '../trpc/server-types'
import { getThreshold } from './multisig-utils'

/**
 * Since we don't have claim re-verification, every claim will always be expired, so we show it as 'verified'
 */
export function ensureClaimStatusNotExpired(claim: ClaimDto): ClaimStatus {
  return claim.status === 'expired' ? 'verified' : claim.status
}

/** Bitkey's three keys are one wallet to its owner, so Bitkey accounts show as a single Bitkey. */
export function isBitkeyClaim(claim: ClaimDto): boolean {
  return claim.keystores.some((keystore) => keystore.wallet === 'bitkey')
}

/**
 * Transforms claim data into claim card props
 */
export function mapClaimToClaimCardProps(
  claim: ClaimDto,
): Omit<ClaimCardProps & { threshold: number }, 'balance' | 'onClick'> {
  return {
    id: claim.id,
    officialName: claim.officialName,
    displayName: claim.displayName,
    threshold: getThreshold(claim.account),
    // Since we don't have claim re-verification, every claim will always be expired, so we show it as 'verified'
    status: ensureClaimStatusNotExpired(claim),
    keystores: isBitkeyClaim(claim)
      ? [{ id: claim.id, wallet: 'bitkey', isVerified: false }]
      : claim.keystores.map((keystore) => ({
          id: keystore.id,
          wallet: keystore.wallet,
          isVerified: Boolean(claim.latestChallenge?.messages.find((m) => m.keystoreId === keystore.id && m.signed)),
        })),
  }
}

export function withStatusBalance(args: {
  isLoading: boolean
  isSuccess: boolean
  balance?: BalanceValue | null
}): BalanceWithStatus {
  if (args.isLoading) {
    return { status: 'loading' }
  }

  if (args.isSuccess && args.balance) {
    return { status: 'success', value: args.balance }
  }

  return { status: 'fail' }
}
