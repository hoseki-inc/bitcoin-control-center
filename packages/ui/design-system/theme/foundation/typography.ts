const fontFamily = "'Geist', sans-serif"

export const fontWeights = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

const baseStyles = {
  fontFamily,
  fontWeight: fontWeights.regular,
}

const headingStyles = {
  ...baseStyles,
  lineHeight: 1.2,
}

const paragraphStyles = {
  ...baseStyles,
  lineHeight: 1.5,
}

/* New Design System Tokens */
export const newTextStyles = {
  // Principal holdings amount.
  'amount/primary': {
    fontSize: '2.25rem',
    lineHeight: '2.75rem',
    letterSpacing: '-0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  'amount/compact': {
    fontSize: '1.75rem',
    lineHeight: '2.25rem',
    letterSpacing: '-0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  // Text
  'text/8xl': {
    fontSize: '3.25rem', // 52px
    lineHeight: '3.5rem', // 56px
    letterSpacing: '-0.065rem', // -1.04px
  },
  'text/7xl': {
    fontSize: '2.75rem', // 44px
    lineHeight: '3rem', // 48px
    letterSpacing: '-0.055rem', // -0.88px
  },
  'text/6xl': {
    fontSize: '2.5rem', // 40px
    lineHeight: '3rem', // 48px
    letterSpacing: '-0.05rem', // -0.8px
  },
  'text/5xl': {
    fontSize: '2.25rem', // 36px
    lineHeight: '2.75rem', // 44px
    letterSpacing: '-0.045rem', // -0.72px
  },
  'text/4xl': {
    fontSize: '2rem', // 32px
    lineHeight: '2.5rem', // 40px
    letterSpacing: '-0.04rem', // -0.64px
  },
  'text/3xl': {
    fontSize: '1.75rem', // 28px
    lineHeight: '2.25rem', // 36px
    letterSpacing: '-0.035rem', // -0.56px
  },
  'text/2xl': {
    fontSize: '1.5rem', // 24px
    lineHeight: '2rem', // 32px
    letterSpacing: '-0.03rem', // -0.48px
  },
  'text/xl': {
    fontSize: '1.25rem', // 20px
    lineHeight: '1.75rem', // 28px
    letterSpacing: '-0.025rem', // -0.4px
  },
  'text/lg': {
    fontSize: '1.125rem', // 18px
    lineHeight: '1.75rem', // 28px
  },
  'text/md': {
    fontSize: '1rem', // 16px
    lineHeight: '1.5rem', // 24px
  },
  'text/sm': {
    fontSize: '0.875rem', // 14px
    lineHeight: '1.25rem', // 20px
  },
  'text/xs': {
    fontSize: '0.75rem', // 12px
    lineHeight: '1.25rem', // 20px
  },

  // Overline
  'overline/lg': {
    fontSize: '1rem', // 16px
    lineHeight: '1.375rem', // 22px
    letterSpacing: '0.0625rem', // 1px
    textTransform: 'uppercase',
  },
  'overline/md': {
    fontSize: '0.875rem', // 14px
    lineHeight: '1.125rem', // 18px
    letterSpacing: '0.0625rem', // 1px
    textTransform: 'uppercase',
  },
  'overline/sm': {
    fontSize: '0.75rem', // 12px
    lineHeight: '1rem', // 16px
    letterSpacing: '0.0625rem', // 1px
    textTransform: 'uppercase',
  },

  // Label
  'label/lg': {
    fontSize: '1rem', // 16px
    lineHeight: '1.125rem', // 18px
  },
  'label/md': {
    fontSize: '0.875rem', // 14px
    lineHeight: '1rem', // 16px
  },
  'label/sm': {
    fontSize: '0.75rem', // 12px
    lineHeight: '0.875rem', // 14px
  },
  'label/xs': {
    fontSize: '0.625rem', // 10px
    lineHeight: '0.875rem', // 14px
  },
} as const

/* Old Design System Tokens */
export const oldTextStyles = {
  'heading/md': {
    ...headingStyles,
    fontSize: '1.75rem',
    letterSpacing: '-0.035rem',
  },
  'heading/sm': {
    ...headingStyles,
    fontSize: '1.4375rem',
    letterSpacing: '-0.02875rem',
  },
  'heading/xs': {
    ...headingStyles,
    fontSize: '1.1875rem',
    letterSpacing: '-0.02375rem',
  },
  'paragraph/lg': {
    ...paragraphStyles,
    fontSize: '1.125rem',
  },
  'paragraph/md': {
    ...paragraphStyles,
    fontSize: '1rem',
  },
  'paragraph/sm': {
    ...paragraphStyles,
    fontSize: '0.875rem',
  },
  caption: {
    ...baseStyles,
    fontSize: '0.75rem',
  },
  micro: {
    ...baseStyles,
    fontSize: '0.625rem',
  },
  footer: {
    ...baseStyles,
    fontSize: '0.625rem',
    letterSpacing: '0.0125rem',
  },
}

/**
 * All the rem values here are converted from pixel values by dividing by 16.
 */
export const chakraTextStyles = {
  ...newTextStyles,
  ...oldTextStyles,
} as const
