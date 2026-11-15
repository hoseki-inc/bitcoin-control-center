import { Th as ChakraTh, type TableColumnHeaderProps } from '@chakra-ui/react'
import { chakraTextStyles } from '../design-system/theme/foundation/typography'

// The table theme's size styles override a textStyle prop on Th, so the token's values go through sx.
export function Th({ children, ...props }: TableColumnHeaderProps): JSX.Element {
  return (
    <ChakraTh sx={chakraTextStyles['text/sm']} color="neutral.900" {...props}>
      {children}
    </ChakraTh>
  )
}
