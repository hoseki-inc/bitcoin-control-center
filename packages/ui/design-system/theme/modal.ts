import { modalAnatomy as parts } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const styleHelpers = createMultiStyleConfigHelpers(parts.keys)

const extendedBaseStyle = styleHelpers.definePartsStyle((props) => {
  const baseStyle = chakraTheme.components.Modal.baseStyle?.(props)

  return {
    ...baseStyle,
    overlay: {
      ...baseStyle?.overlay,
      bg: 'blackAlpha.400',
      backdropFilter: 'blur(8px)',
    },
    dialog: {
      ...baseStyle?.dialog,
      p: { base: 5, md: 6 },
      borderRadius: 'dialog',
      boxShadow: 'floating',
      mx: 4,
      gap: 4,
    },
    header: {
      ...baseStyle?.header,
      p: 0,
      pe: 8,
      overflowWrap: 'anywhere',
      textStyle: 'text/xl',
      fontWeight: 'medium',
    },
    body: {
      ...baseStyle?.body,
      p: 0,
    },
    footer: {
      ...baseStyle?.footer,
      p: 0,
      flexWrap: 'wrap',
      gap: 3,
    },
    closeButton: {
      ...baseStyle?.closeButton,
      top: 2,
      insetEnd: 2,
      minW: 11,
      minH: 11,
    },
  }
})

const noPaddingVariant = styleHelpers.definePartsStyle((props) => {
  const baseStyle = extendedBaseStyle(props)

  return {
    ...baseStyle,
    dialog: {
      ...baseStyle.dialog,
      p: 0,
    },
    header: {
      ...baseStyle.header,
      p: 0,
    },
    body: {
      ...baseStyle.body,
      p: 0,
    },
    footer: {
      ...baseStyle.footer,
      p: 0,
      flexWrap: 'wrap',
      gap: 3,
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
