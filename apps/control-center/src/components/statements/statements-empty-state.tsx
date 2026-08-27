import { Box, Button, Stack } from '@chakra-ui/react'
import { LinearGradient } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'

export function StatementsEmptyState(): JSX.Element {
  return (
    <Box pt={4}>
      <Stack position="relative" bgColor="neutral.50" py={4} px={6}>
        <Box position="relative" h="470px">
          <Box
            position="absolute"
            top="0"
            left="0"
            right="0"
            bottom="0"
            bgImage="url('/statements/satoshi-statement.jpg')"
            bgPosition="top"
            bgRepeat="no-repeat"
            bgSize="contain"
          />
        </Box>

        <LinearGradient
          gradientDirection="from-bottom"
          pointerEvents="auto"
          justify="center"
          alignItems="center"
          gradientSize={60}
          gradientPercentage={70}
        >
          <Button as={Link} to="/statements/create" w="fit-content" position="relative" zIndex={1}>
            Generate Statement
          </Button>
        </LinearGradient>
      </Stack>
    </Box>
  )
}
