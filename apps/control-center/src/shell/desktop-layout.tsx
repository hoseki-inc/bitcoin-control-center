import { Box, useColorMode } from '@chakra-ui/react'
import { Global } from '@emotion/react'
import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Desktop } from './desktop'
import { Dock } from './dock'
import { isSheetPath } from './sections'
import { Sheet } from './sheet'
import { TopBar } from './top-bar'
import { useBlockSeed, useWallpaper } from './wallpaper/use-wallpaper'
import { Wallpaper } from './wallpaper/wallpaper'

/** Wallpaper animation stops shortly after a sheet covers it. */
const PAUSE_UNDER_SHEET_MS = 350

/**
 * The OS-style shell: wallpaper, the home desktop, the dock, and a sheet window for
 * every other route. The document itself never scrolls; sheets and the desktop do.
 */
export function DesktopLayout(): JSX.Element {
  const { pathname } = useLocation()
  const { colorMode } = useColorMode()
  const { preset } = useWallpaper()
  const seed = useBlockSeed(preset.family === 'block')
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const sheetOpen = isSheetPath(pathname)
  const [wallpaperPaused, setWallpaperPaused] = useState(sheetOpen)

  useEffect(() => {
    if (!sheetOpen) {
      setWallpaperPaused(false)
      return
    }
    const timer = window.setTimeout(() => setWallpaperPaused(true), PAUSE_UNDER_SHEET_MS)
    return () => window.clearTimeout(timer)
  }, [sheetOpen])

  return (
    <Box position="relative" h="100dvh" overflow="clip" color="text.primary">
      <Global styles={{ 'html, body': { overflow: 'hidden', scrollbarGutter: 'auto' } }} />
      <Wallpaper
        preset={preset}
        mode={colorMode === 'dark' ? 'dark' : 'light'}
        seed={seed}
        paused={wallpaperPaused}
        onSnapshot={setSnapshot}
      />
      <TopBar sheetOpen={sheetOpen} />
      <Desktop covered={sheetOpen} />
      <AnimatePresence>{sheetOpen && <Sheet key="sheet" wallpaperSnapshot={snapshot} />}</AnimatePresence>
      <Dock />
    </Box>
  )
}
