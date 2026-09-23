import { defineStyle, defineStyleConfig } from '@chakra-ui/react'

const sizes = {
  xs: defineStyle({ textStyle: 'label/xs' }),
  sm: defineStyle({ textStyle: 'label/sm' }),
  md: defineStyle({ textStyle: 'label/md' }),
  lg: defineStyle({ textStyle: 'label/lg' }),
}

export const formLabelTheme = defineStyleConfig({
  baseStyle: {
    color: 'text.tertiary',
    display: 'inline-block',
    mb: 1,
  },
  sizes,
  defaultProps: {
    size: 'md',
  },
})
