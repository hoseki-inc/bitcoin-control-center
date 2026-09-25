import { Stack, chakra } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { borders } from '../css-debug'
import { HARDCODED_WALLETS } from './_test-data/ledger-test-wallets'
import { HardwareWalletCard } from './hardware-wallet-card'

export default {
  title: 'Prove / Hardware Wallet Card',
} satisfies StoryDefault

export const Default: Story = () => (
  <Stack {...borders.redSolid} gap={4} p={4} alignItems="center">
    {/* eslint-disable @typescript-eslint/no-non-null-assertion */}
    <HardwareWalletCard
      wallet={HARDCODED_WALLETS[0]!}
      isSelected={false}
      onClick={() => {
        alert('clicked')
      }}
      onUpdateDisplayName={(newDisplayName) => {
        alert('newDisplayName: ' + newDisplayName)
      }}
    />
    {/* eslint-disable @typescript-eslint/no-non-null-assertion */}
    <HardwareWalletCard
      wallet={HARDCODED_WALLETS[1]!}
      isSelected={true}
      onClick={() => {
        alert('clicked')
      }}
      onUpdateDisplayName={(newDisplayName) => {
        alert('newDisplayName: ' + newDisplayName)
      }}
    />
    {/* eslint-disable @typescript-eslint/no-non-null-assertion */}
    <HardwareWalletCard
      wallet={HARDCODED_WALLETS[1]!}
      isSelected={true}
      isDefaultExpanded={true}
      onClick={() => {
        alert('clicked')
      }}
      onUpdateDisplayName={(newDisplayName) => {
        alert('newDisplayName: ' + newDisplayName)
      }}
    />
    <chakra.div {...borders.greenSolid} p={4}>
      something below
    </chakra.div>
  </Stack>
)
