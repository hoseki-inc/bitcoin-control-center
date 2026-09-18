import { type StackProps } from '@chakra-ui/react'
import { Address, DerivationPath, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { ErrorBanner, type FileDropState, Spinner } from '@hoseki/packages/ui/design-system'
import {
  ClaimConnectionWrapper,
  type ColdcardModel,
  ControlledGenericSigningSteps,
  GenericSigningSteps,
  HardwareWalletError,
  type ParsedSignatureFile,
  encodeHwAppBtcSignature,
  isColdcardModel,
} from '@hoseki/packages/ui/wallet-ui'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { ColdcardQrSigning } from '../../../components/claims/coldcard/coldcard-qr-signing'
import { Step7, Step8, Step9Ui, Step10, Step11Ui } from '../../../components/claims/coldcard/coldcard-steps'
import { KeystoneQrSigning } from '../../../components/claims/keystone/keystone-qr-signing'
import { trezorService } from '../../../components/claims/trezor/trezor-service-singleton'
import { useMultisigPageWrapperContext } from '../../../components/multisig/multisig-page-wrapper'
import { useLedgerStore, useToastOnLedgerDisconnect } from '../../../hooks/use-ledger-store'
import { browserLogger, captureHardwareWalletError } from '../../../logger'
import { trpc } from '../../../trpc'
import type { ClaimDto, KeystoreDto } from '../../../trpc/server-types'
import { getNumberOfMissingSignatures } from '../../../utils/multisig-utils'

export function MultisigSigningPage(): JSX.Element {
  const { keystoreId, walletType } = useParams<{ keystoreId: string; walletType: string }>()
  const { claim } = useMultisigPageWrapperContext()

  if (!keystoreId) {
    return <ErrorBanner mb={4} message="Keystore ID missing" />
  }

  const keystore = claim.keystores.find((ks) => ks.id === keystoreId)
  if (!keystore) {
    return <ErrorBanner mb={4} message="Keystore not found" />
  }

  return (
    <ClaimConnectionWrapper>
      {walletType === 'trezor' && <TrezorSigning claim={claim} keystore={keystore} />}
      {walletType === 'ledger' && <LedgerSigning claim={claim} keystore={keystore} />}
      {walletType === 'coldcard' && <ColdcardSigning claim={claim} keystore={keystore} />}
      {walletType === 'keystone' && <KeystoneSigning claim={claim} keystore={keystore} />}
    </ClaimConnectionWrapper>
  )
}

function TrezorSigning({ claim, keystore }: { claim: ClaimDto; keystore: KeystoreDto }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [signingInProgress, setSigningInProgress] = useState(false)

  const claimQuery = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claim.id })
  const latestMessage = claim.latestChallenge?.messages.find((m) => m.keystoreId === keystore.id)

  const challengeMessageQueryEnabled = !!latestMessage
  const challengeMessageQuery = trpc.portalProve.registry.challengeMessages.get.useQuery(
    { signedMessageId: latestMessage?.signedMessageId ?? '' },
    { enabled: challengeMessageQueryEnabled },
  )

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()

  const signedMessage = challengeMessageQuery.data?.signedMessage
  const completeChallenge = useCompleteChallenge(claim)

  async function handleTrezorSign() {
    setSigningInProgress(true)

    if (!keystore.derivationPath) {
      setError('No derivation path found')
      return
    }
    if (!signedMessage) {
      setError('Could not find signedMessage')
      return
    }

    const signingPath = getSigningPath(keystore)
    if (!signingPath) {
      setError('No signing path found')
      return
    }

    try {
      // Wait for user to sign message on device
      const result = await trezorService.signCustomMessage(signingPath, signedMessage.messageTextToSign)
      if (result.isErr()) {
        const trezorError = result.unwrapErr()
        captureHardwareWalletError(
          trezorError,
          trezorError.message,
          { wallet: 'trezor', step: 'sign-message' },
          { signingPath, keystoreDerivationPath: keystore.derivationPath },
        )
        throw trezorError
      }

      const isLastRequiredSignature = getNumberOfMissingSignatures(claim) === 1

      // Complete challenge message with the signature
      await completeChallengeMessageMutation.mutateAsync({
        signedMessageId: signedMessage.id,
        signature: result.unwrap().signature,
      })

      if (isLastRequiredSignature) {
        return await completeChallenge()
      }

      // Refetch claim, then navigate to the hub
      await claimQuery.refetch()
      navigate(`/multisig/verify/receipt/${claim.id}/${keystore.id}`)
    } catch (error) {
      console.error('error', error)
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError('Error signing message')
      }
    } finally {
      setSigningInProgress(false)
    }
  }

  if (error) {
    return <ErrorBanner mb={4} message={error} />
  }
  if (challengeMessageQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (!signedMessage) {
    return <ErrorBanner mb={4} message="Could not find signed message" />
  }

  return (
    <GenericSigningSteps
      walletType="Trezor"
      signingAnimation="trezorUniqueMessage"
      isLoading={false}
      signedMessage={{
        messageTextToSign: signedMessage.messageTextToSign,
        address: Address.fromCheckedString(signedMessage.address),
        signingPath: getSigningPath(keystore),
      }}
      onProveControl={handleTrezorSign}
      onBack={() => navigate(-1)}
      signingInProgress={signingInProgress}
    />
  )
}

