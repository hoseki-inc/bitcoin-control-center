import { Stack } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { IconLogo, Logo } from './logo'

export default {
  title: 'Prove and Verify / Logo',
} satisfies StoryDefault

export const BasicLogo: Story = () => {
  return (
    <Stack>
      <IconLogo />
      <Logo />
    </Stack>
  )
}

export const WithStaging: Story = () => {
  return (
    <Stack>
      <IconLogo stickerLabel="Staging" />
      <Logo stickerLabel="Development" />
    </Stack>
  )
}
