import { Box, type BoxProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function Wrapper({ children, maxW = '863px', ...props }: { children: ReactNode } & BoxProps): JSX.Element {
  return (
    <Box maxW={maxW} mx="auto" px={[4, 4, 0]} {...props}>
      {children}
    </Box>
  )
}
export interface AppLayoutProps {
  header: ReactNode
  children: ReactNode
  fullWidth?: boolean
}

export function AppLayout({ header, children, fullWidth }: AppLayoutProps): JSX.Element {
  return (
    <Box>
      {header}
      <Wrapper maxW={fullWidth ? '100%' : '863px'}>{children}</Wrapper>
    </Box>
  )
}
