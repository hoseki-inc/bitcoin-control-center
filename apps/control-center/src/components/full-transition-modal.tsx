import {
  Box,
  type BoxProps,
  Container,
  Flex,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalOverlay,
  type ModalProps,
  type StackProps,
  Text,
  keyframes,
} from '@chakra-ui/react'
import { Spinner } from '@hoseki/packages/ui/design-system'
import { greenCheckCircle } from '@hoseki/packages/ui/prove-verify-ui'
import type { LottieRefCurrentProps } from 'lottie-react'
import Lottie from 'lottie-react'
import { useEffect, useRef, useState } from 'react'
import { type TransitionState, useTransitionState } from 'react-transition-state'
import statementSheetAnimation from '../assets/lottie-animations/statement-entrance-animation.json'

export type FullTransitionModalStatus = 'pending' | 'completed' | 'failed'
type FullTransitionModalProps = {
  content: ReturnType<typeof getContent>
  status: FullTransitionModalStatus
  additionalCompletedContent: React.ReactNode
  hideStatementAnimation?: boolean
} & Omit<ModalProps, 'children'>

export function FullTransitionModal({
  content,
  status,
  additionalCompletedContent,
  hideStatementAnimation = false,
  ...props
}: FullTransitionModalProps): JSX.Element {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null)
  const [isStatementAnimationCompleted, setIsStatementAnimationCompleted] = useState(hideStatementAnimation)
  const { firstScreenState, secondScreenState } = useScreenTransition({
    isStarted:
      status !== 'pending' &&
      // wait until the sheet animation is finished before transitioning
      // to the second screen, this was a design decision.
      isStatementAnimationCompleted,
  })

  const { pendingContent, completedContent, failedContent } = content

  return (
    <Modal
      // prevents scroll inside the modal due to content
      // overflow together with overflow="hidden" on ModalBody
      scrollBehavior="inside"
      size="full"
      {...props}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalCloseButton right="auto" left={4} top={4} size="3xl" p={4} />
        <ModalBody display="flex" p={0} overflow="hidden">
          <Container display="flex" maxW="container.lg" pt={28} flexDirection="column" alignItems="center">
            <ScreenFadeTransition state={firstScreenState}>
              <ContentContainer>{pendingContent}</ContentContainer>
            </ScreenFadeTransition>

            {!hideStatementAnimation && (
              <ScreenFadeTransition state={firstScreenState} mt={16}>
                <Box
                  boxShadow="0px 6px 12px 0px rgba(0, 0, 0, 0.11)"
                  animation={`${fadeInSlideUp} 1000ms ease-out 100ms forwards`}
                  onAnimationEnd={() => lottieRef.current?.play()}
                >
                  <Lottie
                    animationData={statementSheetAnimation}
                    loop={false}
                    autoplay={false}
                    lottieRef={lottieRef}
                    onComplete={() => {
                      setIsStatementAnimationCompleted(true)
                    }}
                    style={{
                      width: '100%',
                      height: 'auto',
                    }}
                  />
                </Box>
              </ScreenFadeTransition>
            )}

            <ScreenFadeTransition state={secondScreenState}>
              <ContentContainer>
                {status === 'completed' && (
                  <>
                    {completedContent}
                    {additionalCompletedContent}
                  </>
                )}
                {status === 'failed' && failedContent}
              </ContentContainer>
            </ScreenFadeTransition>
          </Container>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

/**
 * Returns the content for the three states: pending, completed, and failed.
 * Keeps the statement-generation copy in one place for the modal.
 */
export function getContent(): {
  pendingContent: JSX.Element
  completedContent: JSX.Element
  failedContent: JSX.Element
} {
  const copy = {
    pending: {
      title: 'Finalizing Your Statement',
      subtitle: 'Hang Tight—Your Statement is On Its Way!',
      body: "This process may take a few minutes, but once it's ready, you'll see it on the Statements tab. You can choose to wait here or return home.",
    },
    completed: {
      title: 'Your Statement is Ready!',
      subtitle: null,
      body: 'You can download your statement now or view it on the Statements tab.',
    },
  }

  const textProps = {
    title: {
      as: 'h1',
      textStyle: 'text/8xl',
      fontWeight: 'medium',
    },
    subtitle: {
      mt: 6,
      as: 'h2',
      textStyle: 'text/2xl',
      fontWeight: 'medium',
    },
    body: {
      mt: 4,
      as: 'p',
      textStyle: 'text/md',
    },
  } as const

  const statusIndicatorVerticalMargin = 6

  const pendingContent = (
    <>
      <Text {...textProps.title}>{copy.pending.title}</Text>
      <Text {...textProps.subtitle}>{copy.pending.subtitle}</Text>
      <Text {...textProps.body}>{copy.pending.body}</Text>
      <Box my={statusIndicatorVerticalMargin}>
        <Spinner height="48px" width="48px" />
      </Box>
    </>
  )

  const completedContent = (
    <>
      <Text {...textProps.title}>{copy.completed.title}</Text>
      {copy.completed.body && <Text {...textProps.body}>{copy.completed.body}</Text>}
      <Box my={statusIndicatorVerticalMargin}>
        <Lottie
          animationData={greenCheckCircle}
          loop={false}
          autoplay={true}
          style={{ height: '56px', width: '56px' }}
        />
      </Box>
    </>
  )

  const failedContent = (
    <>
      <Text {...textProps.title}>Sorry, something went wrong</Text>
      <Text {...textProps.body}>An unexpected error occurred. Please try generating the statement again.</Text>
    </>
  )

  return { pendingContent, completedContent, failedContent }
}

function ContentContainer({ children, ...props }: StackProps) {
  return (
    <Flex
      flexDirection="column"
      alignItems="center"
      textAlign="center"
      h="250px" // to prevent layout shift from the different height between children
      {...props}
    >
      {children}
    </Flex>
  )
}

function ScreenFadeTransition({
  state: { status, isMounted },
  children,
  duration = 200,
  ...props
}: {
  state: TransitionState
  children: React.ReactNode
  /**
   * Duration of the fade in and fade out animations in milliseconds
   * @default 200
   */
  duration?: number
} & BoxProps) {
  if (!isMounted) {
    return null
  }

  return (
    <Box
      transition={`opacity ${duration}ms ease-in-out`}
      opacity={['preEnter', 'exiting'].includes(status) ? 0 : 1}
      {...props}
    >
      {children}
    </Box>
  )
}

function useScreenTransition({
  isStarted,
  exitTimeout = 200,
}: {
  isStarted: boolean
  /**
   * Timeout in ms for first screen exit animation
   * @default 200
   */
  exitTimeout?: number
}) {
  const [firstScreenState, toggleFirstScreen] = useTransitionState({
    initialEntered: true,
    timeout: exitTimeout,
    unmountOnExit: true,
    onStateChange: (event) => {
      if (['exited', 'unmounted'].includes(event.current.status)) {
        toggleSecondScreen(true)
      }
    },
  })
  const [secondScreenState, toggleSecondScreen] = useTransitionState({
    mountOnEnter: true,
    preEnter: true,
    enter: true,
  })

  useEffect(() => {
    if (isStarted) {
      toggleFirstScreen(false)
    }
  }, [isStarted, toggleFirstScreen])

  return { firstScreenState, secondScreenState }
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
