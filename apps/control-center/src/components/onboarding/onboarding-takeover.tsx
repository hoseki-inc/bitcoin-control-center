import {
  Box,
  Button,
  Flex,
  Modal,
  ModalContent,
  ModalHeader,
  Text,
  VisuallyHidden,
  useBreakpointValue,
  useToken,
} from '@chakra-ui/react'
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
import { EASE_IN, EASE_OUT, TURN_IN_S, TURN_OUT_S } from './onboarding-motion'
import { onboardingSteps } from './onboarding-steps'
import { StepDots } from './step-dots'

/** Fades in and out with the same timing as a step, instead of Chakra's scale, so the backdrop doesn't zoom. */
const FADE: HTMLMotionProps<'section'> = {
  initial: 'exit',
  animate: 'enter',
  exit: 'exit',
  variants: {
    enter: { opacity: 1, transition: { duration: TURN_IN_S, ease: EASE_OUT } },
    exit: { opacity: 0, transition: { duration: TURN_OUT_S, ease: EASE_IN } },
  },
}

const MotionBox = motion.create(Box)

/**
 * Footer buttons: touch-sized on phones. Each is as wide as its longer label ("Not Now", "Add
 * Account"), so nothing in the footer shifts on the last step. Chosen per breakpoint rather than as
 * responsive props, because the button theme's responsive sizes would override a responsive width.
 */
const PHONE_FOOTER = { size: 'md', secondaryMinW: '5.625rem', primaryMinW: '7.25rem' } as const
const DESKTOP_FOOTER = { size: 'sm', secondaryMinW: '5.125rem', primaryMinW: '6.5rem' } as const

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
 * up to the caller.
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
  const footer = useBreakpointValue({ base: PHONE_FOOTER, md: DESKTOP_FOOTER }, { ssr: false }) ?? DESKTOP_FOOTER
  const textTurn = reduceMotion ? FADE_TURN : TEXT_TURN
  const previewTurn = reduceMotion ? FADE_TURN : PREVIEW_TURN
  const primaryRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const [yellow] = useToken('colors', ['secondary.400'])
  const step = steps[index]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const goTo = (next: number): void => {
    setPage({ index: next, direction: next > index ? 1 : -1 })
  }

  // Back disappears on the first step; keep focus in the dialog when it does.
  // Opening is left to the dialog, which focuses itself.
  const shownIndex = useRef(index)
  useEffect(() => {
    if (shownIndex.current === index) {
      return
    }
    shownIndex.current = index
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
      // The dialog itself takes focus on open, so screen readers start at its title and no button
      // shows a focus ring before anyone has used the keyboard. Tab reaches the buttons.
      initialFocusRef={contentRef}
      motionPreset="none"
    >
      <ModalContent
        ref={contentRef}
        motionProps={FADE}
        sx={{ '&:focus-visible': { outline: 'none' } }}
        p={0}
        bg="neutral.50"
        // Brand yellow only: blue and orange belong to the old Hoseki theme.
        bgImage={`radial-gradient(60% 55% at 12% 8%, color-mix(in srgb, ${yellow} 55%, transparent) 0%, transparent 70%)`}
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
                    size={footer.size}
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
                  me={{ sm: 2 }}
                  mb={{ base: 2, sm: 0 }}
                >
                  <StepDots count={steps.length} current={index} />
                </Flex>
                <Flex gap={2} ms={{ base: 'auto', sm: 0 }}>
                  <Button variant="ghost" size={footer.size} minW={footer.secondaryMinW} onClick={onSkip}>
                    {isLast ? 'Not Now' : 'Skip'}
                  </Button>
                  <Button
                    ref={primaryRef}
                    size={footer.size}
                    minW={footer.primaryMinW}
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
