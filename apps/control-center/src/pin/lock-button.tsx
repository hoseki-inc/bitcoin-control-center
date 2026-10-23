import { IconButton } from '@chakra-ui/react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { lockApp, usePinStatus } from './status'

// Long enough to see the shackle close before the lock screen fades in.
const CLOSE_MS = 280

// Like a padlock: unlocked, the shackle rises out of the body on its right side while its left leg stays in.
const OPEN = { d: 'M7 11V4a5 5 0 0 1 10 0v4' }
const SHUT = { d: 'M7 11V7a5 5 0 0 1 10 0v4' }
const SNAP = { type: 'spring', stiffness: 700, damping: 18 } as const

// While hovered: push shut, hold, pop open, hold, again.
const DEMO = {
  d: [OPEN.d, SHUT.d, SHUT.d, OPEN.d, OPEN.d],
  transition: {
    duration: 2,
    times: [0, 0.15, 0.5, 0.65, 1],
    ease: 'easeInOut' as const,
    repeat: Number.POSITIVE_INFINITY,
  },
}

/** Locks this tab. Hovering shows the lock closing and opening; clicking snaps it shut, then the lock screen takes over. */
export function LockButton(): JSX.Element | null {
  const { data } = usePinStatus()
  const reduceMotion = useReducedMotion() === true
  const [closing, setClosing] = useState(false)
  const shackle = useAnimationControls()
  if (data?.required !== true) {
    return null
  }

  // Drawn like Lucide's lock, with the shackle as its own path so it can move.
  const icon = (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden
    >
      <motion.path d="M7 11V7a5 5 0 0 1 10 0v4" initial={OPEN} animate={shackle} />
      <rect width={18} height={11} x={3} y={11} rx={2} ry={2} />
    </svg>
  )

  return (
    <IconButton
      aria-label="Lock"
      variant="ghost"
      icon={icon}
      isDisabled={closing}
      onMouseEnter={() => {
        if (!closing && !reduceMotion) {
          void shackle.start(DEMO)
        }
      }}
      onMouseLeave={() => {
        if (!closing) {
          void shackle.start({ ...OPEN, transition: { duration: reduceMotion ? 0 : 0.25 } })
        }
      }}
      onClick={() => {
        setClosing(true)
        void shackle.start({ ...SHUT, transition: reduceMotion ? { duration: 0 } : SNAP })
        setTimeout(
          () => {
            void lockApp()
          },
          reduceMotion ? 0 : CLOSE_MS,
        )
      }}
    />
  )
}
