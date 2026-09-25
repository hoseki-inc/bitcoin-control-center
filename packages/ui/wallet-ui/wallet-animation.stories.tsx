import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { ColdcardModels } from './coldcard/coldcard-utils'
import { getLedgerImageByModelName } from './ledger/floating-ledger-image'
import { getTrezorImageByModelName } from './trezor/floating-trezor-image'
import { WalletFloatingImage } from './wallet-animation'

export default {
  title: 'Prove / Floating Wallet Images',
} satisfies StoryDefault

export const LedgerImages: Story = () => (
  <Stack spacing={4}>
    <WalletFloatingImage {...getLedgerImageByModelName('Nano S')} />
    <WalletFloatingImage {...getLedgerImageByModelName('Nano S Plus')} />
    <WalletFloatingImage {...getLedgerImageByModelName('Nano X')} />
    <WalletFloatingImage {...getLedgerImageByModelName('Flex')} />
    <WalletFloatingImage {...getLedgerImageByModelName('Stax')} />
  </Stack>
)

export const TrezorImages: Story = () => (
  <Stack spacing={4}>
    <WalletFloatingImage {...getTrezorImageByModelName('T')} />
    <WalletFloatingImage {...getTrezorImageByModelName('Safe 3 (Bitcoin-only)')} />
    <WalletFloatingImage {...getTrezorImageByModelName('Safe 3')} />
    <WalletFloatingImage {...getTrezorImageByModelName('Safe 5')} />
    <WalletFloatingImage {...getTrezorImageByModelName('One')} />
  </Stack>
)

export const ColdcardImages: Story = () => {
  const mk2mk3 = ColdcardModels['MK2/MK3']
  const mk4 = ColdcardModels.MK4
  const q = ColdcardModels.Q

  return (
    <Stack spacing={4}>
      <WalletFloatingImage href={mk2mk3.imageSrc} alt={mk2mk3.imageAlt} />
      <WalletFloatingImage href={mk4.imageSrc} alt={mk4.imageAlt} />
      <WalletFloatingImage href={q.imageSrc} alt={q.imageAlt} />
    </Stack>
  )
}
