import { theme as chakraTheme, defineStyleConfig } from '@chakra-ui/react'
import { inputProps } from '../../design-system'

const sizes = {
  sm: {
    textStyle: 'text/sm',
  },
  md: {
    textStyle: 'text/md',
    px: 2,
    py: 2,
  },
  lg: {
    textStyle: 'text/md',
    py: 3,
    px: 4,
  },
}

export const textareaTheme = defineStyleConfig({
  baseStyle: {
    ...chakraTheme.components.Textarea.baseStyle,
    ...inputProps,
  },
  sizes,
})
