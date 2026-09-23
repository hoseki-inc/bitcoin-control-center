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
    // A floating glass bar that sticks to the bottom of the window, clear of the dock.
    <Box position="sticky" bottom="var(--sheet-footer-offset, 16px)" zIndex={10} mt={6} px={0}>
      <Wrapper maxW="928px" px={0}>
        <HStack
          layerStyle="materialMenu"
          justifyContent={leftButton ? 'space-between' : 'flex-end'}
          width="full"
          minH="44px"
          gap={3}
          flexWrap="wrap"
          p={2}
        >
          {leftButton}
          {rightButton}
        </HStack>
      </Wrapper>
    </Box>
  )
}

WizardFooter.padding = 24
