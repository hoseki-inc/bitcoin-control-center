import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { Address } from '../../bitcoin'
import { GenericSigningSteps } from './generic-signing-steps'

export default {
  title: 'Prove / Generic Signing Steps',
} satisfies StoryDefault

const signedMessage = {
  messageTextToSign: 'I, Craig Wright, hereby declare that I am the creator of the Bitcoin protocol.',
  address: Address.fromString('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').expect('valid address'),
  signingPath: "m/84'/0'/0'/0/5",
}

export const Ledger: Story = () => (
  <GenericSigningSteps
    walletType="Ledger"
    signingAnimation="ledgerUniqueMessage"
    isLoading={false}
    error={undefined}
    signedMessage={signedMessage}
    onProveControl={() => {}}
    onBack={() => {}}
    signingInProgress={false}
  />
)

export const Trezor: Story = () => (
  <GenericSigningSteps
    walletType="Trezor"
    signingAnimation="trezorUniqueMessage"
    isLoading={false}
    error={undefined}
    signedMessage={signedMessage}
    onProveControl={() => {}}
    onBack={() => {}}
    signingInProgress={false}
  />
)

export const SigningInProgress: Story = () => (
  <Stack>
    <p>NOTE: go to the 3rd step to see the animation</p>
    <GenericSigningSteps
      walletType="Ledger"
      signingAnimation="ledgerUniqueMessage"
      isLoading={false}
      error={undefined}
      signedMessage={signedMessage}
      onProveControl={() => {}}
      onBack={() => {}}
      signingInProgress={true}
    />
  </Stack>
)

export const Error: Story = () => (
  <GenericSigningSteps
    walletType="Ledger"
    signingAnimation="ledgerUniqueMessage"
    isLoading={false}
    error={{ message: 'Oh dear, an error occurred' }}
    signedMessage={signedMessage}
    onProveControl={() => {}}
    onBack={() => {}}
    signingInProgress={true}
  />
)
