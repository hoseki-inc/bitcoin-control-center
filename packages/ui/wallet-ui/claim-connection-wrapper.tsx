import { Box, Stack, type StackProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { PageTransition } from '../design-system'
import { WizardFooter } from './wizard-footer'

export function ClaimConnectionWrapper({ children, ...props }: { children: ReactNode } & StackProps): JSX.Element {
  return (
    <Box w={['100%', '100%', '640px']} px={[0, 0, 4]} pb={WizardFooter.padding} mx="auto" boxSizing="content-box">
      <PageTransition>
        <Stack {...props}>{children}</Stack>
      </PageTransition>
    </Box>
  )
}
