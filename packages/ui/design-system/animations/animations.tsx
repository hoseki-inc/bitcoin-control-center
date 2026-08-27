import { Box, type BoxProps, type SystemStyleObject, keyframes } from '@chakra-ui/react'
import type { Keyframes } from '@emotion/react'
import type { ReactNode } from 'react'

export const PAGE_TRANSITION_DELAY = 0.05

export type PageTransitionProps = {
  delayInSeconds?: number
  children: ReactNode
} & BoxProps

export function PageTransition({
  delayInSeconds = PAGE_TRANSITION_DELAY,
  children,
  ...props
}: PageTransitionProps): JSX.Element {
  return (
    <Box sx={Animations.fadeIn(delayInSeconds)} {...props}>
      {children}
    </Box>
  )
}

export const rotateClockwise: Keyframes = keyframes`
  from { transform: rotateZ(0deg); }
  to { transform: rotateZ(360deg); }
`
export const rotateCounterClockwise: Keyframes = keyframes`
  from { transform: rotateZ(0deg); }
  to { transform: rotateZ(-360deg); }
`

export const Animations = {
  fadeIn(delayInSeconds: number = 3): SystemStyleObject {
    const cssDelay = `${delayInSeconds}s`
    return {
      opacity: 0, // Start invisible
      animation: 'fadeIn 0.5s ease-in-out forwards',
      animationDelay: cssDelay,
      '@keyframes fadeIn': {
        '0%': { opacity: 0 },
        '100%': { opacity: 1 },
      },
    }
  },

  scaleAndGlow(durationInSeconds: number = 0.3): SystemStyleObject {
    const cssDuration = `${durationInSeconds}s`
    return {
      '&.active': {
        animation: `scaleAndGlow ${cssDuration} ease`,
      },
      '@keyframes scaleAndGlow': {
        '0%': {
          transform: 'scale(1)',
          boxShadow: 'none',
        },
        '50%': {
          transform: 'scale(0.95)',
          boxShadow: '0 0 15px rgba(255, 255, 255, 0.8)',
        },
        '100%': {
          transform: 'scale(1)',
          boxShadow: 'none',
        },
      },
    }
  },

  fadePulse(durationInSeconds: number = 0.3): SystemStyleObject {
    const cssDuration = `${durationInSeconds}s`
    return {
      '&.active': {
        animation: `fadePulse ${cssDuration} ease`,
      },
      '@keyframes fadePulse': {
        '0%': { opacity: 1 },
        '50%': { opacity: 0.7 },
        '100%': { opacity: 1 },
      },
    }
  },

  slightRotate(durationInSeconds: number = 0.3): SystemStyleObject {
    const cssDuration = `${durationInSeconds}s`
    return {
      '&.active': {
        animation: `slightRotate ${cssDuration} ease`,
      },
      '@keyframes slightRotate': {
        '0%': { transform: 'rotate(0deg)' },
        '50%': { transform: 'rotate(2deg)' },
        '100%': { transform: 'rotate(0deg)' },
      },
    }
  },

  bounce(durationInSeconds: number = 0.3): SystemStyleObject {
    const cssDuration = `${durationInSeconds}s`
    return {
      '&.active': {
        animation: `bounce ${cssDuration} ease`,
      },
      '@keyframes bounce': {
        '0%': { transform: 'translateY(0)' },
        '50%': { transform: 'translateY(-10px)' },
        '100%': { transform: 'translateY(0)' },
      },
    }
  },
}
