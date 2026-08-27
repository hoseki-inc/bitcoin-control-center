import { FormControl, FormLabel, Stack } from '@chakra-ui/react'
import { Network } from '@hoseki/packages/bitcoin'
import type { Story, StoryDefault } from '@ladle/react'
import { useState } from 'react'
import { BitcoinNetworkSelect } from './bitcoin-network-select'

export default {
  title: 'Design system / Forms / Bitcoin Network Select',
} satisfies StoryDefault

export const Default: Story = () => {
  const [network, setNetwork] = useState<Network>(Network.Testnet)

  return (
    <Stack gap={4} maxW="500px">
      <FormControl>
        <FormLabel htmlFor="network">Network</FormLabel>
        <BitcoinNetworkSelect value={network} onChange={setNetwork} />
      </FormControl>
      <div>
        <strong>Selected Network:</strong> {network.toString()}
      </div>
    </Stack>
  )
}
