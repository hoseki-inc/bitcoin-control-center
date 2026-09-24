import { Box, HStack } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { Wrapper } from '../prove-verify-ui'

/**
 * Actions for a step-by-step flow, pinned to the bottom of the window above the dock.
 * No card: content scrolling underneath softens into a blurred fade, the way a sheet
 * toolbar does, and the back action is a quiet text button so the next step leads.
 */
export function WizardFooter({
  leftButton,
  rightButton,
}: {
  leftButton?: ReactNode
  rightButton?: ReactNode
}): JSX.Element {
  return (
    <Box position="sticky" bottom="var(--sheet-footer-offset, 16px)" zIndex={10} mt={8}>
      <Box
        aria-hidden
        position="absolute"
        // Runs past the content column and down to the window's bottom edge, where the
        // sheet clips it, so the only visible edge is the soft fade at the top.
        insetX="-50vw"
        top={-10}
        bottom="-200px"
        pointerEvents="none"
        bg="var(--footer-fade)"
        sx={{
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          maskImage: 'linear-gradient(to bottom, transparent, black 60px)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 60px)',
        }}
      />
      <Wrapper maxW="928px" px={0} position="relative">
        <HStack
          justifyContent={leftButton ? 'space-between' : 'flex-end'}
          width="full"
          minH="44px"
          gap={3}
          flexWrap="wrap"
        >
          {leftButton && (
            <Box
              sx={{
                // Back is secondary navigation: a text button with a leading chevron.
                '& .chakra-button': {
                  bg: 'transparent',
                  border: 'none',
                  boxShadow: 'none',
                  color: 'text.secondary',
                  pl: 2,
                  _hover: { bg: 'surface.muted', color: 'text.primary' },
                },
                '& .chakra-button::before': { content: '"‹"', fontSize: '1.4em', lineHeight: 1, mr: 1.5, mt: '-2px' },
              }}
            >
              {leftButton}
            </Box>
          )}
          {rightButton}
        </HStack>
      </Wrapper>
    </Box>
  )
}

// The footer sits in the flow now, so pages no longer need to reserve room beneath their content.
WizardFooter.padding = 0
