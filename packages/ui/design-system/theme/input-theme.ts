import { inputAnatomy } from '@chakra-ui/anatomy'
import { createMultiStyleConfigHelpers } from '@chakra-ui/react'
import { inputProps } from '../../design-system'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(inputAnatomy.keys)

const baseStyle = definePartsStyle({
  field: {
    width: '100%',
    fontWeight: 400,
    ...inputProps,
    _invalid: {
      borderColor: 'red.500',
      bgColor: 'red.50',
    },
  },
})

const variants = {
  tertiary: definePartsStyle({
    field: {
      bg: '#1D1F2A', // dark background
      border: 'none',
      borderRadius: 'md',
      color: '#E2E8F0', // light text
      _placeholder: {
        color: '#A0AEC0', // gray placeholder
      },
      _hover: {
        bg: '#2A2D3E',
      },
      _focus: {
        bg: '#2A2D3E',
        boxShadow: 'none',
      },
    },
  }),
}

const sizes = {
  sm: definePartsStyle({
    field: {
      textStyle: 'text/sm',
      h: '2rem',
    },
  }),
  md: definePartsStyle({
    field: {
      textStyle: 'text/md',
      h: '2.75rem',
    },
  }),
  lg: definePartsStyle({
    field: {
      textStyle: 'text/md',
      px: 4,
      h: '3.25rem', // 52px
    },
  }),
  xl: definePartsStyle({
    field: {
      textStyle: 'text/md',
      px: 4,
      h: '3.625rem', // 58px
    },
  }),
}

export const inputTheme = defineMultiStyleConfig({
  baseStyle,
  variants,
  sizes,
})
