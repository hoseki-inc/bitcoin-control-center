import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { AdvancedFeatureAlert } from './advanced-feature-alert'

export default {
  title: 'Design system / Feedback / Advanced Feature Alert',
} satisfies StoryDefault

export const Default: Story = () => {
  return (
    <Stack gap={4} maxW="700px">
      <AdvancedFeatureAlert />
    </Stack>
  )
}
