import { accordionAnatomy } from '@chakra-ui/anatomy'
import { createMultiStyleConfigHelpers } from '@chakra-ui/react'

/**
 * Chakra Accordion theming:
 * https://v2.chakra-ui.com/docs/components/accordion/theming
 */
const { definePartsStyle, defineMultiStyleConfig } = createMultiStyleConfigHelpers(accordionAnatomy.keys)

const baseStyle = definePartsStyle({
  container: {
    border: 'solid 1px',
    borderColor: 'border.subtle',
    borderRadius: 'md',
    px: 6,
  },
  item: {
    border: 'none',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    py: 4,
    px: 0,
    border: 'none',
    _hover: {
      bg: 'transparent',
    },
  },
  panel: {
    pb: 4,
    px: 0,
    border: 'none',
  },
  icon: {
    // Ensure chevron is always aligned to the far right.
    marginInlineStart: 'auto',
  },
})

export const accordionTheme = defineMultiStyleConfig({
  baseStyle,
})
