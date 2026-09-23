import { Box, Flex, Grid, Stack, Text, chakra } from '@chakra-ui/react'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { SectionTitle } from '@hoseki/packages/ui/prove-verify-ui'
import type { SupportedHardwareWallet } from '@hoseki/packages/wallet/hardware-wallet'

export function SelectWalletType({
  onConnectionTypeClick,
  signedMessagesLength,
}: {
  onConnectionTypeClick: (walletType: SupportedHardwareWallet) => void
  signedMessagesLength: number
}): JSX.Element {
  return (
    <Box>
      <SectionTitle
        title="Select a Signing Device"
        description={`Choose whichever device is most convenient to use ${signedMessagesLength > 0 ? 'next' : 'first'}.`}
      />
      <Grid templateColumns="repeat(4, 1fr)" gap={8}>
        <ConnectionType
          title="Trezor"
          imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/trezor.svg`}
          imageAltText="Connect your Trezor"
          onClick={() => onConnectionTypeClick('trezor')}
        />
        <ConnectionType
          title="Ledger"
          imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/ledger.svg`}
          imageAltText="Connect your Ledger"
          onClick={() => onConnectionTypeClick('ledger')}
        />
        <ConnectionType
          title="COLDCARD"
          imagePath={`${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/coldcard.svg`}
          imageAltText="Connect your Coldcard"
          onClick={() => onConnectionTypeClick('coldcard')}
        />
        <ConnectionType
          title="Keystone"
          imagePath="/images/hardware-wallets/keystone-logo.svg"
          imageAltText="Connect your Keystone"
          onClick={() => onConnectionTypeClick('keystone')}
        />
      </Grid>
    </Box>
  )
}

function ConnectionType({
  title,
  imagePath,
  imageAltText,
  onClick,
}: {
  title: string
  imagePath: string
  imageAltText: string
  onClick: () => void
}) {
  return (
    <Stack
      onClick={onClick}
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="4px"
      alignItems="center"
      p={8}
      gap={8}
      _hover={{ cursor: 'pointer', bgColor: 'surface.subtle' }}
    >
      <Flex justifyContent="center" h="30px">
        <chakra.img src={imagePath} alt={imageAltText} maxW="100px" />
      </Flex>
      <Text textStyle="label/md" fontWeight="medium">
        {title}
      </Text>
    </Stack>
  )
}
