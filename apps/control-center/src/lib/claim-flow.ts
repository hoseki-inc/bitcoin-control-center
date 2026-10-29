import type { DerivationPath, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { type AsyncResult, Ok, Result } from '@hoseki/packages/result'
import type { BitcoinNetworkString, ClaimId } from '@hoseki/packages/schemas'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { browserLogger } from '../logger'
import { trpc } from '../trpc'
import type { ChallengeDto, ChallengeMessageDto, ClaimDto, KeystoreDto } from '../trpc/server-types'

type CreateSingleSigClaimMutation = ReturnType<typeof trpc.portalProve.registry.claims.create.singlesig.useMutation>

interface Input {
  network: BitcoinNetworkString
  account: SingleSigAccount
  derivationPath: DerivationPath | null
  wallet: SupportedHardwareWallet | null
  model: string | null
  displayName: string
}

type KeystoreUpdate = Parameters<
  ReturnType<typeof trpc.portalProve.registry.claims.updateKeystore.useMutation>['mutateAsync']
>[0]

/**
 * The device details to save onto an account that's already in Control Center, so signing uses the way someone
 * just chose: their device, or no device for Manually Sign. Only for accounts still waiting to be proven.
 */
export function deviceUpdateFor(
  claim: Pick<ClaimDto, 'status' | 'isArchived' | 'keystores'>,
  device: Pick<Input, 'wallet' | 'model' | 'derivationPath'>,
): KeystoreUpdate | null {
  const keystore = claim.keystores[0]
  const isUnproven = claim.status === 'pending' || claim.status === 'unverified'
  if (claim.isArchived || !isUnproven || keystore === undefined) {
    return null
  }
  const update = {
    id: keystore.id,
    label: keystore.label,
    wallet: device.wallet,
    model: device.model,
    derivationPath: device.derivationPath?.toString() ?? keystore.derivationPath,
  }
  const isUnchanged =
    update.wallet === keystore.wallet &&
    update.model === keystore.model &&
    update.derivationPath === keystore.derivationPath
  return isUnchanged ? null : update
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
  const updateKeystoreMutation = trpc.portalProve.registry.claims.updateKeystore.useMutation()

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
      .map((claim) => ({
        claimId: claim.id,
        isArchived: claim.isArchived,
        update: deviceUpdateFor(claim, { wallet, model, derivationPath }),
      }))
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
        ).map((claimData) => ({ claimId: claimData.claim.id, isArchived: false, update: null }))
      })
      .andThenAsync(async (found) => {
        if (found.update === null) {
          return Ok(found)
        }
        return Result.fromPromise(updateKeystoreMutation.mutateAsync(found.update))
          .andThenAsync(async () => Result.fromPromise(trpcUtils.portalProve.registry.claims.invalidate()))
          .map(() => found)
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
        toast.error("Couldn't open this account", { description: err.message })
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
