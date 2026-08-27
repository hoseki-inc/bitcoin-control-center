import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { ConnectManualBitcoinAccordion } from './connect-manual-bitcoin-accordion'

export default {
  title: 'Design system / Disclosure / Connect Manual Bitcoin Accordion',
} satisfies StoryDefault

export const Default: Story = () => {
  return (
    <Stack gap={4} maxW="700px">
      <ConnectManualBitcoinAccordion to="/lendee/connect/self-custody/bitcoin/manual" />
    </Stack>
  )
}
