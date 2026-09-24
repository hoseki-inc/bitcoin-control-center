import { Box, HStack, Radio, RadioGroup, SimpleGrid, Text, useColorMode } from '@chakra-ui/react'
import { WALLPAPER_FAMILIES, WALLPAPER_PRESETS } from '../../shell/wallpaper/presets'
import { useWallpaperThumbnails } from '../../shell/wallpaper/thumbnails'
import { useBlockSeed, useWallpaper } from '../../shell/wallpaper/use-wallpaper'

const familyLabel = new Map(WALLPAPER_FAMILIES.map(({ family, label }) => [family, label]))

/** Choose the desktop wallpaper. Previews render in the current appearance, like the real thing. */
export function WallpaperSettings(): JSX.Element {
  const { colorMode } = useColorMode()
  const { preset, setWallpaper } = useWallpaper()
  const seed = useBlockSeed(true)
  const thumbnails = useWallpaperThumbnails(colorMode === 'dark' ? 'dark' : 'light', seed)

  return (
    <Box as="section" aria-labelledby="wallpaper-heading">
      <Text as="h2" id="wallpaper-heading" textStyle="text/md" fontWeight="semibold" color="text.primary">
        Wallpaper
      </Text>
      <Text mt={2} textStyle="text/sm" color="text.secondary" id="wallpaper-description">
        Animated backgrounds drawn on this device. Each one has a light and a dark version that follows your appearance.
        The Bitcoin wallpapers shift slightly with every new block.
      </Text>
      <RadioGroup
        value={preset.id}
        onChange={setWallpaper}
        mt={5}
        aria-labelledby="wallpaper-heading"
        aria-describedby="wallpaper-description"
      >
        <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
          {WALLPAPER_PRESETS.map((option) => {
            const selected = option.id === preset.id
            const thumbnail = thumbnails[option.id]
            return (
              <Box
                as="label"
                key={option.id}
                p={2}
                border="1px solid"
                borderRadius="panel"
                borderColor={selected ? 'border.inverse' : 'border.subtle'}
                bg={selected ? 'surface.subtle' : 'surface.raised'}
                cursor="pointer"
                transition="border-color 150ms ease, background-color 150ms ease, transform 200ms cubic-bezier(0.23, 1, 0.32, 1)"
                _hover={{ borderColor: 'border.strong' }}
                _active={{ transform: 'scale(0.98)' }}
                _focusWithin={{ outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' }}
              >
                <Box
                  aspectRatio={16 / 10}
                  borderRadius="control"
                  bg={thumbnail !== undefined ? `center / cover url(${thumbnail})` : 'surface.muted'}
                  boxShadow={selected ? '0 0 0 2px var(--hoseki-colors-accent-solid)' : 'none'}
                  transition="box-shadow 150ms ease"
                />
                <HStack justify="space-between" mt={2} px={1} spacing={2}>
                  <Box minW={0}>
                    <Text textStyle="text/sm" fontWeight="medium" noOfLines={1}>
                      {option.name}
                    </Text>
                    <Text textStyle="text/xs" color="text.tertiary" noOfLines={1}>
                      {familyLabel.get(option.family)}
                    </Text>
                  </Box>
                  <Radio as="span" value={option.id} colorScheme="gray" aria-label={option.name} />
                </HStack>
              </Box>
            )
          })}
        </SimpleGrid>
      </RadioGroup>
      <Text mt={3} textStyle="text/xs" color="text.secondary">
        Saved automatically in this browser. You can also right-click the desktop to change it.
      </Text>
    </Box>
  )
}
