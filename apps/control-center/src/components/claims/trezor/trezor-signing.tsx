import { Address } from '@hoseki/packages/bitcoin'
import { Alert } from '@hoseki/packages/ui/design-system'
import { GenericSigningSteps } from '@hoseki/packages/ui/wallet-ui'
import { Result } from '@patina/core'
import { useState } from 'react'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { captureHardwareWalletError } from '../../../logger'
import { trpc } from '../../../trpc'
import type { ChallengeDto, ChallengeMessageDto } from '../../../trpc/server-types'
import { trezorService } from './trezor-service-singleton'

export function TrezorSigning({
  keystore,
  challenge,
  challengeMessage,
  onSigningComplete,
  onExitSigning,
}: SigningFlowProps): JSX.Element {
  const [signingInProgress, setSigningInProgress] = useState(false)
  const [signingError, setSigningError] = useState<Error | null>(null)
  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallengeMutation = trpc.portalProve.registry.challenges.complete.useMutation()

  if (!keystore.derivationPath) {
    return <Alert status="error">Derivation path not found</Alert>
  }

  // Replace 'h' with "'" in the derivation path to make it compatible with Trezor
  const signingPath = `${keystore.derivationPath}/0/0`.replace(/h/g, "'")

  async function signCustomMessageOnTrezor(challenge: ChallengeDto, challengeMessage: ChallengeMessageDto) {
    setSigningInProgress(true)
    setSigningError(null)

    // Step 1: Sign the message on the device
    const signMessageResult = await trezorService.signCustomMessage(
      signingPath,
      challengeMessage.signedMessage.messageTextToSign,
    )
    if (signMessageResult.isErr()) {
      const trezorError = signMessageResult.unwrapErr()
      captureHardwareWalletError(
        trezorError,
        trezorError.message,
        { wallet: 'trezor', step: 'sign-message' },
        { signingPath, keystoreDerivationPath: keystore.derivationPath },
      )
      setSigningError(trezorError)
      setSigningInProgress(false)
      return
    }

    // Step 2: Complete the challenge message
    const ccmResult = await Result.fromPromise(
      completeChallengeMessageMutation.mutateAsync({
        signedMessageId: challengeMessage.signedMessage.id,
        signature: signMessageResult.unwrap().signature,
      }),
    )
    if (ccmResult.isErr()) {
      setSigningInProgress(false)
      return
    }

    // Step 3: Complete the challenge
    const ccResult = await Result.fromPromise(completeChallengeMutation.mutateAsync({ challengeId: challenge.id }))
    if (ccResult.isErr()) {
      setSigningInProgress(false)
      return
    }

    setSigningInProgress(false)
    onSigningComplete()
  }

  return (
    <GenericSigningSteps
      walletType="Trezor"
      signingAnimation="trezorUniqueMessage"
      isLoading={completeChallengeMessageMutation.isLoading || completeChallengeMutation.isLoading}
      error={signingError ?? completeChallengeMessageMutation.error ?? completeChallengeMutation.error ?? undefined}
      signedMessage={{
        messageTextToSign: challengeMessage.signedMessage.messageTextToSign,
        address: Address.fromCheckedString(challengeMessage.signedMessage.address),
        signingPath,
      }}
      onProveControl={() => signCustomMessageOnTrezor(challenge, challengeMessage)}
      onBack={onExitSigning}
      signingInProgress={signingInProgress}
    />
  )
}
