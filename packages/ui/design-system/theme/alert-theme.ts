import { alertAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(alertAnatomy.keys)

const defaultAlertTheme = chakraTheme.components.Alert

const baseStyle = definePartsStyle((props) => {
  const { colorScheme: c } = props

  return {
    ...defaultAlertTheme.baseStyle,
    container: {
      ...defaultAlertTheme.baseStyle?.container,
      bgColor: `${c}.100`,
      border: 'none',
      borderRadius: 4,
      '& a': {
        color: `${c}.700`,
        textDecoration: 'none',

        _hover: {
          color: `${c}.800`,
          textDecoration: 'underline',
        },
      },
    },
    title: {
      ...defaultAlertTheme.baseStyle?.title,
      color: `${c}.800`,
      textStyle: 'text/sm',
      fontWeight: 'medium',
    },
    description: {
      ...defaultAlertTheme.baseStyle?.description,
      color: `${c}.800`,
      textStyle: 'text/sm',
      fontWeight: 'normal',
    },
    icon: {
      ...defaultAlertTheme.baseStyle?.icon,
      color: `${c}.600`,
      boxSize: 3,
      mr: 2,
    },
  }
})

export const alertTheme = defineMultiStyleConfig({
  ...defaultAlertTheme,
  baseStyle,
  defaultProps: {
    variant: 'solid',
  },
})
