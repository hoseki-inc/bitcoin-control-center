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
  VisuallyHidden,
  keyframes,
  usePrefersReducedMotion,
  useToken,
} from '@chakra-ui/react'
import type { HTMLMotionProps } from 'framer-motion'
import type { LottieRefCurrentProps } from 'lottie-react'
// Lottie runs animation expressions with eval: only render bundled animations.
import Lottie from 'lottie-react'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import statementSheetAnimation from '../../assets/lottie-animations/statement-entrance-animation.json'

const CROSS_FADE = 'opacity 400ms ease-in-out'

/** Opens quickly, then fades out gently so the statement appears from behind it. */
const FADE: HTMLMotionProps<'div'> & HTMLMotionProps<'section'> = {
  initial: 'exit',
  animate: 'enter',
  exit: 'exit',
  variants: {
    enter: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: 1, ease: 'easeInOut' } },
  },
}

/**
 * Full-screen screen shown while a statement generates, with its progress in a ring that fills in to
 * a check when the statement is ready. `useStatementGeneration` decides what it shows and when it closes.
 */
export function StatementGenerationModal({
  isOpen,
  progress,
  isCompleted,
  onClose,
  finalFocusRef,
}: {
  isOpen: boolean
  /** 0–100. */
  progress: number
  isCompleted: boolean
  onClose: () => void
  /** Receives focus when the screen closes. */
  finalFocusRef: RefObject<HTMLElement>
}): JSX.Element {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null)
  const reduceMotion = usePrefersReducedMotion()
  // Once the sheet has drawn in, its gray placeholders shimmer while the statement generates.
  const [isSheetDrawn, setIsSheetDrawn] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const isShimmering = isSheetDrawn && !reduceMotion && !isCompleted
  useEffect(() => {
    if (isSheetDrawn) {
      staggerPlaceholders(sheetRef.current)
    }
  }, [isSheetDrawn])
  const headingId = useId()

  return (
    <Modal isOpen={isOpen} onClose={onClose} scrollBehavior="inside" size="full" finalFocusRef={finalFocusRef}>
      <ModalOverlay motionProps={FADE} />
      <ModalContent motionProps={FADE}>
        <ModalCloseButton right="auto" left={4} top={4} size="3xl" p={4} />
        <ModalBody display="flex" p={0} overflow="hidden">
          <Container display="flex" maxW="container.lg" pt={28} flexDirection="column" alignItems="center">
            <Flex flexDirection="column" alignItems="center" textAlign="center" minH="250px">
              <Box display="grid">
                <CrossFade isVisible={!isCompleted}>
                  <Text as="h1" id={headingId} textStyle="text/8xl" fontWeight="medium">
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
              <Box my={6}>
                <ProgressCheck
                  progress={progress}
                  isDone={isCompleted}
                  animate={!reduceMotion}
                  labelledBy={headingId}
                />
              </Box>
            </Flex>
            <Box
              ref={sheetRef}
              mt={16}
              data-shimmer={isShimmering ? '' : undefined}
              sx={{
                '&[data-shimmer] image:not([data-still]), &[data-shimmer] [fill^="url("]': {
                  animation: `${pulse} 2s ease-in-out infinite`,
                },
              }}
              boxShadow="0px 6px 12px 0px rgba(0, 0, 0, 0.11)"
              // Hidden during the delay too, so it doesn't show and then vanish before sliding in.
              animation={`${fadeInSlideUp} 1000ms ease-out 100ms both`}
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget) {
                  lottieRef.current?.play()
                }
              }}
            >
              <Lottie
                animationData={statementSheetAnimation}
                loop={false}
                autoplay={false}
                lottieRef={lottieRef}
                onComplete={() => {
                  setIsSheetDrawn(true)
                }}
                style={{ width: '100%', height: 'auto' }}
              />
            </Box>
          </Container>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

