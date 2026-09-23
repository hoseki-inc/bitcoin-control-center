import type { SystemStyleObject } from '@chakra-ui/react'

export const motion = {
  easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
  revealMs: 180,
  statusMs: 120,
  dismissMs: 150,
} as const

/** Cubic-bézier curves for the glass shell, as framer-motion tuples. */
export const curves = {
  // Quint-like out: sheets, search card, sections arriving.
  enter: [0.23, 1, 0.32, 1],
  // iOS sheet curve: exits, height tweens, layout morphs.
  exit: [0.32, 0.72, 0, 1],
  // Press release with a small overshoot.
  overshoot: [0.34, 1.45, 0.64, 1],
  // Press down.
  press: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

/** Spring presets (framer-motion transition objects). */
export const springs = {
  icon: { type: 'spring', stiffness: 500, damping: 30 },
  dock: { type: 'spring', stiffness: 200, damping: 20 },
  magnify: { mass: 0.1, stiffness: 150, damping: 10 },
  tilt: { stiffness: 210, damping: 26, mass: 0.7 },
  // Large panes of glass: critically damped, bounce reads as wobble.
  pane: { type: 'spring', stiffness: 300, damping: 34, mass: 1 },
  layout: { type: 'spring', duration: 0.35, bounce: 0 },
  pill: { type: 'spring', duration: 0.4, bounce: 0.2 },
} as const

/** Durations in milliseconds for the shell choreography. */
export const durations = {
  sheetIn: 300,
  sheetOut: 200,
  wallpaperReveal: 700,
  dockBounce: 400,
  searchOverlay: 150,
  searchOrb: 380,
  searchCard: 240,
  searchSection: 220,
  heightTween: 260,
  gridItem: 200,
  gridStagger: 10,
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
