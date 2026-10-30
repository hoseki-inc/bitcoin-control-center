import {
  Box,
  Button,
  type ButtonProps,
  Code,
  Flex,
  type FlexProps,
  HStack,
  ListItem,
  OrderedList,
  Stack,
  Text,
  VisuallyHidden,
  chakra,
  useBreakpointValue,
  useToken,
} from '@chakra-ui/react'
import { Logo } from '@hoseki/packages/ui/prove-verify-ui/logo'
import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { EASE_OUT, TURN_IN_S, TURN_OUT_S } from '../components/onboarding/onboarding-motion'
import { BalancePreview } from '../components/onboarding/onboarding-previews'
import { StepDots } from '../components/onboarding/step-dots'
import { setFirstPin, signIn } from './actions'
import { type PinPlatform, currentEpoch } from './gate'
import { PinReadout } from './pin-circles'
import { MISMATCH_MESSAGE, PinInput, PinSteps, usePinField } from './pin-field'

/** The introduction's background, so moving from setup into the introduction shows no seam. */
function PinBackdrop(props: FlexProps): JSX.Element {
  const [yellow] = useToken('colors', ['secondary.400'])
  return (
    <Flex
      position="fixed"
      inset={0}
      direction="column"
      overflowY="auto"
      bg="neutral.50"
      bgImage={`radial-gradient(60% 55% at 12% 8%, color-mix(in srgb, ${yellow} 55%, transparent) 0%, transparent 70%)`}
      {...props}
    />
  )
}

/**
 * The background and logo around a screen's card. Setup is centered, to sit exactly where the introduction's card does.
 * Other screens hang from a fixed height, so the logo stays put as their card changes height.
 */
function PinStage({ centered = false, children }: { centered?: boolean; children: ReactNode }): JSX.Element {
  return (
    <PinBackdrop as="main" aria-labelledby="pin-screen-title">
      <Flex
        direction="column"
        align="center"
        justify={{ md: centered ? 'center' : 'flex-start' }}
        gap={{ base: 0, md: 8 }}
        minH="100dvh"
        px={{ base: 0, md: 4 }}
        pt={{ base: 0, md: centered ? 10 : 'max(40px, calc(50dvh - 252px))' }}
        pb={{ base: 0, md: 10 }}
      >
        <Box py={{ base: 5, md: 0 }}>
          <Logo />
        </Box>
        {children}
      </Flex>
    </PinBackdrop>
  )
}

/** Eases the card to its content's height as steps of different lengths turn over. */
function SmoothHeight({ children }: { children: ReactNode }): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion() === true
  const [height, setHeight] = useState<number | 'auto'>('auto')

  useLayoutEffect(() => {
    const content = contentRef.current
    if (content === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      setHeight(content.offsetHeight)
    })
    observer.observe(content)
    return (): void => {
      observer.disconnect()
    }
  }, [])

  return (
    <motion.div
      style={{ overflow: 'hidden' }}
      initial={false}
      animate={{ height }}
      transition={reduceMotion ? { duration: 0 } : { duration: TURN_IN_S, ease: EASE_OUT }}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  )
}

const CARD_SURFACE = {
  bg: 'shades.0',
  borderStyle: 'solid',
  borderColor: 'neutral.200',
  borderWidth: { base: 0, md: '1px' },
  borderTopWidth: '1px',
  borderTopRadius: 'dialog',
  borderBottomRadius: { md: 'dialog' },
  boxShadow: { md: 'floating' },
  overflow: 'hidden',
} as const

/** One floating card, as wide as the introduction's text panel. On phones, a sheet under the logo. */
function PinCard({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Box flex={{ base: 1, md: 'none' }} w="full" maxW={{ md: '436px' }} {...CARD_SURFACE}>
      <SmoothHeight>
        <Box p={{ base: 6, md: 10 }}>{children}</Box>
      </SmoothHeight>
    </Box>
  )
}

