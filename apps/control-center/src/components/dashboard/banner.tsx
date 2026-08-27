import { Box, Button, HStack, Stack, Text } from '@chakra-ui/react'
import { DismissButton, LinearGradient } from '@hoseki/packages/ui/design-system'
import { Link } from 'react-router'

export function Banner({
  mode,
  onDismissClick,
}: {
  mode: 'large-with-cta' | 'large-without-cta' | 'compact'
  onDismissClick: () => void
}): JSX.Element {
  return <BannerContent mode={mode} onDismissClick={onDismissClick} />
}

export function BannerContent({
  mode,
  onDismissClick,
}: {
  mode: 'large-with-cta' | 'large-without-cta' | 'compact'
  onDismissClick: () => void
}): JSX.Element {
  if (mode === 'compact') {
    return (
      <HStack bgColor="neutral.50" p={6} pb={0}>
        <Stack alignItems="left" gap={4} pb={6}>
          <DismissButton onDismissClick={onDismissClick} />
          <Box>
            <Text as="h2" textStyle="text/md" fontWeight="medium">
              The Standard for Bitcoin Verification
            </Text>
            <Text textStyle="text/sm">
              Verify ownership of your wallet and download a PDF statement of your Bitcoin holdings.
            </Text>
          </Box>
          <Button as={Link} to="/statements/create" w="fit-content">
            Generate Statement
          </Button>
        </Stack>
        <Box
          bgImage="url('/statements/satoshi-statement.jpg')"
          bgPosition="top"
          bgRepeat="no-repeat"
          bgSize="cover"
          w="300px"
          h="200px"
        />
      </HStack>
    )
  }

  return (
    <>
      <Stack position="relative" bgColor="neutral.50" py={4} px={6}>
        <Text as="h2" textStyle="text/2xl" fontWeight="medium">
          The Standard for Bitcoin Verification
        </Text>
        <Text textStyle="text/md">
          Bridge the gap with clear, secure ownership proofs for self-custodied Bitcoin—built for both sides of the
          table.
        </Text>
        <HStack justifyContent="space-between">
          {mode === 'large-without-cta' && (
            <Button as={Link} to="/statements/create" w="fit-content" variant="link" p={0}>
              Generate Your Own Statement
            </Button>
          )}
        </HStack>
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
          {mode === 'large-with-cta' && (
            <Button as={Link} to="/statements/create" w="fit-content" position="relative" zIndex={1}>
              Generate Statement
            </Button>
          )}
        </LinearGradient>
      </Stack>
    </>
  )
}
