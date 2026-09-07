import { Box, Button, Flex, IconButton, Stack, Text } from '@chakra-ui/react'
import { XIcon } from 'lucide-react'
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
  const compact = mode === 'compact'

  return (
    <Flex
      position="relative"
      direction={{ base: 'column', md: 'row' }}
      align="center"
      gap={6}
      bg="neutral.50"
      borderRadius="panel"
      overflow="hidden"
      p={{ base: 6, md: 8 }}
      pb={{ base: 0, md: 8 }}
    >
      <IconButton
        aria-label="Dismiss statement introduction"
        icon={<XIcon size={18} />}
        onClick={onDismissClick}
        variant="ghost"
        position="absolute"
        top={2}
        right={2}
        zIndex={1}
      />
      <Stack flex={1} align="flex-start" gap={4} minW={0} pr={4}>
        <Text as="h2" textStyle={compact ? 'text/xl' : 'text/2xl'} fontWeight="medium">
          The Standard for Bitcoin Verification
        </Text>
        <Text textStyle="text/sm" color="neutral.600" maxW="46ch">
          Verify ownership of your wallet and download a PDF statement of your Bitcoin holdings.
        </Text>
        <Button as={Link} to="/statements/create" mt={2}>
          {mode === 'large-without-cta' ? 'Generate Your Own Statement' : 'Generate Statement'}
        </Button>
      </Stack>
      <Box
        aria-hidden="true"
        position="relative"
        flexShrink={0}
        w={{ base: '100%', md: '240px' }}
        h={compact ? '160px' : '240px'}
        bgImage="url('/statements/satoshi-statement.jpg')"
        bgPosition="top center"
        bgRepeat="no-repeat"
        bgSize="contain"
        sx={{ maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)' }}
      />
    </Flex>
  )
}
