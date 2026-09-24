const disabledColors = {
  bgColor: 'surface.emphasis',
  color: 'text.tertiary',
} as const

const baseStyle = {
  '@media (pointer: coarse)': { minH: '44px', minW: '44px' },
  fontFamily: 'body',
  fontWeight: 'medium',
  // Pills sit naturally on glass and match the dock, search and menus.
  borderRadius: 'full',
  transitionProperty: 'common',
  transitionDuration: 'normal',

  outlineWidth: '2px',
  outlineOffset: '3px',
  _focusVisible: { outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' },

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
  bgColor: 'surface.inverse',
  color: 'text.inverse',

  _hover: {
    bgColor: 'surface.inverse',
  },
  _active: {
    bgColor: 'surface.inversePressed',
  },
  _disabled: {
    bgColor: 'surface.emphasis',
    color: 'text.tertiary',
  },
} as const

const variants = {
  primary: primaryVariant,

  outline: {
    bgColor: 'var(--edge-bg)',
    color: 'text.primary',
    border: '1px solid',
    borderColor: 'border.subtle',
    boxShadow: 'var(--edge-shadow)',

    _hover: {
      bgColor: 'surface.subtle',
    },
    _active: {
      bgColor: 'surface.muted',
    },
    _disabled: {
      borderColor: 'border.subtle',
      bgColor: 'transparent',
    },
  },

  ghost: {
    bgColor: 'transparent',
    color: 'text.primary',

    _hover: {
      bgColor: 'surface.subtle',
    },
    _active: {
      bgColor: 'surface.muted',
    },
    _disabled: {
      bgColor: 'transparent',
    },
  },

  tertiary: {
    bgColor: 'transparent',
    color: 'text.primary',

    _hover: {
      bgColor: 'surface.subtle',
    },
    _active: {
      bgColor: 'surface.muted',
    },
    _disabled: {
      bgColor: 'transparent',
    },
  },

  error: {
    bgColor: 'surface.raised',
    color: 'status.error.fg',

    _hover: {
      bgColor: 'status.error.bg',

      _disabled: {
        bgColor: 'status.error.bg',
        color: 'text.tertiary',
      },
    },
    _active: {
      bgColor: 'status.error.bg',
    },
    _disabled: {
      bgColor: 'transparent',
      color: 'status.error.fg',
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
