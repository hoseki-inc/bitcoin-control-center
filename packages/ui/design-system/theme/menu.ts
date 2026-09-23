import { menuAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'
import { layerStyles } from './foundation/materials'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(menuAnatomy.keys)

const defaultMenuTheme = chakraTheme.components.Menu

const extendedBaseStyle = definePartsStyle(() => {
  return {
    ...defaultMenuTheme.baseStyle,
    list: {
      ...defaultMenuTheme.baseStyle?.list,
      ...layerStyles['material.menu'],
      p: 1,
      minW: '12rem',
      zIndex: 1,
    },
    item: {
      ...defaultMenuTheme.baseStyle?.item,
      bg: 'transparent',
      color: 'text.primary',
      borderRadius: 'var(--radius-menu-item)',
      px: 3,
      py: 2,
      textStyle: 'text/sm',
      fontWeight: 'medium',
      _hover: { bg: 'surface.muted' },
      _focus: { bg: 'surface.muted' },
      _active: { bg: 'surface.emphasis' },
    },
    divider: {
      ...defaultMenuTheme.baseStyle?.divider,
      borderColor: 'border.subtle',
      my: 1,
    },
  }
})

export const menuTheme = defineMultiStyleConfig({
  ...defaultMenuTheme,
  baseStyle: extendedBaseStyle,
})
