import { Box, Flex, Skeleton, Stack, Text } from '@chakra-ui/react'
import { motion as motionTokens } from '@hoseki/packages/ui/design-system/animations/motion'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect } from 'react'

const MotionBox = motion.create(Box)

export function HistoryChartFrame({
  children,
  height,
  viewKey,
  loading,
  updating,
  refreshing,
  reduceMotion: reduceMotionOverride,
}: {
  children: ReactNode
  height: string
  viewKey: string
  loading: boolean
  updating: boolean
  refreshing: boolean
  /** Overrides the system reduced-motion preference. */
  reduceMotion?: boolean
}): JSX.Element {
  const controls = useAnimationControls()
  const systemReduceMotion = useReducedMotion()
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion === true
  const ready = !loading && !updating

  useEffect(() => {
    controls.stop()
    if (reduceMotion || !ready) {
      controls.set({ opacity: 1 })
    } else {
      void controls.start({
        opacity: [0.65, 1],
        transition: { duration: motionTokens.revealMs / 1000, ease: [0.23, 1, 0.32, 1] },
      })
    }
    return () => {
      controls.stop()
    }
  }, [controls, ready, reduceMotion, updating, viewKey])

  return (
    <Box
      bg="shades.0"
      pt={2}
      position="relative"
      overflow="hidden"
      aria-busy={loading || updating || refreshing}
      // The frame clips overflow, so draw the chart's keyboard focus ring inside it.
      sx={{ '& .recharts-surface:focus-visible': { outlineOffset: '-2px' } }}
    >
      <MotionBox
        minH={height}
        initial={false}
        animate={controls}
        // A retained chart belongs to the previous view; its tooltip must not
        // report old account values as though the new selection has loaded.
        // React 19 supports inert; the workspace still uses React 18 types.
        {...(updating ? { inert: true } : {})}
        aria-hidden={updating || undefined}
      >
        {children}
      </MotionBox>
      {updating && (
        // A light sweep across the retained chart while the new view loads.
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          aria-hidden="true"
          sx={{
            background:
              'linear-gradient(90deg, rgba(240,242,245,0) 0%, rgba(240,242,245,0.85) 50%, rgba(240,242,245,0) 100%)',
            backgroundSize: '200% 100%',
            animation: 'historyShimmer 1.4s ease-in-out infinite',
            '@keyframes historyShimmer': {
              '0%': { backgroundPosition: '-200% 0' },
              '100%': { backgroundPosition: '200% 0' },
            },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      )}
    </Box>
  )
}

export function HistoryRangeLoading({
  height,
  label = 'Preparing history for this date range',
}: {
  height: string
  label?: string
}): JSX.Element {
  return (
    <Flex h={height} direction="column" justify="center" px={{ base: 4, md: 8 }} gap={4}>
      <Stack spacing={3} aria-hidden="true">
        {['88%', '64%', '76%'].map((width) => (
          <Skeleton key={width} w={width} h="8px" />
        ))}
      </Stack>
      <Text textStyle="text/sm" color="neutral.600">
        {label}
      </Text>
    </Flex>
  )
}
