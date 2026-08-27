import { Box, type BoxProps, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function Badge({ children, ...rest }: { children: ReactNode } & BoxProps): JSX.Element {
  return (
    <Box bgColor="neutral.50" mr={2} py={0.5} px={1.5} borderRadius="24px" {...rest}>
      <Text textStyle="label/sm" color="neutral.500">
        {children}
      </Text>
    </Box>
  )
}
