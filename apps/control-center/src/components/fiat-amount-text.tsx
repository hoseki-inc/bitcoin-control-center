import { Text, type TextProps } from '@chakra-ui/react'

/** Fiat equivalents remain secondary to Bitcoin, but readable as balances. */
export function FiatAmountText({ primary = false, ...props }: TextProps & { primary?: boolean }): JSX.Element {
  return (
    <Text
      textStyle={primary ? { base: 'text/xl', md: 'text/2xl' } : 'text/md'}
      fontWeight={primary ? 'medium' : 'normal'}
      color="text.secondary"
      minW={0}
      overflowWrap="anywhere"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
      {...props}
    />
  )
}
