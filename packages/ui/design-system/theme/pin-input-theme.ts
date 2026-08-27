import { theme as chakraTheme, defineStyle, defineStyleConfig } from '@chakra-ui/react'

const sizes = {
  md: defineStyle({ width: 'auto', height: '52px' }),
}

export const pinInputTheme = defineStyleConfig({
  baseStyle: {
    ...chakraTheme.components.PinInput.baseStyle,
    border: '1px solid',
    borderColor: 'neutral.300',
    borderRadius: 'md',
  },
  sizes,
  defaultProps: {
    size: 'md',
  },
})