function LedgerSigning({ claim, keystore }: { claim: ClaimDto; keystore: KeystoreDto }) {
  const navigate = useNavigate()
  const [signingError, setSigningError] = useState<Error | null>(null)
  const [signingInProgress, setSigningInProgress] = useState(false)
  const [step, setStep] = useState(1)
  const { signMessage, initLedger, isInitialized, resetLedger } = useLedgerStore(
    useShallow((state) => ({
      signMessage: state.signMessage,
      initLedger: state.init,
      isInitialized: state.isInitialized,
      resetLedger: state.reset,
    })),
  )

  useToastOnLedgerDisconnect()

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

  const error = initiateLedgerMutation.error || signingError

  const claimQuery = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claim.id })
  const latestMessage = claim.latestChallenge?.messages.find((m) => m.keystoreId === keystore.id)

  const challengeMessageQueryEnabled = !!latestMessage
  const challengeMessageQuery = trpc.portalProve.registry.challengeMessages.get.useQuery(
    { signedMessageId: latestMessage?.signedMessageId ?? '' },
    { enabled: challengeMessageQueryEnabled },
  )

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallenge = useCompleteChallenge(claim)

  const signedMessage = challengeMessageQuery.data?.signedMessage

  async function handleLedgerSign() {
    setSigningInProgress(true)

    if (!keystore.derivationPath) {
      setSigningError(new Error('No derivation path found'))
      return
    }
    if (!signedMessage) {
      setSigningError(new Error('Could not find signedMessage'))
      return
    }

    const signingPath = getSigningPath(keystore)
    if (!signingPath) {
      setSigningError(new Error('No signing path found'))
      return
    }

    try {
      // Wait for user to sign message on device
      const result = await signMessage(signingPath, signedMessage.messageTextToSign)
      if (result.isErr()) {
        captureHardwareWalletError(
          result.unwrapErr(),
          'Failed to sign message',
          { wallet: 'ledger', step: 'sign-message' },
          { signingPath },
        )
        throw result.unwrapErr()
      }
      const isLastRequiredSignature = getNumberOfMissingSignatures(claim) === 1
      // Complete challenge message with the signature
      await completeChallengeMessageMutation.mutateAsync({
        signedMessageId: signedMessage.id,
        signature: encodeHwAppBtcSignature(result.unwrap()),
      })

      if (isLastRequiredSignature) {
        return await completeChallenge()
      }

      // Refetch claim, then navigate to the hub
      await claimQuery.refetch()
      navigate(`/multisig/verify/receipt/${claim.id}/${keystore.id}`)
    } catch (error) {
      if (error instanceof Error) {
        setSigningError(error)
      } else {
        setSigningError(new Error('Error signing message'))
      }
    } finally {
      setSigningInProgress(false)
    }
  }

  if (challengeMessageQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (!signedMessage) {
    return <ErrorBanner mb={4} message="Could not find signed message" />
  }

  const handleBack = () => setStep((prev) => Math.max(prev - 1, 1))

  return (
    <>
      {error && (
        <HardwareWalletError
          error={error}
          mt={4}
          onRetry={() => {
            resetLedger()
            window.location.reload()
          }}
        />
      )}
      <ControlledGenericSigningSteps
        step={step}
        onNext={() => {
          if (step === 1 && !error) {
            return initiateLedgerMutation.mutate(undefined, { onSuccess: () => setStep(2) })
          }
          setStep((prev) => {
            if (error) {
              return prev
            }
            return Math.min(prev + 1, 3)
          })
        }}
        onBack={handleBack}
        walletType="Ledger"
        signingAnimation="ledgerUniqueMessage"
        isLoading={false}
        signedMessage={{
          messageTextToSign: signedMessage.messageTextToSign,
          address: Address.fromCheckedString(signedMessage.address),
          signingPath: getSigningPath(keystore),
        }}
        onProveControl={handleLedgerSign}
        onExit={() => navigate(-1)}
        signingInProgress={signingInProgress}
      />
    </>
  )
}

