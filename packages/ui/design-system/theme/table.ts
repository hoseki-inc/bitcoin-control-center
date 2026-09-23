import { tableAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'

const styleHelpers = createMultiStyleConfigHelpers(tableAnatomy.keys)

const extendedBaseStyle = styleHelpers.definePartsStyle({
  ...chakraTheme.components.Table.baseStyle,
  table: {
    ...chakraTheme.components.Table.baseStyle?.table,
    borderColor: 'neutral.200',
    borderWidth: '1px',
    borderLeft: 'none',
    borderRight: 'none',
  },
  th: {
    ...chakraTheme.components.Table.baseStyle?.th,
    fontWeight: 'medium',
    textTransform: 'none',
    borderLeft: 'none',
    borderRight: 'none',

    // These are not working, no idea why
    // textStyle: 'text/sm',
    // color: 'neutral.900',
  },
  td: {
    ...chakraTheme.components.Table.baseStyle?.td,
    borderLeft: 'none',
    borderRight: 'none',
  },
})

export const tableTheme = styleHelpers.defineMultiStyleConfig({
  ...chakraTheme.components.Table,
  baseStyle: extendedBaseStyle,
  defaultProps: {
    ...chakraTheme.components.Table.defaultProps,
    variant: 'simple',
  },
})
