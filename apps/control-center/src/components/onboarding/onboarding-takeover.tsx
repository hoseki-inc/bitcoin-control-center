import { Box, Button, Flex, Modal, ModalContent, ModalHeader, Text, VisuallyHidden, useToken } from '@chakra-ui/react'
import { motion, opacityReveal } from '@hoseki/packages/ui/design-system/animations/motion'
import { Logo } from '@hoseki/packages/ui/prove-verify-ui/logo'
import type { HTMLMotionProps } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isDesktop } from '../../mode'
import { onboardingSteps } from './onboarding-steps'
import { StepDots } from './step-dots'

/** Fades in and out instead of Chakra's scale, so the backdrop doesn't zoom. */
const FADE: HTMLMotionProps<'section'> = {
  initial: 'exit',
  animate: 'enter',
  exit: 'exit',
  variants: {
    enter: { opacity: 1, transition: { duration: motion.revealMs / 1000, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: motion.dismissMs / 1000, ease: 'easeIn' } },
  },
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
  const [index, setIndex] = useState(0)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const [yellow, blue, orange] = useToken('colors', ['secondary.400', 'primary.300', 'tertiary.300'])
  const step = steps[Math.min(index, steps.length - 1)]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  useEffect(() => {
    if (isOpen) {
      setIndex(0)
    }
  }, [isOpen])

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
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap={{ base: 6, md: 8 }}
          minH="100dvh"
          px={4}
          py={{ base: 6, md: 10 }}
        >
          <Logo />
          <Box
            display="grid"
            gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: '5fr 6fr' }}
            w="full"
            maxW="960px"
            h={{ md: '560px' }}
            bg="shades.0"
            border="1px solid"
            borderColor="neutral.200"
            borderRadius="dialog"
            boxShadow="floating"
            overflow="hidden"
          >
            <Flex direction="column" gap={8} p={{ base: 6, md: 10 }} minW={0}>
              <Box key={step.id} sx={opacityReveal}>
                <ModalHeader as="h2" pe={0}>
                  {step.title}
                </ModalHeader>
                <Text textStyle="text/md" color="neutral.600" mt={2}>
                  {step.body}
                </Text>
              </Box>
              <VisuallyHidden aria-live="polite">
                Step {index + 1} of {steps.length}
              </VisuallyHidden>
              <Flex align="center" gap={2} mt="auto" flexWrap="wrap">
                {!isFirst && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIndex(index - 1)
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
                  <Button variant="ghost" size="sm" onClick={onSkip}>
                    {isLast ? 'Not Now' : 'Skip'}
                  </Button>
                  <Button
                    ref={primaryRef}
                    size="sm"
                    onClick={() => {
                      if (isLast) {
                        onAddAccount()
                      } else {
                        setIndex(index + 1)
                      }
                    }}
                  >
                    {isLast ? 'Add Account' : 'Continue'}
                  </Button>
                </Flex>
              </Flex>
            </Flex>
            <Box
              position="relative"
              order={{ base: -1, md: 0 }}
              h={{ base: '220px', md: 'auto' }}
              bg="neutral.50"
              borderStyle="solid"
              borderColor="neutral.200"
              borderWidth={0}
              borderLeftWidth={{ md: '1px' }}
              borderBottomWidth={{ base: '1px', md: 0 }}
              overflow="hidden"
              // A picture of the app: its charts and controls can't be focused or used here.
              aria-hidden
              ref={(element: HTMLDivElement | null) => {
                if (element) {
                  element.inert = true
                }
              }}
              pointerEvents="none"
            >
              <Box key={step.id} position="absolute" inset={0} sx={opacityReveal}>
                {step.preview}
              </Box>
            </Box>
          </Box>
        </Flex>
      </ModalContent>
    </Modal>
  )
}
