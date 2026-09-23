import { Box, Button, Flex, IconButton, Image, Stack, Text } from '@chakra-ui/react'
import { XIcon } from 'lucide-react'
import { Link } from 'react-router'

export function Banner({
  mode,
  onDismissClick,
}: {
  mode: 'large-with-cta' | 'large-without-cta' | 'compact'
  onDismissClick?: () => void
}): JSX.Element {
  return <BannerContent mode={mode} onDismissClick={onDismissClick} />
}

export function BannerContent({
  mode,
  onDismissClick,
}: {
  mode: 'large-with-cta' | 'large-without-cta' | 'compact'
  onDismissClick?: () => void
}): JSX.Element {
  const compact = mode === 'compact'

  return (
    <Flex
      position="relative"
      direction={{ base: 'column', md: 'row' }}
      align="center"
      gap={{ base: 8, md: 10 }}
      bg="surface.subtle"
      borderRadius="panel"
      overflow="hidden"
      p={{ base: 6, md: compact ? 6 : 8 }}
      pb={{ base: 0, md: 8 }}
    >
      {onDismissClick && (
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
      )}
      <Stack flex={1} align="flex-start" gap={4} minW={0} py={{ base: 2, md: 4 }}>
        <Text
          as="h2"
          textStyle={compact ? 'text/2xl' : { base: 'text/4xl', lg: 'text/6xl' }}
          fontWeight="semibold"
          maxW="14ch"
          sx={{ textWrap: 'balance' }}
        >
          Your holdings, on record
        </Text>
        <Text textStyle={compact ? 'text/sm' : 'text/md'} color="text.secondary" maxW="34ch">
          Download a statement of your holdings for a selected period.
        </Text>
        <Button as={Link} to="/statements/create" mt={2}>
          {mode === 'large-without-cta' ? 'Generate Your Own Statement' : 'Generate Statement'}
        </Button>
      </Stack>
      <Box
        aria-hidden="true"
        position="relative"
        flexShrink={0}
        alignSelf="stretch"
        w={{ base: '100%', md: compact ? '220px' : '36%' }}
        h={{ base: compact ? '180px' : '260px', md: compact ? '220px' : '320px' }}
        overflow="hidden"
        sx={{ maskImage: 'linear-gradient(to bottom, black 88%, transparent 100%)' }}
      >
        <Image
          src="/statements/satoshi-statement.jpg"
          alt=""
          w="full"
          maxW="340px"
          mx="auto"
          mt={3}
          border="1px solid"
          borderColor="border.subtle"
          borderRadius="control"
          boxShadow="0 8px 24px rgba(16, 24, 40, 0.08)"
        />
      </Box>
    </Flex>
  )
}
