import { Box, type BoxProps } from '@chakra-ui/react'

export function Card({
  skipPadding = false,
  children,
  ...rest
}: { skipPadding?: boolean; children: React.ReactNode } & BoxProps): JSX.Element {
  return (
    <Box bgColor="white" p={skipPadding ? 0 : 6} borderRadius="panel" {...rest}>
      {children}
    </Box>
  )
}
