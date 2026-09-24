import { Box, Stack, Text } from '@chakra-ui/react'
import { springs } from '@hoseki/packages/ui/design-system/animations/motion'
import { Glass, useGlassPreset } from '@hoseki/packages/ui/design-system/glass'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import type { PointerEvent, ReactNode } from 'react'
import { Link } from 'react-router'

const MotionBox = motion.create(Box)

export const WIDGET_SIZE = {
  w: { base: '160px', sm: '270px' },
  h: { base: '110px', sm: '150px' },
} as const

/** Maximum tilt towards the pointer, in degrees. */
const TILT = 7

/**
 * A glass widget on the desktop: tilts gently towards a mouse pointer, lifts on hover,
 * and opens its section when pressed. The label underneath names where it leads.
 */
export function Widget({
  title,
  label,
  to,
  children,
}: {
  title: string
  label: string
  to: string
  children: ReactNode
}): JSX.Element {
  const glass = useGlassPreset('widget')
  const reduced = useReducedMotion() === true
  const rotateX = useSpring(useMotionValue(0), springs.tilt)
  const rotateY = useSpring(useMotionValue(0), springs.tilt)
  const scale = useSpring(useMotionValue(1), springs.tilt)

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    if (reduced || event.pointerType !== 'mouse') {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    rotateY.set(x * TILT * 2)
    rotateX.set(-y * TILT * 2)
  }
  const settle = (): void => {
    rotateX.set(0)
    rotateY.set(0)
    scale.set(1)
  }

  return (
    <Stack align="center" spacing={2}>
      <MotionBox
        borderRadius={{ base: '12px', sm: '20px' }}
        style={{ rotateX, rotateY, scale, transformPerspective: 900 }}
        onPointerMove={onPointerMove}
        onPointerEnter={() => {
          if (!reduced) {
            scale.set(1.05)
          }
        }}
        onPointerLeave={settle}
        onPointerDown={() => {
          if (!reduced) {
            scale.set(0.97)
          }
        }}
        onPointerUp={() => {
          if (!reduced) {
            scale.set(1.05)
          }
        }}
      >
        <Box
          as={Link}
          to={to}
          display="block"
          borderRadius={{ base: '12px', sm: '20px' }}
          _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '4px' }}
        >
          <Glass
            {...glass}
            w={WIDGET_SIZE.w}
            h={WIDGET_SIZE.h}
            borderRadius={{ base: '12px', sm: '20px' }}
            boxShadow="var(--glass-widget-shadow)"
            p={{ base: 3, sm: 5 }}
            display="flex"
            flexDirection="column"
            color="text.primary"
          >
            <Text textStyle={{ base: 'text/xs', sm: 'text/sm' }} fontWeight="semibold" color="text.secondary">
              {title}
            </Text>
            {children}
          </Glass>
        </Box>
      </MotionBox>
      <Text
        textStyle={{ base: 'text/xs', sm: 'text/sm' }}
        fontWeight="medium"
        color="text.primary"
        textShadow="0 1px 8px var(--focus-band)"
      >
        {label}
      </Text>
    </Stack>
  )
}

/** Large figure inside a widget, with tabular digits so live values do not jitter. */
export function WidgetValue({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Text
      mt={{ base: 1, sm: 2 }}
      textStyle={{ base: 'text/md', sm: 'text/2xl' }}
      fontWeight="semibold"
      letterSpacing="-0.02em"
      noOfLines={1}
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </Text>
  )
}

export function WidgetDetail({
  children,
  color = 'text.secondary',
}: {
  children: ReactNode
  color?: string
}): JSX.Element {
  return (
    <Text
      textStyle={{ base: 'text/xs', sm: 'text/sm' }}
      color={color}
      noOfLines={1}
      sx={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {children}
    </Text>
  )
}

/** Pressed-in progress groove. */
export function WidgetTrack({ value }: { value: number }): JSX.Element {
  return (
    <Box mt="auto" h="6px" borderRadius="full" layerStyle="glassTrack" overflow="hidden">
      <Box
        h="100%"
        w={`${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`}
        borderRadius="full"
        bg="text.primary"
        transition="width 700ms cubic-bezier(0.4, 0, 0.2, 1)"
      />
    </Box>
  )
}
