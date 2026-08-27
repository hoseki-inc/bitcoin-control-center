import { Button, HStack } from '@chakra-ui/react'
import type { Story } from '@ladle/react'
import { Receipt as ReceiptComponent } from './receipt'

export default {
  title: 'Prove and Verify / Receipt',
}

export const Loading: Story = () => (
  <ReceiptComponent title="Hang tight..." state="loading" onClose={() => alert('close')} />
)

export const Receipt: Story = () => (
  <ReceiptComponent
    title="Claim Verified!"
    state="success"
    onClose={() => alert('close')}
    content={
      <HStack spacing={4}>
        <Button variant="outline">Back to Dashboard</Button>
        <Button>Do Another Thing</Button>
      </HStack>
    }
  />
)
