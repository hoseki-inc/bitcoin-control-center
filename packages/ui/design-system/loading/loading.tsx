import {
  Box,
  type BoxProps,
  Skeleton,
  type SkeletonProps,
  type SystemStyleObject,
  VisuallyHidden,
} from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { motion, opacityReveal } from '../animations/motion'
import { LOADING_DELAY_MS, useDelayedFlag } from './use-delayed-flag'

const skeletonFade = `opacity ${motion.revealMs}ms ${motion.easeOut}`

/**
 * Stands in for content that is still loading. It takes the content's space from the start, so
 * nothing moves when the content arrives, but stays invisible for a moment so a quick load never
 * flashes it. Screen readers hear `label` and the region is marked busy.
 */
export function SkeletonRegion({
  label,
  children,
  delayMs = LOADING_DELAY_MS,
  ...props
}: { label: string; delayMs?: number } & BoxProps): JSX.Element {
  const visible = useDelayedFlag(true, delayMs)
  return (
    <Box aria-busy="true" {...props}>
      <VisuallyHidden>{label}</VisuallyHidden>
      <Box aria-hidden="true" opacity={visible ? 1 : 0} transition={skeletonFade}>
        {children}
      </Box>
    </Box>
  )
}

/**
 * A bar for one line of text, sized to the line box of the text style around it, so a figure can
 * load in place inside its own `Text`. Like `SkeletonRegion`, it appears only after a moment.
 */
export function TextSkeleton({
  width = '8ch',
  delayMs = LOADING_DELAY_MS,
  ...props
}: { delayMs?: number } & SkeletonProps): JSX.Element {
  const visible = useDelayedFlag(true, delayMs)
  return (
    <Skeleton
      as="span"
      display="inline-block"
      verticalAlign="middle"
      width={width}
      opacity={visible ? 1 : 0}
      transition={skeletonFade}
      aria-hidden="true"
      sx={{
        // inline-block adds a little height, so 0.8 of the line rather than all of it.
        height: '0.8em',
        '@supports (height: 0.8lh)': { height: '0.8lh' },
      }}
      {...props}
    />
  )
}

/**
 * Styles for content that replaces a skeleton: it fades in if the skeleton was shown, and appears
 * at once after a quick load or from cache, so revisiting a page never fades it.
 */
export function useRevealAfterLoading(
  loading: boolean,
  delayMs: number = LOADING_DELAY_MS,
): SystemStyleObject | undefined {
  const skeletonShown = useDelayedFlag(loading, delayMs)
  const [revealing, setRevealing] = useState(false)
  useEffect(() => {
    if (skeletonShown) {
      setRevealing(true)
    }
  }, [skeletonShown])
  return revealing && !loading ? opacityReveal : undefined
}
