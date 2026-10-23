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
import { type ReactNode, useEffect, useId, useState } from 'react'
import { baseTrpc } from '../trpc'
import { PinCircles, type PinCirclesState, successAnimationMs } from './pin-circles'
import {
  MISMATCH_MESSAGE,
  type PinRecovery,
  UMBREL_RESET_COMMAND,
  UNREACHABLE_MESSAGE,
  saveMessage,
  waitMessage,
  wrongPinMessage,
} from './pin-messages'

// Long enough to see the circles shake red before the next try.
const FEEDBACK_MS = 560

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Milliseconds left until `until`, ticking while it runs; zero once it passes. */
function useTimeLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) {
      return
    }
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 250)
    return (): void => {
      clearInterval(timer)
    }
  }, [until])
  return until === null ? 0 : Math.max(0, until - now)
}

/** The full-screen frame every PIN screen shares: logo, heading, then the screen's own content. */
export function PinScreen({
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

function PinMessage({ id, message, isError }: { id: string; message: string; isError: boolean }): JSX.Element {
  return (
    <Text
      id={id}
      aria-live="polite"
      minH="22px"
      mt={-4}
      textStyle="text/sm"
      textAlign="center"
      color={isError ? 'error.700' : 'neutral.600'}
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {message}
    </Text>
  )
}

interface PinEntry {
  value: string
  setValue: (value: string) => void
  state: PinCirclesState
  shake: number
  message: string
  isError: boolean
  /** Shakes red, shows the message, then clears for another try. */
  reject: (message: string) => Promise<void>
  accept: () => Promise<void>
  showMessage: (message: string, isError: boolean) => void
  setState: (state: PinCirclesState) => void
}

function usePinEntry(): PinEntry {
  const [value, setValue] = useState('')
  const [state, setState] = useState<PinCirclesState>('idle')
  const [shake, setShake] = useState(0)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  return {
    value,
    setValue: (next) => {
      if (next.length > 0 && isError) {
        setMessage('')
        setIsError(false)
      }
      setValue(next)
    },
    state,
    shake,
    message,
    isError,
    reject: async (text) => {
      setState('error')
      setShake((count) => count + 1)
      setMessage(text)
      setIsError(true)
      await wait(FEEDBACK_MS)
      setValue('')
      setState('idle')
    },
    accept: async () => {
      setState('success')
      setMessage('')
      await wait(successAnimationMs())
    },
    showMessage: (text, error) => {
      setMessage(text)
      setIsError(error)
    },
    setState,
  }
}

type PinOutcome = Awaited<ReturnType<typeof baseTrpc.auth.signIn.mutate>>

/**
 * Applies a wrong-PIN or delay answer to the entry. Returns when the next attempt may start,
 * or null if the PIN was accepted.
 */
async function handleOutcome(entry: PinEntry, outcome: PinOutcome): Promise<number | null> {
  if (outcome.ok) {
    return null
  }
  if (outcome.reason === 'wait') {
    entry.setValue('')
    entry.setState('waiting')
    return Date.now() + outcome.retryAfterMs
  }
  await entry.reject(wrongPinMessage(outcome.freeAttemptsLeft))
  if (outcome.retryAfterMs !== null) {
    entry.setState('waiting')
    return Date.now() + outcome.retryAfterMs
  }
  return Date.now()
}

interface CheckedPin {
  entry: PinEntry
  /** Time left in a wrong-PIN delay. */
  waitingFor: number
  submit: (pin: string) => void
}

/** Shared by sign-in and the Change PIN dialog: entering a PIN Sentinel checks, with its delays. */
export function useCheckedPin(
  check: (pin: string) => Promise<PinOutcome>,
  onAccepted: () => void,
  initialRetryAfterMs: number | null,
): CheckedPin {
  const entry = usePinEntry()
  const [retryAt, setRetryAt] = useState<number | null>(() =>
    initialRetryAfterMs === null ? null : Date.now() + initialRetryAfterMs,
  )
  const waitingFor = useTimeLeft(retryAt)
  const busy = entry.state !== 'idle' && entry.state !== 'waiting'

  useEffect(() => {
    if (retryAt !== null && waitingFor > 0) {
      entry.setState('waiting')
      entry.showMessage(waitMessage(waitingFor), false)
    } else if (retryAt !== null) {
      setRetryAt(null)
      entry.setState('idle')
      entry.showMessage('', false)
    }
    // The entry's setters are stable in effect; only the countdown drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAt, waitingFor])

  const submit = (pin: string): void => {
    if (busy || waitingFor > 0) {
      return
    }
    entry.setState('checking')
    void check(pin)
      .then(async (outcome) => {
        if (outcome.ok) {
          await entry.accept()
          onAccepted()
          return
        }
        entry.setState('idle')
        const next = await handleOutcome(entry, outcome)
        if (next !== null && next > Date.now()) {
          setRetryAt(next)
        }
      })
      .catch(async () => {
        entry.setState('idle')
        await entry.reject(UNREACHABLE_MESSAGE)
      })
  }
  return { entry, waitingFor, submit }
}

export function SignInScreen({
  recovery,
  retryAfterMs,
  onSignedIn,
}: {
  recovery: PinRecovery
  retryAfterMs: number | null
  onSignedIn: () => void
}): JSX.Element {
  const messageId = useId()
  const [forgotOpen, setForgotOpen] = useState(false)
  const { entry, waitingFor, submit } = useCheckedPin(
    async (pin) => baseTrpc.auth.signIn.mutate({ pin }),
    onSignedIn,
    retryAfterMs,
  )
  return (
    <PinScreen title="Enter your PIN">
      <chakra.form
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden>
          <input type="text" name="username" autoComplete="username" value="Bitcoin Control Center" readOnly />
        </VisuallyHidden>
        <PinCircles
          value={entry.value}
          onChange={entry.setValue}
          onComplete={submit}
          state={entry.state === 'waiting' && waitingFor === 0 ? 'idle' : entry.state}
          shake={entry.shake}
          isDisabled={waitingFor > 0}
          autoComplete="current-password"
          label="PIN, 6 digits"
          describedBy={messageId}
        />
      </chakra.form>
      <PinMessage id={messageId} message={entry.message} isError={entry.isError} />
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
      <ForgotPinSheet
        isOpen={forgotOpen}
        onClose={() => {
          setForgotOpen(false)
        }}
        recovery={recovery}
      />
    </PinScreen>
  )
}

type SetupStep = { step: 'choose' } | { step: 'confirm'; first: string } | { step: 'save'; pin: string }

/** First PIN, chosen in the app: choose, confirm, then a nudge to save it. */
export function SetupScreen({
  recovery,
  onPinSet,
  onDone,
}: {
  recovery: PinRecovery
  /** The PIN is saved and this tab is signed in; the save step follows. */
  onPinSet: () => void
  onDone: () => void
}): JSX.Element {
  const messageId = useId()
  const entry = usePinEntry()
  const [setup, setSetup] = useState<SetupStep>({ step: 'choose' })

  if (setup.step === 'save') {
    return <SavePinScreen pin={setup.pin} recovery={recovery} onContinue={onDone} />
  }

  const complete = (pin: string): void => {
    if (setup.step === 'choose') {
      setSetup({ step: 'confirm', first: pin })
      entry.setValue('')
      return
    }
    if (pin !== setup.first) {
      void entry.reject(MISMATCH_MESSAGE).then(() => {
        setSetup({ step: 'choose' })
      })
      return
    }
    entry.setState('checking')
    void baseTrpc.auth.setFirstPin
      .mutate({ pin })
      .then(async () => {
        onPinSet()
        await entry.accept()
        setSetup({ step: 'save', pin })
      })
      .catch(async () => {
        entry.setState('idle')
        await entry.reject(UNREACHABLE_MESSAGE)
        setSetup({ step: 'choose' })
      })
  }

  const choosing = setup.step === 'choose'
  return (
    <PinScreen
      title={choosing ? 'Set up your PIN' : 'Enter it again'}
      description={
        choosing ? 'You’ll enter it each time you open Control Center.' : 'To make sure it’s the PIN you meant.'
      }
    >
      <chakra.form
        onSubmit={(event) => {
          event.preventDefault()
        }}
      >
        <VisuallyHidden>
          <input type="text" name="username" autoComplete="username" value="Bitcoin Control Center" readOnly />
        </VisuallyHidden>
        <PinCircles
          key={setup.step}
          value={entry.value}
          onChange={entry.setValue}
          onComplete={complete}
          state={entry.state}
          shake={entry.shake}
          autoComplete="new-password"
          label={choosing ? 'New PIN, 6 digits' : 'Confirm your PIN'}
          describedBy={messageId}
        />
      </chakra.form>
      <PinMessage id={messageId} message={entry.message} isError={entry.isError} />
    </PinScreen>
  )
}

function SavePinScreen({
  pin,
  recovery,
  onContinue,
}: {
  pin: string
  recovery: PinRecovery
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
    <PinScreen title="Save your PIN" description={saveMessage(recovery)}>
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

export function HttpsRequiredScreen(): JSX.Element {
  return (
    <PinScreen
      title="Open the HTTPS address"
      description="Control Center only accepts your PIN over HTTPS. In StartOS, open Bitcoin Control Center using an address that starts with https://."
    />
  )
}

const FORGOT_STEPS: Record<'startos' | 'umbrel' | 'none', ReactNode[]> = {
  startos: [
    'Open StartOS and go to Bitcoin Control Center.',
    'Choose Actions, then Set PIN.',
    'Come back here and enter your new PIN.',
  ],
  umbrel: [
    'Open the umbrelOS terminal (Settings, Advanced settings).',
    <>
      Run <Code wordBreak="break-all">{UMBREL_RESET_COMMAND}</Code>
    </>,
    'Restart Bitcoin Control Center, then set a new PIN.',
  ],
  none: [
    'Stop Sentinel.',
    <>
      Run <Code>node dist/cli.js reset-pin</Code> with the same data folder.
    </>,
    'Start Sentinel, then set a new PIN.',
  ],
}

/** Desktop: a small card that hands off to the computer's administrator prompt, which explains itself. */
function AdminResetCard({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): JSX.Element {
  const [resetting, setResetting] = useState(false)
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

function ForgotPinSheet({
  isOpen,
  onClose,
  recovery,
}: {
  isOpen: boolean
  onClose: () => void
  recovery: PinRecovery
}): JSX.Element {
  if (recovery === 'admin') {
    return <AdminResetCard isOpen={isOpen} onClose={onClose} />
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
              {FORGOT_STEPS[recovery].map((step, index) => (
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
