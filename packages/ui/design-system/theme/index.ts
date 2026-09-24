import { theme as chakraTheme, extendBaseTheme } from '@chakra-ui/react'
import { accordionTheme } from './accordion'
import { alertTheme } from './alert-theme'
import { buttonTheme } from './button-theme'
import { formLabelTheme } from './form-label-theme'
import { layerStyles, materialGlobalStyles } from './foundation/materials'
import { semanticTokens } from './foundation/semantic-tokens'
import { tokens } from './foundation/tokens'
import { chakraTextStyles } from './foundation/typography'
import { inputTheme } from './input-theme'
import { menuTheme } from './menu'
import { modalTheme } from './modal'
import { pinInputTheme } from './pin-input-theme'
import { popoverTheme } from './popover'
import { progressTheme } from './progress-theme'
import { switchTheme } from './switch-theme'
import { tableTheme } from './table'
import { textareaTheme } from './textarea-theme'
import { tooltipTheme } from './tooltip'

const { Drawer, FormError, Select } = chakraTheme.components

export const theme = extendBaseTheme({
  styles: {
    global: {
      ...materialGlobalStyles,
      html: { scrollbarGutter: 'stable' },
      body: {
        textStyle: 'text/sm',
        color: 'text.primary',
        bg: 'surface.base',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      },
      '::selection': { bg: 'accent.solid', color: 'accent.fg' },
      // The appearance toggle reveals the new theme with its own clip-path animation.
      '::view-transition-old(root), ::view-transition-new(root)': { animation: 'none', mixBlendMode: 'normal' },
      ':focus-visible': { outline: '2px solid', outlineColor: 'focus.ring', outlineOffset: '3px' },
      '@media (prefers-reduced-motion: reduce)': {
        '*, *::before, *::after': {
          animationDuration: '0.01ms !important',
          animationIterationCount: '1 !important',
          transitionDuration: '0.01ms !important',
          scrollBehavior: 'auto !important',
        },
      },
    },
  },
  textStyles: chakraTextStyles,
  config: {
    // The app's appearance store resolves system/light/dark and drives Chakra's mode.
    useSystemColorMode: false,
    initialColorMode: 'light',
    cssVarPrefix: 'hoseki',
  },
  semanticTokens,
  layerStyles,
  fonts: {
    heading: `'Geist', sans-serif`,
    body: `'Geist', sans-serif`,
    mono: `'Geist Mono', monospace`,
  },
  fontWeights: { normal: 400, regular: 400, light: 400, medium: 500, semibold: 600, bold: 600 },
  radii: tokens.radii,
  shadows: tokens.shadows,
  components: {
    ...chakraTheme.components,
    Accordion: accordionTheme,
    Alert: alertTheme,
    Button: buttonTheme,
    Heading: {
      ...chakraTheme.components.Heading,
      baseStyle: { ...chakraTheme.components.Heading.baseStyle, fontWeight: 'medium', color: 'text.primary' },
    },
    Drawer,
    FormError,
    FormLabel: formLabelTheme,
    Input: inputTheme,
    Menu: menuTheme,
    PinInput: pinInputTheme,
    Popover: popoverTheme,
    Progress: progressTheme,
    Switch: switchTheme,
    Modal: modalTheme,
    Select: {
      ...Select,
      sizes: {
        ...Select.sizes,
        sm: {
          ...Select.sizes?.sm,
          field: {
            ...Select.sizes?.sm?.field,
            textStyle: { base: 'text/md', md: 'text/sm' },
            h: { base: '2.75rem', md: '2rem' },
          },
        },
      },
    },
    Table: tableTheme,
    Textarea: textareaTheme,
    Tooltip: tooltipTheme,
  },
  colors: tokens.colors,
})

export * from './button-theme'
