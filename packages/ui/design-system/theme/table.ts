import { tableAnatomy } from '@chakra-ui/anatomy'
import { theme as chakraTheme, createMultiStyleConfigHelpers } from '@chakra-ui/react'
import { chakraTextStyles } from './foundation/typography'

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

// Standard data tables use the same typography and spacing for labels and values.
const dataVariant = styleHelpers.definePartsStyle({
  table: { border: 'none', fontFamily: 'body' },
  thead: { bg: 'neutral.50' },
  th: {
    ...chakraTextStyles['text/sm'],
    fontFamily: 'body',
    fontWeight: 'medium',
    color: 'neutral.600',
    textTransform: 'none',
    letterSpacing: 'normal',
    px: 4,
    py: 3,
    whiteSpace: 'nowrap',
    borderBottom: '1px solid',
    borderColor: 'neutral.200',
  },
  td: {
    ...chakraTextStyles['text/sm'],
    fontFamily: 'body',
    fontWeight: 'normal',
    color: 'neutral.900',
    fontVariantNumeric: 'tabular-nums',
    px: 4,
    py: 3,
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
    borderBottom: '1px solid',
    borderColor: 'neutral.200',
  },
  tbody: { 'tr:last-of-type td': { borderBottom: 'none' } },
})

export const tableTheme = styleHelpers.defineMultiStyleConfig({
  ...chakraTheme.components.Table,
  baseStyle: extendedBaseStyle,
  variants: { ...chakraTheme.components.Table.variants, data: dataVariant },
  defaultProps: {
    ...chakraTheme.components.Table.defaultProps,
    variant: 'simple',
  },
})
