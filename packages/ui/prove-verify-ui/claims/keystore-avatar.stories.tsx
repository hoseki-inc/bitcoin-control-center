import { Box, Grid, HStack, Heading, Icon, Stack } from '@chakra-ui/react'
import { getSupportedHardwareWalletLogoPath } from '@hoseki/packages/wallet'
import type { Story, StoryDefault } from '@ladle/react'
import { Clock, Heart, KeyRound, Lock, Shield, Star, Zap } from 'lucide-react'
import { AlertTriangleFilledIcon, CheckCircleFilledIcon } from '../../prove-verify-ui/icons'
import { KeystoreAvatar } from './keystore-avatar'
import { keyIcon } from './keystores-status-indicator'

export default {
  title: 'Prove / Claims / Keystore Avatar',
} satisfies StoryDefault

export const Default: Story = () => {
  return (
    <Grid templateColumns="repeat(4, 1fr)" gap={4} alignItems="center">
      <Box textAlign="center">
        <KeystoreAvatar alt="Ledger" src={getSupportedHardwareWalletLogoPath('ledger')} />
        <Box mt={2} fontSize="sm">
          Ledger
        </Box>
      </Box>
      <Box textAlign="center">
        <KeystoreAvatar alt="Trezor" src={getSupportedHardwareWalletLogoPath('trezor')} />
        <Box mt={2} fontSize="sm">
          Trezor
        </Box>
      </Box>
      <Box textAlign="center">
        <KeystoreAvatar alt="Coldcard" src={getSupportedHardwareWalletLogoPath('coldcard')} />
        <Box mt={2} fontSize="sm">
          Coldcard
        </Box>
      </Box>
      <Box textAlign="center">
        <KeystoreAvatar alt="Manual" src={getSupportedHardwareWalletLogoPath(null)} />
        <Box mt={2} fontSize="sm">
          Manual
        </Box>
      </Box>
      <Box textAlign="center">
        <KeystoreAvatar title="Contained" variant="contained" alt="Contained" icon={keyIcon} />
        <Box mt={2} fontSize="sm">
          Key as icon
        </Box>
      </Box>
    </Grid>
  )
}

export const WithBadge: Story = () => {
  return (
    <Grid templateColumns="repeat(5, 1fr)" gap={4} alignItems="center">
      <Box textAlign="center">
        <KeystoreAvatar alt="Ledger Verified" src={getSupportedHardwareWalletLogoPath('ledger')}>
          <KeystoreAvatar.Badge>
            <CheckCircleFilledIcon color="success.600" color2="white" stroke="shades.0" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Ledger Verified
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Trezor Expired" src={getSupportedHardwareWalletLogoPath('trezor')}>
          <KeystoreAvatar.Badge>
            <AlertTriangleFilledIcon fill="warning.600" color="shades.0" stroke="shades.0" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Trezor Expired
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Coldcard Pending" src={getSupportedHardwareWalletLogoPath('coldcard')}>
          <KeystoreAvatar.Badge>
            <CheckCircleFilledIcon color="neutral.100" color2="neutral.900" stroke="shades.0" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Coldcard Pending
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Manual Key" src={getSupportedHardwareWalletLogoPath(null)}>
          <KeystoreAvatar.Badge>
            <Icon as={KeyRound} color="neutral.400" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Manual Key
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Ledger Shield" src={getSupportedHardwareWalletLogoPath('ledger')}>
          <KeystoreAvatar.Badge>
            <Icon as={Shield} color="blue.500" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Ledger Shield
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Trezor Zap" src={getSupportedHardwareWalletLogoPath('trezor')}>
          <KeystoreAvatar.Badge>
            <Icon as={Zap} color="yellow.500" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Trezor Zap
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Coldcard Clock" src={getSupportedHardwareWalletLogoPath('coldcard')}>
          <KeystoreAvatar.Badge>
            <Icon as={Clock} color="orange.500" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Coldcard Clock
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Manual Star" src={getSupportedHardwareWalletLogoPath(null)}>
          <KeystoreAvatar.Badge>
            <Icon as={Star} color="purple.500" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Manual Star
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Ledger Heart" src={getSupportedHardwareWalletLogoPath('ledger')}>
          <KeystoreAvatar.Badge>
            <Icon as={Heart} color="red.500" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Ledger Heart
        </Box>
      </Box>

      <Box textAlign="center">
        <KeystoreAvatar alt="Trezor Lock" src={getSupportedHardwareWalletLogoPath('trezor')}>
          <KeystoreAvatar.Badge>
            <Icon as={Lock} color="gray.600" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <Box mt={2} fontSize="sm">
          Trezor Lock
        </Box>
      </Box>
    </Grid>
  )
}

