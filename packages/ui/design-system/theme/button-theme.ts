const disabledColors = {
  bgColor: 'neutral.200',
  color: 'neutral.400',
} as const

const baseStyle = {
  fontFamily: 'body',
  fontWeight: 'medium',
  borderRadius: 'control',
  transitionProperty: 'common',
  transitionDuration: 'normal',

  outlineWidth: '2px',
  outlineOffset: '3px',
  _focusVisible: { outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' },

  _hover: {
    cursor: 'pointer',
    _disabled: {
      ...disabledColors,
    },
  },
  _active: {
    transitionTimingFunction: 'ease-in-out', // Chakra overrides this with `cubic-bezier(0.4, 0, 0.2, 1)`, don't know how to disable this yet
    transitionDuration: '150ms',
  },
  _disabled: {
    ...disabledColors,
    pointerEvents: 'none',
  },
} as const

const sizes = {
  xs: {
    h: '2rem',
    minW: '2rem',
    px: 3,
    textStyle: 'text/xs',
  },
  lg: {
    h: '3.5rem',
    minW: '3.5rem',
    px: '20px',
    py: '14px',
    textStyle: 'text/lg',
    fontWeight: 'medium',
  },
  md: {
    h: '2.75rem',
    minW: '2.75rem',
    px: '16px',
    py: '12px',
    textStyle: 'text/sm',
    fontWeight: 'medium',
  },
  sm: {
    h: '2.25rem',
    minW: '2.25rem',
    px: '16px',
    py: '8px',
    textStyle: 'text/xs',
    fontWeight: 'medium',
  },
} as const

export const primaryVariant = {
  bgColor: 'neutral.900',
  color: 'neutral.50',

  _hover: {
    bgColor: 'neutral.800',
  },
  _active: {
    bgColor: 'neutral.700',
  },
  _focus: {
    bgColor: 'neutral.700',
    outlineColor: 'activeState.80',
  },
  _disabled: {
    bgColor: 'neutral.200',
    color: 'neutral.400',
  },
} as const

const variants = {
  primary: primaryVariant,

  outline: {
    bgColor: 'shades.0',
    color: 'neutral.900',
    border: '1px solid',
    borderColor: 'neutral.200',

    _hover: {
      bgColor: 'neutral.50',
    },
    _active: {
      bgColor: 'neutral.100',
    },
    _focus: {
      bgColor: 'neutral.100',
      outlineColor: 'activeState.80',
    },
    _disabled: {
      borderColor: 'neutral.200',
      bgColor: 'transparent',
    },
  },

  ghost: {
    bgColor: 'transparent',
    color: 'neutral.900',

    _hover: {
      bgColor: 'neutral.50',
    },
    _active: {
      bgColor: 'neutral.100',
    },
    _focus: {
      bgColor: 'neutral.100',
      outlineColor: 'activeState.80',
    },
    _disabled: {
      bgColor: 'transparent',
    },
  },

  tertiary: {
    bgColor: 'transparent',
    color: 'neutral.900',

    _hover: {
      bgColor: 'neutral.50',
    },
    _active: {
      bgColor: 'neutral.100',
    },
    _focus: {
      bgColor: 'neutral.100',
      outlineColor: 'activeState.80',
    },
    _disabled: {
      bgColor: 'transparent',
    },
  },

  error: {
    bgColor: 'shades.0',
    color: 'error.600',

    _hover: {
      bgColor: 'error.50',

      _disabled: {
        bgColor: 'error.100',
        color: 'neutral.50',
      },
    },
    _active: {
      bgColor: 'error.100',
    },
    _focus: {
      bgColor: 'error.100',
      outlineColor: 'activeState.80',
    },
    _disabled: {
      bgColor: 'transparent',
      color: 'error.100',
    },
  },
} as const

const defaultProps = {
  size: 'md',
  variant: 'primary',
} as const

export type ButtonSizes = keyof typeof sizes
export type ButtonVariants = keyof typeof variants

/** See: https://www.figma.com/file/2sLeuoy2vF9LEQH648zYZC/Hoseki-Design-System?node-id=3%3A13 */
export const buttonTheme = {
  baseStyle,
  sizes,
  variants,
  defaultProps,
} as const
