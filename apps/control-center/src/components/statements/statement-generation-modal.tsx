import {
  Box,
  Container,
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  Text,
  keyframes,
  usePrefersReducedMotion,
} from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system'
import { greenCheckCircle } from '@hoseki/packages/ui/prove-verify-ui'
import type { HTMLMotionProps } from 'framer-motion'
import type { LottieRefCurrentProps } from 'lottie-react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import statementSheetAnimation from '../../assets/lottie-animations/statement-entrance-animation.json'
import type { StatementDto } from '../../trpc/server-types'

/** How long "Statement Completed" stays up, including the check animation, before the screen fades out. */
export const COMPLETED_HOLD_MS = 1800

/** How long the sheet rests on its last frame before playing again while generation continues. */
export const SHEET_PAUSE_MS = 2500

const CROSS_FADE = 'opacity 400ms ease-in-out'

/** Opens quickly, then fades out gently so the statement appears from behind it. */
function fade(exitSeconds: number): HTMLMotionProps<'div'> & HTMLMotionProps<'section'> {
  return {
    initial: 'exit',
    animate: 'enter',
    exit: 'exit',
    variants: {
      enter: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
      exit: { opacity: 0, transition: { duration: exitSeconds, ease: 'easeInOut' } },
    },
  }
}

/**
 * Full-screen screen shown while a statement generates. See `useGenerationSequence`
 * for how the sheet animation, the green check and `onFinished` are timed.
 */
export function StatementGenerationModal({
  isOpen,
  status,
  onFinished,
  onClose,
  finalFocusRef,
}: {
  isOpen: boolean
  status: StatementDto['status']
  onFinished: () => void
  onClose: () => void
  /** Receives focus when the screen closes. */
  finalFocusRef: RefObject<HTMLElement>
}): JSX.Element {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null)
  const { onSheetEnd, isCompleted } = useGenerationSequence({
    status,
    replaySheet: !usePrefersReducedMotion(),
    replay: () => {
      lottieRef.current?.goToAndPlay(0, true)
    },
    onFinished,
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="full" finalFocusRef={finalFocusRef}>
      <ModalOverlay motionProps={fade(1)} />
      <ModalContent motionProps={fade(1)}>
        <ModalCloseButton right="auto" left={4} top={4} size="3xl" p={4} />
        <ModalBody display="flex" p={0} overflow="hidden">
          <Container display="flex" maxW="container.lg" pt={28} flexDirection="column" alignItems="center">
            <Flex flexDirection="column" alignItems="center" textAlign="center" h="250px">
              <Box display="grid">
                <CrossFade isVisible={!isCompleted}>
                  <Text as="h1" textStyle="text/8xl" fontWeight="medium">
                    Generating Your Statement
                  </Text>
                </CrossFade>
                <CrossFade isVisible={isCompleted}>
                  <Text as="h1" textStyle="text/8xl" fontWeight="medium">
                    Statement Completed
                  </Text>
                </CrossFade>
              </Box>
              <Text as="p" mt={6} textStyle="text/md" opacity={isCompleted ? 0 : 1} transition={CROSS_FADE}>
                This may take a few minutes. It will open here when it&apos;s ready. You can close this screen and come
                back to it from Statements.
              </Text>
              <Box my={6} display="grid" placeItems="center" h="60px" w="60px">
                <CrossFade isVisible={!isCompleted}>
                  <Spinner height="48px" width="48px" />
                </CrossFade>
                {isCompleted && (
                  <Box gridArea="1 / 1">
                    <Lottie
                      animationData={greenCheckCircle}
                      loop={false}
                      autoplay
                      style={{ width: '60px', height: '60px' }}
                    />
                  </Box>
                )}
              </Box>
            </Flex>
            <Box
              mt={16}
              boxShadow="0px 6px 12px 0px rgba(0, 0, 0, 0.11)"
              animation={`${fadeInSlideUp} 1000ms ease-out 100ms forwards`}
              onAnimationEnd={() => lottieRef.current?.play()}
            >
              <Lottie
                animationData={statementSheetAnimation}
                loop={false}
                autoplay={false}
                lottieRef={lottieRef}
                onComplete={onSheetEnd}
                style={{ width: '100%', height: 'auto' }}
              />
            </Box>
          </Container>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

/** Stacks its children in one grid cell with its siblings and fades them in or out. */
function CrossFade({ isVisible, children }: { isVisible: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <Box gridArea="1 / 1" opacity={isVisible ? 1 : 0} transition={CROSS_FADE} aria-hidden={!isVisible}>
      {children}
    </Box>
  )
}

interface GenerationSequence {
  /** Call when the sheet animation reaches its last frame. */
  onSheetEnd: () => void
  /** Whether to show "Statement Completed" and the green check. */
  isCompleted: boolean
}

/**
 * Times the end of generation. While the statement is generating, the sheet
 * rests on its last frame for `SHEET_PAUSE_MS` and then `replay` is called
 * (unless `replaySheet` is off, for reduced motion). Once the sheet is at rest
 * and generation has ended, a failed statement calls `onFinished` straight away;
 * a completed one sets `isCompleted` for `COMPLETED_HOLD_MS` first.
 */
export function useGenerationSequence({
  status,
  replaySheet,
  replay,
  onFinished,
}: {
  status: StatementDto['status']
  replaySheet: boolean
  replay: () => void
  onFinished: () => void
}): GenerationSequence {
  const [isAtRest, setIsAtRest] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)
  // Call the latest callbacks, not the ones from when the sheet started playing.
  const latest = useRef({ replay, onFinished })
  useEffect(() => {
    latest.current = { replay, onFinished }
  }, [replay, onFinished])
  useEffect(() => {
    if (!isAtRest) {
      return
    }
    if (status === 'completed') {
      setIsCompleted(true)
      return
    }
    if (status === 'failed') {
      latest.current.onFinished()
      return
    }
    if (!replaySheet) {
      return
    }
    const timer = window.setTimeout(() => {
      setIsAtRest(false)
      latest.current.replay()
    }, SHEET_PAUSE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [isAtRest, status, replaySheet])
  useEffect(() => {
    if (!isCompleted) {
      return
    }
    const timer = window.setTimeout(() => {
      latest.current.onFinished()
    }, COMPLETED_HOLD_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [isCompleted])
  return {
    onSheetEnd: () => {
      setIsAtRest(true)
    },
    isCompleted,
  }
}

const fadeInSlideUp = keyframes`
  0% {
    opacity: 0;
    transform: translateY(50px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
`
