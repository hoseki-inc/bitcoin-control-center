import { Box, SimpleGrid, Text, Tooltip, VisuallyHidden, useColorMode } from '@chakra-ui/react'
import { Image as ImageIcon } from 'lucide-react'
import { WALLPAPER_FAMILIES, WALLPAPER_PRESETS } from '../../shell/wallpaper/presets'
import { useWallpaperThumbnails } from '../../shell/wallpaper/thumbnails'
import { useBlockSeed, useWallpaper } from '../../shell/wallpaper/use-wallpaper'
import { SettingsRow } from './settings-rows'

const familyLabel = new Map(WALLPAPER_FAMILIES.map(({ family, label }) => [family, label]))

/** Choose the desktop wallpaper. Previews render in the current appearance, like the real thing. */
export function WallpaperRow({ tone }: { tone: number }): JSX.Element {
  const { colorMode } = useColorMode()
  const { preset, setWallpaper } = useWallpaper()
  const seed = useBlockSeed(true)
  const thumbnails = useWallpaperThumbnails(colorMode === 'dark' ? 'dark' : 'light', seed)

  return (
    <SettingsRow
      icon={ImageIcon}
      tone={tone}
      title="Wallpaper"
      titleId="wallpaper-heading"
      description={`${preset.name} · ${familyLabel.get(preset.family) ?? ''}. Drawn live on this device, in light and dark.`}
      descriptionId="wallpaper-description"
      footer={
        <SimpleGrid
          role="radiogroup"
          aria-labelledby="wallpaper-heading"
          aria-describedby="wallpaper-description"
          columns={{ base: 4, md: 8 }}
          spacing={2}
        >
          {WALLPAPER_PRESETS.map((option) => {
            const selected = option.id === preset.id
            const thumbnail = thumbnails[option.id]
            return (
              <Tooltip
                key={option.id}
                label={`${option.name} · ${familyLabel.get(option.family) ?? ''}`}
                openDelay={300}
              >
                <Box
                  as="label"
                  display="block"
                  cursor="pointer"
                  borderRadius="10px"
                  aspectRatio={16 / 10}
                  bg={thumbnail !== undefined ? `center / cover url(${thumbnail})` : 'surface.muted'}
                  boxShadow={
                    selected
                      ? '0 0 0 2px var(--hoseki-colors-accent-solid), 0 2px 6px rgb(0 0 0 / 0.2)'
                      : '0 0 0 0.5px var(--edge-border), 0 1px 3px rgb(0 0 0 / 0.12)'
                  }
                  transition="transform 200ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 150ms ease"
                  _hover={{ transform: 'scale(1.05)' }}
                  _active={{ transform: 'scale(0.97)' }}
                  sx={{
                    '&:has(input:focus-visible)': {
                      outline: '2px solid',
                      outlineColor: 'focus.ring',
                      outlineOffset: '3px',
                    },
                  }}
                >
                  <VisuallyHidden
                    as="input"
                    type="radio"
                    name="wallpaper"
                    value={option.id}
                    checked={selected}
                    aria-label={option.name}
                    onChange={() => {
                      setWallpaper(option.id)
                    }}
                  />
                </Box>
              </Tooltip>
            )
          })}
          <Text gridColumn="1 / -1" textStyle="text/xs" color="text.tertiary">
            Saved in this browser. You can also right-click the desktop.
          </Text>
        </SimpleGrid>
      }
    />
  )
}
