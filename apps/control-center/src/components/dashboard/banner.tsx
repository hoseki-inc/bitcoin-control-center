import { Box, Button, Flex, Image, Stack, Text } from '@chakra-ui/react'
import { Link, useLocation } from 'react-router'

export function Banner(): JSX.Element {
  const { pathname } = useLocation()
  return (
    <Flex
      direction={{ base: 'column', md: 'row' }}
      align="center"
      gap={{ base: 8, md: 10 }}
      bg="neutral.50"
      borderRadius="panel"
      overflow="hidden"
      p={{ base: 6, md: 8 }}
      pb={{ base: 0, md: 8 }}
    >
      <Stack flex={1} align="flex-start" gap={4} minW={0} py={{ base: 2, md: 4 }}>
        <Text
          as="h2"
          textStyle={{ base: 'text/4xl', lg: 'text/6xl' }}
          fontWeight="semibold"
          maxW="14ch"
          sx={{ textWrap: 'balance' }}
        >
          Your holdings, on record
        </Text>
        <Text textStyle="text/md" color="neutral.600" maxW="34ch">
          Download a statement of your holdings for a selected period.
        </Text>
        <Button as={Link} to="/statements/create" state={{ returnTo: pathname }} mt={2}>
          Generate Statement
        </Button>
      </Stack>
      <Box
        aria-hidden="true"
        flexShrink={0}
        w={{ base: '100%', md: '36%' }}
        h={{ base: '260px', md: '320px' }}
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
          borderColor="neutral.200"
          borderRadius="control"
          boxShadow="0 8px 24px rgba(16, 24, 40, 0.08)"
        />
      </Box>
    </Flex>
  )
}
