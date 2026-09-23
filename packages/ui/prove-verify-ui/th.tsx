import { Th as ChakraTh, type TableColumnHeaderProps } from '@chakra-ui/react'

// NOTE: See comment in /design-system/theme/table.ts
export function Th({ children, ...props }: TableColumnHeaderProps): JSX.Element {
  return (
    <ChakraTh fontSize="14px" color="text.primary" {...props}>
      {children}
    </ChakraTh>
  )
}
