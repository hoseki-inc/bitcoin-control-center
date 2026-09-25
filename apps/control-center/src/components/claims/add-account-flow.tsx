import { Box, Button, Flex, Grid, Icon, Stack, Text } from '@chakra-ui/react'
import { ConnectManualBitcoinAccordion } from '@hoseki/packages/ui/design-system'
import { PageHeading } from '@hoseki/packages/ui/design-system/page-heading'
import { KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { ConnectionType } from './claims-landing/connection-type'

const CoinbaseMedia = (
  <img src="/images/exchanges/coinbase.svg" alt="Coinbase" style={{ height: '24px', width: '24px' }} />
)
const KrakenMedia = <img src="/images/exchanges/kraken.svg" alt="Kraken" style={{ height: '24px', width: '24px' }} />
const RobinhoodMedia = (
  <img src="/images/exchanges/robinhood-icon.svg" alt="Robinhood" style={{ height: '24px', width: '24px' }} />
)
const StrikeMedia = (
  <img src="/images/exchanges/strike-icon.svg" alt="Strike" style={{ height: '24px', width: '24px' }} />
)

interface AddAccountFlowProps {
  onClose: () => void
  /** When set, verify flows will navigate back here (e.g. { returnTo: '/accounts/add' }) */
  linkState?: { returnTo?: string }
}

export function AddAccountFlow({ onClose, linkState }: AddAccountFlowProps): JSX.Element {
  return (
    <Box py={8}>
      <Flex mb={4}>
        <Button variant="ghost" size="sm" onClick={onClose} color="neutral.900" fontWeight="medium" ml={-3}>
          Back to Accounts
        </Button>
      </Flex>

      <PageHeading title="Add Account" description="Choose where you hold your Bitcoin." mb={8} />
      <Stack spacing={8}>
        <AccountGroup
          title="Wallet"
          description="Track Bitcoin using public wallet information. Your private keys stay with you."
        >
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
          <ConnectionType title="Multisig" media={<KeyRound size={22} />} to="/multisig/create" state={linkState} />
        </AccountGroup>
        <ConnectManualBitcoinAccordion to="/accounts/verify/advanced" state={linkState} />
        <AccountGroup title="Exchange" description="Connect an exchange to track your balance.">
          <ConnectionType title="Coinbase" media={CoinbaseMedia} to="/accounts/verify/coinbase" state={linkState} />
          <ConnectionType title="Kraken" media={KrakenMedia} to="/accounts/verify/kraken" state={linkState} />
          <ConnectionType title="Robinhood" media={RobinhoodMedia} to="/accounts/verify/robinhood" state={linkState} />
          <ConnectionType title="Strike" media={StrikeMedia} to="/accounts/verify/strike" state={linkState} />
        </AccountGroup>
        <AccountGroup title="Manual entry" description="Enter Bitcoin or ETF holdings. Update them yourself.">
          <ConnectionType
            title="Manual Entry"
            media={<ManualEntryIcon />}
            to="/accounts/verify/manual-type"
            state={linkState}
          />
        </AccountGroup>
      </Stack>
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

function AccountGroup({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}): JSX.Element {
  return (
    <Box as="section" aria-label={title}>
      <Text as="h2" textStyle="text/lg" fontWeight="medium">
        {title}
      </Text>
      <Text textStyle="text/sm" color="neutral.600" mt={1} mb={4}>
        {description}
      </Text>
      <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }} gap={3}>
        {children}
      </Grid>
    </Box>
  )
}
