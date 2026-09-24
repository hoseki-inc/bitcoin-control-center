import { Box, Flex, Text } from '@chakra-ui/react'
import { curves } from '@hoseki/packages/ui/design-system/animations/motion'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

const MotionBox = motion.create(Box)

export type ContextMenuEntry =
  { label: string; onSelect: () => void; checked?: boolean; destructive?: boolean } | { divider: true }

export interface ContextMenuAnchor {
  x: number
  y: number
}

const MENU_WIDTH = 220
const EDGE = 8

/** Pointer position, or the element's corner when opened from the keyboard (menu key, Shift+F10). */
export function anchorFromEvent(event: ReactMouseEvent<HTMLElement>): ContextMenuAnchor {
  if (event.clientX === 0 && event.clientY === 0) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.bottom }
  }
  return { x: event.clientX, y: event.clientY }
}

/**
 * A glass menu at a point on screen. It appears where the pointer is (no exit animation,
 * so repeated right-clicks jump straight to the cursor) and closes on Escape, a selection,
 * or any press outside it.
 */
export function ContextMenu({
  anchor,
  entries,
  label,
  onClose,
}: {
  anchor: ContextMenuAnchor
  entries: readonly ContextMenuEntry[]
  label: string
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState(anchor)

  // Give focus back to whatever had it (the icon, usually) when the menu closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (previous?.isConnected === true) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])

  // Keep the menu on screen and focus its first item.
  useEffect(() => {
    const menu = ref.current
    if (menu === null) {
      return
    }
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      x: Math.min(anchor.x, window.innerWidth - width - EDGE),
      y: anchor.y + height > window.innerHeight - EDGE ? Math.max(EDGE, anchor.y - height) : anchor.y,
    })
    menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target) === true)) {
        onClose()
      }
    }
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onEscape, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
    const index = items.findIndex((item) => item === document.activeElement)
    const move = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (move !== 0) {
      event.preventDefault()
      items[(index + move + items.length) % items.length]?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <MotionBox
      ref={ref}
      role="menu"
      aria-label={label}
      layerStyle="materialMenu"
      position="fixed"
      zIndex={1000}
      top={`${position.y}px`}
      left={`${position.x}px`}
      w={`${MENU_WIDTH}px`}
      p={1}
      onKeyDown={onKeyDown}
      onContextMenu={(event: ReactMouseEvent) => {
        event.preventDefault()
      }}
      style={{ transformOrigin: 'top left' }}
      initial={{ opacity: 0, scale: 0.95, x: -8 }}
      animate={{ opacity: 1, scale: 1, x: 0, transition: { duration: 0.15, ease: curves.enter } }}
    >
      {entries.map((entry, index) =>
        'divider' in entry ? (
          <Box as="hr" key={`divider-${index}`} border="none" h="1px" bg="border.subtle" mx={2} my={1} />
        ) : (
          <MenuItem key={entry.label} entry={entry} onClose={onClose} />
        ),
      )}
    </MotionBox>
  )
}

function MenuItem({
  entry,
  onClose,
}: {
  entry: Extract<ContextMenuEntry, { label: string }>
  onClose: () => void
}): JSX.Element {
  const checkable = entry.checked !== undefined
  return (
    <Flex
      as="button"
      type="button"
      role={checkable ? 'menuitemradio' : 'menuitem'}
      aria-checked={checkable ? entry.checked : undefined}
      tabIndex={-1}
      w="100%"
      align="center"
      gap={2}
      px={3}
      py={2}
      borderRadius="var(--radius-menu-item)"
      textAlign="left"
      color={entry.destructive === true ? 'status.error.fg' : 'text.primary'}
      _hover={{ bg: 'surface.muted' }}
      _focus={{ bg: 'surface.muted', outline: 'none' }}
      onClick={() => {
        onClose()
        entry.onSelect()
      }}
    >
      <Text as="span" flex={1} textStyle="text/sm" fontWeight="medium">
        {entry.label}
      </Text>
      {entry.checked === true && <Check size={14} aria-hidden />}
    </Flex>
  )
}

/** State for one menu at a time: `open(event, entries)` from an onContextMenu handler. */
export function useContextMenu(label: string): {
  open: (event: ReactMouseEvent<HTMLElement>, entries: readonly ContextMenuEntry[]) => void
  menu: ReactNode
} {
  const [state, setState] = useState<{ anchor: ContextMenuAnchor; entries: readonly ContextMenuEntry[] } | null>(null)
  const close = useCallback(() => {
    setState(null)
  }, [])
  const open = useCallback((event: ReactMouseEvent<HTMLElement>, entries: readonly ContextMenuEntry[]) => {
    event.preventDefault()
    event.stopPropagation()
    setState({ anchor: anchorFromEvent(event), entries })
  }, [])
  return {
    open,
    menu:
      state === null ? null : (
        <ContextMenu anchor={state.anchor} entries={state.entries} label={label} onClose={close} />
      ),
  }
}
