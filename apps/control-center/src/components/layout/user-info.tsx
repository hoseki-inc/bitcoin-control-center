import { HStack, IconButton } from '@chakra-ui/react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { SettingsIcon } from 'lucide-react'
import { Link } from 'react-router'
import { LockButton } from '../../pin/lock-button'

// While hovered, the gear spins one quick turn, rests a few seconds, and spins again.
const SPIN = {
  duration: 3.4,
  times: [0, 0.12, 1],
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

export function UserInfo(): JSX.Element {
  return (
    <HStack spacing={1}>
      <LockButton />
      <SettingsButton />
    </HStack>
  )
}
