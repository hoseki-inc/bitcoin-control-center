import { Box, Flex, Text } from '@chakra-ui/react'
import { curves, durations, springs } from '@hoseki/packages/ui/design-system/animations/motion'
import { Glass, useGlassPreset } from '@hoseki/packages/ui/design-system/glass'
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import { Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { usePrivacy } from '../hooks/use-privacy'
import { SECTIONS, type Section, sectionForPath } from './sections'

const MotionBox = motion.create(Box)

const BASE = 50
const MAGNIFIED = 80
const REACH = 150

/** Icon tile: a glossy squircle with the section glyph. */
export function DockTile({
  tile,
  glyph,
  icon: Icon,
}: {
  tile: readonly [string, string]
  glyph: string
  icon: LucideIcon
}): JSX.Element {
  return (
    <Flex
      w="100%"
      h="100%"
      align="center"
      justify="center"
      borderRadius="24%"
      bg={`linear-gradient(160deg, ${tile[0]}, ${tile[1]})`}
      boxShadow="inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 0 rgb(0 0 0 / 0.15), 0 2px 6px rgb(0 0 0 / 0.25)"
    >
      <Icon size="48%" color={glyph} strokeWidth={2} aria-hidden />
    </Flex>
  )
}

/** Width and height follow the pointer: 50px at rest, 80px directly under the cursor. */
function useMagnification(mouseX: MotionValue<number>, ref: React.RefObject<HTMLElement | null>): MotionValue<number> {
  const reduced = useReducedMotion() === true
  const distance = useTransform(mouseX, (x) => {
    const rect = ref.current?.getBoundingClientRect()
    return rect === undefined ? REACH : x - (rect.left + rect.width / 2)
  })
  const target = useTransform(distance, [-REACH, 0, REACH], [BASE, reduced ? BASE : MAGNIFIED, BASE])
  return useSpring(target, springs.magnify)
}

function DockSlot({
  mouseX,
  label,
  active,
  children,
}: {
  mouseX: MotionValue<number>
  label: string
  active: boolean
  children: (bounceKey: number, bounce: () => void) => ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const size = useMagnification(mouseX, ref)
  const [hovered, setHovered] = useState(false)
  const [bounceKey, setBounceKey] = useState(0)
  const reduced = useReducedMotion() === true

  return (
    <MotionBox
      ref={ref}
      position="relative"
      flexShrink={0}
      style={{ width: size, height: size }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <Box
        key={bounceKey}
        w="100%"
        h="100%"
        sx={
          bounceKey > 0 && !reduced
            ? {
                animation: `dockBounce ${durations.dockBounce}ms ease-in-out`,
                '@keyframes dockBounce': {
                  '0%, 100%': { transform: 'translateY(0)' },
                  '50%': { transform: 'translateY(-20px)' },
                },
              }
            : undefined
        }
      >
        {children(bounceKey, () => setBounceKey((value) => value + 1))}
      </Box>

      <AnimatePresence>
        {hovered && (
          <MotionBox
            layerStyle="material"
            borderRadius="full"
            position="absolute"
            bottom="calc(100% + 10px)"
            left="50%"
            px={2.5}
            py={1}
            pointerEvents="none"
            whiteSpace="nowrap"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <Text textStyle="text/xs" fontWeight="medium">
              {label}
            </Text>
          </MotionBox>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {active && (
          <MotionBox
            aria-hidden
            position="absolute"
            bottom="-7px"
            left="calc(50% - 5px)"
            w="10px"
            h="2px"
            borderRadius="full"
            bg="text.primary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: reduced ? 0 : 0.4, duration: 0.3, ease: curves.enter } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          />
        )}
      </AnimatePresence>
    </MotionBox>
  )
}

function SectionItem({
  section,
  mouseX,
  active,
}: {
  section: Section
  mouseX: MotionValue<number>
  active: boolean
}): JSX.Element {
  return (
    <DockSlot mouseX={mouseX} label={section.label} active={active}>
      {(_key, bounce) => (
        <Box
          as={Link}
          to={section.path}
          data-dock-item
          aria-label={section.label}
          aria-current={active ? 'page' : undefined}
          display="block"
          w="100%"
          h="100%"
          borderRadius="24%"
          transition="filter 150ms"
          _active={{ filter: 'brightness(0.85)' }}
          _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
          onClick={() => {
            if (!active) bounce()
          }}
        >
          <DockTile tile={section.tile} glyph={section.glyph} icon={section.icon} />
        </Box>
      )}
    </DockSlot>
  )
}

function PrivacyItem({ mouseX }: { mouseX: MotionValue<number> }): JSX.Element {
  const { hidden, toggle } = usePrivacy()
  const label = hidden ? 'Show balances' : 'Hide balances'
  return (
    <DockSlot mouseX={mouseX} label={label} active={false}>
      {() => (
        <Box
          as="button"
          type="button"
          data-dock-item
          aria-label={label}
          aria-pressed={hidden}
          display="block"
          w="100%"
          h="100%"
          borderRadius="24%"
          _active={{ filter: 'brightness(0.85)' }}
          _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
          onClick={toggle}
        >
          <DockTile tile={['#C9B8FF', '#6D28D9']} glyph="#FFFFFF" icon={hidden ? EyeOff : Eye} />
        </Box>
      )}
    </DockSlot>
  )
}

/** Moves focus between dock items with the arrow keys, Home and End. */
function handleArrowKeys(event: KeyboardEvent<HTMLElement>): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-dock-item]')]
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (index === -1) return
  const next =
    event.key === 'ArrowRight'
      ? items[(index + 1) % items.length]
      : event.key === 'ArrowLeft'
        ? items[(index - 1 + items.length) % items.length]
        : event.key === 'Home'
          ? items[0]
          : event.key === 'End'
            ? items[items.length - 1]
            : undefined
  if (next === undefined) return
  event.preventDefault()
  next.focus()
}

export function Dock(): JSX.Element {
  const mouseX = useMotionValue(Number.POSITIVE_INFINITY)
  const { pathname } = useLocation()
  const activeId = pathname === '/' ? 'home' : sectionForPath(pathname)?.id
  const glass = useGlassPreset('dock')

  const onPointerMove = (event: PointerEvent<HTMLElement>): void => {
    // Touch never magnifies; a finger has no hover position.
    if (event.pointerType === 'mouse') mouseX.set(event.clientX)
  }

  return (
    <Flex
      position="fixed"
      left={0}
      right={0}
      bottom="calc(10px + env(safe-area-inset-bottom))"
      justify="center"
      zIndex={30}
      pointerEvents="none"
    >
      <Glass
        {...glass}
        as="nav"
        aria-label="Sections"
        data-app-dock
        pointerEvents="auto"
        borderRadius="16px"
        boxShadow="var(--glass-drop)"
        display="flex"
        alignItems="flex-end"
        gap="10px"
        h={`${BASE + 24}px`}
        px={3}
        pb={3}
        onPointerMove={onPointerMove}
        onPointerLeave={() => mouseX.set(Number.POSITIVE_INFINITY)}
        onKeyDown={handleArrowKeys}
      >
        {SECTIONS.map((section) => (
          <SectionItem key={section.id} section={section} mouseX={mouseX} active={activeId === section.id} />
        ))}
        <Box aria-hidden alignSelf="center" w="1px" h="36px" bg="border.subtle" mx={0.5} mb={-1} />
        <PrivacyItem mouseX={mouseX} />
      </Glass>
    </Flex>
  )
}
