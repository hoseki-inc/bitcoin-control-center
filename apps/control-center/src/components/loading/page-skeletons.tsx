import { Box, Flex, HStack, Skeleton, Stack, Text, chakra } from '@chakra-ui/react'
import { SkeletonRegion, TextSkeleton } from '@hoseki/packages/ui/design-system'
import { VIEWPORT_BELOW_HEADER } from '@hoseki/packages/ui/prove-verify-ui/layout'
import { TopBar } from '@hoseki/packages/ui/prove-verify-ui/top-bar'
import { Link } from 'react-router'

/** One fact under an account's heading: its label and value. */
function FactSkeleton({ width, w }: { width: string; w: string[] }): JSX.Element {
  return (
    <Box w={w}>
      <Text textStyle="text/sm" fontWeight="medium" mb={1}>
        <TextSkeleton width="7ch" />
      </Text>
      <Text textStyle="label/sm" fontWeight="medium">
        <TextSkeleton width={width} />
      </Text>
    </Box>
  )
}

/**
 * An account page's outline while the account loads. Exchange and wallet pages show a large logo
 * above four facts; manual and ETF pages show three facts and then their forms. The way back to
 * Accounts works from the start.
 */
export function AccountDetailsSkeleton({
  label = 'Loading account',
  layout = 'logo',
}: {
  label?: string
  layout?: 'logo' | 'manual'
}): JSX.Element {
  return (
    <Box py={6}>
      <TopBar mb={6}>
        <TopBar.Item as={Link} to="/accounts">
          Back to Accounts
        </TopBar.Item>
      </TopBar>
      <SkeletonRegion label={label}>
        {layout === 'logo' ? (
          <Stack spacing={4}>
            <Box>
              <Text textStyle="text/md" fontWeight="medium">
                <TextSkeleton width="16ch" />
              </Text>
              <Text textStyle="text/xs">
                <TextSkeleton width="28ch" />
              </Text>
            </Box>
            <chakra.hr />
            <Stack align="center" w="640px" maxW="full" mx="auto" mt={-4}>
              <Box pt={10} pb={6}>
                <Skeleton boxSize="100px" borderRadius="full" />
              </Box>
              <HStack spacing={4} mb={4} w="100%" alignItems="flex-start">
                {['10ch', '12ch', '9ch', '12ch'].map((width, index) => (
                  <FactSkeleton key={index} width={width} w={['100%', '50%', '25%']} />
                ))}
              </HStack>
              <Box w="100%">
                <Skeleton h="32px" w="140px" />
              </Box>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={6}>
            <Box>
              <HStack spacing={3} mb={1}>
                <Skeleton boxSize="20px" />
                <Text textStyle="text/md" fontWeight="medium">
                  <TextSkeleton width="14ch" />
                </Text>
              </HStack>
              <Text textStyle="text/xs">
                <TextSkeleton width="26ch" />
              </Text>
            </Box>
            <chakra.hr />
            <Stack align="center" maxW="640px" mx="auto" w="100%">
              <HStack spacing={4} mb={4} w="100%" alignItems="flex-start">
                {['12ch', '12ch', '14ch'].map((width, index) => (
                  <FactSkeleton key={index} width={width} w={['100%', '50%', '33%']} />
                ))}
              </HStack>
            </Stack>
            <chakra.hr />
            <Stack maxW="640px" mx="auto" w="100%" spacing={3}>
              <Text textStyle="text/md" fontWeight="medium">
                <TextSkeleton width="14ch" />
              </Text>
              <Skeleton h="40px" />
            </Stack>
          </Stack>
        )}
      </SkeletonRegion>
    </Box>
  )
}

/** A statement page's outline while the statement loads: the summary column and the document beside it. */
export function StatementPageSkeleton(): JSX.Element {
  return (
    <SkeletonRegion label="Loading statement">
      <Flex flexDirection={{ base: 'column', lg: 'row' }} align="flex-start">
        <Stack
          gap={6}
          flexBasis={{ base: 'auto', lg: '40%' }}
          w="full"
          maxW={{ base: 'full', lg: 'min(40%, 480px)' }}
          py={6}
          px={{ base: 4, md: 8 }}
        >
          <Text textStyle="text/sm">
            <TextSkeleton width="8ch" />
          </Text>
          <Stack gap={3}>
            <Text textStyle="text/2xl" fontWeight="medium">
              <TextSkeleton width="14ch" />
            </Text>
            {['24ch', '18ch', '22ch', '16ch'].map((width) => (
              <Text key={width} textStyle="text/sm">
                <TextSkeleton width={width} />
              </Text>
            ))}
          </Stack>
          <Skeleton h="40px" w="full" />
        </Stack>
        <Box
          height={{ base: '60vh', lg: VIEWPORT_BELOW_HEADER }}
          flex={{ base: 'none', lg: 1 }}
          w={{ base: 'full', lg: 'auto' }}
          bg="#F9F9F9"
          display="flex"
          alignItems="flex-start"
          justifyContent="center"
          pt={10}
        >
          <Skeleton w="min(80%, 520px)" h="70%" borderRadius="none" startColor="neutral.50" endColor="neutral.100" />
        </Box>
      </Flex>
    </SkeletonRegion>
  )
}
