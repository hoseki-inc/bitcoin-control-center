import { Box, Button, Flex, Grid, Icon, keyframes } from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { ConnectManualBitcoinAccordion } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { ManualEntryIcon, MultisigImage } from './account-type-media'
import { ConnectionType } from './claims-landing/connection-type'

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

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
          Back to Accounts
        </Button>
      </Flex>

      {/* Content */}
      <Box flex={1} overflow="auto" display="flex" justifyContent="center" px={{ base: 6, md: 12 }} pt={12} pb={20}>
        <Box w="100%" maxW="680px">
          <PageHeading
            title="Connect New Account"
            description="Connect your hardware wallet to securely link your Bitcoin holdings. Your private keys never leave your device."
            mb={10}
          />

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
