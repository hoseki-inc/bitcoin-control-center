import { menuAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(menuAnatomy.keys)

const defaultMenuTheme = chakraTheme.components.Menu

const extendedBaseStyle = definePartsStyle(() => {
  return {
    ...defaultMenuTheme.baseStyle,
    item: {
      ...defaultMenuTheme.baseStyle?.item,
      _hover: {
        bg: 'gray.50',
      },
    },
  }
})

export const menuTheme = defineMultiStyleConfig({
  ...defaultMenuTheme,
  baseStyle: extendedBaseStyle,
})
