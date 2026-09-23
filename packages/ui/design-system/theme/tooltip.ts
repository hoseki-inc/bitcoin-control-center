import { theme as chakraTheme, defineStyleConfig } from '@chakra-ui/react'
import { layerStyles } from './foundation/materials'

const baseStyle = {
  ...chakraTheme.components.Tooltip.baseStyle,
  py: 1.5,
  px: 2.5,
  bg: 'surface.overlay',
  color: 'text.primary',
  border: '1px solid',
  borderColor: 'border.subtle',
  borderRadius: 'xl',
  boxShadow: 'lg',
  fontWeight: 'medium',
  '--popper-arrow-bg': 'var(--hoseki-colors-surface-overlay)',
  _dark: { ...layerStyles.material, borderRadius: 'xl', '--popper-arrow-bg': 'rgb(38 39 44)' },
}

export const tooltipTheme = defineStyleConfig({ baseStyle })
