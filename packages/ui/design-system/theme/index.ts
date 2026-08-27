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
import { tableTheme } from './table'
import { textareaTheme } from './textarea-theme'
import { tooltipTheme } from './tooltip'

const { Drawer, FormError, Select } = chakraTheme.components

export const theme = extendBaseTheme({
  styles: {
    global: {
      body: {
        fontSize: 'sm',
        color: 'gray.900',
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
  },
  components: {
    ...chakraTheme.components,
    Accordion: accordionTheme,
    Alert: alertTheme,
    Button: buttonTheme,
    Drawer,
    FormError,
    FormLabel: formLabelTheme,
    Input: inputTheme,
    Menu: menuTheme,
    PinInput: pinInputTheme,
    Progress: progressTheme,
    Modal: modalTheme,
    Select,
    Table: tableTheme,
    Textarea: textareaTheme,
    Tooltip: tooltipTheme,
  },
  colors: tokens.colors,
})

export * from './button-theme'
