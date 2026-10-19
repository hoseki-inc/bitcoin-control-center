import { motion as motionTokens } from '@hoseki/packages/ui/design-system/animations/motion'

// One timing for everything that moves in the introduction, on the design system's ease-out curve.

/** The design system's ease-out curve, as framer-motion takes it. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_IN = [0.4, 0, 1, 1] as const

/** How long a step takes to settle in, and to leave. */
export const TURN_IN_S = 0.5
export const TURN_OUT_S = 0.22

/** The settle as a CSS transition timing, for what CSS animates. */
export const TURN_IN_CSS = `${TURN_IN_S * 1000}ms ${motionTokens.easeOut}`
