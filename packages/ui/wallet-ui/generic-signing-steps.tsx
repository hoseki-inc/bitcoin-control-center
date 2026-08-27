import { Box, Button, HStack, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import type { Address } from '../../bitcoin'
import type { HardwareDeviceError } from '../../wallet'
import { LabelWithTooltip, Spinner } from '../design-system'
import { HardwareWalletError } from './hardware-wallet-error'
import { NavigationArrows } from './navigation-arrows'
import { WaitingOnDevice } from './waiting-on-device'
import { WalletAnimation, type WalletAnimationType } from './wallet-animation'
import { WizardFooter } from './wizard-footer'

export function GenericSigningSteps(props: {
  walletType: WalletType
  signingAnimation: WalletAnimationType
  isLoading: boolean
  error?: Error | HardwareDeviceError | { message: string }
  signedMessage: { messageTextToSign: string; address: Address; signingPath: string | null }
  onProveControl: () => void
  onBack: () => void
  signingInProgress: boolean
}): JSX.Element {
  const [step, setStep] = useState<number>(1)

  const handleNext = () => setStep((prev) => Math.min(prev + 1, 3))
  const handleBack = () => setStep((prev) => Math.max(prev - 1, 1))

  if (props.isLoading) {
    return <Spinner fullPage />
  }

  return (
    <ControlledGenericSigningSteps
      {...props}
      step={step}
      onNext={handleNext}
      onBack={handleBack}
      onExit={props.onBack}
    />
  )
}

export function ControlledGenericSigningSteps({
  step,
  onNext,
  onBack,
  walletType,
  signingAnimation,
  isLoading,
  error,
  signedMessage,
  onProveControl,
  onExit,
  signingInProgress,
}: {
  step: number
  onNext: () => void
  onBack: () => void
  walletType: WalletType
  signingAnimation: WalletAnimationType
  isLoading: boolean
  error?: Error | HardwareDeviceError | { message: string }
  signedMessage: { messageTextToSign: string; address: Address; signingPath: string | null }
  onProveControl: () => void
  onExit: () => void
  signingInProgress: boolean
}): JSX.Element {
  if (isLoading) {
    return <Spinner fullPage />
  }

  return (
    <>
      {error && <HardwareWalletError error={error} mt={4} onRetry={() => window.location.reload()} />}

      {step === 1 && (
        <>
          <WalletAnimation animation="genericProveControl" />
          <SigningInfoStep1 />
        </>
      )}
      {[2, 3].includes(step) && (
        <>
          <WalletAnimation animation={signingAnimation} />
          {step === 2 && <SigningInfoStep2 walletType={walletType} />}
          {step === 3 && (
            <SignAddressAndMessageStep
              walletType={walletType}
              signingInProgress={signingInProgress}
              messageTextToSign={signedMessage.messageTextToSign}
              address={signedMessage.address}
              signingPath={signedMessage.signingPath}
            />
          )}
        </>
      )}
      <NavigationArrows onBack={step > 1 ? onBack : undefined} onForward={step < 3 ? onNext : undefined} />

      <WizardFooter
        leftButton={
          step === 1 && (
            <Button variant="outline" onClick={onExit}>
              Back
            </Button>
          )
        }
        rightButton={
          step === 3 && (
            <Button onClick={onProveControl} isDisabled={signingInProgress}>
              Prove Control
            </Button>
          )
        }
      />
    </>
  )
}

export function SigningInfoStep1(): JSX.Element {
  return (
    <>
      <Text textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Now that we've identified the Bitcoin you're claiming, the next step is proving control.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        Currently, your Bitcoin exists as anonymous, dormant savings. By proving control with Bitcoin Control Center,
        you unlock its potential—transforming your self-custodial Bitcoin into verifiable, private capital recognized by
        third parties.
      </Text>
    </>
  )
}

type WalletType = 'Ledger' | 'Trezor'

function SigningInfoStep2({ walletType }: { walletType: WalletType }) {
  return (
    <>
      <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
        Proving Control With Your {walletType}
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        You'll prove control by signing a unique message with your hardware wallet.
      </Text>
      <Text textStyle="text/md" color="neutral.900">
        This lets us confirm you control the private key for the Bitcoin you're claiming—without ever needing to see
        your key.
      </Text>
    </>
  )
}

export function SignAddressAndMessageStep({
  walletType,
  signingInProgress,
  messageTextToSign,
  address,
  signingPath,
}: {
  walletType: WalletType
  signingInProgress: boolean
  messageTextToSign: string
  address: Address
  signingPath: string | null
}): JSX.Element {
  return (
    <>
      <Stack>
        <Text as="h2" textStyle="text/2xl" color="neutral.900" fontWeight="medium">
          Proving Control With Your {walletType}
        </Text>
        <Text textStyle="text/md" mb={4}>
          Click 'Prove Control' to sign the unique message below on your device.
        </Text>
        <SignAddressAndMessageInfo messageTextToSign={messageTextToSign} address={address} signingPath={signingPath} />
      </Stack>

      {signingInProgress && <WaitingOnDevice mt={4} message="Waiting for device confirmation..." />}
    </>
  )
}

export function SignAddressAndMessageInfo({
  messageTextToSign,
  address,
  signingPath,
}: {
  messageTextToSign: string
  address: Address
  signingPath: string | null
}): JSX.Element {
  return (
    <Stack gap={4}>
      <Box>
        <LabelWithTooltip
          labelText="Message"
          tooltipText="A unique message you'll sign to prove control of your private key."
        />
        <Box
          border="1px solid"
          borderColor="neutral.200"
          p={2}
          borderRadius="md"
          bgColor="neutral.50"
          fontFamily="'Geist Mono', monospace"
          fontSize={12}
          h="75px"
        >
          <Text textStyle="text/xs" color="neutral.600">
            {messageTextToSign}
          </Text>
        </Box>
      </Box>
      <HStack>
        <Box w={signingPath ? '65%' : '100%'}>
          <LabelWithTooltip
            labelText="Address"
            tooltipText="A signed message requires an address (which acts as the public key) to verify which private key created it. We use the first receive address for this verification."
          />
          <Box
            border="1px solid"
            borderColor="neutral.200"
            p={2}
            borderRadius="md"
            bgColor="neutral.50"
            fontFamily="'Geist Mono', monospace"
            fontSize={12}
          >
            <Text textStyle="text/xs" color="neutral.600">
              {address.toString()}
            </Text>
          </Box>
        </Box>
        {signingPath && (
          <Box w="35%">
            <LabelWithTooltip
              labelText="Derivation path"
              tooltipText="The derivation path of the address you will be signing for"
            />
            <Box
              border="1px solid"
              borderColor="neutral.200"
              p={2}
              borderRadius="md"
              bgColor="neutral.50"
              fontFamily="'Geist Mono', monospace"
              fontSize={12}
            >
              <Text textStyle="text/xs" color="neutral.600">
                {signingPath}
              </Text>
            </Box>
          </Box>
        )}
      </HStack>
    </Stack>
  )
}
