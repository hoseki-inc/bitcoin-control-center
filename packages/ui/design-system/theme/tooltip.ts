import { theme as chakraTheme, defineStyleConfig } from '@chakra-ui/react'

const baseStyle = {
  ...chakraTheme.components.Tooltip.baseStyle,
  py: 1.5,
  px: 2,
  bg: 'white',
  color: 'gray.900',
  border: '1px solid',
  borderColor: 'white',
  borderRadius: 'xl',
  boxShadow: 'lg',
  fontWeight: 'semibold',
  '--popper-arrow-bg': 'white',
}

export const tooltipTheme = defineStyleConfig({ baseStyle })
