import { type DerivationPath, type SingleSigAccount } from '@hoseki/packages/bitcoin'
import { type AsyncResult, Ok, Result } from '@hoseki/packages/result'
import { type BitcoinNetworkString, type ClaimId } from '@hoseki/packages/schemas'
import { type SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { browserLogger } from '../logger'
import { trpc } from '../trpc'
import { type ChallengeDto, type ChallengeMessageDto, type ClaimDto, type KeystoreDto } from '../trpc/server-types'

type CreateSingleSigClaimMutation = ReturnType<typeof trpc.portalProve.registry.claims.create.singlesig.useMutation>

interface Input {
  network: BitcoinNetworkString
  account: SingleSigAccount
  derivationPath: DerivationPath | null
  wallet: SupportedHardwareWallet | null
  model: string | null
  displayName: string
}

type UseNavigateToAnExistentOrNewClaimReturn = Omit<CreateSingleSigClaimMutation, 'execute'> & {
  execute: (input: Input) => AsyncResult<ClaimId, Error>
}

/**
 * Fetches a singlesig claim by account, if not found, creates a new one.
 * Then navigates to the signing page using the returned claim id.
 */
export function useNavigateToAnExistentOrNewClaim(): UseNavigateToAnExistentOrNewClaimReturn {
  const trpcUtils = trpc.useUtils()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const createSingleSigClaimMutation = trpc.portalProve.registry.claims.create.singlesig.useMutation()

  function execute({
    account,
    wallet,
    model,
    displayName,
    derivationPath,
    network,
  }: Input): AsyncResult<ClaimId, Error> {
    setIsLoading(true)

    return Result.fromPromise(
      trpcUtils.portalProve.registry.claims.get.byAccount.fetch({
        network,
        account: account.descriptor(),
      }),
    )
      .map((claim) => ({ claimId: claim.id, isArchived: claim.isArchived }))
      .orElseAsync(async () => {
        browserLogger.info('No existing claim found. Creating new claim.')

        return Result.fromPromise(
          createSingleSigClaimMutation.mutateAsync({
            network,
            account: account.descriptor(),
            displayName,
            keystore: {
              label: 'Default Keystore',
              wallet,
              model,
              derivationPath: derivationPath?.toString() ?? null,
            },
          }),
        ).map((claimData) => ({ claimId: claimData.claim.id, isArchived: false }))
      })
      .andThen(({ claimId, isArchived }) => {
        if (isArchived) {
          toast.info('This account is archived', {
            description: 'Restore it from Archived accounts before reconnecting.',
          })
          void navigate('/accounts#archived')
          setIsLoading(false)
          return Ok(claimId)
        }

        void navigate(`/accounts/${claimId}/signing`)
        setIsLoading(false)
        return Ok(claimId)
      })
      .inspectErr((err) => {
        browserLogger.error({ err }, 'Failed to navigate to a claim')
        toast.error('Failed to navigate to a claim', { description: err.message })
        setIsLoading(false)
      })
  }

  return {
    ...createSingleSigClaimMutation,
    isLoading,
    execute,
  }
}

export type SigningFlowProps = {
  claim: ClaimDto
  keystore: KeystoreDto
  challenge: ChallengeDto
  challengeMessage: ChallengeMessageDto
  onExitSigning: () => void
  onSigningComplete: () => void
}
