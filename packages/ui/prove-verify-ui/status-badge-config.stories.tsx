import { Box, Stack, Text } from '@chakra-ui/react'
import type { Story } from '@ladle/react'
import { StatusBadge } from './status-badge'
import {
  getBadgeConfigForAccessRequest,
  getBadgeConfigForClaim,
  getBadgeConfigForClaimAccess,
  getBadgeConfigForKeystore,
  getBadgeConfigForStatement,
} from './status-badge-config'

export default {
  title: 'Prove and Verify / Status Badge Config',
}

export const WithIcons: Story = () => (
  <Stack spacing={8}>
    <Box>
      <Text textStyle="text/3xl" fontWeight="medium">
        Claim
      </Text>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge {...getBadgeConfigForClaim('verified')} />
        <StatusBadge {...getBadgeConfigForClaim('pending')} />
        <StatusBadge {...getBadgeConfigForClaim('expired')} />
      </div>
    </Box>

    <Box>
      <Text textStyle="text/3xl" fontWeight="medium">
        Claim Access
      </Text>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge {...getBadgeConfigForClaimAccess('active')} />
        <StatusBadge {...getBadgeConfigForClaimAccess('inactive')} />
        <StatusBadge {...getBadgeConfigForClaimAccess('disconnected')} />
      </div>
    </Box>

    <Box>
      <Text textStyle="text/3xl" fontWeight="medium">
        Access Request
      </Text>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge {...getBadgeConfigForAccessRequest('accepted')} />
        <StatusBadge {...getBadgeConfigForAccessRequest('pending')} />
        <StatusBadge {...getBadgeConfigForAccessRequest('expired')} />
        <StatusBadge {...getBadgeConfigForAccessRequest('rejected')} />
      </div>
    </Box>

    <Box>
      <Text textStyle="text/3xl" fontWeight="medium">
        Statement
      </Text>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge {...getBadgeConfigForStatement('completed')} />
        <StatusBadge {...getBadgeConfigForStatement('pending')} />
        <StatusBadge {...getBadgeConfigForStatement('failed')} />
      </div>
    </Box>

    <Box>
      <Text textStyle="text/3xl" fontWeight="medium">
        Keystore
      </Text>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge {...getBadgeConfigForKeystore('verified')} />
        <StatusBadge {...getBadgeConfigForKeystore('identified')} />
        <StatusBadge {...getBadgeConfigForKeystore('pending')} />
      </div>
    </Box>
  </Stack>
)
