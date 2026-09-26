import { Box, HStack } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Wrapper } from '../prove-verify-ui'

export function WizardFooter({
  leftButton,
  rightButton,
}: {
  leftButton?: ReactNode
  rightButton?: ReactNode
}): JSX.Element {
  return (
    <Box
      borderTop="1px solid"
      borderColor="neutral.200"
      bgColor="white"
      px={8}
      py={4}
      position="fixed"
      bottom={0}
      left={0}
      width="100%"
      zIndex={10}
    >
      <Wrapper>
        <HStack justifyContent={Boolean(leftButton) ? 'space-between' : 'flex-end'} width="full" minH="50px">
          {leftButton}
          {rightButton}
        </HStack>
      </Wrapper>
    </Box>
  )
}

WizardFooter.padding = 24
