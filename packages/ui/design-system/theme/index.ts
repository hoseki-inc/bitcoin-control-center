import { theme as chakraTheme, extendBaseTheme } from '@chakra-ui/react'
import { accordionTheme } from './accordion'
import { alertTheme } from './alert-theme'
import { buttonTheme } from './button-theme'
import { formLabelTheme } from './form-label-theme'
import { tokens } from './foundation/tokens'
import { chakraTextStyles } from './foundation/typography'
import { inputTheme } from './input-theme'
import { menuTheme } from './menu'
import { modalTheme } from './modal'
import { pinInputTheme } from './pin-input-theme'
import { progressTheme } from './progress-theme'
import { skeletonTheme } from './skeleton-theme'
import { tableTheme } from './table'
import { textareaTheme } from './textarea-theme'
import { tooltipTheme } from './tooltip'

const { Drawer, FormError, Select } = chakraTheme.components
// Chakra defaults Heading to size="xl", whose responsive fontSize overrides textStyle. Drop the default so
// textStyle sets heading size; an explicit size prop still works.
const { defaultProps: _headingDefaultProps, ...chakraHeading } = chakraTheme.components.Heading

export const theme = extendBaseTheme({
  styles: {
    global: {
      html: { scrollbarGutter: 'stable' },
      body: {
        textStyle: 'text/sm',
        color: 'neutral.900',
        bg: 'white',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      },
      '::selection': { bg: 'secondary.400', color: 'neutral.900' },
      ':focus-visible': { outline: '2px solid', outlineColor: 'activeState.80', outlineOffset: '3px' },
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
    useSystemColorMode: false,
    initialColorMode: 'light',
    cssVarPrefix: 'hoseki',
  },
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
      ...chakraHeading,
      baseStyle: { ...chakraHeading.baseStyle, fontWeight: 'medium', color: 'neutral.900' },
    },
    Drawer,
    FormError,
    FormLabel: formLabelTheme,
    Input: inputTheme,
    Menu: menuTheme,
    PinInput: pinInputTheme,
    Progress: progressTheme,
    Modal: modalTheme,
    Select: {
      ...Select,
      sizes: {
        ...Select.sizes,
        sm: {
          ...Select.sizes?.sm,
          field: {
            ...Select.sizes?.sm.field,
            textStyle: { base: 'text/md', md: 'text/sm' },
            h: { base: '2.75rem', md: '2rem' },
          },
        },
      },
    },
    Skeleton: skeletonTheme,
    Table: tableTheme,
    Textarea: textareaTheme,
    Tooltip: tooltipTheme,
  },
  colors: tokens.colors,
})

export * from './button-theme'
