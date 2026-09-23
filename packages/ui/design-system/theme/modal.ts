import { modalAnatomy as parts } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const styleHelpers = createMultiStyleConfigHelpers(parts.keys)

const extendedBaseStyle = styleHelpers.definePartsStyle((props) => {
  const baseStyle = chakraTheme.components.Modal.baseStyle?.(props)

  return {
    ...baseStyle,
    dialog: {
      ...baseStyle?.dialog,
      p: 6,
      pt: 8,
      gap: 4,
    },
    header: {
      ...baseStyle?.header,
      p: 0,
    },
    body: {
      ...baseStyle?.body,
      p: 0,
    },
    footer: {
      ...baseStyle?.footer,
      p: 0,
    },
  }
})

const noPaddingVariant = styleHelpers.definePartsStyle((props) => {
  const baseStyle = chakraTheme.components.Modal.baseStyle?.(props)

  return {
    ...baseStyle,
    dialog: {
      ...baseStyle?.dialog,
      p: 0,
    },
    header: {
      ...baseStyle?.header,
      p: 0,
    },
    body: {
      ...baseStyle?.body,
      p: 0,
    },
    footer: {
      ...baseStyle?.footer,
      p: 0,
    },
  }
})

export const modalTheme = styleHelpers.defineMultiStyleConfig({
  ...chakraTheme.components.Modal,
  baseStyle: extendedBaseStyle,
  variants: {
    ...chakraTheme.components.Modal.variants,
    noPadding: noPaddingVariant,
  },
  defaultProps: {
    ...chakraTheme.components.Modal.defaultProps,
    variant: undefined, // Override the variant to be undefined by default
  },
})
