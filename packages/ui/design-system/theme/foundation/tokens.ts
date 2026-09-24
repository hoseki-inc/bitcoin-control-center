import { colors } from './colors'

export const tokens = {
  colors,
  radii: {
    control: '8px',
    // Softer corners suit glass windows; dialogs and windows go rounder still.
    panel: '16px',
    dialog: '16px',
  },
  shadows: {
    floating: '0 16px 48px -12px rgba(15, 23, 42, 0.2)',
  },
} as const
