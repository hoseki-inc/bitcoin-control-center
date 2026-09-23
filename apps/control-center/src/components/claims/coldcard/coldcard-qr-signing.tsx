import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Button,
  Stack,
  type StackProps,
  Text,
} from '@chakra-ui/react'
import { Address } from '@hoseki/packages/bitcoin'
import { Alert } from '@hoseki/packages/ui/design-system'
import {
  type ColdcardModel,
  NavigationArrows,
  SignAddressAndMessageInfo,
  WalletAnimation,
  WizardFooter,
  getColdcardAnimation,
  isColdcardModel,
  parseArmoredSignature,
} from '@hoseki/packages/ui/wallet-ui'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { SigningFlowProps } from '../../../lib/claim-flow'
import { trpc } from '../../../trpc'
import type { ChallengeMessageDto, ClaimDto } from '../../../trpc/server-types'
import { GenericError } from '../../errors/generic-error'
import { BBQrDisplay } from '../../qr/bbqr-display'
import { BBQrScanner } from '../../qr/bbqr-scanner'
import { ColdcardModelImage, Step7 } from './coldcard-steps'

/** Convert `m/84'/0'/0'/0/0` → `m/84h/0h/0h/0/0` for Coldcard Q. */
function toColdcardPath(path: string): string {
  return path.replace(/'/g, 'h')
}

type ColdcardQrSigningProps = Omit<SigningFlowProps, 'challenge'> & {
  /** Only `id` is required; full ChallengeDto is accepted but not needed. */
  challenge: { id: string }
  /** When provided, the scan step calls this instead of the built-in single-sig mutations. */
  onSubmitSignature?: (signature: string) => Promise<void>
}

export function ColdcardQrSigning({
  claim,
  keystore,
  challenge,
  challengeMessage,
  onExitSigning,
  onSigningComplete,
  onSubmitSignature,
}: ColdcardQrSigningProps): JSX.Element {
  const [step, setStep] = useState(1)
  const onBack = (): void => {
    setStep((prev) => prev - 1)
  }
  const onNext = (): void => {
    setStep((prev) => prev + 1)
  }
  const model: ColdcardModel =
    keystore.model != null && keystore.model !== '' && isColdcardModel(keystore.model) ? keystore.model : 'Q'

  if (!keystore.derivationPath) {
    return <Alert status="error">Derivation path not found</Alert>
  }
  const signingPath = `${keystore.derivationPath}/0/0`

  switch (step) {
    case 1:
      return <Step7 onBack={onExitSigning} onNext={onNext} />
    case 2:
      return <QrSignIntro model={model} onBack={onBack} onNext={onNext} />
    case 3:
      return (
        <QrSignDisplayMessage
          model={model}
          messageTextToSign={challengeMessage.signedMessage.messageTextToSign}
          signingPath={signingPath}
          address={Address.fromCheckedString(challengeMessage.signedMessage.address)}
          onBack={onBack}
          onNext={onNext}
        />
      )
    case 4:
      return <QrSignConfirmOnDevice model={model} onBack={onBack} onNext={onNext} />
    case 5:
      return (
        <QrSignScanSignature
          model={model}
          claim={claim}
          challenge={challenge}
          challengeMessage={challengeMessage}
          onBack={onBack}
          onSigningComplete={onSigningComplete}
          onSubmitSignature={onSubmitSignature}
        />
      )
    default:
      return <GenericError title="Unexpected error" message="Invalid step" />
  }
}

// ---------------------------------------------------------------------------
// QR Sign Step 1: Intro
// ---------------------------------------------------------------------------

function QrSignIntro({
  model,
  onBack,
  onNext,
  ...rest
}: { model: ColdcardModel; onBack: () => void; onNext: () => void } & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardSignMessage')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Proving Control With Your COLDCARD Q
      </Text>

      <Text textStyle="text/md" color="neutral.900">
        You'll sign a unique message by scanning a QR code with your COLDCARD Q. No file downloads needed.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        This lets us confirm you control the private key for the Bitcoin you're claiming — without ever needing to see
        your key.
      </Text>

      <NavigationArrows onBack={onBack} onForward={onNext} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// QR Sign Step 2: Display Message QR
// ---------------------------------------------------------------------------

function QrSignDisplayMessage({
  model,
  messageTextToSign,
  signingPath,
  address,
  onBack,
  onNext,
  ...rest
}: {
  model: ColdcardModel
  messageTextToSign: string
  signingPath: string
  address: Address
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  // Use the Sparrow-compatible "signmessage" format that the Coldcard Q
  // firmware recognises natively when scanned from the main QR scanner.
  // Format: "signmessage <derivation-path> ascii:<message>"
  const signingQrValue = useMemo(
    () => `signmessage ${toColdcardPath(signingPath)} ascii:${messageTextToSign}`,
    [signingPath, messageTextToSign],
  )

  return (
    <Stack gap={4} alignItems="center" {...rest}>
      <ColdcardModelImage model={model} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900" textAlign="center">
        Scan This Message With Your COLDCARD Q
      </Text>
      <Text textStyle="text/md" color="neutral.900" textAlign="center">
        From the main menu on your COLDCARD Q, press the{' '}
        <Text as="span" fontWeight={600}>
          QR
        </Text>{' '}
        button and point the camera at this QR code:
      </Text>

      <BBQrDisplay value={signingQrValue} size={280} />

      <Accordion allowToggle w="100%">
        <AccordionItem>
          <h2>
            <AccordionButton>
              Signing Details
              <AccordionIcon />
            </AccordionButton>
          </h2>
          <AccordionPanel>
            <SignAddressAndMessageInfo
              messageTextToSign={messageTextToSign}
              address={address}
              signingPath={signingPath}
            />
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Next</Button>}
      />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// QR Sign Step 3: Confirm on Device
// ---------------------------------------------------------------------------

function QrSignConfirmOnDevice({
  model,
  onBack,
  onNext,
  ...rest
}: { model: ColdcardModel; onBack: () => void; onNext: () => void } & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation={getColdcardAnimation(model, 'coldcardSignTextFile')} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
        Confirm and Sign on Your COLDCARD Q
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Review the message and address on your COLDCARD Q screen, then press{' '}
        <Text as="span" fontWeight={600}>
          ENTER
        </Text>{' '}
        to sign.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        After signing, your COLDCARD Q will display a QR code containing the signature. Click 'Ready to Scan' when it
        appears.
      </Text>

      <WizardFooter
        leftButton={
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        }
        rightButton={<Button onClick={onNext}>Ready to Scan</Button>}
      />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// QR Sign Step 4: Scan Signature
// ---------------------------------------------------------------------------

function QrSignScanSignature({
  model,
  claim: _claim,
  challenge,
  challengeMessage,
  onBack,
  onSigningComplete,
  onSubmitSignature,
  ...rest
}: {
  model: ColdcardModel
  claim: ClaimDto
  challenge: { id: string }
  challengeMessage: ChallengeMessageDto
  onBack: () => void
  onSigningComplete: () => void
  onSubmitSignature?: (signature: string) => Promise<void>
} & StackProps): JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const completeChallengeMessageMutation = trpc.portalProve.registry.challengeMessages.complete.useMutation()
  const completeChallengeMutation = trpc.portalProve.registry.challenges.complete.useMutation()

  async function submitSignature(signature: string): Promise<void> {
    setIsSubmitting(true)
    try {
      if (onSubmitSignature) {
        await onSubmitSignature(signature)
      } else {
        await completeChallengeMessageMutation.mutateAsync({
          signedMessageId: challengeMessage.signedMessage.id,
          signature,
        })
        await completeChallengeMutation.mutateAsync({ challengeId: challenge.id })
        onSigningComplete()
      }
    } catch {
      toast.error('The signing process did not complete successfully.')
      setIsSubmitting(false)
    }
  }

  function handleBBQrComplete(data: Uint8Array): void {
    const text = new TextDecoder().decode(data)
    extractAndSubmitSignature(text)
  }

  function handlePlainScan(text: string): void {
    extractAndSubmitSignature(text)
  }

  function extractAndSubmitSignature(text: string): void {
    const result = parseArmoredSignature(text)
    if (result.isOk()) {
      void submitSignature(result.unwrap().signature)
    } else {
      toast.error('Invalid signature', { description: result.unwrapErr().message })
    }
  }

  return (
    <Stack gap={4} alignItems="center" {...rest}>
      <ColdcardModelImage model={model} />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="neutral.900" textAlign="center">
        Scan the Signed Message
      </Text>
      <Text textStyle="text/md" color="neutral.900" textAlign="center">
        Hold your COLDCARD Q screen in front of your webcam to scan the signature.
      </Text>

      {isSubmitting ? (
        <Text textStyle="text/md" color="neutral.500">
          Verifying signature...
        </Text>
      ) : (
        <BBQrScanner
          onComplete={handleBBQrComplete}
          onPlainScan={handlePlainScan}
          onError={(msg) => {
            toast.error('Scanner error', { description: msg })
          }}
          onCancel={onBack}
        />
      )}
    </Stack>
  )
}
