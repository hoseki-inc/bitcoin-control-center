import { Flex, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { SEARCH_SHORTCUT, ShortcutHint } from './commands'
import { Orb } from './orb'

/** The desktop's way into search: a glass pill above the dock with a small, still orb. */
export function SearchPill({ onOpen }: { onOpen: () => void }): JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <Flex
      as="button"
      type="button"
      onClick={onOpen}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      aria-label={`Search (${SEARCH_SHORTCUT})`}
      aria-keyshortcuts="Meta+K Control+K"
      layerStyle="material"
      borderRadius="full"
      position="fixed"
      left="50%"
      transform="translateX(-50%)"
      bottom="calc(98px + env(safe-area-inset-bottom))"
      align="center"
      gap={2}
      py={1.5}
      pl={1.5}
      pr={3}
      zIndex={29}
      transition="background-color 300ms, transform 200ms cubic-bezier(0.23, 1, 0.32, 1)"
      _hover={{ bg: 'surface.muted' }}
      _active={{ transform: 'translateX(-50%) scale(0.97)' }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
    >
      {/* Only animates while hovered, so the idle desktop costs nothing. */}
      <Orb size={22} live={hovered} />
      <Text textStyle="text/sm" fontWeight="medium">
        Search
      </Text>
      <ShortcutHint>{SEARCH_SHORTCUT}</ShortcutHint>
    </Flex>
  )
}
