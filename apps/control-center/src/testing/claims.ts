import { Wallets } from '@hoseki/packages/testing/wallets'
import type { ClaimDto } from '../trpc/server-types'

export function claimFixture(id: ClaimDto['id'], displayName: string): ClaimDto {
  const createdAt = new Date('2026-01-01T00:00:00Z')
  return {
    id,
    displayName,
    createdAt,
    updatedAt: createdAt,
    officialName: '',
    isVerified: true,
    network: 'bitcoin_mainnet',
    status: 'verified',
    isArchived: false,
    metadata: null,
    account: Wallets.singlesigNativeSegwitAccount.descriptor(),
    keystores: [],
    latestChallenge: null,
  }
}