/** The screen's title. A screen with no PIN field takes focus here, so screen readers announce it on arrival. */
function PinTitle({ takesFocus = false, children }: { takesFocus?: boolean; children: ReactNode }): JSX.Element {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const isPresent = useIsPresent()
  useEffect(() => {
    if (takesFocus) {
      titleRef.current?.focus({ preventScroll: true })
    }
  }, [takesFocus])
  return (
    <Text
      as="h1"
      ref={titleRef}
      id={isPresent ? 'pin-screen-title' : undefined}
      tabIndex={takesFocus ? -1 : undefined}
      textStyle="text/xl"
      fontWeight="medium"
      color="neutral.900"
      sx={{ '&:focus': { outline: 'none' } }}
    >
      {children}
    </Text>
  )
}

function PinHeading({
  title,
  description,
  descriptionId,
  takesFocus,
}: {
  title: string
  description?: string
  descriptionId?: string
  takesFocus?: boolean
}): JSX.Element {
  return (
    <Box>
      <PinTitle takesFocus={takesFocus}>{title}</PinTitle>
      {description !== undefined && (
        <Text id={descriptionId} mt={2} textStyle="text/md" color="neutral.600" sx={{ textWrap: 'pretty' }}>
          {description}
        </Text>
      )}
    </Box>
  )
}

/** Touch-sized on phones, as in the introduction's footer. */
function useButtonSize(): 'md' | 'sm' {
  return useBreakpointValue<'md' | 'sm'>({ base: 'md', md: 'sm' }, { ssr: false }) ?? 'sm'
}

// Ghost buttons on the card's left edge line their text up with the title above.
const GHOST_INSET = { variant: 'ghost', ms: -4, color: 'neutral.600' } as const
const STACK_SPACING = { base: 6, md: 8 } as const

export function SignInScreen({ platform, onSignedIn }: { platform: PinPlatform; onSignedIn: () => void }): JSX.Element {
  const field = usePinField()
  const [forgot, setForgot] = useState(false)
  const buttonSize = useButtonSize()
  return (
    <PinStage>
      <PinCard>
        {/* Forward into Forgot PIN, and back out of it. */}
        <PinSteps step={forgot ? 'forgot' : 'enter'} direction={forgot ? 1 : -1}>
          {forgot ? (
            <ForgotPin
              platform={platform}
              onBack={() => {
                setForgot(false)
              }}
            />
          ) : (
            <Stack spacing={STACK_SPACING}>
              <PinHeading title="Enter your PIN" />
              <Box>
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
                <Button
                  {...GHOST_INSET}
                  size={buttonSize}
                  mt={2}
                  onClick={() => {
                    setForgot(true)
                  }}
                >
                  Forgot PIN?
                </Button>
              </Box>
            </Stack>
          )}
        </PinSteps>
      </PinCard>
    </PinStage>
  )
}

/** Labeled, and says so when it worked. */
function CopyButton({ value, label, ...props }: ButtonProps & { value: string; label: string }): JSX.Element {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    if (result === null) {
      return
    }
    const timer = setTimeout(() => {
      setResult(null)
    }, 2000)
    return (): void => {
      clearTimeout(timer)
    }
  }, [result])
  const text = result === 'copied' ? 'Copied' : result === 'failed' ? 'Couldn’t copy' : label
  return (
    <>
      <Button
        variant="outline"
        leftIcon={result === 'copied' ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setResult('copied')
            })
            .catch(() => {
              setResult('failed')
            })
        }}
        {...props}
      >
        {text}
      </Button>
      <VisuallyHidden aria-live="polite">{result === null ? '' : text}</VisuallyHidden>
    </>
  )
}

const SETUP_STEPS = ['choose', 'confirm', 'save'] as const

/**
 * First PIN, chosen in the app: choose, confirm, then a nudge to save it. It sits in the introduction's card at the same
 * place and size, beside the same sample portfolio, blurred, so the introduction opens over it with only the text
 * changing and the picture coming into focus. Never the user's data.
 */
