import { Box } from '@chakra-ui/react'
import { StatusBadge, getBadgeConfigForClaim } from '@hoseki/packages/ui/prove-verify-ui'
import { useNavigate } from 'react-router'
import { useGetClaimBalance } from '../../../lib/balances'
import type { ClaimDto } from '../../../trpc/server-types'
import { type ConnectionHero, ConnectionPending, ConnectionSuccess } from '../connection-success'
import { UnverifiedTooltip } from './bitkey-notes'

const bitkeyHero: ConnectionHero = { photo: '/images/hardware-wallets/bitkey-device.png', alt: 'Bitkey' }

/** Shown while Sentinel saves the Bitkey. */
export function BitkeyConnecting(): JSX.Element {
  return <ConnectionPending title="Connecting Your Bitkey..." hero={bitkeyHero} />
}

/**
 * Celebrates a newly added Bitkey. It says "connected", never "verified": the balance leads, and the Unverified
 * badge stays beneath it.
 */
export function BitkeyConnected({ claim }: { claim: ClaimDto }): JSX.Element {
  const navigate = useNavigate()
  const balance = useGetClaimBalance(claim.id)
  const badge = getBadgeConfigForClaim(claim.status)
  const viewBitkey = () => {
    void navigate(`/accounts/${claim.id}`)
  }

  return (
    <ConnectionSuccess
      hero={bitkeyHero}
      title="Bitkey Connected!"
      subtitle="Its balance and history now show in Control Center."
      balance={balance}
      // Gray, not green: the Bitkey is connected but stays unverified.
      checkTone="neutral"
      badge={
        // Beside the badge, the tooltip doesn't cover View Bitkey.
        <UnverifiedTooltip>
          <Box as="span">
            <StatusBadge status={badge.status} label={badge.label} icon={badge.icon} size="sm" />
          </Box>
        </UnverifiedTooltip>
      }
      primary={{ label: 'View Bitkey', onClick: viewBitkey }}
      secondary={{
        label: 'Connect Another Account',
        onClick: () => {
          void navigate('/accounts/add')
        },
      }}
      onClose={viewBitkey}
      closeTitle="View Bitkey"
    />
  )
}
