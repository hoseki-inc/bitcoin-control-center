import { Box, CloseButton, HStack, Link, Text } from '@chakra-ui/react'
import { GlobeIcon } from 'lucide-react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { toast } from 'sonner'
import { useLocalSetting } from '../../hooks/use-local-settings'
import { ELECTRUM_CHOICE_KEY } from '../onboarding/electrum-choice'

// Kept outside React: each page group mounts its own layout, so a failed save doesn't bring the
// notice back until the next launch.
let closedThisSession = false

/**
 * A strip above the header on desktop while Electrum is still the public server the app started
 * with: no server has been connected on purpose, and the public one wasn't kept in the introduction.
 */
export function PublicServerNotice(): JSX.Element {
  // Written only when a connection is connected, so it's empty until someone chooses a server.
  const host = useLocalSetting('electrum_host')
  const choice = useLocalSetting(ELECTRUM_CHOICE_KEY)
  const [closed, setClosed] = useState(closedThisSession)
  // Hidden while either is loading or failed to load.
  const shown = !closed && host.data === null && choice.data === null

  return (
    <Box as="output" display="block">
      {shown && (
        <Box bg="warning.50" borderBottom="1px solid" borderColor="warning.200" color="warning.800">
          <HStack maxW="928px" mx="auto" px={{ base: 4, md: 6 }} py={2} gap={3}>
            <Box flexShrink={0} aria-hidden>
              <GlobeIcon size={16} />
            </Box>
            <Text textStyle="text/sm" flex={1} minW={0}>
              You’re using a public Electrum server. Blockstream can see your wallet addresses.{' '}
              <Link as={RouterLink} to="/settings#electrum-server" fontWeight="semibold" textDecoration="underline">
                Use your own node
              </Link>
            </Text>
            <CloseButton
              size="sm"
              borderRadius="full"
              aria-label="Dismiss"
              onClick={() => {
                closedThisSession = true
                setClosed(true)
                choice.saveAsync('dismissed').catch(() => {
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
