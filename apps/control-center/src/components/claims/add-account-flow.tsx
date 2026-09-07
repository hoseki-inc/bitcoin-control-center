import { Box, Button, Flex, Grid, Icon } from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { ConnectManualBitcoinAccordion } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { KeystoreAvatar } from '@hoseki/packages/ui/prove-verify-ui'
import { keyIcon } from '@hoseki/packages/ui/prove-verify-ui/claims/keystores-status-indicator'
import { ConnectionType } from './claims-landing/connection-type'

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
  linkState?: Record<string, unknown>
}

export function AddAccountFlow({ onClose, linkState }: AddAccountFlowProps): JSX.Element {
  return (
    <Box py={8}>
      <Flex mb={4}>
        <Button variant="ghost" size="sm" onClick={onClose} color="neutral.900" fontWeight="medium" ml={-3}>
          Back to My Holdings
        </Button>
      </Flex>

      {/* Content */}
      <Box>
        <Box w="100%">
          <PageHeading
            title="Connect New Account"
            description="Connect a wallet or exchange, or add your Bitcoin holdings manually."
            mb={6}
          />

          {/* Hardware wallets -- same tiles as the original claims page */}
          <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }} gap={4} mb={8}>
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
