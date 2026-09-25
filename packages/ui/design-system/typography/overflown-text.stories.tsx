import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { OverflownText as OverflownTextComponent } from './overflown-text'

export default {
  title: 'Design system / Typography',
} satisfies StoryDefault

export const OverflownText: Story = () => {
  const sentences = [
    'This is a small sentence.',
    'Hover me to see the full text, since this is a larger sentence that should be truncated.',
  ]
  return (
    <Stack border="1px solid" borderColor="neutral.200" p={4} w="250px" gap={4}>
      {sentences.map((sentence) => (
        <OverflownTextComponent key={sentence}>{sentence}</OverflownTextComponent>
      ))}
    </Stack>
  )
}
