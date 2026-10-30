import { Box, CloseButton, HStack, Link, Text } from '@chakra-ui/react'
import { GlobeIcon } from 'lucide-react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { toast } from 'sonner'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { PUBLIC_ELECTRUM_HOST } from '../../pages/settings/electrum-connection'

/** Desktop: `dismissed` once someone closes the notice. */
const NOTICE_KEY = 'electrum_notice_v1'

// Kept outside React: each page group mounts its own layout, so a failed save doesn't bring the
// notice back until the next launch.
let closedThisSession = false

/**
 * A strip above the header on desktop while Electrum uses Blockstream's public server, even if the
 * introduction kept it or connected it through Tor, which hides only your IP address. Connecting
 * another server or closing the notice hides it.
 */
export function PublicServerNotice(): JSX.Element {
  // Written only when a connection is connected, so it's empty while the app is on the server it started with.
  const host = useLocalSetting('electrum_host')
  const notice = useLocalSetting(NOTICE_KEY)
  const [closed, setClosed] = useState(closedThisSession)
  const onPublicServer = host.data === null || host.data === PUBLIC_ELECTRUM_HOST
  // Hidden while either is loading or failed to load.
  const shown = !closed && onPublicServer && notice.data === null

  return (
    <Box as="output" display="block">
      {shown && (
        <Box bg="neutral.100" borderBottom="1px solid" borderColor="neutral.200" color="neutral.900">
          <HStack maxW="928px" mx="auto" px={{ base: 4, md: 6 }} py={2} gap={3}>
            <Box flexShrink={0} color="neutral.600" aria-hidden>
              <GlobeIcon size={16} />
            </Box>
            <Text textStyle="text/sm" flex={1} minW={0}>
              You’re using a public Electrum server. Blockstream can see your wallet addresses.{' '}
              <Link as={RouterLink} to="/settings#electrum-server" fontWeight="semibold">
                Use your own node
              </Link>
            </Text>
            <CloseButton
              size="sm"
              color="neutral.500"
              borderRadius="full"
              aria-label="Dismiss"
              onClick={() => {
                closedThisSession = true
                setClosed(true)
                notice.saveAsync('dismissed').catch(() => {
                  toast.error("Couldn't save that", { description: 'The notice may show again next time.' })
                })
              }}
            />
          </HStack>
        </Box>
      )}
    </Box>
  )
}
