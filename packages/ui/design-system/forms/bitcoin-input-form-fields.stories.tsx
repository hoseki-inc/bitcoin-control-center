import { Stack } from '@chakra-ui/react'
import { Network, NetworkAccount, SingleSigAccount } from '@hoseki/packages/bitcoin'
import { Slip132 } from '@hoseki/packages/wallet'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import type { BitcoinInput } from '../../utils/bitcoin'
import { BitcoinInputFormFields } from './bitcoin-input-form-fields'

export default {
  title: 'Design system / Forms / Bitcoin Input Form Fields',
} satisfies StoryDefault

// Mock xpub for testing
const MOCK_XPUB =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'
const MOCK_DESCRIPTOR =
  'pkh(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)#kdnywuy7'

export const Empty: Story = () => {
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinInputFormFields setBitcoinInput={setBitcoinInput} />
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}

export const WithXpub: Story = () => {
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)
  const xpub = Slip132.getXpubFromString(MOCK_XPUB).expect('valid xpub')
  const defaultValues: BitcoinInput = {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, new SingleSigAccount('p2pkh', xpub)),
    rawInput: MOCK_XPUB,
    displayName: 'My Bitcoin Account',
  }

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinInputFormFields setBitcoinInput={setBitcoinInput} defaultValues={defaultValues} />
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}

export const WithDescriptor: Story = () => {
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)
  const singleSigAccount = SingleSigAccount.fromDescriptor(MOCK_DESCRIPTOR).expect('valid account')
  const defaultValues: BitcoinInput = {
    variant: 'singlesig',
    data: new NetworkAccount(Network.Mainnet, singleSigAccount),
    rawInput: MOCK_DESCRIPTOR,
    displayName: 'My Bitcoin Account',
  }

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinInputFormFields setBitcoinInput={setBitcoinInput} defaultValues={defaultValues} />
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}

export const WithTestnet: Story = () => {
  const [bitcoinInput, setBitcoinInput] = useState<BitcoinInput | null>(null)
  const testnetXpub =
    'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'
  const testnetDescriptor = `pkh(${testnetXpub}/<0;1>/*)#c4nu0fm0`

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinInputFormFields setBitcoinInput={setBitcoinInput} />
      <div>
        <strong>Try entering:</strong>
        <pre>{testnetDescriptor}</pre>
      </div>
      {bitcoinInput && (
        <div>
          <strong>Parsed Input:</strong>
          <pre>{JSON.stringify(bitcoinInput, null, 2)}</pre>
        </div>
      )}
    </Stack>
  )
}