export function SetupScreen({
  platform,
  pinWasReset,
  onDone,
}: {
  platform: Exclude<PinPlatform, 'startos'>
  pinWasReset: boolean
  onDone: () => void
}): JSX.Element {
  const field = usePinField()
  const descriptionId = useId()
  const reduceMotion = useReducedMotion() === true
  const buttonSize = useButtonSize()
  const showsPreview = useBreakpointValue({ base: false, md: true }, { ssr: false }) ?? true
  const [step, setStep] = useState<
    { step: 'choose' } | { step: 'confirm'; first: string } | { step: 'save'; pin: string }
  >({ step: 'choose' })
  const [direction, setDirection] = useState(1)
  const [leaving, setLeaving] = useState(false)

  const go = (next: typeof step, towards: 1 | -1 = 1): void => {
    setDirection(towards)
    setStep(next)
  }

  const complete = (pin: string): void => {
    if (step.step === 'choose') {
      field.clear()
      go({ step: 'confirm', first: pin })
    } else if (step.step === 'confirm' && pin !== step.first) {
      void field.reject(MISMATCH_MESSAGE).then(() => {
        go({ step: 'choose' }, -1)
      })
    } else {
      void field
        .check(async () => setFirstPin(pin))
        .then((result) => {
          // Unreachable, or another device set the PIN first: asking again moves to sign-in.
          go(result === 'accepted' ? { step: 'save', pin } : { step: 'choose' }, result === 'accepted' ? 1 : -1)
        })
    }
  }

  // The text leaves first, so nothing is left to collide with whatever comes next. A lock meanwhile drops it.
  const leave = (): void => {
    const epoch = currentEpoch()
    setLeaving(true)
    setTimeout(
      () => {
        if (currentEpoch() === epoch) {
          onDone()
        }
      },
      reduceMotion ? 0 : TURN_OUT_S * 1000,
    )
  }

  const choosing = step.step === 'choose'
  return (
    <PinStage centered>
      <Box
        display="grid"
        gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: '5fr 6fr' }}
        flex={{ base: 1, md: 'none' }}
        w="full"
        maxW={{ md: '960px' }}
        h={{ md: 'clamp(400px, calc(100dvh - 144px), 560px)' }}
        {...CARD_SURFACE}
      >
        <Flex direction="column" gap={STACK_SPACING} p={{ base: 6, md: 10 }} minW={0}>
          <PinSteps step={leaving ? null : step.step} direction={direction}>
            {step.step === 'save' ? (
              <SavePin pin={step.pin} platform={platform} />
            ) : (
              <Stack spacing={STACK_SPACING}>
                <PinHeading
                  title={choosing ? (pinWasReset ? 'Choose a new PIN' : 'Set up your PIN') : 'Confirm your PIN'}
                  description={
                    !choosing
                      ? 'Enter the same 6 digits again.'
                      : pinWasReset
                        ? 'Your PIN was reset. Your accounts and history are as you left them.'
                        : '6 digits you’ll enter each time you open Control Center.'
                  }
                  descriptionId={descriptionId}
                />
                <PinInput
                  field={field}
                  label={choosing ? 'New PIN, 6 digits' : 'Confirm your PIN'}
                  autoComplete="new-password"
                  descriptionId={descriptionId}
                  onComplete={complete}
                />
              </Stack>
            )}
          </PinSteps>
          <VisuallyHidden aria-live="polite">
            Step {SETUP_STEPS.indexOf(step.step) + 1} of {SETUP_STEPS.length}
          </VisuallyHidden>
          <Flex
            align="center"
            gap={4}
            mt="auto"
            opacity={leaving ? 0 : 1}
            transition={`opacity ${TURN_OUT_S * 1000}ms`}
            pointerEvents={leaving ? 'none' : undefined}
          >
            {step.step === 'confirm' && (
              <Button
                {...GHOST_INSET}
                size={buttonSize}
                onClick={() => {
                  field.clear()
                  go({ step: 'choose' }, -1)
                }}
              >
                Back
              </Button>
            )}
            <Box ms="auto">
              <StepDots count={SETUP_STEPS.length} current={SETUP_STEPS.indexOf(step.step)} />
            </Box>
            {step.step === 'save' && (
              <Button size={buttonSize} minW="6.5rem" isDisabled={leaving} onClick={leave}>
                Continue
              </Button>
            )}
          </Flex>
        </Flex>
        {showsPreview && (
          <Box
            position="relative"
            overflow="hidden"
            bg="neutral.50"
            borderLeft="1px solid"
            borderColor="neutral.200"
            aria-hidden
            // React 19 supports inert; the workspace still uses React 18 types.
            {...{ inert: true }}
          >
            <Box position="absolute" inset={0} filter="blur(10px)">
              <BalancePreview />
            </Box>
          </Box>
        )}
      </Box>
    </PinStage>
  )
}

