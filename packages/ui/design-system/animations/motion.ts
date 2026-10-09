import type { SystemStyleObject } from '@chakra-ui/react'

export const motion = {
  easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
  revealMs: 180,
  statusMs: 120,
  dismissMs: 150,
} as const

// Unsupported browsers show content immediately. No timers or hidden initial state.
export const opacityReveal: SystemStyleObject = {
  opacity: 1,
  transition: `opacity ${motion.revealMs}ms ${motion.easeOut}`,
  '@starting-style': { opacity: 0 },
  '@media (prefers-reduced-motion: reduce)': {
    transition: 'none',
    '@starting-style': { opacity: 1 },
  },
}
