import { Box, Button, Flex, Modal, ModalContent, ModalHeader, Text, VisuallyHidden, useToken } from '@chakra-ui/react'
import { motion as motionTokens } from '@hoseki/packages/ui/design-system/animations/motion'
import { Logo } from '@hoseki/packages/ui/prove-verify-ui/logo'
import {
  AnimatePresence,
  type HTMLMotionProps,
  type Variants,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'framer-motion'
import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { isDesktop } from '../../mode'
import { onboardingSteps } from './onboarding-steps'
import { StepDots } from './step-dots'

/** Fades in and out instead of Chakra's scale, so the backdrop doesn't zoom. */
const FADE: HTMLMotionProps<'section'> = {
  initial: 'exit',
  animate: 'enter',
  exit: 'exit',
  variants: {
    enter: { opacity: 1, transition: { duration: motionTokens.revealMs / 1000, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: motionTokens.dismissMs / 1000, ease: 'easeIn' } },
  },
}

const MotionBox = motion.create(Box)

/** The design system's ease-out curve, as framer-motion takes it. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const EASE_IN = [0.4, 0, 1, 1] as const
const TURN_IN_S = 0.5
const TURN_OUT_S = 0.22

/**
 * How a step turns over: the old one softens and eases away as the new one drifts in from the
 * direction of travel and settles. `direction` is 1 going forward and -1 going back.
 */
function turnVariants({ distance, blur, delay }: { distance: number; blur: number; delay: number }): Variants {
  return {
    enter: (direction: number) => ({ opacity: 0, x: direction * distance, filter: `blur(${blur}px)` }),
    center: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { duration: TURN_IN_S, ease: EASE_OUT, delay },
    },
    exit: (direction: number) => ({
      opacity: 0,
      x: (direction * -distance) / 2,
      filter: `blur(${blur}px)`,
      transition: { duration: TURN_OUT_S, ease: EASE_IN },
    }),
  }
}

// The preview travels a little further and later than the text, for a touch of depth.
const TEXT_TURN = turnVariants({ distance: 12, blur: 4, delay: 0.04 })
const PREVIEW_TURN = turnVariants({ distance: 32, blur: 6, delay: 0.1 })
/** With reduced motion, steps simply cross-fade. */
const FADE_TURN: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: motionTokens.revealMs / 1000, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: motionTokens.dismissMs / 1000, ease: EASE_IN } },
}

/** One step's text or preview as it turns over. A step on its way out is hidden from assistive technology. */
function StepLayer(props: ComponentProps<typeof MotionBox>): JSX.Element {
  const isPresent = useIsPresent()
  return (
    <MotionBox initial="enter" animate="center" exit="exit" aria-hidden={isPresent ? undefined : true} {...props} />
  )
}

/** The step's title. Only the step on screen labels the dialog; one on its way out is plain text. */
function StepTitle({ children }: { children: ReactNode }): JSX.Element {
  const isPresent = useIsPresent()
  return isPresent ? (
    <ModalHeader as="h2" pe={0}>
      {children}
    </ModalHeader>
  ) : (
    <Text as="h2" textStyle="text/xl" fontWeight="medium">
      {children}
    </Text>
  )
}

/**
 * The full-screen introduction for a new installation: what Control Center does, how it handles
 * wallets and data, and what to have ready before adding the first account. Saving the choice is
 * up to the caller, so Settings can show it again without changing anything.
 */
