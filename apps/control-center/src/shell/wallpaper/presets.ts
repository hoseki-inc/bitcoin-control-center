export type WallpaperFamily = 'aurora' | 'landscape' | 'block' | 'grain'
export type WallpaperMode = 'light' | 'dark'

/** Five colours per mode; each family's shader gives them its own roles. */
export type Palette = readonly [string, string, string, string, string]

export interface WallpaperPreset {
  id: string
  name: string
  family: WallpaperFamily
  /** Shader-specific tuning. */
  params: readonly [number, number, number, number]
  /** Animation speed multiplier. */
  speed: number
  palettes: Record<WallpaperMode, Palette>
}

export const DEFAULT_WALLPAPER_ID = 'aurora-dusk'

export const WALLPAPER_FAMILIES: ReadonlyArray<{ family: WallpaperFamily; label: string }> = [
  { family: 'aurora', label: 'Aurora' },
  { family: 'landscape', label: 'Landscape' },
  { family: 'block', label: 'Bitcoin' },
  { family: 'grain', label: 'Minimal' },
]

/**
 * Palettes are tuned so glass text stays legible: dark palettes keep mid-tones low
 * for white text, light palettes keep them high for slate text, and none compete
 * with the Hoseki yellow accent.
 */
export const WALLPAPER_PRESETS: readonly [WallpaperPreset, ...WallpaperPreset[]] = [
  {
    id: 'aurora-dusk',
    name: 'Dusk',
    family: 'aurora',
    params: [1.4, 0, 0, 0],
    speed: 1,
    palettes: {
      // base, field, mid, highlight, glow
      dark: ['#07080F', '#1B1640', '#3A2A6B', '#B8693A', '#FFD27A'],
      light: ['#F2EBF8', '#D9C9F4', '#B4C4F4', '#FFC795', '#FFE3A0'],
    },
  },
  {
    id: 'aurora-tide',
    name: 'Tide',
    family: 'aurora',
    params: [1.2, 0, 0, 0],
    speed: 0.9,
    palettes: {
      dark: ['#030E0E', '#0A2629', '#10423D', '#2E8C78', '#8FE3C0'],
      light: ['#EEF7F5', '#D4EEE8', '#C2E1F1', '#A9E3D0', '#EAFFF6'],
    },
  },
  {
    id: 'landscape-ridge',
    name: 'Ridgeline',
    family: 'landscape',
    // roughness, sun height, sun x, ridge count scale
    params: [1, 0.64, 0.72, 1],
    speed: 1,
    palettes: {
      // sky top, horizon haze, far ridge, near ridge, sun glow
      dark: ['#060A13', '#1C283B', '#18202F', '#06080D', '#C9D7F2'],
      light: ['#BCD2EA', '#EEF2F4', '#A3B5C8', '#56687C', '#FFF4D6'],
    },
  },
  {
    id: 'landscape-dune',
    name: 'Dunes',
    family: 'landscape',
    params: [0.45, 0.5, 0.3, 1],
    speed: 0.8,
    palettes: {
      dark: ['#0C0712', '#4A2A2A', '#5B3524', '#1C110D', '#FFB36B'],
      light: ['#F4E3CF', '#FBEFE2', '#E7C39A', '#C58F5E', '#FFF1C9'],
    },
  },
  {
    id: 'block-contour',
    name: 'Contour',
    family: 'block',
    // mode (0 = contour lines), line density, 0, 0
    params: [0, 14, 0, 0],
    speed: 0.6,
    palettes: {
      // base, field, mid, line, index line
      dark: ['#0A0A0C', '#131419', '#1C1E25', '#6E6245', '#FFE56C'],
      light: ['#FBFAF5', '#F2F0E7', '#E7E3D5', '#CDBF94', '#B48E12'],
    },
  },
  {
    id: 'block-cells',
    name: 'Blockfield',
    family: 'block',
    // mode (1 = cells), cell density, 0, 0
    params: [1, 5, 0, 0],
    speed: 0.6,
    palettes: {
      dark: ['#08090C', '#12141C', '#1B1F2C', '#B86A12', '#FFE56C'],
      light: ['#F7F7F4', '#ECEDF1', '#DDE1EA', '#F2B35C', '#FFE9A0'],
    },
  },
  {
    id: 'grain-graphite',
    name: 'Graphite',
    family: 'grain',
    // grain strength scale, 0, 0, 0
    params: [1, 0, 0, 0],
    speed: 0.5,
    palettes: {
      // base, lift, warm corner, cool corner, unused
      dark: ['#0B0C10', '#1A1C22', '#2A251E', '#161B26', '#000000'],
      light: ['#EEEEEC', '#FFFFFF', '#F4ECDD', '#E6EBF2', '#000000'],
    },
  },
  {
    id: 'grain-linen',
    name: 'Linen',
    family: 'grain',
    params: [1.3, 0, 0, 0],
    speed: 0.5,
    palettes: {
      dark: ['#110E0B', '#211B15', '#3A2D1B', '#1A1714', '#000000'],
      light: ['#F4EDE2', '#FFFDF8', '#F1DFC0', '#EFE9E0', '#000000'],
    },
  },
]

export function getWallpaperPreset(id: string): WallpaperPreset {
  return WALLPAPER_PRESETS.find((preset) => preset.id === id) ?? WALLPAPER_PRESETS[0]
}

/** Static stand-in while WebGL starts, and the fallback when it is unavailable. */
export function wallpaperFallback(preset: WallpaperPreset, mode: WallpaperMode): string {
  const [base, field, mid, highlight] = preset.palettes[mode]
  return `radial-gradient(120% 90% at 75% 15%, ${highlight}55 0%, transparent 55%), radial-gradient(90% 80% at 20% 90%, ${mid} 0%, transparent 60%), linear-gradient(160deg, ${field} 0%, ${base} 100%)`
}
