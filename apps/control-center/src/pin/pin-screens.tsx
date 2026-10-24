import {
  Box,
  Button,
  Code,
  Flex,
  HStack,
  IconButton,
  ListItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  OrderedList,
  Stack,
  Text,
  VisuallyHidden,
  chakra,
} from '@chakra-ui/react'
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { setFirstPin, signIn } from './actions'
import type { PinPlatform } from './gate'
import { MISMATCH_MESSAGE, PinInput, usePinField } from './pin-field'

/** The full-screen frame every PIN screen shares: logo, heading, then the screen's own content. */
function PinScreen({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <Flex
      position="fixed"
      inset={0}
      bg="shades.0"
      direction="column"
      align="center"
      overflowY="auto"
      px={4}
      py={8}
      as="main"
      aria-labelledby="pin-screen-title"
    >
      <Stack spacing={8} align="center" w="full" maxW="380px" my="auto">
        <chakra.img src="/hoseki-logo-box.svg" alt="Bitcoin Control Center" w="52px" />
        <Stack spacing={2} textAlign="center">
          <Text as="h1" id="pin-screen-title" textStyle="text/2xl" fontWeight="medium" color="neutral.900">
            {title}
          </Text>
          {description !== undefined && (
            <Text textStyle="text/md" color="neutral.600" sx={{ textWrap: 'balance' }}>
              {description}
            </Text>
          )}
        </Stack>
        {children}
      </Stack>
    </Flex>
  )
}

export function SignInScreen({ platform, onSignedIn }: { platform: PinPlatform; onSignedIn: () => void }): JSX.Element {
  const field = usePinField()
  const [forgotOpen, setForgotOpen] = useState(false)
  return (
    <PinScreen title="Enter your PIN">
      <PinInput
        field={field}
        label="PIN, 6 digits"
        autoComplete="current-password"
        checksPin
        onComplete={(pin) => {
          void field
            .check(async () => signIn(pin))
            .then((result) => {
              if (result === 'accepted') {
                onSignedIn()
              }
            })
        }}
      />
      <chakra.button
        type="button"
        p={1.5}
        textStyle="text/sm"
        color="neutral.600"
        fontWeight="medium"
        textDecoration="underline"
        textDecorationColor="neutral.300"
        textUnderlineOffset="3px"
        borderRadius="sm"
        _hover={{ color: 'neutral.900' }}
        onClick={() => {
          setForgotOpen(true)
        }}
      >
        Forgot PIN?
      </chakra.button>
      <ForgotPin
        platform={platform}
        isOpen={forgotOpen}
        onClose={() => {
          setForgotOpen(false)
        }}
      />
    </PinScreen>
  )
}

/** First PIN, chosen in the app: choose, confirm, then a nudge to save it. */
export function SetupScreen({
  platform,
  onDone,
}: {
  platform: Exclude<PinPlatform, 'startos'>
  onDone: () => void
}): JSX.Element {
  const field = usePinField()
  const [step, setStep] = useState<
    { step: 'choose' } | { step: 'confirm'; first: string } | { step: 'save'; pin: string }
  >({ step: 'choose' })

  if (step.step === 'save') {
    return <SavePinScreen pin={step.pin} platform={platform} onContinue={onDone} />
  }

  const complete = (pin: string): void => {
    if (step.step === 'choose') {
      field.clear()
      setStep({ step: 'confirm', first: pin })
    } else if (pin !== step.first) {
      void field.reject(MISMATCH_MESSAGE).then(() => {
        setStep({ step: 'choose' })
      })
    } else {
      void field
        .check(async () => setFirstPin(pin))
        .then((result) => {
          // Unreachable, or another device set the PIN first: asking again moves to sign-in.
          setStep(result === 'accepted' ? { step: 'save', pin } : { step: 'choose' })
        })
    }
  }

  const choosing = step.step === 'choose'
  return (
    <PinScreen
      title={choosing ? 'Set up your PIN' : 'Enter it again'}
      description={
        choosing ? 'You’ll enter it each time you open Control Center.' : 'To make sure it’s the PIN you meant.'
      }
    >
      <PinInput
        field={field}
        stepKey={step.step}
        label={choosing ? 'New PIN, 6 digits' : 'Confirm your PIN'}
        autoComplete="new-password"
        onComplete={complete}
      />
    </PinScreen>
  )
}