function ColdcardSigning({ claim, keystore }: { claim: ClaimDto; keystore: KeystoreDto }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  /*
  The steps are:
    1: 'Signing instructions, part 1',
    2: 'Signing instructions, part 2',
    3: 'Download message file',
    4: 'Sign the message file',
    5: 'Upload the signed message file',
  */
  const [wizardStep, setWizardStep] = useState<number>(1)
  const goBack = () => (wizardStep === 1 ? () => {} : setWizardStep((prev) => prev - 1))
  const goForward = () => (wizardStep === 5 ? () => {} : setWizardStep((prev) => prev + 1))

  const latestMessage = claim.latestChallenge?.messages.find((m) => m.keystoreId === keystore.id)
  const claimQuery = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claim.id })

  const challengeMessageQueryEnabled = !!latestMessage
  const challengeMessageQuery = trpc.portalProve.registry.challengeMessages.get.useQuery(
    { signedMessageId: latestMessage?.signedMessageId ?? '' },
    { enabled: challengeMessageQueryEnabled },
  )

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallenge = useCompleteChallenge(claim)

  // Vini: I'm not using the scriptType mapping function here because Coldcard always displays address format as p2pkh
  const singleSigAccount = new SingleSigAccount('p2pkh', keystore.xpub)
  const derivationPathRes = DerivationPath.fromString(keystore.derivationPath + '/0/0')

  const signedMessage = challengeMessageQuery.data?.signedMessage

  const model = keystore.model ?? 'MK4'
  const modelToDisplay: ColdcardModel = isColdcardModel(model) ? model : 'MK4'

  if (derivationPathRes.isErr()) {
    return <ErrorBanner mb={4} message="Invalid derivation path" />
  }
  if (error) {
    return <ErrorBanner mb={4} message={error} />
  }
  if (challengeMessageQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (!signedMessage) {
    return <ErrorBanner mb={4} message="Could not find signed message" />
  }

  async function handleOnProveControl(signature: string): Promise<void> {
    if (!signedMessage) {
      setError('Could not find signedMessage')
      return
    }

    const isLastRequiredSignature = getNumberOfMissingSignatures(claim) === 1
    await completeChallengeMessageMutation.mutateAsync(
      {
        signedMessageId: signedMessage.id,
        signature,
      },
      {
        onSuccess: async () => {
          await claimQuery.refetch()
        },
        onError: (error) => {
          console.error('error', error)
          setError('Error completing challenge message')
        },
      },
    )

    if (isLastRequiredSignature) {
      return completeChallenge()
    }

    navigate(`/multisig/verify/receipt/${claim.id}/${keystore.id}`)
  }

  // Coldcard Q uses QR-based signing flow
  if (modelToDisplay === 'Q' && claim.latestChallenge && challengeMessageQuery.data) {
    return (
      <ColdcardQrSigning
        claim={claim}
        keystore={keystore}
        challenge={claim.latestChallenge}
        challengeMessage={challengeMessageQuery.data}
        onExitSigning={() => navigate(`/multisig/${claim.id}/connect/coldcard/${keystore.id}`)}
        onSigningComplete={() => {}}
        onSubmitSignature={handleOnProveControl}
      />
    )
  }

  // MK2/MK3/MK4 use MicroSD file-based signing flow
  return (
    <>
      {wizardStep === 1 && (
        <Step7 onBack={() => navigate(`/multisig/${claim.id}/connect/coldcard/${keystore.id}`)} onNext={goForward} />
      )}

      {wizardStep === 2 && <Step8 model={modelToDisplay} onBack={goBack} onNext={goForward} />}

      {wizardStep === 3 && (
        <Step9Ui
          model={modelToDisplay}
          textFileContents={[signedMessage.messageTextToSign, derivationPathRes.unwrap().toString()]}
          onBack={goBack}
          onNext={goForward}
        />
      )}
      {wizardStep === 4 && (
        <Step10
          model={modelToDisplay}
          messageTextToSign={signedMessage.messageTextToSign}
          address={Address.fromCheckedString(signedMessage.address)}
          signingPath={derivationPathRes.unwrap().toString()}
          onBack={goBack}
          onNext={goForward}
        />
      )}
      {wizardStep === 5 && (
        <ColdcardMultisigStep11
          model={modelToDisplay}
          account={singleSigAccount}
          walletDisplayName="Coldcard Wallet"
          claim={claim}
          onBack={goBack}
          onProveControl={handleOnProveControl}
        />
      )}
    </>
  )
}

