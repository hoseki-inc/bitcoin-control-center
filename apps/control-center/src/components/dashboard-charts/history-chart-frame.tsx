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
}: {
  children: ReactNode
  height: string
  viewKey: string
  loading: boolean
  updating: boolean
  refreshing: boolean
}): JSX.Element {
  const controls = useAnimationControls()
  const reduceMotion = useReducedMotion()
  const ready = !loading && !updating

  useEffect(() => {
    controls.stop()
    if (reduceMotion || !ready) {
      controls.set({ opacity: updating ? 0.55 : 1 })
    } else {
      void controls.start({
        opacity: [0.65, 1],
        transition: { duration: motionTokens.revealMs / 1000, ease: [0.23, 1, 0.32, 1] },
      })
    }
    return () => controls.stop()
  }, [controls, ready, reduceMotion, updating, viewKey])

  return (
    <Box bg="surface.raised" pt={2} position="relative" overflow="hidden" aria-busy={loading || updating || refreshing}>
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
      {(updating || refreshing) && (
        <Box position="absolute" insetX={0} top={0} pointerEvents="none">
          <Skeleton
            h="3px"
            startColor="chart.skeletonFrom"
            endColor="chart.skeletonTo"
            sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
          />
          {updating && (
            <Text
              role="status"
              textStyle="text/xs"
              color="text.secondary"
              bg="surface.raised"
              px={2}
              py={1}
              position="absolute"
              right={0}
              top={2}
            >
              Updating view…
            </Text>
          )}
        </Box>
      )}
    </Box>
  )
}

export function HistoryRangeLoading({ height }: { height: string }): JSX.Element {
  return (
    <Flex
      h={height}
      direction="column"
      justify="center"
      px={{ base: 4, md: 8 }}
      gap={4}
      role="status"
      aria-label="Preparing history for this date range"
    >
      <Stack spacing={3} aria-hidden="true">
        {['88%', '64%', '76%'].map((width) => (
          <Skeleton
            key={width}
            w={width}
            h="8px"
            borderRadius="control"
            startColor="chart.skeletonFrom"
            endColor="chart.skeletonTo"
            sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}
          />
        ))}
      </Stack>
      <Text textStyle="text/sm" color="text.secondary">
        Preparing history for this date range
      </Text>
    </Flex>
  )
}
