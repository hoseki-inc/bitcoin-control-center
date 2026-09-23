import { popoverAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'
import { layerStyles } from './foundation/materials'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(popoverAnatomy.keys)

const defaultPopoverTheme = chakraTheme.components.Popover

const base = defaultPopoverTheme.baseStyle

const baseStyle = definePartsStyle(() => {
  return {
    ...base,
    content: {
      ...base?.content,
      bg: 'surface.overlay',
      borderColor: 'border.subtle',
      borderRadius: 'var(--radius-menu)',
      boxShadow: 'floating',
      '--popper-arrow-bg': 'var(--hoseki-colors-surface-overlay)',
      _dark: { ...layerStyles.materialMenu, '--popper-arrow-bg': 'rgb(38 39 44)' },
    },
  }
})

export const popoverTheme = defineMultiStyleConfig({ ...defaultPopoverTheme, baseStyle })
