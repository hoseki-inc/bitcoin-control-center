import { modalAnatomy as parts } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'
import { layerStyles } from './foundation/materials'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(parts.keys)

const extendedBaseStyle = definePartsStyle((props) => {
  const baseStyle = chakraTheme.components.Modal.baseStyle?.(props)

  return {
    ...baseStyle,
    overlay: {
      ...baseStyle?.overlay,
      bg: 'rgba(15, 23, 42, 0.4)',
      backdropFilter: 'blur(8px)',
      _dark: { bg: 'rgba(0, 0, 0, 0.6)' },
    },
    dialog: {
      ...baseStyle?.dialog,
      p: { base: 5, md: 6 },
      bg: 'surface.overlay',
      color: 'text.primary',
      borderRadius: 'var(--radius-modal)',
      boxShadow: 'floating',
      // Dark dialogs are glass; a heavier tint keeps form content legible over busy pages.
      _dark: { ...layerStyles.material, bg: 'rgb(20 21 26 / 0.78)', borderRadius: 'var(--radius-modal)' },
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

const noPaddingVariant = definePartsStyle((props) => {
  const baseStyle = extendedBaseStyle(props)

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
      flexWrap: 'wrap',
      gap: 3,
    },
  }
})

export const modalTheme = defineMultiStyleConfig({
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
