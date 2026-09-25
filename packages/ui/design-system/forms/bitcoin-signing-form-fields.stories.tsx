import { Stack } from '@chakra-ui/react'
import { Address } from '@hoseki/packages/bitcoin'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { BitcoinSigningFormFields } from './bitcoin-signing-form-fields'

export default {
  title: 'Design system / Forms / Bitcoin Signing Form Fields',
} satisfies StoryDefault

// Mock address for testing
const MOCK_ADDRESS_MAINNET = 'bc1qae3yup8ulj732scv3y3k2lr58kuqe7mxhnena8'
const MOCK_MESSAGE = 'This is a test message that needs to be signed with a Bitcoin private key.'

export const Default: Story = () => {
  const [signature, setSignature] = useState<string | null>(null)
  const address = Address.fromString(MOCK_ADDRESS_MAINNET).expect('valid address')

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinSigningFormFields message={MOCK_MESSAGE} address={address} setSignature={setSignature} />
      {signature != null && signature !== '' && (
        <div>
          <strong>Signature:</strong>
          <pre>{signature}</pre>
        </div>
      )}
    </Stack>
  )
}

export const WithLongMessage: Story = () => {
  const [signature, setSignature] = useState<string | null>(null)
  const address = Address.fromString(MOCK_ADDRESS_MAINNET).expect('valid address')
  const longMessage =
    'This is a much longer message that demonstrates how the form handles extended text content. It should still work correctly and display properly in the UI.'

  return (
    <Stack gap={4} maxW="700px">
      <BitcoinSigningFormFields message={longMessage} address={address} setSignature={setSignature} />
      {signature != null && signature !== '' && (
        <div>
          <strong>Signature:</strong>
          <pre>{signature}</pre>
        </div>
      )}
    </Stack>
  )
}
