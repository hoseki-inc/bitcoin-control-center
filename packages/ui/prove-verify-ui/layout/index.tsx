import { Box, type BoxProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export function Wrapper({ children, maxW = '863px', ...props }: { children: ReactNode } & BoxProps): JSX.Element {
  return (
    <Box maxW={maxW} mx="auto" px={{ base: 4, md: 6 }} {...props}>
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
      <Wrapper
        as="main"
        id="main-content"
        tabIndex={-1}
        pb={{ base: 8, md: 12 }}
        maxW={fullWidth ? '100%' : '928px'}
        px={fullWidth ? 0 : { base: 4, md: 6 }}
      >
        {children}
      </Wrapper>
    </Box>
  )
}
