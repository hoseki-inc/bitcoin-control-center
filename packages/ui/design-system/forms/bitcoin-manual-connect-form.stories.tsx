import { Stack } from '@chakra-ui/react'
import { Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import type { BitcoinInput } from '../../utils/bitcoin'
import { BitcoinManualConnect } from './bitcoin-manual-connect-form'

export default {
  title: 'Design system / Forms / Bitcoin Manual Connect',
} satisfies StoryDefault

// Mock xpub for testing
const MOCK_XPUB =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'

export const Empty: Story = () => {
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinManualConnect bitcoinInput={bitcoinInput} setBitcoinInput={setBitcoinInput} />
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}

export const WithInitialValue: Story = () => {
  const xpub = Slip132.getXpubFromString(MOCK_XPUB).expect('valid xpub')
  const defaultValues: BitcoinInput = {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, new SingleSigAccount('p2pkh', xpub)),
    rawInput: MOCK_XPUB,
    displayName: 'My Bitcoin Account',
  }
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(defaultValues)

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinManualConnect bitcoinInput={bitcoinInput} setBitcoinInput={setBitcoinInput} />
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}
