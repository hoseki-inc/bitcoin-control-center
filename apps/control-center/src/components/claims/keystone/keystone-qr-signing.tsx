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
  NavigationArrows,
  SignAddressAndMessageInfo,
  WalletAnimation,
  WizardFooter,
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

/** Convert `m/84'/0'/0'/0/0` → `m/84h/0h/0h/0/0` for Sparrow-compatible signing. */
function toHardenedNotation(path: string): string {
  return path.replace(/'/g, 'h')
}

type KeystoneQrSigningProps = Omit<SigningFlowProps, 'challenge'> & {
  challenge: { id: string }
  onSubmitSignature?: (signature: string) => Promise<void>
}

export function KeystoneQrSigning({
  claim,
  keystore,
  challenge,
  challengeMessage,
  onExitSigning,
  onSigningComplete,
  onSubmitSignature,
}: KeystoneQrSigningProps): JSX.Element {
  const [step, setStep] = useState(1)
  const onBack = (): void => setStep((prev) => prev - 1)
  const onNext = (): void => setStep((prev) => prev + 1)

  if (!keystore.derivationPath) {
    return <Alert status="error">Derivation path not found</Alert>
  }
  const signingPath = `${keystore.derivationPath}/0/0`

  switch (step) {
    case 1:
      return <KeystoneSignIntro onBack={onExitSigning} onNext={onNext} />
    case 2:
      return (
        <KeystoneSignDisplayMessage
          messageTextToSign={challengeMessage.signedMessage.messageTextToSign}
          signingPath={signingPath}
          address={Address.fromCheckedString(challengeMessage.signedMessage.address)}
          onBack={onBack}
          onNext={onNext}
        />
      )
    case 3:
      return <KeystoneSignConfirmOnDevice onBack={onBack} onNext={onNext} />
    case 4:
      return (
        <KeystoneSignScanSignature
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
// Step 1: Intro
// ---------------------------------------------------------------------------

function KeystoneSignIntro({
  onBack,
  onNext,
  ...rest
}: { onBack: () => void; onNext: () => void } & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation="genericProveControl" />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="text.primary">
        Proving Control With Your Keystone
      </Text>

      <Text textStyle="text/md" color="text.primary">
        You'll sign a unique message by scanning a QR code with your Keystone. No cables or file downloads needed.
      </Text>
      <Text textStyle="text/md" color="text.primary">
        This lets us confirm you control the private key for the Bitcoin you're claiming — without ever needing to see
        your key.
      </Text>

      <NavigationArrows onBack={onBack} onForward={onNext} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Display Message QR
// ---------------------------------------------------------------------------

function KeystoneSignDisplayMessage({
  messageTextToSign,
  signingPath,
  address,
  onBack,
  onNext,
  ...rest
}: {
  messageTextToSign: string
  signingPath: string
  address: Address
  onBack: () => void
  onNext: () => void
} & StackProps): JSX.Element {
  const signingQrValue = useMemo(
    () => `signmessage ${toHardenedNotation(signingPath)} ascii:${messageTextToSign}`,
    [signingPath, messageTextToSign],
  )

  return (
    <Stack gap={4} alignItems="center" {...rest}>
      <WalletAnimation animation="keystoneQrAnimation" />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="text.primary" textAlign="center">
        Scan This Message With Your Keystone
      </Text>
      <Text textStyle="text/md" color="text.primary" textAlign="center">
        Open the QR scanner on your Keystone and point the camera at this QR code:
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
// Step 3: Confirm on Device
// ---------------------------------------------------------------------------

function KeystoneSignConfirmOnDevice({
  onBack,
  onNext,
  ...rest
}: { onBack: () => void; onNext: () => void } & StackProps): JSX.Element {
  return (
    <Stack gap={4} {...rest}>
      <WalletAnimation animation="keystoneQrAnimation" />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="text.primary">
        Confirm and Sign on Your Keystone
      </Text>
      <Text textStyle="text/md" color="text.primary">
        Review the message and address on your Keystone screen, then confirm to sign.
      </Text>
      <Text textStyle="text/md" color="text.primary">
        After signing, your Keystone will display a QR code containing the signature. Click 'Ready to Scan' when it
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
// Step 4: Scan Signature
// ---------------------------------------------------------------------------

function KeystoneSignScanSignature({
  claim,
  challenge,
  challengeMessage,
  onBack,
  onSigningComplete,
  onSubmitSignature,
  ...rest
}: {
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
      <WalletAnimation animation="keystoneQrAnimation" />

      <Text as="h2" textStyle="text/2xl" fontWeight="medium" color="text.primary" textAlign="center">
        Scan the Signed Message
      </Text>
      <Text textStyle="text/md" color="text.primary" textAlign="center">
        Hold your Keystone screen in front of your webcam to scan the signature.
      </Text>

      {isSubmitting ? (
        <Text textStyle="text/md" color="text.tertiary">
          Verifying signature...
        </Text>
      ) : (
        <BBQrScanner
          onComplete={handleBBQrComplete}
          onPlainScan={handlePlainScan}
          onError={(msg) => toast.error('Scanner error', { description: msg })}
          onCancel={onBack}
        />
      )}
    </Stack>
  )
}
