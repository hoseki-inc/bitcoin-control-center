import { Button, Stack, Text, useDisclosure } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { Spinner } from './spinner'

export default {
  title: 'Design system / Spinner',
} satisfies StoryDefault

export const Default: Story = () => <Spinner />

export const FullPage: Story = () => (
  <Stack>
    <Text>Full page spinner always positioned in middle of the screen.</Text>
    <Spinner fullPage />
  </Stack>
)

export const Centered: Story = () => <Spinner centered />

export const Lazy: Story = () => {
  const { isOpen, onToggle } = useDisclosure()

  return (
    <Stack>
      <Text>Lazy Spinners are only shown after 200ms of being mounted.</Text>
      {isOpen && <Spinner isLazy />}
      <Button onClick={() => onToggle()}>Toggle Mounting Spinner</Button>
    </Stack>
  )
}
