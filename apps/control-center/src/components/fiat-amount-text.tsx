import { Text, type TextProps } from '@chakra-ui/react'

/** Fiat equivalents remain secondary to Bitcoin, but readable as balances. */
export function FiatAmountText(props: TextProps): JSX.Element {
  return (
    <Text
      textStyle={{ base: 'text/xl', md: 'text/2xl' }}
      fontWeight="medium"
      color="neutral.600"
      minW={0}
      overflowWrap="anywhere"
      sx={{ fontVariantNumeric: 'tabular-nums' }}
      {...props}
    />
  )
}
