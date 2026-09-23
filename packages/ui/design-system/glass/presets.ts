import { useColorMode } from '@chakra-ui/react'
import { type GlassOptions } from './glass'

type Surface = 'dock' | 'widget'

/**
 * Per-surface glass tuning. Dark values follow the measured umbrelOS 2.0 surfaces;
 * light glass is our own: it brightens instead of dimming and carries a pale tint so
 * slate text stays legible over light wallpapers.
 */
export const glassPresets: Record<Surface, Record<'light' | 'dark', GlassOptions>> = {
  dock: {
    dark: { scale: 70, chroma: 0.24, bevel: 'dome', blur: 1.5, saturate: 1.4, brightness: 0.9 },
    light: {
      scale: 70,
      chroma: 0.24,
      bevel: 'dome',
      blur: 1.5,
      saturate: 1.6,
      brightness: 1.08,
      tint: 'rgb(255 255 255 / 0.3)',
    },
  },
  widget: {
    dark: {
      scale: 110,
      chroma: 0.35,
      bevel: 18,
      blur: 2,
      saturate: 1.8,
      brightness: 0.82,
      tint: 'linear-gradient(to bottom, rgb(255 255 255 / 0.08), rgb(12 14 18 / 0.24))',
    },
    light: {
      scale: 110,
      chroma: 0.35,
      bevel: 18,
      blur: 2,
      saturate: 1.7,
      brightness: 1.06,
      tint: 'linear-gradient(to bottom, rgb(255 255 255 / 0.62), rgb(255 255 255 / 0.34))',
    },
  },
}

export function useGlassPreset(surface: Surface): GlassOptions {
  const { colorMode } = useColorMode()
  return glassPresets[surface][colorMode === 'dark' ? 'dark' : 'light']
}
