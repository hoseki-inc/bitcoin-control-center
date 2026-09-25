import { Box, Button, Flex, Grid, Heading, Icon, Text, keyframes } from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { ConnectManualBitcoinAccordion } from '@hoseki/packages/ui/design-system'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui'
import { keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { ConnectionType } from './claims-landing/connection-type'

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

const commonProps = { icon: keyIcon, alt: 'Multisig keystore' }
const MultisigImage = (
  <KeystoreAvatar.Group>
    <KeystoreAvatar {...commonProps} />
    <KeystoreAvatar {...commonProps} />
    <KeystoreAvatar {...commonProps} />
  </KeystoreAvatar.Group>
)

const CoinbaseMedia = <img src="/images/exchanges/coinbase-wordmark.svg" alt="Coinbase" style={{ height: '20px' }} />
const KrakenMedia = <img src="/images/exchanges/kraken-wordmark.svg" alt="Kraken" style={{ height: '20px' }} />
const RobinhoodMedia = <img src="/images/exchanges/robinhood-lockup.png" alt="Robinhood" style={{ height: '20px' }} />
const StrikeMedia = <img src="/images/exchanges/strike-logo.svg" alt="Strike" style={{ height: '20px' }} />

interface AddAccountFlowProps {
  onClose: () => void
  /** When set, verify flows will navigate back here (e.g. { returnTo: '/accounts/add' }) */
  linkState?: { returnTo?: string }
}

export function AddAccountFlow({ onClose, linkState }: AddAccountFlowProps): JSX.Element {
  return (
    <Box
      position="fixed"
      inset={0}
      bg="shades.0"
      zIndex={200}
      display="flex"
      flexDirection="column"
      animation={`${fadeIn} 0.2s ease`}
    >
      {/* Top bar */}
      <Flex
        align="center"
        justify="space-between"
        px={{ base: 6, md: 12 }}
        py={5}
        borderBottom="1px solid"
        borderColor="neutral.200"
        flexShrink={0}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          color="neutral.900"
          fontWeight="medium"
          leftIcon={<BackArrowIcon />}
        >
          Back to My Holdings
        </Button>
      </Flex>

      {/* Content */}
      <Box flex={1} overflow="auto" display="flex" justifyContent="center" px={{ base: 6, md: 12 }} pt={12} pb={20}>
        <Box w="100%" maxW="680px">
          <Heading textStyle="text/3xl" fontWeight="bold" color="neutral.900" mb={2}>
            Connect New Account
          </Heading>
          <Text textStyle="text/md" color="neutral.400" mb={10} maxW="480px">
            Connect your hardware wallet to securely link your Bitcoin holdings. Your private keys never leave your
            device.
          </Text>

          {/* Hardware wallets -- same tiles as the original claims page */}
          <Grid templateColumns="repeat(3, 1fr)" gap={4} mb={8}>
            <ConnectionType
              title="Trezor"
              imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/trezor.svg`}
              imageAltText="Connect your Trezor"
              to="/accounts/verify/trezor"
              state={linkState}
            />
            <ConnectionType
              title="COLDCARD"
              imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/coldcard.svg`}
              imageAltText="Connect your Coldcard"
              to="/accounts/verify/coldcard"
              state={linkState}
            />
            <ConnectionType
              title="Ledger"
              imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/ledger.svg`}
              imageAltText="Connect your Ledger"
              to="/accounts/verify/ledger"
              state={linkState}
            />
            <ConnectionType
              title="Keystone"
              imagePath="/images/hardware-wallets/keystone-logo.svg"
              imageAltText="Connect your Keystone"
              to="/accounts/verify/keystone"
              state={linkState}
            />
            <ConnectionType title="Multisig" media={MultisigImage} to="/multisig/create" />
            <ConnectionType title="Coinbase" media={CoinbaseMedia} to="/accounts/verify/coinbase" state={linkState} />
            <ConnectionType title="Kraken" media={KrakenMedia} to="/accounts/verify/kraken" state={linkState} />
            <ConnectionType
              title="Robinhood"
              media={RobinhoodMedia}
              to="/accounts/verify/robinhood"
              state={linkState}
            />
            <ConnectionType title="Strike" media={StrikeMedia} to="/accounts/verify/strike" state={linkState} />
            <ConnectionType
              title="Manual Entry"
              media={<ManualEntryIcon />}
              to="/accounts/verify/manual-type"
              state={linkState}
            />
          </Grid>

          {/* Advanced / manual signing */}
          <ConnectManualBitcoinAccordion to="/accounts/verify/advanced" state={linkState} />
        </Box>
      </Box>
    </Box>
  )
}

function ManualEntryIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 24 24" w={6} h={6} color="neutral.600">
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

function BackArrowIcon(): JSX.Element {
  return (
    <Icon viewBox="0 0 16 16" w={4} h={4}>
      <path
        d="M10 4L6 8L10 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Icon>
  )
}
