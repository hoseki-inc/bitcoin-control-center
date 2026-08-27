import { HStack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { RadioCard, RadioCardGroup } from './radio-card'

export default {
  title: 'Design system / Forms / RadioCard',
} satisfies StoryDefault

export const Single: Story = () => (
  <HStack>
    <RadioCard>A Single RadioCard</RadioCard>
  </HStack>
)

export const Group: Story = () => {
  const options = ['Legacy (P2PKH)', 'Nested SegWit (P2SH)', 'Native SegWit (P2WPKH)', 'Taproot (P2TR)']
  return <RadioCardGroup options={options} name="scriptType" defaultValue={options[1]} onChange={console.log} />
}