/** The green of the app's check animation (`greenCheckCircle`), so the two checks match. */
const CHECK_GREEN = '#059669'
const SIZE = 60
const RING_WIDTH = 6
const RADIUS = (SIZE - RING_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const CHECK_LENGTH = 34
/** How much of the ring the arc covers while it spins. */
const SPINNER_ARC = 0.25

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`

/**
 * A green ring that fills with progress, with the percentage inside. Before there's any progress, a
 * short arc spins instead. When done, the ring fills in to a solid disc and a white check draws
 * itself across it.
 */
function ProgressCheck({
  progress,
  isDone,
  animate,
  labelledBy,
}: {
  progress: number
  isDone: boolean
  animate: boolean
  /** The heading that names the progress. */
  labelledBy: string
}): JSX.Element {
  const [track] = useToken('colors', ['neutral.100'])
  const transition = (value: string): string => (animate ? value : 'none')
  const isWaiting = progress === 0 && !isDone
  return (
    <Box
      position="relative"
      w={`${SIZE}px`}
      h={`${SIZE}px`}
      // Keyframes only reach the page through Chakra's styles, not an inline style.
      sx={animate ? { '& [data-spinner]': { animation: `${spin} 1s linear infinite` } } : undefined}
    >
      {/* What assistive technology reads; the ring below is drawn for sight only. */}
      <VisuallyHidden>
        <progress value={progress} max={100} aria-labelledby={labelledBy} />
      </VisuallyHidden>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke={track} strokeWidth={RING_WIDTH} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={CHECK_GREEN}
          strokeWidth={RING_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - SPINNER_ARC)}
          data-spinner=""
          style={{
            transformOrigin: 'center',
            opacity: isWaiting ? 1 : 0,
            transition: transition('opacity 300ms ease-out'),
          }}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={CHECK_GREEN}
          strokeWidth={RING_WIDTH}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{
            opacity: isWaiting ? 0 : 1,
            transition: transition('stroke-dashoffset 300ms ease-out, opacity 300ms ease-out'),
          }}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={SIZE / 2}
          fill={CHECK_GREEN}
          style={{
            transformOrigin: 'center',
            transform: isDone ? 'scale(1)' : 'scale(0.8)',
            opacity: isDone ? 1 : 0,
            transition: transition('transform 350ms ease-out, opacity 200ms ease-out'),
          }}
        />
        <path
          d="M19 31 L26.5 38.5 L41 23"
          fill="none"
          stroke="white"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LENGTH}
          strokeDashoffset={isDone ? 0 : CHECK_LENGTH}
          style={{ transition: isDone ? transition('stroke-dashoffset 350ms ease-out 300ms') : 'none' }}
        />
      </svg>
      <Text
        position="absolute"
        inset={0}
        display="grid"
        placeItems="center"
        textStyle="text/sm"
        fontWeight="medium"
        opacity={isDone || isWaiting ? 0 : 1}
        transition={transition(isDone ? 'opacity 150ms ease-out' : 'opacity 300ms ease-out')}
        aria-hidden="true"
      >
        {progress}%
      </Text>
    </Box>
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

/**
 * The sheet's gray placeholders: its table rows and header bars are images, and its shaded boxes
 * gradient fills. Icons are images too, so `staggerPlaceholders` holds them still.
 */
const PLACEHOLDERS = 'image:not([data-still]), [fill^="url("]'

/** A gentle fade down and back, so each placeholder looks like it's filling in. */
const pulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
`

/** Gives each placeholder its own timing, so they shimmer separately; icons stay still. */
function staggerPlaceholders(sheet: HTMLElement | null): void {
  sheet?.querySelectorAll<SVGElement>(PLACEHOLDERS).forEach((element, index) => {
    // Lottie writes widths with a unit ("32px").
    if (element instanceof SVGImageElement && Number.parseFloat(element.getAttribute('width') ?? '0') <= 32) {
      element.dataset['still'] = ''
      return
    }
    element.style.animationDuration = `${1.6 + (index % 4) * 0.35}s`
    element.style.animationDelay = `${((index * 0.53) % 1.8).toFixed(2)}s`
  })
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
