import { Box, Skeleton, Stack, chakra } from '@chakra-ui/react'

export function ClaimCardLoadingSkeleton(): JSX.Element {
  return (
    <Box
      textAlign="center"
      borderWidth="1px"
      borderRadius="md"
      borderColor="border.subtle"
      p={4}
      bg="surface.raised"
      transition="all 0.2s"
    >
      <chakra.img src="/bitcoin-gray.svg" alt="Bitcoin Wallet Example" mx="auto" mb={2} mt={3} />
      <Stack gap={2}>
        <Stack alignItems="center" gap={2}>
          <Skeleton height="10px" width="50px" />
          <Skeleton height="14px" width="120px" />
          <Skeleton height="12px" width="70px" />
          <Skeleton height="12px" width="50px" />
        </Stack>
      </Stack>
    </Box>
  )
}
