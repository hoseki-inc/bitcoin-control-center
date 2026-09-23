/**
 * Colour roles shared by the light theme and the dark glass theme.
 *
 * Components should use these roles rather than palette steps so both themes stay
 * legible. Dark values are translucent whites because dark surfaces sit on top of
 * the wallpaper and glass materials.
 */
const white = (alpha: number): string => `rgba(255, 255, 255, ${alpha})`

type ModeValue = { default: string; _dark: string }
const mode = (light: string, dark: string): ModeValue => ({ default: light, _dark: dark })

export const semanticColors = {
  text: {
    primary: mode('neutral.900', white(0.92)),
    secondary: mode('neutral.600', white(0.64)),
    tertiary: mode('neutral.500', white(0.46)),
    disabled: mode('neutral.400', white(0.3)),
    inverse: mode('shades.0', 'neutral.900'),
  },
  border: {
    subtle: mode('neutral.200', white(0.1)),
    strong: mode('neutral.400', white(0.22)),
    inverse: mode('neutral.900', white(0.9)),
  },
  surface: {
    base: mode('shades.0', '#0B0C10'),
    raised: mode('shades.0', white(0.05)),
    subtle: mode('neutral.50', white(0.04)),
    muted: mode('neutral.100', white(0.08)),
    emphasis: mode('neutral.200', white(0.14)),
    inverse: mode('neutral.900', white(0.92)),
    inversePressed: mode('neutral.700', white(0.78)),
    // Opaque floating surface for menus and popovers when glass is unavailable.
    overlay: mode('shades.0', '#16171C'),
  },
  accent: {
    solid: mode('secondary.400', 'secondary.400'),
    fg: mode('neutral.900', 'neutral.900'),
    subtle: mode('#FFF8D6', 'rgba(255, 229, 108, 0.14)'),
    text: mode('#7A5C00', 'secondary.400'),
  },
  status: {
    success: {
      fg: mode('success.700', 'success.300'),
      bg: mode('success.50', 'rgba(16, 185, 129, 0.14)'),
      border: mode('success.200', 'rgba(16, 185, 129, 0.32)'),
      solid: mode('success.600', 'success.500'),
    },
    warning: {
      fg: mode('warning.700', 'warning.300'),
      bg: mode('warning.50', 'rgba(245, 158, 11, 0.14)'),
      border: mode('warning.200', 'rgba(245, 158, 11, 0.32)'),
      solid: mode('warning.500', 'warning.400'),
    },
    error: {
      fg: mode('error.700', 'error.400'),
      bg: mode('error.50', 'rgba(240, 62, 1, 0.14)'),
      border: mode('error.100', 'rgba(248, 113, 113, 0.32)'),
      solid: mode('error.500', 'error.500'),
    },
  },
  chart: {
    axis: mode('neutral.500', white(0.46)),
    grid: mode('neutral.200', white(0.08)),
    muted: mode('neutral.400', white(0.3)),
    line: mode('neutral.600', white(0.7)),
    positive: mode('success.500', 'success.400'),
    negative: mode('error.500', 'error.400'),
    price: mode('warning.600', 'secondary.400'),
    skeletonFrom: mode('neutral.100', white(0.04)),
    skeletonTo: mode('neutral.300', white(0.12)),
  },
  focus: {
    ring: mode('activeState.80', 'activeState.60'),
  },
  // Chakra's own base roles, used by the stock components we spread into the theme.
  'chakra-body-text': mode('neutral.900', white(0.92)),
  'chakra-body-bg': mode('shades.0', '#0B0C10'),
  'chakra-border-color': mode('neutral.200', white(0.1)),
  'chakra-inverse-text': mode('shades.0', 'neutral.900'),
  'chakra-subtle-bg': mode('neutral.50', white(0.04)),
  'chakra-subtle-text': mode('neutral.600', white(0.64)),
  'chakra-placeholder-color': mode('neutral.500', white(0.4)),
} as const

export const semanticTokens = { colors: semanticColors }