function SavePin({ pin, platform }: { pin: string; platform: Exclude<PinPlatform, 'startos'> }): JSX.Element {
  const [shown, setShown] = useState(false)
  return (
    <Stack spacing={STACK_SPACING}>
      <PinHeading
        takesFocus
        title="Your PIN is set"
        description={
          platform === 'desktop'
            ? 'Keep a copy in your password manager. If you forget it, an administrator of this computer can reset it, keeping your accounts and history.'
            : 'Keep a copy in your password manager. If you forget it, you can reset it from the umbrelOS terminal, keeping your accounts and history.'
        }
      />
      <Stack spacing={3}>
        <PinReadout pin={pin} shown={shown} />
        <HStack spacing={2}>
          <Button
            flex={1}
            size="sm"
            variant="outline"
            leftIcon={shown ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            onClick={() => {
              setShown((value) => !value)
            }}
          >
            {shown ? 'Hide PIN' : 'Show PIN'}
          </Button>
          <CopyButton flex={1} size="sm" value={pin} label="Copy PIN" />
        </HStack>
      </Stack>
    </Stack>
  )
}

/** Shown while Sentinel is first asked whether a PIN is needed. */
export function PinLoadingScreen(): JSX.Element {
  return <PinBackdrop />
}

/** StartOS sets the first PIN from its Set PIN action, so the first visitor on the network can't choose it. */
export function StartOsSetupScreen(): JSX.Element {
  return (
    <PinStage>
      <PinCard>
        <Stack spacing={STACK_SPACING}>
          <Flex w={12} h={12} borderRadius="full" bg="neutral.100" color="neutral.700" align="center" justify="center">
            <KeyRoundIcon size={20} aria-hidden="true" />
          </Flex>
          <PinHeading
            takesFocus
            title="Set your PIN in StartOS"
            description="Open StartOS, go to Bitcoin Control Center, and run the Set PIN action. Then come back here."
          />
        </Stack>
      </PinCard>
    </PinStage>
  )
}

/** Sentinel couldn't be asked whether a PIN is needed, so nothing opens until it answers. */
export function UnreachableScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }): JSX.Element {
  const buttonSize = useButtonSize()
  return (
    <PinStage>
      <PinCard>
        <Stack spacing={STACK_SPACING}>
          <PinHeading
            takesFocus
            title="Couldn’t reach Control Center"
            description="Check that it’s running, then try again."
          />
          <Button alignSelf="flex-start" size={buttonSize} minW="6.5rem" onClick={onRetry} isLoading={retrying}>
            Try again
          </Button>
        </Stack>
      </PinCard>
    </PinStage>
  )
}

export function InsecureScreen(): JSX.Element {
  return (
    <PinStage>
      <PinCard>
        <PinHeading
          takesFocus
          title="Insecure connection not allowed"
          description="Open Control Center at an address that starts with https://, or over Tor."
        />
      </PinCard>
    </PinStage>
  )
}

const UMBREL_RESET_COMMAND = 'sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin'

