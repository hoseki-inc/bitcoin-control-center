import { Button, HStack, Link, Stack, chakra } from '@chakra-ui/react'
import type { Story, StoryDefault } from '@ladle/react'
import { RestartIcon } from '../prove-verify-ui'
import { ErrorBanner, ErrorBlock, ErrorInline } from './errors'

export default {
  title: 'Design system / Errors',
} satisfies StoryDefault

export const ErrorBlocks: Story = () => {
  return (
    <Stack spacing={4}>
      <ErrorBlock
        title="Connection Unsuccessful"
        description="Something went wrong while connecting. Please try again."
        variant="error"
      />
      <ErrorBlock
        title="Connection Unsuccessful"
        description="Something went wrong while connecting. Please try again."
        variant="warning"
      />
      <ErrorBlock
        title="Connection Unsuccessful"
        description="Something went wrong while connecting. Please try again."
        variant="neutral"
      />
    </Stack>
  )
}

export const ErrorBanners: Story = () => {
  const rightContent = <Button>Retry</Button>
  return (
    <Stack>
      <ErrorBanner variant="error" message="Error: The claim was not added to your account" />
      <ErrorBanner
        variant="error"
        message="Error: The claim was not added to your account"
        rightContent={rightContent}
      />

      <ErrorBanner variant="warning" message="Error: The claim was not added to your account" />
      <ErrorBanner
        variant="warning"
        message="Error: The claim was not added to your account"
        rightContent={rightContent}
      />

      <ErrorBanner variant="neutral" message="Error: The claim was not added to your account" />
      <ErrorBanner
        variant="neutral"
        message="Error: The claim was not added to your account"
        rightContent={rightContent}
      />

      <ErrorBanner
        variant="neutral"
        message="Error: The claim was not added to your account"
        rightContent={
          <HStack py={3}>
            <Link as="button" fontWeight="semibold" onClick={() => {}}>
              Retry
            </Link>
            <RestartIcon strokeWidth={3} />
          </HStack>
        }
      />
    </Stack>
  )
}

export const ErrorInlines: Story = () => {
  const bulletList = (
    <chakra.ol ml={6}>
      <li>Do this first</li>
      <li>Then try this</li>
    </chakra.ol>
  )

  return (
    <Stack>
      <ErrorInline
        variant="error"
        title="Connection error"
        message="Please try again. If the issue continues, reach out to us at support@bitcoincontrolcenter.com."
      />
      <ErrorInline
        variant="error"
        title="Connection error"
        message="Please try the following steps:"
        otherContent={bulletList}
      />

      <ErrorInline
        variant="warning"
        title="Error loading data"
        message="Please try again. If the issue continues, reach out to us at support@bitcoincontrolcenter.com."
      />
      <ErrorInline
        variant="warning"
        title="Error loading data"
        message="Please try the following steps:"
        otherContent={bulletList}
      />

      <ErrorInline
        variant="neutral"
        title="Error loading data"
        message="Please try again. If the issue continues, reach out to us at support@bitcoincontrolcenter.com."
      />
      <ErrorInline
        variant="neutral"
        title="Error loading data"
        message="Please try the following steps:"
        otherContent={bulletList}
      />
    </Stack>
  )
}
