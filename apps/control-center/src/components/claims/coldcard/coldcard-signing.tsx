import type { StackProps } from '@chakra-ui/react'
import { Account, Address } from '@hoseki/packages/bitcoin'
import { Alert, type FileDropState } from '@hoseki/packages/ui/design-system'
import { type ColdcardModel, type ParsedSignatureFile, isColdcardModel } from '@hoseki/packages/ui/wallet-ui'
import { useState } from 'react'
import { toast } from 'sonner'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { trpc } from '../../../trpc'
import type { ChallengeDto, ChallengeMessageDto, ClaimDto } from '../../../trpc/server-types'
import { GenericError } from '../../errors/generic-error'
import { ColdcardQrSigning } from './coldcard-qr-signing'
import { Step9Ui, Step10, Step11Ui } from './coldcard-steps'

export function ColdcardSigning(props: SigningFlowProps): JSX.Element {
  const { claim, keystore, challenge, challengeMessage, onExitSigning, onSigningComplete } = props
  const model: ColdcardModel = keystore.model && isColdcardModel(keystore.model) ? keystore.model : 'MK4'

  // Coldcard Q uses QR-based signing flow
  if (model === 'Q') {
    return <ColdcardQrSigning {...props} />
  }

  // MK2/MK3/MK4 use the MicroSD file-based signing flow
  return (
    <ColdcardFileSigning
      claim={claim}
      keystore={keystore}
      challenge={challenge}
      challengeMessage={challengeMessage}
      onExitSigning={onExitSigning}
      onSigningComplete={onSigningComplete}
      model={model}
    />
  )
}

function ColdcardFileSigning({
  claim,
  keystore,
  challenge,
  challengeMessage,
  onExitSigning,
  onSigningComplete,
  model,
}: SigningFlowProps & { model: ColdcardModel }): JSX.Element {
  const [step, setStep] = useState(1)
  const onBack = (): void => {
    setStep((prev) => prev - 1)
  }
  const onNext = (): void => {
    setStep((prev) => prev + 1)
  }
  const { scriptType } = Account.fromCheckedDescriptor(claim.account)

  if (!keystore.derivationPath) {
    return <Alert status="error">Derivation path not found</Alert>
  }
  const signingPath = `${keystore.derivationPath}/0/0`

  const commonProps = {
    model,
    onBack,
    onNext,
  } as const
  switch (step) {
    case 1: {
      const signedMessage = challengeMessage.signedMessage
      const content = [signedMessage.messageTextToSign, signingPath, scriptType.toUpperCase().replace('_', '-')]
      return <Step9Ui {...commonProps} textFileContents={content} onBack={onExitSigning} />
    }
    case 2:
      return (
        <Step10
          address={Address.fromCheckedString(challengeMessage.signedMessage.address)}
          messageTextToSign={challengeMessage.signedMessage.messageTextToSign}
          signingPath={signingPath}
          {...commonProps}
        />
      )
    case 3:
      return (
        <SinglesigStep11
          {...commonProps}
          claim={claim}
          challenge={challenge}
          challengeMessage={challengeMessage}
          onSigningComplete={onSigningComplete}
        />
      )
    default:
      return <GenericError title="Unexpected error" message="Invalid step" />
  }
}

function SinglesigStep11({
  model,
  claim: _claim,
  challenge,
  challengeMessage,
  onBack,
  onSigningComplete,
  ...rest
}: {
  model: ColdcardModel
  claim: ClaimDto
  challenge: ChallengeDto
  challengeMessage: ChallengeMessageDto
  onBack: () => void
  onSigningComplete: () => void
} & StackProps) {
  const [signatureFile, setSignatureFile] = useState<ParsedSignatureFile | null>(null)
  const [fileState, setFileState] = useState<FileDropState>('ready')

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallengeMutation = trpc.portalProve.registry.challenges.complete.useMutation()

  async function proveControl() {
    if (!signatureFile) {
      toast.error('The signature file was not found or claim/challenge data is not available.')
      return
    }

    try {
      // First, complete the signed message
      await completeChallengeMessageMutation.mutateAsync({
        signedMessageId: challengeMessage.signedMessage.id,
        signature: signatureFile.signature,
      })

      // Then complete the challenge
      await completeChallengeMutation.mutateAsync({ challengeId: challenge.id })

      onSigningComplete()
    } catch {
      toast.error('The signing process did not complete successfully.')
    }
  }

  return (
    <Step11Ui
      model={model}
      signatureFile={signatureFile}
      setSignatureFile={setSignatureFile}
      fileState={fileState}
      setFileState={setFileState}
      onBack={onBack}
      onProveControl={proveControl}
      {...rest}
    />
  )
}