const FORGOT_STEPS: Record<'startos' | 'umbrel', ReactNode[]> = {
  startos: [
    'Open StartOS and go to Bitcoin Control Center.',
    'Choose Actions, then Set PIN.',
    'Come back here and enter your new PIN.',
  ],
  umbrel: [
    'Open the umbrelOS terminal (Settings, Advanced settings).',
    <>
      Run this command:
      <Code display="block" mt={2} p={3} borderRadius="md" bg="neutral.100">
        {/* Wraps only between words, so a long name never looks like two when it's retyped. */}
        {UMBREL_RESET_COMMAND.split(' ').map((word, index) => (
          <Fragment key={index}>
            {index > 0 && ' '}
            <chakra.span whiteSpace="nowrap">{word}</chakra.span>
          </Fragment>
        ))}
      </Code>
      <CopyButton mt={2} size="sm" value={UMBREL_RESET_COMMAND} label="Copy command" />
    </>,
    'Restart Bitcoin Control Center, then set a new PIN right away.',
  ],
}

/** StartOS and Umbrel: the steps to reset it on the server, which stay here while they're followed. */
function ForgotPin({ platform, onBack }: { platform: PinPlatform; onBack: () => void }): JSX.Element {
  const buttonSize = useButtonSize()
  if (platform === 'desktop') {
    return <DesktopReset onBack={onBack} />
  }
  return (
    <Stack spacing={STACK_SPACING}>
      <PinHeading takesFocus title="Reset your PIN" description="Your accounts and history stay as they are." />
      <OrderedList spacing={3} ms={5} textStyle="text/sm" color="neutral.900">
        {FORGOT_STEPS[platform].map((step, index) => (
          <ListItem key={index}>{step}</ListItem>
        ))}
      </OrderedList>
      <Box>
        <Button {...GHOST_INSET} size={buttonSize} onClick={onBack}>
          Back
        </Button>
      </Box>
    </Stack>
  )
}

/** Says what's about to happen, since the computer's own administrator prompt doesn't explain it. */
function DesktopReset({ onBack }: { onBack: () => void }): JSX.Element {
  const desktopPin = window.desktop?.pin
  const buttonSize = useButtonSize()
  const [phase, setPhase] = useState<'ready' | 'asking' | 'refused' | 'restarting'>('ready')
  useEffect(
    () =>
      desktopPin?.onResetting(() => {
        setPhase('restarting')
      }),
    [desktopPin],
  )
  const busy = phase === 'asking' || phase === 'restarting'
  return (
    <Stack spacing={STACK_SPACING}>
      <PinHeading
        takesFocus
        title="Reset your PIN"
        description={
          desktopPin
            ? 'Your accounts and history stay as they are. Your computer will ask an administrator to confirm, then you’ll choose a new PIN.'
            : 'Your accounts and history stay as they are. Open the Bitcoin Control Center app on this computer to reset your PIN.'
        }
      />
      <Stack spacing={3}>
        <Text aria-live="polite" minH="20px" textStyle="text/sm" color="neutral.600">
          {phase === 'refused' && 'PIN not reset. Nothing changed.'}
          {phase === 'restarting' && 'PIN reset. Restarting Control Center…'}
        </Text>
        <Flex align="center" justify="space-between">
          <Button {...GHOST_INSET} size={buttonSize} isDisabled={busy} onClick={onBack}>
            Back
          </Button>
          {desktopPin && (
            <Button
              size={buttonSize}
              minW="6.5rem"
              isLoading={busy}
              onClick={() => {
                setPhase('asking')
                // On success the app restarts to set a new PIN; a cancelled prompt leaves everything as it was.
                void desktopPin
                  .resetPin()
                  .catch(() => false)
                  .then((reset) => {
                    if (!reset) {
                      setPhase('refused')
                    }
                  })
              }}
            >
              Reset PIN
            </Button>
          )}
        </Flex>
      </Stack>
    </Stack>
  )
}
