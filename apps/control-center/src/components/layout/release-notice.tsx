import { Box, CloseButton, HStack, Link, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { baseTrpc } from '../../trpc'

export const DOWNLOAD_URL = 'https://www.bitcoincontrolcenter.com/#downloads'
// Only asks the local Sentinel. While its launch check is still running, ask again soon so a short
// session still sees the result; after that, Sentinel checks about once a day and hourly is enough.
export const PENDING_REFRESH_MS = 3000
const REFRESH_MS = 60 * 60 * 1000

// Kept outside React so a dismissed notice stays hidden on pages outside the main layout, until the
// app starts again or a newer release is found.
let dismissedVersion: string | null = null

/** A notice at the bottom of the window when a newer desktop release is out. */
export function ReleaseNotice(): JSX.Element {
  const { data } = useQuery({
    queryKey: ['release-check'],
    queryFn: async ({ signal }) => baseTrpc.settings.releaseCheck.query(undefined, { signal }),
    refetchInterval: (status) => (status?.pending === false ? REFRESH_MS : PENDING_REFRESH_MS),
  })
  const [dismissed, setDismissed] = useState(dismissedVersion)
  const version = data?.newVersion ?? null
  const shown = version !== null && version !== dismissed
  // The live region stays mounted and empty, so screen readers announce the notice when it is filled.
  return (
    <Box as="output">
      {shown && (
        <HStack
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
            onClick={(event) => {
              dismissedVersion = version
              setDismissed(version)
              // From the keyboard (no pointer, so no click count), the focused button is about to
              // disappear: keep the reader's place in the page instead of dropping to the top.
              if (event.detail === 0) {
                document.getElementById('main-content')?.focus({ preventScroll: true })
              }
            }}
          />
        </HStack>
      )}
    </Box>
  )
}