export function OnboardingTakeover({
  isOpen,
  onSkip,
  onAddAccount,
  desktop = isDesktop,
}: {
  isOpen: boolean
  /** Skip, Not Now and Escape all close it. */
  onSkip: () => void
  onAddAccount: () => void
  desktop?: boolean
}): JSX.Element {
  const steps = useMemo(() => onboardingSteps(desktop), [desktop])
  const [{ index, direction }, setPage] = useState({ index: 0, direction: 1 })
  const reduceMotion = useReducedMotion() === true
  const textTurn = reduceMotion ? FADE_TURN : TEXT_TURN
  const previewTurn = reduceMotion ? FADE_TURN : PREVIEW_TURN
  const primaryRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const [yellow, blue, orange] = useToken('colors', ['secondary.400', 'primary.300', 'tertiary.300'])
  const step = steps[Math.min(index, steps.length - 1)]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  useEffect(() => {
    if (isOpen) {
      setPage({ index: 0, direction: 1 })
    }
  }, [isOpen])

  const goTo = (next: number): void => {
    setPage({ index: next, direction: next > index ? 1 : -1 })
  }

  // Back and Skip disappear on the first and last steps; keep focus in the dialog when they do.
  useEffect(() => {
    if (contentRef.current?.contains(document.activeElement) !== true) {
      primaryRef.current?.focus()
    }
  }, [index])

  if (step === undefined) {
    return <></>
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onSkip}
      size="full"
      closeOnOverlayClick={false}
      initialFocusRef={primaryRef}
      motionPreset="none"
    >
      <ModalContent
        ref={contentRef}
        motionProps={FADE}
        p={0}
        bg="neutral.50"
        bgImage={[
          `radial-gradient(60% 55% at 12% 8%, color-mix(in srgb, ${yellow} 55%, transparent) 0%, transparent 70%)`,
          `radial-gradient(50% 50% at 92% 92%, color-mix(in srgb, ${blue} 22%, transparent) 0%, transparent 70%)`,
          `radial-gradient(40% 40% at 88% 10%, color-mix(in srgb, ${orange} 16%, transparent) 0%, transparent 70%)`,
        ].join(', ')}
      >
        {/* Phones get the whole screen: the preview over the gradient, with a sheet of text and
            controls at the bottom within thumb reach. Larger screens float a card. */}
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap={{ base: 0, md: 8 }}
          minH="100dvh"
          px={{ base: 0, md: 4 }}
          py={{ base: 0, md: 10 }}
        >
          <Box display={{ base: 'none', md: 'block' }}>
            <Logo />
          </Box>
          <Box
            display="grid"
            gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: '5fr 6fr' }}
            gridTemplateRows={{ base: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr)' }}
            w="full"
            maxW={{ md: '960px' }}
            // Short laptop screens shrink the card rather than scroll it.
            h={{ base: '100dvh', md: 'clamp(400px, calc(100dvh - 144px), 560px)' }}
            bg={{ md: 'shades.0' }}
            borderStyle="solid"
            borderWidth={{ base: 0, md: '1px' }}
            borderColor="neutral.200"
            borderRadius={{ md: 'dialog' }}
            boxShadow={{ md: 'floating' }}
            overflow="hidden"
          >
            <Flex
              direction="column"
              gap={{ base: 6, md: 8 }}
              p={{ base: 6, md: 10 }}
              pb={{ base: 'max(24px, env(safe-area-inset-bottom))', md: 10 }}
              minW={0}
              bg="shades.0"
              borderTopRadius={{ base: 'dialog', md: 0 }}
              borderStyle="solid"
              borderWidth={0}
              borderTopWidth={{ base: '1px', md: 0 }}
              borderColor="neutral.200"
            >
              {/* One grid cell, so the outgoing and incoming text overlap as they cross. On phones it
                  keeps room for the longest step, so the preview above doesn't resize between steps. */}
              <Box display="grid" minH={{ base: '8.5rem', md: 0 }}>
                <AnimatePresence initial={false} custom={direction}>
                  <StepLayer key={step.id} custom={direction} variants={textTurn} gridArea="1 / 1">
                    <StepTitle>{step.title}</StepTitle>
                    <Text textStyle="text/md" color="neutral.600" mt={2}>
                      {step.body}
                    </Text>
                  </StepLayer>
                </AnimatePresence>
              </Box>
              <VisuallyHidden aria-live="polite">
                Step {index + 1} of {steps.length}
              </VisuallyHidden>
              <Flex align="center" gap={2} mt="auto" flexWrap="wrap">
                {!isFirst && (
                  <Button
                    variant="ghost"
                    size={{ base: 'md', md: 'sm' }}
                    onClick={() => {
                      goTo(index - 1)
                    }}
                  >
                    Back
                  </Button>
                )}
                <Flex
                  order={{ base: -1, sm: 0 }}
                  w={{ base: 'full', sm: 'auto' }}
                  justify="center"
                  ms={{ sm: 'auto' }}
                  me={{ sm: 3 }}
                  mb={{ base: 2, sm: 0 }}
                >
                  <StepDots count={steps.length} current={index} />
                </Flex>
                <Flex gap={2} ms={{ base: 'auto', sm: 0 }}>
                  <Button variant="ghost" size={{ base: 'md', md: 'sm' }} onClick={onSkip}>
                    {isLast ? 'Not Now' : 'Skip'}
                  </Button>
                  <Button
                    ref={primaryRef}
                    size={{ base: 'md', md: 'sm' }}
                    onClick={() => {
                      if (isLast) {
                        onAddAccount()
                      } else {
                        goTo(index + 1)
                      }
                    }}
                  >
                    {isLast ? 'Add Account' : 'Continue'}
                  </Button>
                </Flex>
              </Flex>
            </Flex>
            <Flex
              direction="column"
              order={{ base: -1, md: 0 }}
              minH={0}
              pt={{ base: 'env(safe-area-inset-top)', md: 0 }}
              bg={{ md: 'neutral.50' }}
              borderStyle="solid"
              borderColor="neutral.200"
              borderWidth={0}
              borderLeftWidth={{ md: '1px' }}
              overflow="hidden"
              // A picture of the app, described by the text beside it. Only its charts answer the
              // pointer, and nothing in it takes keyboard focus.
              aria-hidden
              pointerEvents="none"
            >
              <Box display={{ base: 'block', md: 'none' }} pt={5}>
                <Logo />
              </Box>
              <Box position="relative" flex={1} minH={0}>
                <AnimatePresence initial={false} custom={direction}>
                  <StepLayer key={step.id} custom={direction} variants={previewTurn} position="absolute" inset={0}>
                    {step.preview}
                  </StepLayer>
                </AnimatePresence>
              </Box>
            </Flex>
          </Box>
        </Flex>
      </ModalContent>
    </Modal>
  )
}
