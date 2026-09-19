import { Address } from '@hoseki/packages/bitcoin'
import { Alert } from '@hoseki/packages/ui/design-system'
import {
  ControlledGenericSigningSteps,
  HardwareWalletError,
  encodeHwAppBtcSignature,
} from '@hoseki/packages/ui/wallet-ui'
import { Result } from '@patina/core'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLedgerStore, useToastOnLedgerDisconnect } from '../../../hooks/use-ledger-store'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { browserLogger, captureHardwareWalletError } from '../../../logger'
import { trpc } from '../../../trpc'
import type { ChallengeDto, ChallengeMessageDto } from '../../../trpc/server-types'

export function LedgerSigning({
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
  const [step, setStep] = useState(1)

  const { isInitialized, initLedger, signMessage, resetLedger } = useLedgerStore(
    useShallow((state) => ({
      isInitialized: state.isInitialized,
      initLedger: state.init,
      signMessage: state.signMessage,
      resetLedger: state.reset,
    })),
  )

  const initiateLedgerMutation = useMutation({
    mutationFn: async () => {
      if (!isInitialized) {
        await resetLedger()
        await initLedger()
      }
    },
    onError(error: Error) {
      browserLogger.error({ error }, 'Error initializing Ledger')
    },
  })

  useToastOnLedgerDisconnect()

  if (!keystore.derivationPath) {
    return <Alert status="error" title="Derivation path not found"></Alert>
  }

  // Replace 'h' with "'" in the derivation path to make it compatible with Ledger
  const signingPath = `${keystore.derivationPath}/0/0`.replace(/h/g, "'")

  async function signCustomMessageOnLedger(signingChallenge: ChallengeDto, signingMessage: ChallengeMessageDto) {
    setSigningInProgress(true)
    setSigningError(null)

    // Step 1: Sign the message on the device
    const signMessageResult = await signMessage(signingPath, signingMessage.signedMessage.messageTextToSign)
    if (signMessageResult.isErr()) {
      captureHardwareWalletError(
        signMessageResult.unwrapErr(),
        'Failed to sign message',
        { wallet: 'ledger', step: 'sign-message' },
        { signingPath, keystoreDerivationPath: keystore.derivationPath },
      )
      setSigningError(signMessageResult.unwrapErr())
      setSigningInProgress(false)
      return
    }

    // Step 2: Complete the challenge message
    const ccmResult = await Result.fromPromise(
      completeChallengeMessageMutation.mutateAsync({
        signedMessageId: signingMessage.signedMessage.id,
        signature: encodeHwAppBtcSignature(signMessageResult.unwrap()),
      }),
    )
    if (ccmResult.isErr()) {
      setSigningInProgress(false)
      return
    }

    // Step 3: Complete the challenge
    const ccResult = await Result.fromPromise(
      completeChallengeMutation.mutateAsync({ challengeId: signingChallenge.id }),
    )
    if (ccResult.isErr()) {
      setSigningInProgress(false)
      return
    }

    setSigningInProgress(false)
    onSigningComplete()
  }

  const error = initiateLedgerMutation.error || signingError

  const handleNext = () => {
    setStep((prev) => {
      if (error) {
        return prev
      }
      if (prev === 1) {
        initiateLedgerMutation.mutate(undefined, {
          onSuccess: () => {
            setStep(prev + 1)
          },
        })
        return prev
      }

      return Math.min(prev + 1, 3)
    })
  }
  const handleBack = () => {
    setStep((prev) => Math.max(prev - 1, 1))
  }

  return (
    <>
      {error && (
        <HardwareWalletError
          error={error}
          mt={4}
          onRetry={() => {
            // TODO: Is there any way to remove this whole error component?
            // Inside ControlledGenericSigningSteps, we already handle errors.
            // Is resetLedger really necessary?
            resetLedger()
            window.location.reload()
          }}
        />
      )}
      <ControlledGenericSigningSteps
        step={step}
        onNext={handleNext}
        onBack={handleBack}
        walletType="Ledger"
        signingAnimation="ledgerUniqueMessage"
        isLoading={completeChallengeMessageMutation.isLoading || completeChallengeMutation.isLoading}
        error={completeChallengeMessageMutation.error ?? completeChallengeMutation.error ?? undefined}
        signedMessage={{
          messageTextToSign: challengeMessage.signedMessage.messageTextToSign,
          address: Address.fromCheckedString(challengeMessage.signedMessage.address),
          signingPath,
        }}
        onProveControl={
          initiateLedgerMutation.isError ? () => {} : () => signCustomMessageOnLedger(challenge, challengeMessage)
        }
        onExit={onExitSigning}
        signingInProgress={signingInProgress}
      />
    </>
  )
}
