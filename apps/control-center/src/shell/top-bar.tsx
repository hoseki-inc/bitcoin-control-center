import { Box, HStack } from '@chakra-ui/react'
import { AppearanceToggle } from '../components/appearance-toggle'
import { isDesktop } from '../mode'

/**
 * Floating glass pill in the top-right corner for controls that apply everywhere.
 * On the desktop app a transparent strip along the top edge lets the window be dragged.
 */
export function TopBar({ sheetOpen }: { sheetOpen: boolean }): JSX.Element {
  return (
    <>
      {isDesktop && (
        <Box
          aria-hidden
          position="fixed"
          top={0}
          left={0}
          right={0}
          h="40px"
          zIndex={25}
          sx={{ WebkitAppRegion: 'drag' }}
        />
      )}
      <HStack
        layerStyle="material"
        borderRadius="full"
        position="fixed"
        top="calc(12px + env(safe-area-inset-top))"
        right="calc(16px + env(safe-area-inset-right))"
        zIndex={30}
        // Below lg an open sheet reaches the top corner, so its close button takes the spot.
        display={{ base: sheetOpen ? 'none' : 'flex', lg: 'flex' }}
        spacing={0}
        p={1}
        sx={{ WebkitAppRegion: 'no-drag' }}
      >
        <AppearanceToggle size="sm" borderRadius="full" minW="36px" h="36px" />
      </HStack>
    </>
  )
}
