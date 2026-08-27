import { Progress, Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'

export default {
  title: 'Design system / Progress',
} satisfies StoryDefault

export const Default: Story = () => {
  return (
    <Stack>
      <Progress borderRadius="full" size="sm" value={75} max={100} />
      <Progress borderRadius="full" size="md" value={75} max={100} />
      <Progress borderRadius="full" size="lg" value={75} max={100} />
    </Stack>
  )
}