function KeystoneSigning({ claim, keystore }: { claim: ClaimDto; keystore: KeystoreDto }) {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const latestMessage = claim.latestChallenge?.messages.find((m) => m.keystoreId === keystore.id)
  const claimQuery = trpc.portalProve.registry.claims.get.byId.useQuery({ id: claim.id })

  const challengeMessageQuery = trpc.portalProve.registry.challengeMessages.get.useQuery(
    { signedMessageId: latestMessage?.signedMessageId ?? '' },
    { enabled: !!latestMessage },
  )

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallenge = useCompleteChallenge(claim)

  if (error) {
    return <ErrorBanner mb={4} message={error} />
  }
  if (challengeMessageQuery.isLoading) {
    return <Spinner fullPage size="xl" />
  }
  if (!challengeMessageQuery.data?.signedMessage) {
    return <ErrorBanner mb={4} message="Could not find signed message" />
  }
  if (!claim.latestChallenge) {
    return <ErrorBanner mb={4} message="No challenge found" />
  }

  async function handleOnProveControl(signature: string): Promise<void> {
    const signedMessage = challengeMessageQuery.data?.signedMessage
    if (!signedMessage) {
      setError('Could not find signedMessage')
      return
    }

    const isLastRequiredSignature = getNumberOfMissingSignatures(claim) === 1
    await completeChallengeMessageMutation.mutateAsync(
      {
        signedMessageId: signedMessage.id,
        signature,
      },
      {
        onSuccess: async () => {
          await claimQuery.refetch()
        },
        onError: (error) => {
          console.error('error', error)
          setError('Error completing challenge message')
        },
      },
    )

    if (isLastRequiredSignature) {
      return completeChallenge()
    }

    navigate(`/multisig/verify/receipt/${claim.id}/${keystore.id}`)
  }

  return (
    <KeystoneQrSigning
      claim={claim}
      keystore={keystore}
      challenge={claim.latestChallenge}
      challengeMessage={challengeMessageQuery.data}
      onExitSigning={() => navigate(`/multisig/${claim.id}/connect/keystone/${keystore.id}`)}
      onSigningComplete={() => {}}
      onSubmitSignature={handleOnProveControl}
    />
  )
}

function ColdcardMultisigStep11({
  model,
  account,
  walletDisplayName,
  claim,
  onBack,
  onProveControl,
  ...rest
}: {
  model: ColdcardModel
  account: SingleSigAccount
  walletDisplayName: string
  claim: ClaimDto
  onBack: () => void
  onProveControl: (signature: string) => void
} & StackProps) {
  const [signatureFile, setSignatureFile] = useState<ParsedSignatureFile | null>(null)
  const [fileState, setFileState] = useState<FileDropState>('ready')

  async function proveControl() {
    if (!signatureFile) {
      toast.error('The signature file was not found.')
      return
    }

    onProveControl(signatureFile.signature)
  }

  return (
    <Step11Ui
      signatureFile={signatureFile}
      setSignatureFile={setSignatureFile}
      fileState={fileState}
      setFileState={setFileState}
      model={model}
      onBack={onBack}
      onProveControl={proveControl}
      {...rest}
    />
  )
}

function useCompleteChallenge(claim: ClaimDto) {
  const trpcUtils = trpc.useUtils()
  const navigate = useNavigate()

  const completeChallengeMutation = trpc.portalProve.registry.challenges.complete.useMutation({
    onSuccess: () => {
      trpcUtils.portalProve.registry.claims.get.byId.invalidate({ id: claim.id }).then(() => {
        navigate('/accounts/verify/receipt/' + claim.id)
      })
    },
    onError: (error) => {
      browserLogger.error(error, 'There was an error when completing your Multisig claim')
      toast.error('There was an error when completing your Multisig claim')
    },
  })

  async function completeChallenge() {
    if (!claim.latestChallenge?.id) {
      return
    }
    await completeChallengeMutation.mutateAsync({ challengeId: claim.latestChallenge.id })
  }

  return completeChallenge
}

function getSigningPath(keystore: KeystoreDto): string | null {
  if (!keystore.derivationPath) {
    return null
  }

  const basePath = keystore.derivationPath?.replace(/h/g, "'")
  return basePath + '/0/0'
}
