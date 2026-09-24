import { Box } from '@chakra-ui/react'
import { durations } from '@hoseki/packages/ui/design-system/animations/motion'
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useWelcomeRevealed } from '../components/onboarding/welcome-reveal'

const MotionBox = motion.create(Box)

/** Widgets come first; icons follow after a gap the length of one and a half widgets. */
export const WIDGET_COUNT = 4

/**
 * Items rise into place once the welcome has revealed the desktop: widgets move only
 * (fading glass would flash its backdrop), icons fade and grow with a 10ms stagger.
 */
export function Entrance({
  index,
  kind,
  children,
}: {
  index: number
  kind: 'widget' | 'item'
  children: ReactNode
}): JSX.Element {
  const revealed = useWelcomeRevealed()
  const delay = ((kind === 'widget' ? 0 : WIDGET_COUNT * 1.5) + index) * (durations.gridStagger / 1000)
  return (
    <MotionBox
      initial={kind === 'widget' ? { scale: 0.92, y: 12 } : { opacity: 0, scale: 0.75 }}
      animate={
        revealed
          ? { opacity: 1, scale: 1, y: 0, transition: { duration: durations.gridItem / 1000, ease: 'easeOut', delay } }
          : undefined
      }
    >
      {children}
    </MotionBox>
  )
}
