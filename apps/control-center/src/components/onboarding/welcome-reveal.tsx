import { Box, Button, Image, Spinner, Stack, Text, useColorModeValue, usePrefersReducedMotion } from '@chakra-ui/react'
import { motion } from '@hoseki/packages/ui/design-system/animations/motion'
import { type ReactNode, useEffect, useRef, useState } from 'react'

export function WelcomeReveal({ children }: { children: ReactNode }): JSX.Element {
  const reducedMotion = usePrefersReducedMotion()
  const logoSrc = useColorModeValue('/hoseki-logo.svg', '/hoseki-logo-light.svg')
  const [phase, setPhase] = useState<'welcome' | 'reveal' | 'done'>('welcome')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const welcomeRef = useRef<HTMLButtonElement | null>(null)
  const moveFocus = useRef(false)
  const welcoming = phase === 'welcome'

  useEffect(() => {
    if (!welcoming && (moveFocus.current || document.activeElement === welcomeRef.current)) {
      contentRef.current?.focus({ preventScroll: true })
      moveFocus.current = false
    }
  }, [welcoming, phase])

  useEffect(() => {
    if (phase === 'done') return
    const timer = window.setTimeout(
      () => setPhase(phase === 'welcome' ? 'reveal' : 'done'),
      phase === 'welcome' ? (reducedMotion ? 600 : 1280) : reducedMotion ? 150 : 420,
    )
    return () => window.clearTimeout(timer)
  }, [phase, reducedMotion])

  useEffect(() => {
    if (phase === 'done') return
    const skip = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
        return
      // Do not let the skip key activate a control revealed beneath the welcome.
      if (event.key === 'Enter' || event.key === ' ') event.preventDefault()
      moveFocus.current = event.key !== 'Tab'
      setPhase('done')
    }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [phase])

  return (
    <Box position="relative" data-welcome-phase={phase}>
      {phase !== 'done' && (
        <Button
          variant="unstyled"
          type="button"
          ref={welcomeRef}
          aria-label="Skip welcome to Hoseki Control Center"
          onClick={() => {
            moveFocus.current = document.activeElement === welcomeRef.current
            setPhase('done')
          }}
          position="fixed"
          insetInline={0}
          top={0}
          w="full"
          h="100svh"
          display="flex"
          justifyContent="center"
          alignItems="center"
          zIndex={1}
          opacity={welcoming ? 1 : 0}
          visibility={welcoming ? 'visible' : 'hidden'}
          transition={`opacity 260ms ${motion.easeOut}, visibility 260ms`}
          sx={{ '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}
        >
          <Stack align="center" gap={5} px={6} aria-hidden="true">
            <Spinner size="lg" color="text.tertiary" mb={3} />
            <Image
              src={logoSrc}
              alt=""
              w={{ base: '168px', md: '208px' }}
              h="auto"
              sx={{
                animation: `welcomeIdentity 480ms ${motion.easeOut} both`,
                '@keyframes welcomeIdentity': {
                  from: { opacity: 0, filter: 'blur(4px)', transform: 'translateY(4px)' },
                  to: { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
                },
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            />
            <Text
              textStyle={{ base: 'text/2xl', md: 'text/3xl' }}
              fontWeight="medium"
              color="text.primary"
              letterSpacing="-0.02em"
              sx={{
                animation: `welcomeIdentity 480ms ${motion.easeOut} 180ms both`,
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              Control Center
            </Text>
          </Stack>
        </Button>
      )}
      <Box
        ref={(element: HTMLDivElement | null) => {
          contentRef.current = element
          if (element) element.inert = welcoming
        }}
        tabIndex={-1}
        aria-hidden={welcoming ? true : undefined}
        visibility={welcoming ? 'hidden' : 'visible'}
        // Descendants such as page spinners explicitly set visibility to visible.
        opacity={welcoming ? 0 : 1}
        sx={
          phase === 'reveal'
            ? {
                animation: `welcomeApp 420ms ${motion.easeOut} both`,
                '@keyframes welcomeApp': {
                  from: { opacity: 0 },
                  to: { opacity: 1 },
                },
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }
            : undefined
        }
      >
        {children}
      </Box>
    </Box>
  )
}
