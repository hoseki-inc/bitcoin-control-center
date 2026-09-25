import { menuAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const styleHelpers = createMultiStyleConfigHelpers(menuAnatomy.keys)

const defaultMenuTheme = chakraTheme.components.Menu

const extendedBaseStyle = styleHelpers.definePartsStyle(() => {
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

export const menuTheme = styleHelpers.defineMultiStyleConfig({
  ...defaultMenuTheme,
  baseStyle: extendedBaseStyle,
})
