import { Box, Button, Grid, Heading, Icon, Text } from '@chakra-ui/react'
import { ConnectManualBitcoinAccordion } from '@hoseki/packages/ui/design-system'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui/claims/keystore-avatar'
import { keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { ChevronLeft } from 'lucide-react'
import { ConnectionType } from './claims-landing/connection-type'

interface AddAccountFlowProps {
  onClose: () => void
  /** When set, verify flows will navigate back here (e.g. { returnTo: '/accounts/add' }) */
  linkState?: Record<string, unknown>
}

export function AddAccountFlow({ onClose, linkState }: AddAccountFlowProps): JSX.Element {
  return (
    <Box w="full" py={{ base: 6, md: 8 }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        color="text.primary"
        fontWeight="medium"
        mb={6}
        pl={0}
        leftIcon={<Icon as={ChevronLeft} boxSize={4} />}
      >
        Back to Accounts
      </Button>
      <Heading as="h1" textStyle="text/3xl" fontWeight="bold" color="text.primary" mb={2}>
        Connect New Account
      </Heading>
      <Text textStyle="text/md" color="text.secondary" mb={10}>
        Connect your hardware wallet to securely link your Bitcoin holdings. Your private keys never leave your device.
      </Text>
      <Grid templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }} gap={4} mb={8}>
        <ConnectionType
          title="Trezor"
          imagePath="/images/hardware-wallets/trezor.svg"
          imageAltText="Trezor"
          to="/accounts/verify/trezor"
          state={linkState}
        />
        <ConnectionType
          title="COLDCARD"
          imagePath="/images/hardware-wallets/coldcard.svg"
          imageAltText="COLDCARD"
          to="/accounts/verify/coldcard"
          state={linkState}
        />
        <ConnectionType
          title="Ledger"
          imagePath="/images/hardware-wallets/ledger.svg"
          imageAltText="Ledger"
          to="/accounts/verify/ledger"
          state={linkState}
        />
        <ConnectionType
          title="Keystone"
          imagePath="/images/hardware-wallets/keystone-logo.svg"
          imageAltText="Keystone"
          to="/accounts/verify/keystone"
          state={linkState}
        />
        <ConnectionType
          title="Multisig"
          media={
            <KeystoreAvatar.Group>
              <KeystoreAvatar icon={keyIcon} alt="Multisig keystore" />
              <KeystoreAvatar icon={keyIcon} alt="Multisig keystore" />
              <KeystoreAvatar icon={keyIcon} alt="Multisig keystore" />
            </KeystoreAvatar.Group>
          }
          to="/multisig/create"
          state={linkState}
        />
        <ConnectionType
          title="Coinbase"
          imagePath="/images/exchanges/coinbase-wordmark.svg"
          imageAltText="Coinbase"
          to="/accounts/verify/coinbase"
          state={linkState}
        />
        <ConnectionType
          title="Kraken"
          imagePath="/images/exchanges/kraken-wordmark.svg"
          imageAltText="Kraken"
          to="/accounts/verify/kraken"
          state={linkState}
        />
        <ConnectionType
          title="Robinhood"
          imagePath="/images/exchanges/robinhood-lockup.png"
          imageAltText="Robinhood"
          to="/accounts/verify/robinhood"
          state={linkState}
        />
        <ConnectionType
          title="Strike"
          imagePath="/images/exchanges/strike-logo.svg"
          imageAltText="Strike"
          to="/accounts/verify/strike"
          state={linkState}
        />
        <ConnectionType
          title="Manual Entry"
          media={<ManualEntryIcon />}
          to="/accounts/verify/manual-type"
          state={linkState}
        />
      </Grid>
      <ConnectManualBitcoinAccordion to="/accounts/verify/advanced" state={linkState} />
    </Box>
  )
}

function ManualEntryIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={6} h={6} color="text.secondary">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="14 2 14 8 20 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline
        points="10 9 9 9 8 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Icon>
  )
}
