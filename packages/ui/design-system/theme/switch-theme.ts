import { switchAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(switchAnatomy.keys)

const defaultSwitchTheme = chakraTheme.components.Switch

/**
 * Switches glow Hoseki yellow when on and sit in a quiet groove when off. Chakra's base
 * style is kept: its sizes live in CSS variables set there.
 */
const baseStyle = definePartsStyle((props) => {
  const base = defaultSwitchTheme.baseStyle?.(props)
  return {
    ...base,
    track: {
      ...base?.track,
      bg: 'surface.emphasis',
      boxShadow: 'inset 0 1px 2px rgb(0 0 0 / 0.15)',
      _checked: { ...base?.track?._checked, bg: 'accent.solid' },
      _focusVisible: { boxShadow: '0 0 0 2px var(--hoseki-colors-focus-ring)' },
    },
    thumb: {
      ...base?.thumb,
      bg: 'white',
      boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)',
    },
  }
})

export const switchTheme = defineMultiStyleConfig({ ...defaultSwitchTheme, baseStyle })
