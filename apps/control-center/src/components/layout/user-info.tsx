import { HStack, IconButton } from '@chakra-ui/react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { CircleQuestionMarkIcon, SettingsIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { helpLink } from '../../lib/help-link'
import { usePinStatus } from '../../pin/actions'
import { LockButton } from '../../pin/lock-button'

const RELEASE_VERSION = import.meta.env.VITE_RELEASE_VERSION

// While hovered, the gear spins one quick turn, rests a few seconds, and spins again.
const SPIN = {
  duration: 3.4,
  times: [0, 0.12, 1],
  ease: 'easeInOut' as const,
  repeat: Number.POSITIVE_INFINITY,
}

// While hovered, the question mark gives a quick "huh?" wiggle, rests, and wiggles again.
const WIGGLE = {
  duration: 2.4,
  times: [0, 0.06, 0.14, 0.22, 0.3, 0.36, 1],
  ease: 'easeInOut' as const,
  repeat: Number.POSITIVE_INFINITY,
}

function SettingsButton(): JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const rotate = useMotionValue(0)

  return (
    <IconButton
      as={Link}
      to="/settings"
      aria-label="Settings"
      variant="ghost"
      icon={
        <motion.span style={{ display: 'inline-flex', rotate }}>
          <SettingsIcon size={20} />
        </motion.span>
      }
      onMouseEnter={() => {
        if (!reduceMotion) {
          rotate.set(0)
          animate(rotate, [0, 360, 360], SPIN)
        }
      }}
      onMouseLeave={() => {
        // Finish the turn in progress rather than jump back.
        const turned = rotate.get() % 360
        rotate.set(turned)
        animate(rotate, turned === 0 ? 0 : 360, { duration: 0.25, ease: 'easeOut' })
      }}
    />
  )
}

function HelpButton(): JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const rotate = useMotionValue(0)
  const { pathname } = useLocation()
  // Sentinel names the platform it runs on; with none, such as a dev server, the click counts as "web".
  const platform = usePinStatus().data?.platform ?? 'web'
  const href = helpLink({ platform, os: navigator.platform, version: RELEASE_VERSION, pathname })

  return (
    <IconButton
      as="a"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Help"
      variant="ghost"
      icon={
        <motion.span style={{ display: 'inline-flex', rotate }}>
          <CircleQuestionMarkIcon size={20} />
        </motion.span>
      }
      onMouseEnter={() => {
        if (!reduceMotion) {
          animate(rotate, [0, -10, 9, -6, 3, 0, 0], WIGGLE)
        }
      }}
      onMouseLeave={() => {
        animate(rotate, 0, { duration: 0.2, ease: 'easeOut' })
      }}
    />
  )
}

export function UserInfo(): JSX.Element {
  return (
    <HStack spacing={1}>
      <HelpButton />
      <LockButton />
      <SettingsButton />
    </HStack>
  )
}