function SavePinScreen({
  pin,
  platform,
  onContinue,
}: {
  pin: string
  platform: Exclude<PinPlatform, 'startos'>
  onContinue: () => void
}): JSX.Element {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => {
      setCopied(false)
    }, 2000)
    return (): void => {
      clearTimeout(timer)
    }
  }, [copied])

  return (
    <PinScreen
      title="Save your PIN"
      description={
        platform === 'desktop'
          ? 'Keep it in your password manager. If you forget it, you’ll need this computer’s administrator password to reset it.'
          : 'Keep it in your password manager. If you forget it, you’ll need to reset it from the umbrelOS terminal.'
      }
    >
      <HStack spacing={2}>
        <HStack
          spacing={2}
          px={4}
          h="48px"
          borderRadius="md"
          bg="neutral.100"
          fontFamily="mono"
          textStyle="text/xl"
          sx={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.3em' }}
          aria-label={shown ? `Your PIN, ${pin.split('').join(' ')}` : 'Your PIN, hidden'}
        >
          <Text as="span">{shown ? pin : '••••••'}</Text>
        </HStack>
        <IconButton
          variant="ghost"
          aria-label={shown ? 'Hide PIN' : 'Show PIN'}
          icon={shown ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
          onClick={() => {
            setShown((value) => !value)
          }}
        />
        <IconButton
          variant="ghost"
          aria-label="Copy PIN"
          icon={copied ? <CheckIcon size={20} /> : <CopyIcon size={20} />}
          onClick={() => {
            void navigator.clipboard
              .writeText(pin)
              .then(() => {
                setCopied(true)
              })
              .catch(() => undefined)
          }}
        />
        <VisuallyHidden aria-live="polite">{copied ? 'Copied' : ''}</VisuallyHidden>
      </HStack>
      <Button minW="200px" onClick={onContinue}>
        Continue
      </Button>
    </PinScreen>
  )
}

/** StartOS sets the first PIN from its Set PIN action, so the first visitor on the network can't choose it. */
export function StartOsSetupScreen(): JSX.Element {
  return (
    <PinScreen
      title="Set your PIN in StartOS"
      description="Open StartOS, go to Bitcoin Control Center, and run the Set PIN action. Then come back here."
    >
      <Box color="neutral.400" aria-hidden="true">
        <KeyRoundIcon size={28} />
      </Box>
    </PinScreen>
  )
}

/** Sentinel couldn't be asked whether a PIN is needed, so nothing opens until it answers. */
export function UnreachableScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }): JSX.Element {
  return (
    <PinScreen title="Couldn’t reach Control Center">
      <Button onClick={onRetry} isLoading={retrying}>
        Try again
      </Button>
    </PinScreen>
  )
}

export function InsecureScreen(): JSX.Element {
  return (
    <PinScreen
      title="Insecure connection not allowed"
      description="Open Control Center at an address that starts with https://, or over Tor."
    />
  )
}

const FORGOT_STEPS: Record<'startos' | 'umbrel', ReactNode[]> = {
  startos: [
    'Open StartOS and go to Bitcoin Control Center.',
    'Choose Actions, then Set PIN.',
    'Come back here and enter your new PIN.',
  ],
  umbrel: [
    'Open the umbrelOS terminal (Settings, Advanced settings).',
    <>
      Run{' '}
      <Code wordBreak="break-all">sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin</Code>
    </>,
    'Restart Bitcoin Control Center, then set a new PIN.',
  ],
}

/** StartOS and Umbrel: the steps to reset it on the server. Desktop: a small card that opens the computer's administrator prompt, which explains itself. */
function ForgotPin({
  platform,
  isOpen,
  onClose,
}: {
  platform: PinPlatform
  isOpen: boolean
  onClose: () => void
}): JSX.Element {
  const [resetting, setResetting] = useState(false)
  if (platform === 'desktop') {
    const desktopPin = window.desktop?.pin
    return (
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent mx={4} maxW="xs" borderRadius="panel">
          <ModalHeader textAlign="center" textStyle="text/lg" fontWeight="medium" pt={6} pb={4}>
            Forgot your PIN?
          </ModalHeader>
          <ModalFooter as={Stack} spacing={1} pt={0} pb={4}>
            {desktopPin && (
              <Button
                w="full"
                isLoading={resetting}
                onClick={() => {
                  setResetting(true)
                  // On success the app restarts to set a new PIN; a cancelled prompt leaves everything as it was.
                  void desktopPin
                    .resetPin()
                    .catch(() => false)
                    .finally(() => {
                      setResetting(false)
                    })
                }}
              >
                Reset PIN
              </Button>
            )}
            <Button w="full" variant="ghost" color="neutral.600" onClick={onClose}>
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    )
  }
  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="md">
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader textStyle="text/lg" fontWeight="medium">
          Reset your PIN
        </ModalHeader>
        <ModalBody>
          <Stack spacing={4}>
            <OrderedList spacing={2} textStyle="text/sm" color="neutral.900">
              {FORGOT_STEPS[platform].map((step, index) => (
                <ListItem key={index}>{step}</ListItem>
              ))}
            </OrderedList>
            <Text textStyle="text/sm" color="neutral.600">
              Your accounts and history stay as they are.
            </Text>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
