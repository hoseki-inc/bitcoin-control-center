import { Button, Stack, Text, chakra } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { toast } from 'sonner'

export default {
  title: 'Design system / Toasts',
} satisfies StoryDefault

export const Default: Story = () => (
  <Stack alignItems="flex-start">
    <Button
      onClick={() => {
        toast.success('The action you performed was a success.')
      }}
    >
      Success
    </Button>
    <Button
      onClick={() => {
        toast.error('The action you performed was a failure.')
      }}
    >
      Error
    </Button>
    <Button
      onClick={() => {
        toast.info('This is an information message.')
      }}
    >
      Info
    </Button>
    <Button
      onClick={() => {
        toast.warning('This is a warning message.')
      }}
    >
      Warning
    </Button>
    <Button
      onClick={() => {
        toast.info('Custom content', {
          duration: 7000,
          description: (
            <Text color="salmon">
              This is custom <b>HTML content</b> with{' '}
              <chakra.a href="/statements" color="purple" textDecoration="underline">
                a link
              </chakra.a>
              .
            </Text>
          ),
        })
      }}
    >
      Custom Content
    </Button>
  </Stack>
)
