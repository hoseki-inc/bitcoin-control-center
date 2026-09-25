import { Stack } from '@chakra-ui/react'
import { Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import type { Story, StoryDefault } from '@ladle/react'
import type { BitcoinInput } from '../../utils/bitcoin'
import { AccountAccordion, type BalanceData } from './account-accordion'

export default {
  title: 'Design system / Disclosure / Account Accordion',
} satisfies StoryDefault

// Mock xpub for testing
const MOCK_XPUB =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'
const MOCK_DESCRIPTOR =
  'pkh(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)#kdnywuy7'

function createBitcoinInput(
  scriptType: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr',
  rawInput: string,
  displayName: string,
): BitcoinInput {
  const xpub = Slip132.getXpubFromString(MOCK_XPUB).expect('valid xpub')
  return {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, new SingleSigAccount(scriptType, xpub)),
    rawInput,
    displayName,
  }
}

export const WithBalance: Story = () => {
  const bitcoinInput = createBitcoinInput('p2pkh', MOCK_XPUB, 'My Bitcoin Wallet')
  const balance: BalanceData = {
    noBalance: null,
    btc: '0.5 BTC',
    usd: '$25,000',
  }

  return (
    <Stack gap={4} maxW="700px">
      <AccountAccordion
        bitcoinInput={bitcoinInput}
        balance={balance}
        onEditClick={() => {
          alert('Edit clicked')
        }}
      />
    </Stack>
  )
}

export const WithoutBalance: Story = () => {
  const bitcoinInput = createBitcoinInput('p2wpkh', MOCK_DESCRIPTOR, 'My SegWit Wallet')
  const balance: BalanceData = {
    noBalance: 'No balance found',
    btc: null,
    usd: null,
  }

  return (
    <Stack gap={4} maxW="700px">
      <AccountAccordion
        bitcoinInput={bitcoinInput}
        balance={balance}
        onEditClick={() => {
          alert('Edit clicked')
        }}
      />
    </Stack>
  )
}

export const Taproot: Story = () => {
  const bitcoinInput = createBitcoinInput('p2tr', MOCK_XPUB, 'My Taproot Wallet')
  const balance: BalanceData = {
    noBalance: null,
    btc: '1.25 BTC',
    usd: '$62,500',
  }

  return (
    <Stack gap={4} maxW="700px">
      <AccountAccordion
        bitcoinInput={bitcoinInput}
        balance={balance}
        onEditClick={() => {
          alert('Edit clicked')
        }}
      />
    </Stack>
  )
}

export const NestedSegWit: Story = () => {
  const bitcoinInput = createBitcoinInput('p2sh-p2wpkh', MOCK_DESCRIPTOR, 'My Nested SegWit Wallet')
  const balance: BalanceData = {
    noBalance: null,
    btc: '0.001 BTC',
    usd: '$50',
  }

  return (
    <Stack gap={4} maxW="700px">
      <AccountAccordion
        bitcoinInput={bitcoinInput}
        balance={balance}
        onEditClick={() => {
          alert('Edit clicked')
        }}
      />
    </Stack>
  )
}
