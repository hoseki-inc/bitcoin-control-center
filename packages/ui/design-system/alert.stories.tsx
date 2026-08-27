import { VStack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { Alert } from './alert'

export default {
  title: 'Design system / Alert',
} satisfies StoryDefault

export const Inline: Story = () => (
  <VStack align="stretch" spacing={4}>
    <Alert status="info" title="Statement generated">
      Your proof of ownership statement has been successfully created and is ready to share.
    </Alert>
    <Alert status="warning" title="Save your API key">
      Please save this API key now. You will not be able to see it again after closing this window.
    </Alert>
    <Alert status="error" title="Connection failed">
      Unable to connect to your wallet. Please check your device connection and try again.
    </Alert>
  </VStack>
)

export const Toast: Story = () => (
  <VStack align="stretch" spacing={4}>
    <Alert variant="toast" status="info" title="Did you know?">
      You can verify your Bitcoin holdings without revealing your wallet address or full balance.
    </Alert>
    <Alert variant="toast" status="warning" title="Save your API key">
      Please save this API key now. You will not be able to see it again after closing this window.
    </Alert>
    <Alert variant="toast" status="error" title="Connection failed" onRetry={() => alert('Retried!')}>
      Unable to connect to your wallet. Please check your device connection and try again.
    </Alert>
  </VStack>
)

export const WithCustomBackground: Story = () => (
  <VStack align="stretch" spacing={4}>
    <Alert bgColor="neutral.50" title="Custom background">
      This alert uses <code>bgColor=&quot;neutral.50&quot;</code> to show that Chakra style props are still forwarded.
    </Alert>
  </VStack>
)
