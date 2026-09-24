import { Box, useColorMode } from '@chakra-ui/react'
import { Global } from '@emotion/react'
import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useWelcomeRevealed } from '../components/onboarding/welcome-reveal'
import { Desktop } from './desktop'
import { Dock } from './dock'
import { CommandPalette } from './search/command-palette'
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
  const [searchOpen, setSearchOpen] = useState(false)
  const revealed = useWelcomeRevealed()
  const openSearch = useCallback(() => {
    setSearchOpen(true)
  }, [])
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
  }, [])

  // ⌘K (Ctrl+K elsewhere) opens search from anywhere once the welcome has cleared.
  useEffect(() => {
    if (!revealed) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return
      }
      event.preventDefault()
      setSearchOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [revealed])

  useEffect(() => {
    if (!sheetOpen) {
      setWallpaperPaused(false)
      return
    }
    const timer = window.setTimeout(() => {
      setWallpaperPaused(true)
    }, PAUSE_UNDER_SHEET_MS)
    return () => {
      window.clearTimeout(timer)
    }
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
      <Desktop covered={sheetOpen} onOpenSearch={openSearch} />
      <AnimatePresence>{sheetOpen && <Sheet key="sheet" wallpaperSnapshot={snapshot} />}</AnimatePresence>
      <Dock />
      <CommandPalette open={searchOpen} onClose={closeSearch} />
    </Box>
  )
}
