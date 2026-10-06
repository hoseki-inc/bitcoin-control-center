import { Box, type BoxProps, Stack, type StackProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { PageTransition } from '../design-system'
import { WizardFooter } from './wizard-footer'

export function ClaimConnectionWrapper({
  children,
  maxW = '672px',
  ...props
}: { children: ReactNode; maxW?: BoxProps['maxW'] } & Omit<StackProps, 'maxW'>): JSX.Element {
  return (
    <Box
      w="full"
      maxW={maxW}
      minW={0}
      px={[0, 0, 4]}
      // The app layout already pads the page bottom on wider screens, so only add enough to clear the fixed footer.
      pb={{ base: WizardFooter.padding, md: 12 }}
      mx="auto"
      boxSizing="border-box"
    >
      <PageTransition>
        <Stack {...props}>{children}</Stack>
      </PageTransition>
    </Box>
  )
}