export const Variants: Story = () => {
  return (
    <Box>
      <Heading size="sm">Contained</Heading>
      <HStack mt={4} gap={4} alignItems="center">
        <KeystoreAvatar
          title="Contained"
          variant="contained"
          alt="Contained"
          src={getSupportedHardwareWalletLogoPath('ledger')}
        />
        <KeystoreAvatar title="Contained" variant="contained" alt="Contained" icon={keyIcon} />
      </HStack>
      <Heading size="sm" mt={8}>
        Filled
      </Heading>
      <HStack mt={4} gap={4} alignItems="center">
        <KeystoreAvatar
          title="Filled"
          variant="filled"
          alt="Filled"
          src={getSupportedHardwareWalletLogoPath('ledger')}
        />
        <KeystoreAvatar title="Filled" variant="filled" alt="Filled" src={getSupportedHardwareWalletLogoPath('ledger')}>
          <KeystoreAvatar.Badge>
            <Icon as={KeyRound} color="neutral.400" boxSize="16px" />
          </KeystoreAvatar.Badge>
        </KeystoreAvatar>
        <KeystoreAvatar p={0.5} title="Filled" variant="filled" alt="Filled" icon={keyIcon} />
      </HStack>
    </Box>
  )
}

export const Sizes: Story = () => {
  return (
    <Box>
      <Heading size="sm">Contained Variant</Heading>
      <HStack mt={4} gap={4} alignItems="center">
        <Box textAlign="center">
          <KeystoreAvatar
            variant="contained"
            size="24px"
            alt="Small Ledger"
            src={getSupportedHardwareWalletLogoPath('ledger')}
          />
          <Box mt={2} fontSize="xs">
            24px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="contained"
            size="32px"
            alt="Medium Ledger"
            src={getSupportedHardwareWalletLogoPath('ledger')}
          />
          <Box mt={2} fontSize="xs">
            32px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="contained"
            size="36px"
            alt="Default Ledger"
            src={getSupportedHardwareWalletLogoPath('ledger')}
          />
          <Box mt={2} fontSize="xs">
            36px (default)
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="contained"
            size="48px"
            alt="Large Ledger"
            src={getSupportedHardwareWalletLogoPath('ledger')}
          />
          <Box mt={2} fontSize="xs">
            48px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="contained"
            size="64px"
            alt="Extra Large Ledger"
            src={getSupportedHardwareWalletLogoPath('ledger')}
          />
          <Box mt={2} fontSize="xs">
            64px
          </Box>
        </Box>
      </HStack>

      <Heading size="sm" mt={8}>
        Filled Variant
      </Heading>
      <HStack mt={4} gap={4} alignItems="center">
        <Box textAlign="center">
          <KeystoreAvatar
            variant="filled"
            size="24px"
            alt="Small Trezor"
            src={getSupportedHardwareWalletLogoPath('trezor')}
          />
          <Box mt={2} fontSize="xs">
            24px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="filled"
            size="32px"
            alt="Medium Trezor"
            src={getSupportedHardwareWalletLogoPath('trezor')}
          />
          <Box mt={2} fontSize="xs">
            32px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="filled"
            size="44px"
            alt="Default Trezor"
            src={getSupportedHardwareWalletLogoPath('trezor')}
          />
          <Box mt={2} fontSize="xs">
            44px (default)
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="filled"
            size="48px"
            alt="Large Trezor"
            src={getSupportedHardwareWalletLogoPath('trezor')}
          />
          <Box mt={2} fontSize="xs">
            48px
          </Box>
        </Box>
        <Box textAlign="center">
          <KeystoreAvatar
            variant="filled"
            size="64px"
            alt="Extra Large Trezor"
            src={getSupportedHardwareWalletLogoPath('trezor')}
          />
          <Box mt={2} fontSize="xs">
            64px
          </Box>
        </Box>
      </HStack>
    </Box>
  )
}

export const Group: Story = () => {
  return (
    <Stack>
      <KeystoreAvatar.Group>
        <KeystoreAvatar alt="Ledger" src={getSupportedHardwareWalletLogoPath('ledger')} />
        <KeystoreAvatar alt="Trezor" src={getSupportedHardwareWalletLogoPath('trezor')} />
        <KeystoreAvatar alt="Coldcard" src={getSupportedHardwareWalletLogoPath('coldcard')} />
      </KeystoreAvatar.Group>

      <KeystoreAvatar.Group>
        <KeystoreAvatar alt="Key" icon={keyIcon} />
        <KeystoreAvatar alt="Key" icon={keyIcon} />
        <KeystoreAvatar alt="key" icon={keyIcon} />
      </KeystoreAvatar.Group>
    </Stack>
  )
}
