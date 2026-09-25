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
      px={0}
      pt={4}
      pb="max(1rem, env(safe-area-inset-bottom))"
      position="fixed"
      bottom={0}
      left={0}
      width="100%"
      zIndex={10}
    >
      <Wrapper maxW="928px">
        <HStack
          justifyContent={Boolean(leftButton) ? 'space-between' : 'flex-end'}
          width="full"
          minH="44px"
          gap={3}
          flexWrap="wrap"
        >
          {leftButton}
          {rightButton}
        </HStack>
      </Wrapper>
    </Box>
  )
}

WizardFooter.padding = 24
