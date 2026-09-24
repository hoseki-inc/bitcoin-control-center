import { Box, SimpleGrid, Text, useColorMode } from '@chakra-ui/react'
import { curves } from '@hoseki/packages/ui/design-system/animations/motion'
import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { ContextMenuAnchor } from './context-menu'
import { WALLPAPER_PRESETS } from './wallpaper/presets'
import { useWallpaperThumbnails } from './wallpaper/thumbnails'
import { useBlockSeed, useWallpaper } from './wallpaper/use-wallpaper'

const MotionBox = motion.create(Box)
const WIDTH = 344
const EDGE = 8

/** A glass popover of wallpaper previews, opened from the desktop's context menu. */
export function WallpaperPicker({ anchor, onClose }: { anchor: ContextMenuAnchor; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const { colorMode } = useColorMode()
  const { preset, setWallpaper } = useWallpaper()
  const seed = useBlockSeed(true)
  const thumbnails = useWallpaperThumbnails(colorMode === 'dark' ? 'dark' : 'light', seed)
  const [position, setPosition] = useState(anchor)

  useEffect(() => {
    const panel = ref.current
    if (panel === null) {
      return
    }
    const { width, height } = panel.getBoundingClientRect()
    setPosition({
      x: Math.max(EDGE, Math.min(anchor.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(anchor.y, window.innerHeight - height - EDGE)),
    })
    panel.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  }, [anchor])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node && ref.current?.contains(event.target) === true)) {
        onClose()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  return (
    <MotionBox
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- An animated popover at the pointer; the motion wrapper cannot render a native dialog.
      role="dialog"
      aria-label="Choose a wallpaper"
      layerStyle="materialMenu"
      position="fixed"
      zIndex={1000}
      top={`${position.y}px`}
      left={`${position.x}px`}
      w={`${WIDTH}px`}
      p={3}
      style={{ transformOrigin: 'top left' }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: curves.enter } }}
    >
      <Text textStyle="text/sm" fontWeight="semibold" mb={2} px={1}>
        Wallpaper
      </Text>
      <SimpleGrid columns={4} spacing={2}>
        {WALLPAPER_PRESETS.map((option) => {
          const selected = option.id === preset.id
          return (
            <Box
              as="button"
              type="button"
              key={option.id}
              aria-pressed={selected}
              aria-label={option.name}
              onClick={() => {
                setWallpaper(option.id)
              }}
              borderRadius="10px"
              outline="2px solid"
              outlineColor={selected ? 'accent.solid' : 'transparent'}
              outlineOffset="2px"
              transition="transform 200ms cubic-bezier(0.23, 1, 0.32, 1), outline-color 150ms"
              _hover={{ transform: 'scale(1.05)' }}
              _active={{ transform: 'scale(0.96)' }}
              _focusVisible={{ outlineColor: 'focus.ring' }}
            >
              <Box
                h="46px"
                borderRadius="10px"
                bg={
                  thumbnails[option.id] !== undefined ? `center / cover url(${thumbnails[option.id]})` : 'surface.muted'
                }
              />
              <Text textStyle="text/xs" mt={1} color={selected ? 'text.primary' : 'text.secondary'} noOfLines={1}>
                {option.name}
              </Text>
            </Box>
          )
        })}
      </SimpleGrid>
    </MotionBox>
  )
}
