import { CloseButton, HStack, Link, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { baseTrpc } from '../../trpc'

export const DOWNLOAD_URL = 'https://www.bitcoincontrolcenter.com/#downloads'
// Sentinel checks about once a day; asking it hourly shows a result soon after.
const REFRESH_MS = 60 * 60 * 1000

// Kept outside React: each page group mounts its own layout, and a dismissed notice stays hidden
// until the app starts again or a newer release is found.
let dismissedVersion: string | null = null

/** A notice at the bottom of the window when a newer desktop release is out. */
export function ReleaseNotice(): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ['release-check'],
    queryFn: async ({ signal }) => baseTrpc.settings.releaseCheck.query(undefined, { signal }),
    refetchInterval: REFRESH_MS,
  })
  const [dismissed, setDismissed] = useState(dismissedVersion)
  const version = data?.newVersion ?? null
  if (version === null || version === dismissed) {
    return null
  }
  return (
    <HStack
      as="output"
      position="fixed"
      bottom={4}
      left="50%"
      transform="translateX(-50%)"
      maxW="calc(100% - 32px)"
      zIndex={100}
      spacing={3}
      bg="shades.0"
      border="1px solid"
      borderColor="neutral.200"
      borderRadius="full"
      boxShadow="md"
      pl={4}
      pr={2}
      py={1.5}
    >
      <Text textStyle="text/sm" color="neutral.900">
        Bitcoin Control Center {version} is available.
      </Text>
      <Link href={DOWNLOAD_URL} isExternal textStyle="text/sm" fontWeight="semibold" color="warning.700">
        Download
      </Link>
      <CloseButton
        size="sm"
        color="neutral.500"
        borderRadius="full"
        aria-label="Dismiss"
        onClick={() => {
          dismissedVersion = version
          setDismissed(version)
        }}
      />
    </HStack>
  )
}
