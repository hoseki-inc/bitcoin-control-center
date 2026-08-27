import { HStack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { Badge } from './badge'

export default {
  title: 'Design system / Badge',
} satisfies StoryDefault

export const Default: Story = () => (
  <HStack>
    <Badge>Advanced</Badge>
    <Badge>P2WPKH</Badge>
  </HStack>
)
